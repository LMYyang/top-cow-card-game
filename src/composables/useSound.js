// src/composables/useSound.js
// 游戏音效单例：实例池（懒创建常驻复用）+ <50ms 防重入节流 + 静音持久化。
// 所有 uni 音频 API 包 try-catch：音频失败静默，绝不影响游戏逻辑。
// bgm 特例：循环播放（不参与节流、stop→play 重播会打断循环，用独立 start/stopBgm 控制），
// 与操作音共用同一静音开关（公用 🔊/🔇）。
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
  'click', 'shuffle', 'play_card', 'other_play', 'pass',
  'suanzhang', 'win', 'lose', 'bgm', 'turn',
]

function getCtx(name) {
  if (!ctxPool) ctxPool = {}
  if (!ctxPool[name]) {
    const ctx = uni.createInnerAudioContext()
    ctx.src = `/static/sounds/${name}.wav` // H5 相对根路径，与 favicon 引用一致
    if (name === 'bgm') ctx.loop = true // 背景音乐循环
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

  /** 起播背景音乐（循环）。muted 时不起播；已在播则不重复触发 */
  function startBgm() {
    if (muted.value) return
    try {
      const ctx = getCtx('bgm')
      if (ctx.paused === false) return // uni H5 提供 paused；已播则跳过
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 停止背景音乐（离局/静音切换时调用）。池里没有 bgm 实例（从未起播）时不创建 */
  function stopBgm() {
    if (!ctxPool?.bgm) return
    try { ctxPool.bgm.stop?.() } catch { /* 静默 */ }
  }

  /** 切换静音并持久化。开静音停 bgm；解静音由页面 watch 恢复 bgm */
  function toggleMute() {
    muted.value = !muted.value
    try { uni.setStorageSync('dingniuzi_muted', muted.value) } catch { /* 存储不可用：忽略 */ }
    if (muted.value) stopBgm()
  }

  return { play, muted, toggleMute, startBgm, stopBgm }
}
