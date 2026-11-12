import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from '../server/node_modules/ws/index.js'
import { createServerApp } from '../server/index.js'

let app // { httpServer, wss, port, mgr }
beforeAll(async () => {
  app = createServerApp(0) // 端口 0 = 随机
  await new Promise((resolve) => {
    app.httpServer.once('listening', resolve)
    app.httpServer.listen(app.port)
  })
})
afterAll(async () => {
  // 测试客户端从未主动关闭，直接 httpServer.close 会因活动 WebSocket 挂起（ws#886）；
  // 先从服务端强制断开全部客户端，wss/httpServer 的 close 回调才会触发
  for (const cs of app.wss.clients) cs.terminate()
  await Promise.all([
    new Promise((resolve) => app.wss.close(resolve)),
    new Promise((resolve) => app.httpServer.close(resolve)),
  ])
})

function wsUrl() { return `ws://127.0.0.1:${app.httpServer.address().port}` }

/** 测试用客户端：收集推送，支持请求-响应 */
function client() {
  const ws = new WebSocket(wsUrl())
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
    return new Promise((resolve) => {
      waiters.push({ pred: (m) => m.requestId === id, resolve })
      ws.send(JSON.stringify({ type, payload, requestId: id }))
    })
  }
  return { ws, inbox, opened, request }
}

describe('server/index.js 消息路由', () => {
  it('创建房间 → 快速匹配加入 → 准备 → 开始 → 收到 game.state', async () => {
    const host = client()
    await host.opened
    const createRes = await host.request('room.create', { name: '甲' })
    expect(createRes.type).toBe('room.created')
    const roomId = createRes.payload.room.roomId

    const guest = client()
    await guest.opened
    const joinRes = await guest.request('room.quickMatch', { name: '乙' })
    expect(joinRes.type).toBe('room.joined')
    expect(joinRes.payload.room.roomId).toBe(roomId)

    const others = []
    for (const n of ['丙', '丁']) {
      const c = client()
      await c.opened
      const r = await c.request('room.join', { name: n, roomId })
      expect(r.type).toBe('room.joined')
      others.push(c)
    }
    await host.request('room.ready', { ready: true })
    await guest.request('room.ready', { ready: true })
    for (const c of others) await c.request('room.ready', { ready: true })
    const startRes = await host.request('game.start', {})
    expect(startRes.type).toBe('game.started')
    // guest 收到 game.state（ROLLING 阶段）
    const st = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('waitFor game.state timeout')), 3000)
      const check = (raw) => {
        const hit = guest.inbox.find((m) => m.type === 'game.state')
        if (hit) { clearTimeout(t); resolve(hit) }
      }
      check()
      guest.ws.on('message', check)
    })
    expect(st.payload.view.state).toBe('ROLLING')
  })

  it('非法动作返回 error（requestId 关联）', async () => {
    const c = client()
    await c.opened
    const res = await c.request('game.play', { tileIds: ['t1-1'] })
    expect(res.type).toBe('error')
    expect(res.payload.message).toBeTruthy()
  })

  it('reconnect：未知 token 返回 ROOM_GONE error', async () => {
    const c = client()
    await c.opened
    const res = await c.request('reconnect', { token: 'bogus' })
    expect(res.type).toBe('error')
    expect(res.payload.code).toBe('ROOM_GONE')
  })

  it('未知消息类型返回 UNKNOWN_TYPE', async () => {
    const c = client()
    await c.opened
    const res = await c.request('totally.bogus', {})
    expect(res.type).toBe('error')
    expect(res.payload.code).toBe('UNKNOWN_TYPE')
  })
})
