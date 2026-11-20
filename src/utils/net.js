// src/utils/net.js
import { ref } from 'vue'
import { SERVER_WS_URL } from './config.js'

/**
 * WebSocket 客户端封装：connect() / request(type, payload)（8s 超时）/
 * on(type, handler)（推送订阅，返回取消函数）/ close() / status。
 * 首连失败不自动重连；建立后的意外断线自动重连：指数退避 1s→2s→4s→8s，最多 5 次。
 */

const REQUEST_TIMEOUT = 8000
const MAX_RETRIES = 5
const RECONNECT_MAX_DELAY = 8000

export function createNet() {
  let ws = null
  let reqSeq = 0
  let retries = 0
  let everOpened = false
  let manuallyClosed = false
  let reconnectTimer = null
  const pending = new Map() // requestId -> { resolve, reject, timer }
  const listeners = new Map() // type -> Set<handler>
  const status = ref('connecting')

  function dispatch(ev) {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg && msg.requestId && pending.has(msg.requestId)) {
      const { resolve, timer } = pending.get(msg.requestId)
      clearTimeout(timer)
      pending.delete(msg.requestId)
      resolve(msg)
      return
    }
    const set = listeners.get(msg?.type)
    if (set) for (const h of set) h(msg.payload, msg)
  }

  function handleClose() {
    if (manuallyClosed) {
      status.value = 'closed'
      return
    }
    if (!everOpened) {
      // 首连失败：由 connect() 的 Promise reject 处理
      status.value = 'closed'
      return
    }
    status.value = 'reconnecting'
    scheduleReconnect()
  }

  function scheduleReconnect() {
    if (retries >= MAX_RETRIES) {
      status.value = 'closed'
      return
    }
    const delay = Math.min(1000 * 2 ** retries, RECONNECT_MAX_DELAY)
    retries += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (manuallyClosed) return
      const ws2 = new WebSocket(SERVER_WS_URL)
      ws = ws2
      bind(ws2)
    }, delay)
  }

  function bind(ws2) {
    ws2.onopen = () => {
      everOpened = true
      retries = 0
      status.value = 'open'
    }
    ws2.onmessage = dispatch
    ws2.onclose = handleClose
    ws2.onerror = () => { /* onclose 会随后触发，统一在 handleClose 处理 */ }
  }

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    manuallyClosed = false
    everOpened = false
    status.value = 'connecting'
    return new Promise((resolve, reject) => {
      const ws2 = new WebSocket(SERVER_WS_URL)
      ws = ws2
      let opened = false
      ws2.onopen = () => {
        opened = true
        everOpened = true
        retries = 0
        status.value = 'open'
        resolve()
      }
      ws2.onmessage = dispatch
      ws2.onclose = () => {
        if (opened) { handleClose(); return }
        status.value = 'closed'
        reject(new Error('连接服务器失败'))
      }
      ws2.onerror = () => {
        // 未 open 的失败直接 reject
        if (!opened) reject(new Error('连接服务器失败'))
      }
    })
  }

  function request(type, payload = {}) {
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error('未连接服务器'))
    const requestId = `r${Date.now().toString(36)}-${(reqSeq += 1)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('请求超时'))
      }, REQUEST_TIMEOUT)
      pending.set(requestId, { resolve, reject, timer })
      ws.send(JSON.stringify({ type, payload, requestId }))
    })
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(handler)
    return () => listeners.get(type)?.delete(handler)
  }

  function close() {
    manuallyClosed = true
    status.value = 'closed'
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (ws) { try { ws.close() } catch { /* noop */ } }
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('连接已关闭'))
    }
    pending.clear()
  }

  return { connect, request, on, close, status }
}

/** 页面级共享单例（lobby/room/game 共用一条连接） */
let shared = null
export function sharedNet() {
  if (!shared) shared = createNet()
  return shared
}
