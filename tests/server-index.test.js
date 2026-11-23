import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
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

function wsUrl(target = app) { return `ws://127.0.0.1:${target.httpServer.address().port}` }

/** 测试用客户端：收集推送，支持请求-响应。target 缺省连默认 app，心跳用例传 hbApp */
function client(target = app) {
  const ws = new WebSocket(wsUrl(target))
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
      // 超时兜底：服务器漏回回执时快速失败，而非挂起整个测试
      const timer = setTimeout(() => reject(new Error(`request('${type}') 超时：未收到 requestId=${id} 的回执`)), 3000)
      waiters.push({
        pred: (m) => m.requestId === id,
        resolve: (msg) => { clearTimeout(timer); resolve(msg) },
      })
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

  it('BAD_JSON 帧返回 error，且连接保持可用', async () => {
    const c = client()
    await c.opened
    c.ws.send('not json') // 非法帧：服务端应回 BAD_JSON 而非崩服/断连
    const bad = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('未收到 BAD_JSON error')), 3000)
      const check = () => {
        const hit = c.inbox.find((m) => m.type === 'error' && m.payload?.code === 'BAD_JSON')
        if (hit) { clearTimeout(t); resolve(hit) }
      }
      check()
      c.ws.on('message', check)
    })
    expect(bad.payload.code).toBe('BAD_JSON')
    // 同一连接继续可用：证明坏帧没有杀死连接
    const res = await c.request('reconnect', { token: 'x' })
    expect(res.type).toBe('error')
    expect(res.payload.code).toBe('ROOM_GONE')
  })

  it('重连后被取代的旧连接关闭不影响新连接', async () => {
    const s1 = client()
    await s1.opened
    const createRes = await s1.request('room.create', { name: '甲' })
    expect(createRes.type).toBe('room.created')
    const token = createRes.payload.token

    const s2 = client() // 同一玩家的重连连接
    await s2.opened
    const reRes = await s2.request('reconnect', { token })
    expect(reRes.type).toBe('reconnected')

    s1.ws.terminate() // 旧连接此刻才被关闭（reconnect 内部已将其取代）
    await new Promise((r) => setTimeout(r, 200))
    // 修复点：onDisconnect 带上 conn 后会忽略被取代连接的过期 close，新连接不受影响
    const res = await s2.request('room.ready', { ready: true })
    expect(res.type).toBe('room.ready.ok')
  })

  it('对局中不能创建/加入新房间（ROOM_STARTED，成员不被移出原房间）', async () => {
    const host = await fullGame()
    const createRes = await host.request('room.create', { name: '甲' })
    expect(createRes.type).toBe('error')
    expect(createRes.payload.code).toBe('ROOM_STARTED')
    // 旧成员身份保留：仍可在原房间正常操作（请求有回执即证明未掉线）
    const ready = await host.request('room.ready', { ready: true })
    expect(ready.type).toBe('error') // 对局中改准备状态被拒（NOT 掉线类错误）
    expect(ready.payload.code).toBe('ROOM_STARTED')
  })

  it('对局中 leave 先收到回执再断开', async () => {
    const host = await fullGame()
    const res = await host.request('room.leave')
    expect(res.type).toBe('room.left') // 回执先于 socket 关闭送达
  })
})

describe('心跳死链检测（独立 app，短心跳周期）', () => {
  let hbApp
  beforeAll(async () => {
    hbApp = createServerApp(0, { heartbeatMs: 200 })
    await new Promise((resolve) => {
      hbApp.httpServer.once('listening', resolve)
      hbApp.httpServer.listen(hbApp.port)
    })
  })
  afterAll(async () => {
    for (const cs of hbApp.wss.clients) cs.terminate()
    await Promise.all([
      new Promise((resolve) => hbApp.wss.close(resolve)),
      new Promise((resolve) => hbApp.httpServer.close(resolve)),
    ])
  })

  it('客户端断网（流停摆不发 pong）：~2 个心跳周期后连接被清，WAITING 房销毁', async () => {
    const c = client(hbApp)
    await c.opened
    const created = await c.request('room.create', { name: '甲' })
    expect(created.type).toBe('room.created')
    const roomId = created.payload.room.roomId
    expect(hbApp.mgr.rooms.has(roomId)).toBe(true)
    // 模拟断网/杀进程：暂停底层 TCP 流——客户端收不到 ping 也不回 pong（node ws 不自动回 pong），
    // 也没有 FIN（'close' 不触发），复现"成员 connected 恒 true、僵尸房常驻"的旧 bug 前置状态
    c.ws.pause()
    // 2 个周期（400ms）+ 余量后：死链被 terminate → onConnClose → removeMember → destroyRoom
    await new Promise((r) => setTimeout(r, 900))
    expect(hbApp.mgr.rooms.has(roomId)).toBe(false)
  })

  it('在线客户端不受心跳影响：回 pong 保持连接，房间保留、请求可用', async () => {
    const c = client(hbApp)
    c.ws.on('ping', () => c.ws.pong()) // 浏览器/uni 环境自动回 pong，node ws 客户端需手动
    await c.opened
    const created = await c.request('room.create', { name: '乙' })
    const roomId = created.payload.room.roomId
    await new Promise((r) => setTimeout(r, 900)) // 跨多个心跳周期
    expect(hbApp.mgr.rooms.has(roomId)).toBe(true)
    const res = await c.request('session.check', { token: created.payload.token })
    expect(res.type).toBe('session.check.ok')
  })
})

/** 构建 4 人满员并已开局的真实对局，返回房主客户端（座位 0） */
async function fullGame() {
  const host = client()
  await host.opened
  const createRes = await host.request('room.create', { name: '甲' })
  const roomId = createRes.payload.room.roomId
  const guests = []
  for (const n of ['乙', '丙', '丁']) {
    const c = client()
    await c.opened
    const r = await c.request('room.join', { name: n, roomId })
    expect(r.type).toBe('room.joined')
    guests.push(c)
  }
  await host.request('room.ready', { ready: true })
  for (const c of guests) await c.request('room.ready', { ready: true })
  const startRes = await host.request('game.start', {})
  expect(startRes.type).toBe('game.started')
  return host
}
