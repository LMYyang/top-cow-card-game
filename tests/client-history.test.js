import { describe, it, expect, vi, beforeEach } from 'vitest'

// uni storage 内存 mock：backfillNetStats 的读写都在 dingniuzi_history / dingniuzi_stats / 迁移标记
let store = {}
globalThis.uni = {
  setStorageSync: vi.fn((k, v) => { store[k] = v }),
  getStorageSync: vi.fn((k) => store[k] ?? ''),
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
}

import { backfillNetStats, appendHistory } from '../src/composables/history.js'

describe('backfillNetStats 单机统计口径迁移', () => {
  beforeEach(() => {
    store = {}
  })

  it('从未打过联网局：统计原样保留', () => {
    store['dingniuzi_stats'] = { rounds: 10, totalScore: 12 }
    const stats = backfillNetStats()
    expect(stats).toEqual({ rounds: 10, totalScore: 12 })
  })

  it('统计混含联网局：剔除历史里的 net 部分得纯单机口径（修一次即可，不随历史增减漂移）', () => {
    // 旧版本 net 局 rounds+1 写进过 stats；历史里留有 3 条 net
    store['dingniuzi_stats'] = { rounds: 13, totalScore: 5 }
    store['dingniuzi_history'] = [
      { mode: 'net', scores: { 0: 6 } },
      { mode: 'solo', scores: { 0: 6 }, totalsAfter: { 0: 6 } },
      { mode: 'net', scores: { 0: -3 } },
      { mode: 'net', scores: { 0: 2 } },
    ]
    const stats = backfillNetStats()
    // rounds 13-3=10、totalScore 5-(6-3+2)=0
    expect(stats).toEqual({ rounds: 10, totalScore: 0 })
    // 迁移结果持久化（再次 onShow 读到同一口径）
    expect(store['dingniuzi_stats']).toEqual({ rounds: 10, totalScore: 0 })
  })

  it('迁移标记置位后不再执行（net 局继续只进历史，单机口径不随之漂移）', () => {
    store['dingniuzi_stats'] = { rounds: 13, totalScore: 5 }
    store['dingniuzi_history'] = [{ mode: 'net', scores: { 0: 6 } }]
    backfillNetStats()
    // 之后又打了 2 局联网（只进历史）与 1 局单机（stats +1）
    appendHistory({ time: 1, mode: 'net', scores: { 0: 1 } })
    appendHistory({ time: 2, mode: 'net', scores: { 0: 1 } })
    store['dingniuzi_stats'] = { rounds: 11, totalScore: 1 }
    const stats = backfillNetStats()
    // 不再扣历史里的 net 条数：单机局数稳定
    expect(stats).toEqual({ rounds: 11, totalScore: 1 })
  })

  it('统计缺失时兜底 {rounds:0,totalScore:0}', () => {
    const stats = backfillNetStats()
    expect(stats).toEqual({ rounds: 0, totalScore: 0 })
  })
})
