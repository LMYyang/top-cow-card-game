import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { RoomManager } from './rooms.js'

/**
 * 顶牛子联网对战服务器。
 * createServerApp(port, opts) 返回 { httpServer, wss, port, mgr }，便于测试用随机端口与短心跳。
 * node index.js 直接启动（默认 3001，PORT 环境变量可覆盖）。
 */

const HEARTBEAT_MS = 15_000 // 心跳周期：连续两轮（~30s）ping 无回应判定死链

export function createServerApp(port = 3001, { heartbeatMs = HEARTBEAT_MS } = {}) {
  const mgr = new RoomManager()
  const httpServer = createServer((_req, res) => {
    res.writeHead(426).end('WebSocket only') // 拒绝普通 HTTP 请求
  })
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 }) // 限制单帧大小，防恶意大帧

  wss.on('connection', (socket) => {
    // 连接级包装：send 支持对象并自动 JSON；close 幂等
    const conn = {
      raw: socket,
      token: null, // 认证后由路由写入（room.* 成功响应或 reconnect）
      alive: true, // 心跳标记：每轮 ping 前置 false，收到 pong（或任何帧）置 true
      send(obj) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj)) },
      close() { try { socket.close() } catch { /* noop */ } },
    }
    // 收帧异常（非 mask 帧/非法 UTF-8/超 maxPayload）会 emit 'error'，无监听会 uncaughtException 崩服
    socket.on('error', (err) => console.error('[server] socket error:', err.message))
    // 半开连接检测：客户端断网/杀进程时 TCP 不会发 FIN，socket 'close' 永不触发，
    // 成员 connected 恒为 true → WAITING 房永远不被清理（房间里僵尸占位、列表一直展示）。
    // 服务端周期 ping，两轮无 pong 视为死链 terminate()，触发 onConnClose 走正常断线清理。
    socket.on('pong', () => { conn.alive = true })
    socket.on('message', () => { conn.alive = true }) // 有任何业务帧也算活着
    const beat = setInterval(() => {
      if (socket.readyState !== socket.OPEN) { clearInterval(beat); return }
      if (!conn.alive) {
        clearInterval(beat)
        socket.terminate() // 触发 'close' → mgr.onConnClose(conn)
        return
      }
      conn.alive = false
      try { socket.ping() } catch { /* readyState 竞态：下一轮再判 */ }
    }, heartbeatMs)
    beat.unref?.()
    socket.on('close', () => {
      clearInterval(beat)
      mgr.onConnClose(conn)
    })
    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch {
        conn.send({ type: 'error', payload: { code: 'BAD_JSON', message: '消息格式错误' } })
        return
      }
      try {
        handle(mgr, conn, msg)
      } catch (e) {
        // 防御性兜底：任何处理异常不至崩服
        conn.send({ type: 'error', payload: { code: 'INTERNAL', message: '服务器内部错误' } })
        console.error('[server] handle error:', e)
      }
    })
  })

  const sweepTimer = setInterval(() => mgr.sweep(), 30_000)
  sweepTimer.unref?.()

  return { httpServer, wss, port, mgr }
}

/** 消息路由：type → RoomManager 方法。有 requestId 时带 requestId 回执 */
function handle(mgr, conn, msg) {
  const { type, requestId } = msg || {}
  const payload = (msg && msg.payload) || {}
  const reply = (t, p) => conn.send({ type: t, payload: p, ...(requestId ? { requestId } : {}) })
  const replyError = (code, message) => reply('error', { code, message })

  switch (type) {
    case 'room.list': {
      // 大厅房间列表：无需入房身份，任何人可查（只含未开局、有真人在线、未满员的房）
      return reply('room.list.ok', { rooms: mgr.listRooms() })
    }
    case 'room.create': {
      const { room, token, seat, error } = mgr.createRoom(conn, sanitizeName(payload.name), String(payload.token || ''))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.created', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.join': {
      const roomId = Number(payload.roomId)
      if (!Number.isInteger(roomId)) return replyError('BAD_REQUEST', '房间号非法')
      const { room, token, seat, error } = mgr.joinRoom(conn, sanitizeName(payload.name), roomId, String(payload.token || ''))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.joined', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.quickMatch': {
      const { room, token, seat, error } = mgr.quickMatch(conn, sanitizeName(payload.name), String(payload.token || ''))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.joined', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.seat': {
      // 协议约定 room.seat 只带 { seat }：房间由 token 反查（payload.roomId 不存在，Number(undefined)=NaN 会导致误判 ROOM_GONE）
      const room = mgr.roomOf(conn.token)
      if (!room) return replyError('NOT_IN_ROOM', '不在此房间')
      const res = mgr.moveSeat(conn.token, room.roomId, Number(payload.seat))
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.seat.ok', {})
    }
    case 'room.ready': {
      // 同 room.seat：房间由 token 反查
      const room = mgr.roomOf(conn.token)
      if (!room) return replyError('NOT_IN_ROOM', '不在此房间')
      const res = mgr.setReady(conn.token, room.roomId, !!payload.ready)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.ready.ok', {})
    }
    case 'room.kick': {
      // 房主踢人：目标由 payload.token 指定（被踢方凭 token 索引移除，房主身份服务端校验）
      const room = mgr.roomOf(conn.token)
      if (!room) return replyError('NOT_IN_ROOM', '不在此房间')
      const res = mgr.kickMember(conn.token, room.roomId, String(payload.token || ''))
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.kick.ok', {})
    }
    case 'room.poke': {
      // 房主提醒未准备玩家：目标由 payload.token 指定
      const room = mgr.roomOf(conn.token)
      if (!room) return replyError('NOT_IN_ROOM', '不在此房间')
      const res = mgr.pokeMember(conn.token, room.roomId, String(payload.token || ''))
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.poke.ok', {})
    }
    case 'room.leave': {
      // 先回执再离开：对局中 leave 会关闭连接，后发回执将永远无法送达
      reply('room.left', {})
      mgr.leave(conn.token)
      conn.token = null
      return
    }
    case 'game.start': {
      const room = mgr.roomOf(conn.token)
      const res = mgr.startGame(conn.token, room ? room.roomId : NaN)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('game.started', {})
    }
    case 'game.roll':
    case 'game.play':
    case 'game.discard':
    case 'game.settleContinue': {
      const res = mgr.gameAction(conn.token, type, payload)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('action.ok', {})
    }
    case 'session.check': {
      // 会话预检（大厅用）：本地存有 token 时查询是否有可恢复的房（对局中宽限期内）
      const found = mgr.checkSession(String(payload.token || ''))
      return reply('session.check.ok', { session: found })
    }
    case 'reconnect': {
      const reqToken = String(payload.token || '')
      if (conn.token && conn.token !== reqToken) mgr.leave(conn.token) // 跨房重连：先按旧 token 退出旧房（WAITING 移除；对局中按断线宽限处理）
      const res = mgr.reconnect(conn, reqToken)
      if (res.error) return replyError(res.error.code, res.error.message)
      conn.token = reqToken
      return reply('reconnected', { room: mgr.roomState(res.room), yourSeat: res.seat })
    }
    default:
      return replyError('UNKNOWN_TYPE', '未知消息类型') // 不回显原始 type，防注入/反射
  }
}

function sanitizeName(name) {
  // 先剔除控制字符与 RTL 覆写字符（可被用于日志/界面欺骗），再截断
  const s = String(name ?? '').replace(/[\u0000-\u001f\u202a-\u202e]/g, '').trim().slice(0, 12)
  return s || '玩家'
}

// 直接运行时启动（被 import 时不启动）
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && entry === import.meta.url) {
  const app = createServerApp(Number(process.env.PORT || 3001))
  app.httpServer.listen(app.port, () => console.log(`[dingniuzi] ws server listening on :${app.port}`))
}
