// 游戏音效单例：实例池（懒创建常驻复用）+ <50ms 防重入节流 + 音量/静音持久化。
// 所有 uni 音频 API 包 try-catch：音频失败静默，绝不影响游戏逻辑。
// 三通道独立控制（设置页可分别调音量/静音）：
// - bgm：背景音乐，循环播放，用独立 start/stopBgm 控制
// - sfx：操作音效（按钮/洗牌/输赢等）
// - voice：人声播报（牌名/扣牌/算账），按"语音通道"独占——新语音顶掉旧语音，避免叠音
import { ref } from 'vue'

export const SOUND_STORAGE_KEY = 'dingniuzi_sound'

// 单例状态放模块级：多处 useSound() 共享同一音量配置/池/时间戳
let ctxPool = null
let lastPlayAt = {}
let sound = null // ref，懒初始化（_resetForTest 后重读 storage）

/** 默认音量配置：1 = 不 attenuate，bgm 固定压低 */
export const DEFAULT_SOUND_CONF = {
  bgm: { muted: false, volume: 1 },
  sfx: { muted: false, volume: 1 },
  voice: { muted: false, volume: 1 },
}

export function _resetForTest() {
  ctxPool = null
  lastPlayAt = {}
  sound = null
}

const NAMES = [
  'click', 'shuffle', 'play_card', 'other_play',
  'suanzhang', 'win', 'lose', 'turn',
]

// ---- 语音资源清单（人声播报，文件在 static/sounds/ 下） ----
// 牌名 → 语音文件：card/ 目录 13 种牌型
const CARD_VOICES = {
  大天: 'daTian', 虎头: 'huTou', 大五: 'daWu', 红十: 'hongShi', 红八: 'hongBa',
  长三: 'daSan', 一六: 'yaoLiu', 一五: 'yaoWu', 一三: 'yaoSan', 二板: 'erBan',
  地幺: 'daYao', 三六: 'waiJiu', 二六: 'erLiu',
}
const WITHHOLD_VOICES = ['kouYiZhang', 'shuiLe', 'yaoBuQi', 'guo']
const ACCOUNT_VOICE = 'suanzhang_voice'
// bgm 候选（bgm/ 目录序号文件，随机选一循环；增删曲目只需改此清单）
const BGM_TRACKS = ['05', '20', '27', '32', '50', '54']
// 统一压低：源文件响度不一，不盖过前景音
const BGM_BASE_VOLUME = 0.2

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function normalizeConf(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const ch of ['bgm', 'sfx', 'voice']) {
    const c = src[ch] && typeof src[ch] === 'object' ? src[ch] : {}
    const d = DEFAULT_SOUND_CONF[ch]
    out[ch] = {
      muted: typeof c.muted === 'boolean' ? c.muted : d.muted,
      volume: typeof c.volume === 'number' && c.volume >= 0 && c.volume <= 1 ? c.volume : d.volume,
    }
  }
  return out
}

function loadConf() {
  try {
    return normalizeConf(uni.getStorageSync(SOUND_STORAGE_KEY))
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SOUND_CONF))
  }
}

function saveConf(conf) {
  try {
    uni.setStorageSync(SOUND_STORAGE_KEY, conf)
  } catch { /* 存储不可用：仅影响下次启动 */ }
}

function getCtx(name) {
  if (!ctxPool) ctxPool = {}
  if (!ctxPool[name]) {
    const ctx = uni.createInnerAudioContext()
    // play_card/win 用 mp3（体积小），其余固定音效用 wav；语音（card_/wh_/bgm_ 前缀）路径由 name 携带
    if (name.startsWith('card_')) ctx.src = `/static/sounds/card/${name.slice(5)}.mp3`
    else if (name.startsWith('wh_')) ctx.src = `/static/sounds/withhold/${name.slice(3)}.mp3`
    else if (name.startsWith('bgm_')) ctx.src = `/static/sounds/bgm/${name.slice(4)}.mp3`
    else if (name === 'voice_account') ctx.src = `/static/sounds/${ACCOUNT_VOICE}.mp3`
    else ctx.src = ['play_card', 'win'].includes(name)
      ? `/static/sounds/${name}.mp3`
      : `/static/sounds/${name}.wav`
    if (name.startsWith('bgm_')) {
      ctx.loop = true
      ctx.volume = BGM_BASE_VOLUME
    }
    ctx.onError?.(() => {})
    ctxPool[name] = ctx
  }
  return ctxPool[name]
}

/** 把非 bgm 实例的音量刷成当前配置（实例常驻复用，改音量必须覆盖池内旧值） */
function applyVolume() {
  if (!ctxPool) return
  for (const [name, ctx] of Object.entries(ctxPool)) {
    try {
      if (name.startsWith('bgm_')) {
        ctx.volume = sound.value.bgm.muted ? 0 : BGM_BASE_VOLUME * sound.value.bgm.volume
      } else if (name.startsWith('card_') || name.startsWith('wh_') || name === 'voice_account') {
        ctx.volume = sound.value.voice.volume
      } else {
        ctx.volume = sound.value.sfx.volume
      }
    } catch { /* 音频不可用：静默 */ }
  }
}

export function useSound() {
  if (sound === null) {
    sound = ref(loadConf())
  }

  /** 播放音效。name ∈ NAMES；<50ms 同名重复忽略；sfx 静音短路；异常静默 */
  function play(name) {
    if (sound.value.sfx.muted || !NAMES.includes(name)) return
    const now = Date.now()
    if (lastPlayAt[name] && now - lastPlayAt[name] < 50) return
    lastPlayAt[name] = now
    try {
      const ctx = getCtx(name)
      ctx.volume = sound.value.sfx.volume
      ctx.stop?.()
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /**
   * 播放人声语音（独占语音通道：新语音 stop 旧语音）。
   * playCardVoice(tileName, declared)：按牌名播报，declared=true 改播"算账"语音。
   * playWithholdVoice()：扣牌时随机播一条。
   */
  function playVoice(voiceName) {
    if (sound.value.voice.muted) return
    try {
      const ctx = getCtx(voiceName)
      ctx.volume = sound.value.voice.volume
      ctx.stop?.()
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 出牌播报：宣告算账时播"算账"，否则按牌名播报（未知牌名静默） */
  function playCardVoice(tileName, declared = false) {
    if (declared) { playVoice('voice_account'); return }
    const v = CARD_VOICES[tileName]
    if (v) playVoice(`card_${v}`)
  }

  /** 扣牌播报：随机选一 */
  function playWithholdVoice() {
    playVoice(`wh_${pickRandom(WITHHOLD_VOICES)}`)
  }

  /** 起播背景音乐（循环，随机选一首，选定后保持不变）。
   *  调用时机由页面层保证在旧页卸载之后（onReady），避免旧页 stopBgm 把新局 BGM 停掉 */
  function startBgm() {
    if (sound.value.bgm.muted) return
    try {
      const ctx = getCtx(`bgm_${pickRandom(BGM_TRACKS)}`)
      ctx.volume = BGM_BASE_VOLUME * sound.value.bgm.volume
      if (ctx.paused === false) return
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 停止背景音乐。池里没有 bgm 实例（从未起播）时不创建 */
  function stopBgm() {
    if (!ctxPool) return
    for (const k of Object.keys(ctxPool)) {
      if (k.startsWith('bgm_')) {
        try { ctxPool[k].stop?.() } catch { /* 静默 */ }
      }
    }
  }

  /** 更新一条通道配置并持久化；bgm 通道实时生效（静音即停，解除后由页面 watch 恢复） */
  function updateChannel(channel, patch) {
    if (!sound.value[channel]) return
    sound.value[channel] = { ...sound.value[channel], ...patch }
    saveConf(sound.value)
    if (channel === 'bgm') {
      if (sound.value.bgm.muted) stopBgm()
      else applyVolume()
    } else {
      applyVolume()
    }
  }

  return {
    play, sound, startBgm, stopBgm, playCardVoice, playWithholdVoice,
    updateChannel,
    // 兼容旧接口：全局静音 = 三通道全静音
    get muted() { return sound.value.bgm.muted && sound.value.sfx.muted && sound.value.voice.muted },
    toggleMute() {
      const target = !this.muted
      for (const ch of ['bgm', 'sfx', 'voice']) updateChannel(ch, { muted: target })
    },
  }
}
