import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// uni 全局 mock（net.js 不依赖 uni，但保持环境干净）
globalThis.uni = { setStorageSync: vi.fn(), getStorageSync: () => '' }

// 最小 WebSocket mock：测试可控触发 open/message/close
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  static last = null
  constructor(url) {
    FakeWebSocket.last = this
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.sent = []
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { if (this.readyState !== FakeWebSocket.CLOSED) { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({}) } }
  terminate() { this.close() }
  __open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  __close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({}) }
  __recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  __recvRaw(str) { this.onmessage?.({ data: str }) }
}
globalThis.WebSocket = FakeWebSocket

import { createNet } from '../src/utils/net.js'
import { SERVER_WS_URL } from '../src/utils/config.js'

describe('net.js', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('connect 建立 WebSocket 到配置地址并 resolve，status → open', async () => {
    const net = createNet()
    const p = net.connect()
    expect(net.status.value).toBe('connecting')
    FakeWebSocket.last.__open()
    await p
    expect(FakeWebSocket.last.url).toBe(SERVER_WS_URL)
    expect(net.status.value).toBe('open')
  })

  it('connect 失败（onerror）reject，且不进入自动重连', async () => {
    const net = createNet()
    const p = net.connect().catch((e) => e)
    const ws = FakeWebSocket.last
    ws.readyState = FakeWebSocket.CLOSED
    ws.onerror?.(new Error('refused'))
    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect(net.status.value).toBe('connecting') // 未自动重连（首次连接失败由调用方处理）
  })

  it('request 发送带 requestId 的消息并关联响应', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const req = net.request('room.create', { name: '甲' })
    const sent = FakeWebSocket.last.sent[0]
    expect(sent.requestId).toBeTruthy()
    expect(sent.type).toBe('room.create')
    FakeWebSocket.last.__recv({ type: 'room.created', payload: { ok: 1 }, requestId: sent.requestId })
    const res = await req
    expect(res.type).toBe('room.created')
    expect(res.payload.ok).toBe(1)
  })

  it('request 超时 8s reject', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const req = net.request('room.create', {}) .catch((e) => e)
    vi.advanceTimersByTime(8001)
    const err = await req
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('超时')
  })

  it('error 响应（带 requestId）同样走 request 关联', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const req = net.request('game.play', {})
    FakeWebSocket.last.__recv({ type: 'error', payload: { code: 'ILLEGAL', message: '这张牌接不上底端' }, requestId: FakeWebSocket.last.sent[0].requestId })
    const res = await req
    expect(res.type).toBe('error')
    expect(res.payload.message).toBe('这张牌接不上底端')
  })

  it('推送分发给 on 订阅者；返回的取消函数生效', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const got = []
    const off = net.on('game.state', (pl) => got.push(pl))
    FakeWebSocket.last.__recv({ type: 'game.state', payload: { n: 1 } })
    expect(got).toEqual([{ n: 1 }])
    off()
    FakeWebSocket.last.__recv({ type: 'game.state', payload: { n: 2 } })
    expect(got).toEqual([{ n: 1 }]) // 取消后不再收到
  })

  it('断线后自动重连（1s 退避起步）并保留订阅', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const got = []
    net.on('room.state', (pl) => got.push(pl))
    FakeWebSocket.last.__close() // 触发 onclose
    expect(net.status.value).toBe('reconnecting')
    vi.advanceTimersByTime(1000) // 1s 退避后重连
    FakeWebSocket.last.__open()
    expect(net.status.value).toBe('open')
    FakeWebSocket.last.__recv({ type: 'room.state', payload: { n: 1 } })
    expect(got).toEqual([{ n: 1 }]) // 订阅在新连接上依然生效
  })

  it('指数退避：连续失败 1s→2s→4s，5 次后 status=closed', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    FakeWebSocket.last.__close()
    vi.advanceTimersByTime(1000)
    FakeWebSocket.last.__close() // 第 2 次失败（retries=1）
    vi.advanceTimersByTime(2000)
    FakeWebSocket.last.__close() // 第 3 次（retries=2）
    vi.advanceTimersByTime(4000)
    FakeWebSocket.last.__close() // 第 4 次（retries=3）
    vi.advanceTimersByTime(8000) // 退避上限 8s
    FakeWebSocket.last.__close() // 第 5 次（retries=4）
    vi.advanceTimersByTime(8000)
    FakeWebSocket.last.__close() // 第 6 次连接尝试失败 → retries>=5 → closed
    expect(net.status.value).toBe('closed')
  })

  it('close() 手动关闭：不再自动重连，status=closed', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    net.close()
    expect(net.status.value).toBe('closed')
    vi.advanceTimersByTime(10000)
    expect(net.status.value).toBe('closed')
  })

  it('非 JSON 消息被忽略不崩溃', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    FakeWebSocket.last.__recvRaw('not-json{{{')
    expect(net.status.value).toBe('open')
  })

  it('sharedNet() 返回单例', async () => {
    const { sharedNet } = await import('../src/utils/net.js')
    expect(sharedNet()).toBe(sharedNet())
  })
})
