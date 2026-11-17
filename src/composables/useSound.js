// src/composables/useSound.js
// 游戏音效单例：实例池（懒创建常驻复用）+ <50ms 防重入节流 + 静音持久化。
// 所有 uni 音频 API 包 try-catch：音频失败静默，绝不影响游戏逻辑。
import { ref } from 'vue'

// 单例状态放模块级：多处 useSound() 共享同一 muted/池/时间戳
let ctxPool = null // { [name]: InnerAudioContext }
let lastPlayAt = {} // { [name]: ms }
let muted = null // ref，懒初始化（_resetForTest 后重读 storage）

export function _resetForTest() {
  ctxPool = null
  lastPlayAt = {}
  muted = null
}

const NAMES = [
  'dice-roll', 'dice-land', 'tile-play', 'tile-discard', 'account-slam',
  'settle-win', 'settle-lose', 'settle-draw', 'reveal-flip',
]

function getCtx(name) {
  if (!ctxPool) ctxPool = {}
  if (!ctxPool[name]) {
    const ctx = uni.createInnerAudioContext()
    ctx.src = `/static/sounds/${name}.wav` // H5 相对根路径，与 favicon 引用一致
    ctx.onError?.(() => {}) // 吞错误：音频失败静默
    ctxPool[name] = ctx
  }
  return ctxPool[name]
}

export function useSound() {
  if (muted === null) {
    muted = ref(uni.getStorageSync('dingniuzi_muted') === true)
  }

  /** 播放音效。name ∈ NAMES；<50ms 同名重复忽略；muted 短路；异常静默 */
  function play(name) {
    if (muted.value || !NAMES.includes(name)) return
    const now = Date.now()
    if (lastPlayAt[name] && now - lastPlayAt[name] < 50) return
    lastPlayAt[name] = now
    try {
      const ctx = getCtx(name)
      ctx.stop?.()
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 切换静音并持久化 */
  function toggleMute() {
    muted.value = !muted.value
    try { uni.setStorageSync('dingniuzi_muted', muted.value) } catch { /* 存储不可用：忽略 */ }
  }

  return { play, muted, toggleMute }
}
