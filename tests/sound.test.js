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
    expect(lastCtx.src).toContain('/static/sounds/play_card.wav')
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

  it('静音：play 短路不创建实例、不播放', () => {
    const s = useSound()
    s.toggleMute()
    expect(s.muted.value).toBe(true)
    expect(uni.setStorageSync).toHaveBeenCalledWith('dingniuzi_muted', true)
    s.play('click')
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
  })

  it('静音持久化：storage 已存 true 时初始化即静音', () => {
    globalThis.uni.getStorageSync.mockImplementation((k) => (k === 'dingniuzi_muted' ? true : ''))
    const s = useSound()
    expect(s.muted.value).toBe(true)
  })

  it('音频 API 异常被吞掉，不影响 play 返回', () => {
    const s = useSound()
    uni.createInnerAudioContext.mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => s.play('play_card')).not.toThrow()
  })

  it('bgm：startBgm 循环实例播放、重复 start 不重播、stopBgm 停止', () => {
    const s = useSound()
    s.startBgm()
    expect(lastCtx.loop).toBe(true) // bgm 实例带循环标记
    expect(lastCtx.src).toContain('/static/sounds/bgm.wav')
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
})
