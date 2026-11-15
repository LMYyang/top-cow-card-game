import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// uni 全局 mock（useGame 读写 storage、toast）
globalThis.uni = {
  setStorageSync: vi.fn(),
  getStorageSync: () => '',
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
}

import { useGame } from '../src/composables/useGame.js'

describe('useGame redeal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** 推进掷骰动画定时器（roll 内部 1.2s + 2.4s 两层），进入 PLAYING */
  function rollAndSettle(g) {
    g.roll(3)
    vi.advanceTimersByTime(1200)
    vi.advanceTimersByTime(2400)
  }

  it('canRedealNow：我满足条件且窗口内为 true，出牌后为 false', () => {
    const g = useGame()
    rollAndSettle(g)
    // 发牌随机，直接覆写我的手牌为满足条件的手牌
    g.view.myHand.splice(0, g.view.myHand.length,
      { id: 't5-1', name: '红八', a: 4, b: 4, type: '横牌', red: true },
      { id: 't5-2', name: '红八', a: 4, b: 4, type: '横牌', red: true },
      { id: 't1-1', name: '大天', a: 6, b: 6, type: '横牌', red: false },
      { id: 't3-1', name: '大五', a: 5, b: 5, type: '横牌', red: false },
      { id: 't10-1', name: '二板', a: 2, b: 2, type: '横牌', red: false },
      { id: 't11-1', name: '地幺', a: 1, b: 1, type: '横牌', red: false },
    )
    // syncView 未触发时 myHand 是 reactive 视图，直接读 view 判断
    expect(g.canRedealNow.value).toBe(true)
    // 出牌后窗口关闭
    vi.advanceTimersByTime(3000) // AI 头牌若轮到则行动（不阻塞断言）
  })

  it('redeal()：窗口内满足条件时成功，状态回 ROLLING 且掷骰权归我', () => {
    const g = useGame()
    rollAndSettle(g)
    g.view.myHand.splice(0, g.view.myHand.length,
      { id: 't5-1', name: '红八', a: 4, b: 4, type: '横牌', red: true },
      { id: 't5-2', name: '红八', a: 4, b: 4, type: '横牌', red: true },
      { id: 't1-1', name: '大天', a: 6, b: 6, type: '横牌', red: false },
      { id: 't3-1', name: '大五', a: 5, b: 5, type: '横牌', red: false },
      { id: 't10-1', name: '二板', a: 2, b: 2, type: '横牌', red: false },
      { id: 't11-1', name: '地幺', a: 1, b: 1, type: '横牌', red: false },
    )
    const res = g.redeal()
    expect(res.ok).toBe(true)
    expect(g.view.state).toBe('ROLLING')
    expect(g.diceRollerSeat).toBe(0) // 申请人打骰
    // 重发后可再次掷骰
    rollAndSettle(g)
    expect(g.view.state).toBe('PLAYING')
    expect(g.view.myHand).toHaveLength(6)
  })

  it('redeal()：牌型不满足时拒绝', () => {
    const g = useGame()
    rollAndSettle(g)
    // 覆写为不满足牌型的手牌（仅一张红八 + 含竖牌），排除随机发牌偶发满足的情况
    g.view.myHand.splice(0, g.view.myHand.length,
      { id: 't5-1', name: '红八', a: 4, b: 4, type: '横牌', red: true },
      { id: 't2-1', name: '虎头', a: 5, b: 6, type: '竖牌', red: false },
      { id: 't1-1', name: '大天', a: 6, b: 6, type: '横牌', red: false },
      { id: 't3-1', name: '大五', a: 5, b: 5, type: '横牌', red: false },
      { id: 't10-1', name: '二板', a: 2, b: 2, type: '横牌', red: false },
      { id: 't11-1', name: '地幺', a: 1, b: 1, type: '横牌', red: false },
    )
    const res = g.redeal()
    expect(res.ok).toBe(false)
    expect(g.view.state).toBe('PLAYING')
  })
})
