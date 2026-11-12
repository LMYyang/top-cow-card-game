import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { RoomManager } from './rooms.js'

/**
 * 顶牛子联网对战服务器。
 * createServerApp(port) 返回 { httpServer, wss, port, mgr }，便于测试用随机端口。
 * node index.js 直接启动（默认 3001，PORT 环境变量可覆盖）。
 */

export function createServerApp(port = 3001) {
  const mgr = new RoomManager()
  const httpServer = createServer((_req, res) => {
    res.writeHead(426).end('WebSocket only') // 拒绝普通 HTTP 请求
  })
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (socket) => {
    // 连接级包装：send 支持对象并自动 JSON；close 幂等
    const conn = {
      raw: socket,
      token: null, // 认证后由路由写入（room.* 成功响应或 reconnect）
      send(obj) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj)) },
      close() { try { socket.close() } catch { /* noop */ } },
    }
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
    socket.on('close', () => mgr.onConnClose(conn))
  })

  const sweepTimer = setInterval(() => mgr.sweep(), 30_000)
  sweepTimer.unref?.()

  return { httpServer, wss, port, mgr }
}

/** 消息路由：type → RoomManager 方法。有 requestId 时带 requestId 回执 */
function handle(mgr, conn, msg) {
  const { type, payload = {}, requestId } = msg || {}
  const reply = (t, p) => conn.send({ type: t, payload: p, ...(requestId ? { requestId } : {}) })
  const replyError = (code, message) => reply('error', { code, message })

  switch (type) {
    case 'room.create': {
      const { room, token, seat, error } = mgr.createRoom(conn, sanitizeName(payload.name))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.created', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.join': {
      const roomId = Number(payload.roomId)
      if (!Number.isInteger(roomId)) return replyError('BAD_REQUEST', '房间号非法')
      const { room, token, seat, error } = mgr.joinRoom(conn, sanitizeName(payload.name), roomId)
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.joined', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.quickMatch': {
      const { room, token, seat, error } = mgr.quickMatch(conn, sanitizeName(payload.name))
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
    case 'room.leave': {
      mgr.leave(conn.token)
      conn.token = null
      return reply('room.left', {})
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
    case 'reconnect': {
      const res = mgr.reconnect(conn, String(payload.token || ''))
      if (res.error) return replyError(res.error.code, res.error.message)
      conn.token = String(payload.token)
      return reply('reconnected', { room: mgr.roomState(res.room), yourSeat: res.seat })
    }
    default:
      return replyError('UNKNOWN_TYPE', `未知消息类型: ${type}`)
  }
}

function sanitizeName(name) {
  const s = String(name ?? '').trim().slice(0, 12)
  return s || '玩家'
}

// 直接运行时启动（被 import 时不启动）
const entry = process.argv[1]?.replace(/\\/g, '/')
if (entry && import.meta.url.endsWith(entry)) {
  const app = createServerApp(Number(process.env.PORT || 3001))
  app.httpServer.listen(app.port, () => console.log(`[dingniuzi] ws server listening on :${app.port}`))
}
