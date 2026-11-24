// tests/sound.test.js
// uni 全局 mock：createInnerAudioContext 返回可断言的假实例；storage 用 vi.fn
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctxFactory = () => ({
  src: '',
  loop: false,
  paused: true,
  play: vi.fn(function () { this.paused = false }),
  stop: vi.fn(function () { this.paused = true }),
  onError: vi.fn(),
})
let lastCtx = null // 最新创建的音频实例（工厂返回后 useSound 才设 src，故用引用而非 src 键注册）
globalThis.uni = {
  createInnerAudioContext: vi.fn(() => {
    const c = ctxFactory()
    lastCtx = c
    return c
  }),
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
}

import { useSound, _resetForTest } from '../src/composables/useSound.js'

describe('useSound', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
    globalThis.uni.getStorageSync.mockImplementation(() => '')
  })

  it('play 创建实例并播放，同名复用同一实例', () => {
    const s = useSound()
    // 两次 play 需间隔 >50ms 绕过节流（与下一用例的节流语义一致），断言保持不变
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    s.play('play_card')
    now.mockReturnValue(1100)
    s.play('play_card')
    now.mockRestore()
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
    expect(lastCtx.src).toContain('/static/sounds/play_card.mp3')
    expect(lastCtx.play).toHaveBeenCalledTimes(2)
  })

  it('防重入：同名 50ms 内重复调用被忽略', () => {
    const s = useSound()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    s.play('click')
    now.mockReturnValue(1049) // 49ms 内
    s.play('click')
    expect(lastCtx.play).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1051) // 51ms，放行
    s.play('click')
    expect(lastCtx.play).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('静音：toggleMute 三通道全静音，play 短路不创建实例、不播放', () => {
    const s = useSound()
    s.toggleMute()
    expect(s.muted).toBe(true)
    expect(uni.setStorageSync).toHaveBeenCalledWith('dingniuzi_sound', expect.objectContaining({
      bgm: expect.objectContaining({ muted: true }),
      sfx: expect.objectContaining({ muted: true }),
      voice: expect.objectContaining({ muted: true }),
    }))
    s.play('click')
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
  })

  it('静音持久化：storage 已存全静音配置时初始化即静音', () => {
    globalThis.uni.getStorageSync.mockImplementation((k) => (k === 'dingniuzi_sound'
      ? { bgm: { muted: true, volume: 1 }, sfx: { muted: true, volume: 1 }, voice: { muted: true, volume: 1 } }
      : ''))
    const s = useSound()
    expect(s.muted).toBe(true)
  })

  it('分通道静音：voice 静音不影响音效与 bgm', () => {
    const s = useSound()
    s.updateChannel('voice', { muted: true })
    expect(s.sound.value.voice.muted).toBe(true)
    expect(s.sound.value.sfx.muted).toBe(false)
    expect(s.sound.value.bgm.muted).toBe(false)
    s.playCardVoice('红十')
    s.playWithholdVoice()
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
    s.play('click')
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
  })

  it('音量调节：play 前把实例 volume 刷成当前配置；持久化到 storage', () => {
    const s = useSound()
    s.updateChannel('sfx', { volume: 0.4 })
    s.play('click')
    expect(lastCtx.volume).toBe(0.4)
    expect(uni.setStorageSync).toHaveBeenCalledWith('dingniuzi_sound', expect.objectContaining({
      sfx: expect.objectContaining({ volume: 0.4 }),
    }))
  })

  it('bgm 音量 = 基础响度 × 通道音量；bgm 静音后 startBgm 不播、updateChannel 实时停 bgm', () => {
    const s = useSound()
    s.updateChannel('bgm', { volume: 0.5 })
    s.startBgm()
    expect(lastCtx.volume).toBeCloseTo(0.1) // BGM_BASE_VOLUME 0.2 × 0.5
    s.updateChannel('bgm', { muted: true })
    expect(lastCtx.stop).toHaveBeenCalled()
    s.startBgm()
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1) // 没有新建实例
  })

  it('音频 API 异常被吞掉，不影响 play 返回', () => {
    const s = useSound()
    uni.createInnerAudioContext.mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => s.play('play_card')).not.toThrow()
  })

  it('bgm：startBgm 循环实例播放（bgm/ 目录随机选曲）、重复 start 不重播、stopBgm 停止', () => {
    const s = useSound()
    s.startBgm()
    expect(lastCtx.loop).toBe(true) // bgm 实例带循环标记
    expect(lastCtx.src).toContain('/static/sounds/bgm/') // bgm 从 bgm/ 目录取（随机选一）
    expect(lastCtx.src).toMatch(/\.mp3$/)
    expect(lastCtx.play).toHaveBeenCalledTimes(1)
    s.startBgm() // 已在播（paused=false）不重复 play
    expect(lastCtx.play).toHaveBeenCalledTimes(1)
    s.stopBgm()
    expect(lastCtx.stop).toHaveBeenCalled()
  })

  it('bgm：muted 时 startBgm 不播；toggleMute 开静音自动停 bgm', () => {
    const s = useSound()
    s.toggleMute() // 开静音
    s.startBgm()
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled() // 静音下连实例都不建
    s.toggleMute() // 解除静音
    s.startBgm()
    expect(lastCtx.play).toHaveBeenCalledTimes(1)
    s.toggleMute() // 再开静音：自动停 bgm
    expect(lastCtx.stop).toHaveBeenCalled()
  })

  it('play 不接受未知音效名（防御拼写错误）', () => {
    const s = useSound()
    s.play('not-a-sound')
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
  })

  it('turn 音效已注册且可播', () => {
    const s = useSound()
    s.play('turn')
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
    expect(lastCtx.src).toContain('/static/sounds/turn.wav')
  })

  it('出牌语音：按牌名播 card/ 下对应 mp3；未知牌名静默', () => {
    const s = useSound()
    s.playCardVoice('红十')
    expect(lastCtx.src).toContain('/static/sounds/card/hongShi.mp3')
    s.playCardVoice('不存在的牌')
    // 未知牌名不创建新实例（仍只有红十这一次）
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
  })

  it('算账宣告语音：playCardVoice(name, true) 播 suanzhang_voice，不读牌名', () => {
    const s = useSound()
    s.playCardVoice('红十', true)
    expect(lastCtx.src).toContain('/static/sounds/suanzhang_voice.mp3')
  })

  it('扣牌语音：playWithholdVoice 播 withhold/ 目录 mp3', () => {
    const s = useSound()
    s.playWithholdVoice()
    expect(lastCtx.src).toMatch(/^\/static\/sounds\/withhold\/\w+\.mp3$/)
  })

  it('语音静音短路：toggleMute 后不播语音', () => {
    const s = useSound()
    s.toggleMute()
    s.playCardVoice('红十')
    s.playWithholdVoice()
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
  })

  it('坏配置兜底：storage 里非法配置回退默认', () => {
    globalThis.uni.getStorageSync.mockImplementation((k) => (k === 'dingniuzi_sound' ? { bgm: { volume: 'x', muted: 1 } } : ''))
    const s = useSound()
    expect(s.sound.value.bgm).toEqual({ muted: false, volume: 1 })
    expect(s.sound.value.sfx).toEqual({ muted: false, volume: 1 })
  })
})
