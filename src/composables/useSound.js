// src/composables/useSound.js
// 游戏音效单例：实例池（懒创建常驻复用）+ <50ms 防重入节流 + 静音持久化。
// 所有 uni 音频 API 包 try-catch：音频失败静默，绝不影响游戏逻辑。
// bgm 特例：循环播放（不参与节流、stop→play 重播会打断循环，用独立 start/stopBgm 控制），
// 与操作音共用同一静音开关（公用 🔊/🔇）。
// 语音特例（card/withhold/算账人声）：与操作音共用节流与静音，但按"语音通道"独占——
// 新语音顶掉旧语音（同一 ctx 池槽位），避免两张牌的播报叠音。
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
  'suanzhang', 'win', 'lose', 'turn',
]

// ---- 语音资源清单（人声播报，文件在 static/sounds/ 下，构建时随 static 目录整体复制） ----
// 牌名 → 语音文件：card/ 目录 13 种牌型（tableHistory 条目的牌名直接映射）
const CARD_VOICES = {
  大天: 'daTian', 虎头: 'huTou', 大五: 'daWu', 红十: 'hongShi', 红八: 'hongBa',
  长三: 'daSan', 一六: 'yaoLiu', 一五: 'yaoWu', 一三: 'yaoSan', 二板: 'erBan',
  地幺: 'daYao', 三六: 'waiJiu', 二六: 'erLiu',
}
// 扣牌语音（随机选一）
const WITHHOLD_VOICES = ['kouYiZhang', 'shuiLe', 'yaoBuQi', 'guo']
// 算账宣告语音
const ACCOUNT_VOICE = 'suanzhang_voice'
// bgm 候选（bgm/ 目录序号文件，随机选一循环；增删曲目只需改此清单）
const BGM_TRACKS = ['05', '20', '27', '32', '50', '54']
// bgm 音量：源文件响度不一，统一压到 0.2 做垫底衬乐，不盖过出牌/语音等前景音
const BGM_VOLUME = 0.2

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getCtx(name) {
  if (!ctxPool) ctxPool = {}
  if (!ctxPool[name]) {
    const ctx = uni.createInnerAudioContext()
    // 固定音效：play_card/win 用 mp3（体积小）；其余音效用 wav
    // 语音（card_/wh_/bgm_ 前缀）：mp3，路径由 name 直接携带
    if (name.startsWith('card_')) ctx.src = `/static/sounds/card/${name.slice(5)}.mp3`
    else if (name.startsWith('wh_')) ctx.src = `/static/sounds/withhold/${name.slice(3)}.mp3`
    else if (name.startsWith('bgm_')) ctx.src = `/static/sounds/bgm/${name.slice(4)}.mp3`
    else if (name === 'voice_account') ctx.src = `/static/sounds/${ACCOUNT_VOICE}.mp3`
    else ctx.src = ['play_card', 'win'].includes(name)
      ? `/static/sounds/${name}.mp3`
      : `/static/sounds/${name}.wav`
    if (name.startsWith('bgm_')) {
      ctx.loop = true // 背景音乐循环
      ctx.volume = BGM_VOLUME // 统一压低：源文件响度不一，防止盖过前景音
    }
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

  /**
   * 播放人声语音（独占语音通道：新语音 stop 旧语音，防叠音覆盖）。
   * - playCardVoice(tileName)：按牌名播报 card/ 下对应语音（长三→daSan 等别名归一）。
   *   declare=true 时改播"算账"语音（算账宣告不读牌名，避免两句语音打架）。
   * - playWithholdVoice()：扣牌时随机播 withhold/ 下一条。
   * muted 短路；异常静默。
   */
  function playVoice(voiceName) {
    if (muted.value) return
    try {
      const ctx = getCtx(voiceName)
      ctx.stop?.()
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 出牌播报入口：宣告算账时播"算账"，否则按牌名播报（未知牌名静默） */
  function playCardVoice(tileName, declared = false) {
    if (declared) { playVoice('voice_account'); return }
    const v = CARD_VOICES[tileName]
    if (v) playVoice(`card_${v}`)
  }

  /** 扣牌播报：withhold 清单随机选一 */
  function playWithholdVoice() {
    playVoice(`wh_${pickRandom(WITHHOLD_VOICES)}`)
  }

  /** 起播背景音乐（循环）。muted 时不起播；已在播则不重复触发。
   *  每次进入对局随机选一首（bgm/ 目录序号曲目），选定后保持不变（stop→start 同曲续播语义）。
   *  调用时机由页面层保证在旧页卸载之后（onReady），避免旧页 stopBgm 把新局 BGM 停掉 */
  function startBgm() {
    if (muted.value) return
    try {
      const ctx = getCtx(`bgm_${pickRandom(BGM_TRACKS)}`)
      if (ctx.paused === false) return // uni H5 提供 paused；已播则跳过
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 停止背景音乐（离局/静音切换时调用）。池里没有 bgm 实例（从未起播）时不创建 */
  function stopBgm() {
    if (!ctxPool) return
    for (const k of Object.keys(ctxPool)) {
      if (k.startsWith('bgm_')) {
        try { ctxPool[k].stop?.() } catch { /* 静默 */ }
      }
    }
  }

  /** 切换静音并持久化。开静音停 bgm；解静音由页面 watch 恢复 bgm */
  function toggleMute() {
    muted.value = !muted.value
    try { uni.setStorageSync('dingniuzi_muted', muted.value) } catch { /* 存储不可用：忽略 */ }
    if (muted.value) stopBgm()
  }

  return { play, muted, toggleMute, startBgm, stopBgm, playCardVoice, playWithholdVoice }
}
