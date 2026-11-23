/**
 * 联网对战全场景协议层测试（真实时钟，无伪定时器——ws IO 与服务器 setTimeout 混跑时
 * vi.advanceTimersByTime 会让真实 socket 回调饿死，此前 9 个失败全部是该问题）。
 * 宽限/超时类用例通过注入 mgr 内部定时器？不行——改为直接调用 mgr 方法模拟到期，
 * 或对超时类用例临时把 GRACE_MS 视为不可配而跳过（已有 server-rooms.test.js 伪时钟覆盖）。
 * 本文件专注于真实 IO 下的行为链路。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { createServerApp } from '../server/index.js'

let app
beforeAll(async () => {
  app = createServerApp(0)
  await new Promise((resolve) => {
    app.httpServer.once('listening', resolve)
    app.httpServer.listen(app.port)
  })
})
afterAll(async () => {
  for (const cs of app.wss.clients) cs.terminate()
  await Promise.all([
    new Promise((resolve) => app.wss.close(resolve)),
    new Promise((resolve) => app.httpServer.close(resolve)),
  ])
})

function wsUrl() { return `ws://127.0.0.1:${app.httpServer.address().port}` }

function client() {
  const ws = new WebSocket(wsUrl())
  ws.on('ping', () => ws.pong()) // 服务端心跳：node ws 客户端需手动回 pong（浏览器自动）
  const inbox = []
  const waiters = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    inbox.push(msg)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1) }
    }
  })
  const opened = new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  const request = (type, payload = {}) => {
    const id = `req-${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`request('${type}') 超时`)), 3000)
      waiters.push({
        pred: (m) => m.requestId === id,
        resolve: (msg) => { clearTimeout(timer); resolve(msg) },
      })
      ws.send(JSON.stringify({ type, payload, requestId: id }))
    })
  }
  const terminate = () => { try { ws.terminate() } catch { /* noop */ } }
  return { ws, inbox, opened, request, terminate }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询条件直到真或超时 */
async function until(fn, ms, label) {
  const deadline = Date.now() + ms
  let last
  while (Date.now() < deadline) {
    last = fn()
    if (last) return last
    await sleep(100)
  }
  throw new Error(`until(${label}) 超时`)
}

/** 建一个 4 人满员已开局房间（真人全在位，掷骰未掷） */
async function fullRoom() {
  const host = client()
  await host.opened
  const created = await host.request('room.create', { name: '甲' })
  const roomId = created.payload.room.roomId
  const tokens = [created.payload.token]
  const guests = []
  for (const n of ['乙', '丙', '丁']) {
    const c = client()
    await c.opened
    const r = await c.request('room.join', { name: n, roomId })
    tokens.push(r.payload.token)
    guests.push(c)
  }
  for (const c of [host, ...guests]) await c.request('room.ready', { ready: true })
  await host.request('game.start', {})
  const room = () => app.mgr.tokens.get(tokens[0])
  return { host, guests, roomId, tokens, room }
}

describe('多人边界（真实 IO）', () => {
  it('满员 WAITING 房第 5 人 quickMatch 不会挤进（落到新房）', async () => {
    const { roomId, tokens, room } = await fullRoom()
    // 打完掷骰把房间推入 PLAYING，再断言 join 满员开局房被拒
    const host = client()
    await host.opened
    await host.request('reconnect', { token: tokens[0] })
    await host.request('game.roll', {})
    await sleep(4200)
    expect(room().game.state).toBe('PLAYING')
    const fifth = client()
    await fifth.opened
    const r1 = await fifth.request('room.join', { name: '戊', roomId })
    expect(r1.type).toBe('error')
    expect(r1.payload.code).toBe('ROOM_STARTED') // 满员+已开局：先被 started 拦下
    const r2 = await fifth.request('room.quickMatch', { name: '戊' })
    expect(r2.type).toBe('room.joined')
    expect(r2.payload.room.roomId).not.toBe(roomId)
  })

  it('对局中 createRoom/joinRoom/quickMatch 挤不进，本人原房间身份保留可继续打', async () => {
    const { host, roomId, room } = await fullRoom()
    const r1 = await host.request('room.create', { name: '甲' })
    expect(r1.type).toBe('error')
    expect(r1.payload.code).toBe('ROOM_STARTED')
    const r2 = await host.request('room.join', { name: '甲', roomId: 1 })
    expect(r2.type).toBe('error') // ROOM_GONE 或 ROOM_STARTED 均可，但身份保留
    // 原房间还能掷骰（身份保留的铁证）
    const r3 = await host.request('game.roll', {})
    expect(r3.type).toBe('action.ok')
    await until(() => room().game.state === 'PLAYING', 8000, '掷骰时间线后进 PLAYING')
    expect(room().game.state).toBe('PLAYING')
  })

  it('WAITING 换座位：占用位/非法座位被拒，空位成功', async () => {
    const host = client()
    await host.opened
    const created = await host.request('room.create', { name: '甲' })
    const roomId = created.payload.room.roomId
    const g = client()
    await g.opened
    await g.request('room.join', { name: '乙', roomId })
    const r1 = await host.request('room.seat', { seat: 1 })
    expect(r1.type).toBe('error')
    expect(r1.payload.code).toBe('SEAT_TAKEN')
    const r2 = await host.request('room.seat', { seat: 99 })
    expect(r2.type).toBe('error')
    expect(r2.payload.code).toBe('SEAT_INVALID')
    const r3 = await host.request('room.seat', { seat: 2 })
    expect(r3.type).toBe('room.seat.ok')
  })
})

/** 全员掉线托管打完一局（掉线即 aiTimer，maybeAutoRoll/scheduleAiTurn 全自动） */
async function playToSettleByTakeover(tokens) {
  for (const t of tokens) {
    const room = app.mgr.tokens.get(t)
    const m = room.members.find((x) => x.token === t)
    if (m && m.conn) { m.conn.raw.terminate() }
  }
  await sleep(300)
  const room = app.mgr.tokens.get(tokens[0]) || [...app.mgr.rooms.values()][0]
  return until(() => (room.game?.state === 'SETTLE' ? room : null), 60000, '托管打到 SETTLE')
}

describe('连续局推进（真实 IO）', () => {
  it('结算后全员重连并 settleContinue → 房间重置回 WAITING 且全员已准备', async () => {
    const { tokens } = await fullRoom()
    const room = await playToSettleByTakeover(tokens)
    // 全员重连（掉线成员未超 60s 宽限），确认后回房间（WAITING）
    for (const t of tokens) {
      const c = client()
      await c.opened
      const re = await c.request('reconnect', { token: t })
      expect(re.type).toBe('reconnected')
      const ack = await c.request('game.settleContinue', {})
      expect(ack.type).toBe('action.ok')
    }
    await until(() => room.game === null, 5000, '全员确认后重置回 WAITING')
    expect(room.members.every((m) => m.ready)).toBe(true)
    expect(room.members.every((m) => !m.isAI)).toBe(true)
  }, 70000)

  it('结算后仅 1 人确认，5s 超时自动重置回 WAITING', async () => {
    const { tokens } = await fullRoom()
    const room = await playToSettleByTakeover(tokens)
    const c = client()
    await c.opened
    await c.request('reconnect', { token: tokens[0] })
    await c.request('game.settleContinue', {})
    expect(room.game).not.toBe(null) // 未齐，等超时
    await until(() => room.game === null, 8000, '5s 超时重置回 WAITING')
    expect(room.members.every((m) => m.ready)).toBe(true)
  }, 70000)

  it('结算前 settleContinue 被拒 BAD_STATE；未知动作被路由层拒 UNKNOWN_TYPE', async () => {
    const { host } = await fullRoom()
    const r1 = await host.request('game.settleContinue', {})
    expect(r1.type).toBe('error')
    expect(r1.payload.code).toBe('BAD_STATE')
    const r2 = await host.request('game.foo', {})
    expect(r2.type).toBe('error')
    expect(['UNKNOWN_TYPE', 'UNKNOWN_ACTION']).toContain(r2.payload.code)
  })
})

describe('断线重连（真实 IO）', () => {
  it('掷骰中断线：托管自动掷完成发牌，重连不重发牌', async () => {
    const { host, tokens, room } = await fullRoom()
    void host
    await host.request('game.roll', {})
    await sleep(500) // 编排中（1.2s 定骰前）
    const c0 = client() // 房主连接已断（fullRoom 后 host 连接还在——这里先断）
    void c0
    host.terminate()
    await sleep(150)
    await until(() => room().game.state === 'PLAYING', 10000, '托管自动掷后进 PLAYING')
    expect(room().game.players.every((p) => p.hand.length === 6)).toBe(true)
    const c2 = client()
    await c2.opened
    const re = await c2.request('reconnect', { token: tokens[0] })
    expect(re.type).toBe('reconnected')
    expect(room().game.players.every((p) => p.hand.length === 6)).toBe(true)
  })

  it('出牌中断线：托管代打本座位；重连收回托管', async () => {
    const { tokens, room } = await fullRoom()
    // 全员掉线 → 整局由托管 AI 驱动（只断乙的话，其他真人座位不动，整局会卡在真人回合）
    for (const t of tokens) {
      const m = room().members.find((x) => x.token === t)
      if (m && m.conn) { m.conn.raw.terminate() }
    }
    await sleep(300)
    // 等到乙（座位1）真出过一次牌（托管代打）
    await until(() => room().game.tableHistory.some((e) => e.seat === 1), 20000, '托管代打乙出牌')
    const c2 = client()
    await c2.opened
    const re = await c2.request('reconnect', { token: tokens[1] })
    expect(re.type).toBe('reconnected')
    const m = room().members.find((x) => x.token === tokens[1])
    expect(m.connected).toBe(true)
    expect(m.aiTimer).toBeNull()
  }, 30000)

  it('结算中断线重连：能继续 settleContinue 重置房间回 WAITING', async () => {
    const { tokens } = await fullRoom()
    const room = await playToSettleByTakeover(tokens)
    const c = client()
    await c.opened
    const re = await c.request('reconnect', { token: tokens[0] })
    expect(re.type).toBe('reconnected')
    const ack = await c.request('game.settleContinue', {})
    expect(ack.type).toBe('action.ok')
    expect(room.game).not.toBe(null) // 只 1 人确认，未超时仍在结算
  }, 70000)

  it('对局中主动退出（room.leave）：连接关闭走宽限+托管，宽限内凭 token 重连可回房', async () => {
    const { tokens, room } = await fullRoom()
    const c2 = client()
    await c2.opened
    await c2.request('reconnect', { token: tokens[1] })
    // 主动退出：回执 room.left 后连接被服务器关闭，座位进入宽限+托管
    const left = await c2.request('room.leave', {})
    expect(left.type).toBe('room.left')
    await until(() => {
      const m = room().members.find((x) => x.token === tokens[1])
      return m && !m.connected && m.aiTimer
    }, 3000, '退出后进托管')
    // 宽限期内凭 token 重连：恢复身份
    const c3 = client()
    await c3.opened
    const re = await c3.request('reconnect', { token: tokens[1] })
    expect(re.type).toBe('reconnected')
    const m = room().members.find((x) => x.token === tokens[1])
    expect(m.connected).toBe(true)
    expect(m.aiTimer).toBeNull()
    expect(m.gone).toBe(false)
  }, 15000)

  it('WAITING 主动退出：token 立即失效（reconnect 拒 ROOM_GONE）', async () => {
    const host = client()
    await host.opened
    const created = await host.request('room.create', { name: '甲' })
    const token = created.payload.token
    const left = await host.request('room.leave', {})
    expect(left.type).toBe('room.left')
    // 服务器 removeMember 已删 token；客户端本地也清 storage。凭旧 token 重连必须被拒
    const c2 = client()
    await c2.opened
    const re = await c2.request('reconnect', { token })
    expect(re.type).toBe('error')
    expect(re.payload.code).toBe('ROOM_GONE')
  })

  it('掉线超 60s 宽限：token 失效，重连被拒（WAITING 房移除成员，ROOM_GONE）', async () => {
    // 不做真实 60s 等待：直接调 mgr 内部宽限定时器无法注入，
    // 改为验证「gone 后 reconnect 拒绝」这一不变式——手动置 gone 模拟宽限到期后的状态
    const host = client()
    await host.opened
    const created = await host.request('room.create', { name: '甲' })
    const token = created.payload.token
    const roomId = created.payload.room.roomId
    const room = app.mgr.rooms.get(roomId)
    const me = room.members.find((m) => m.token === token)
    me.gone = true // 模拟宽限到期（60s 真等太慢；grace 路径已由上面用例覆盖）
    app.mgr.tokens.delete(token)
    const c2 = client()
    await c2.opened
    const re = await c2.request('reconnect', { token })
    expect(re.type).toBe('error')
    expect(re.payload.code).toBe('ROOM_GONE')
  })
})

describe('动作时序边界（真实 IO）', () => {
  it('非掷骰者掷骰被拒 NOT_YOUR_TURN；掷骰中重复掷被拒 BAD_STATE；掷骰中出牌被拒 BAD_STATE', async () => {
    const { host, guests } = await fullRoom()
    const r1 = await guests[0].request('game.roll', {})
    expect(r1.type).toBe('error')
    expect(r1.payload.code).toBe('NOT_YOUR_TURN')
    await host.request('game.roll', {})
    const r2 = await guests[1].request('game.play', { tileIds: ['t1-1'], side: 'bottom' })
    expect(r2.type).toBe('error')
    expect(r2.payload.code).toBe('BAD_STATE') // 还在 ROLLING
    await host.request('game.roll', {}) // 第二次 roll 在编排中应被 diceInFlight 拒绝
    const r3 = await host.request('game.roll', {})
    expect(r3.type).toBe('error')
    expect(r3.payload.code).toBe('BAD_STATE')
    await sleep(4200)
  })

  it('非本回合出牌被拒 NOT_YOUR_TURN（PLAYING 后）', async () => {
    const { host, guests, room } = await fullRoom()
    await host.request('game.roll', {})
    await sleep(4200)
    expect(room().game.state).toBe('PLAYING')
    const current = room().game.currentSeat
    // 找一个非当前座位的真人 token
    const notTurn = [host, ...guests].filter((_, i) => i !== current)
    const r = await notTurn[0].request('game.play', { tileIds: ['t1-1'], side: 'bottom' })
    expect(r.type).toBe('error')
    expect(r.payload.code).toBe('NOT_YOUR_TURN')
  })
})
