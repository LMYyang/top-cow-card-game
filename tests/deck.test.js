import { describe, it, expect } from 'vitest'
import { shuffle, dealGroups, mulberry32 } from '../src/core/deck.js'
import { TILES } from '../src/core/tiles.js'

describe('mulberry32 可复现随机', () => {
  it('同种子产生同序列', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('shuffle 洗牌', () => {
  it('返回新数组且不修改原数组', () => {
    const original = [...TILES]
    const shuffled = shuffle(TILES, mulberry32(1))
    expect(shuffled).not.toBe(TILES)
    expect(TILES).toEqual(original)
  })
  it('同种子洗牌结果一致，不同种子大概率不同', () => {
    expect(shuffle(TILES, mulberry32(7))).toEqual(shuffle(TILES, mulberry32(7)))
    expect(shuffle(TILES, mulberry32(7))).not.toEqual(shuffle(TILES, mulberry32(8)))
  })
  it('洗牌后仍是同样的 24 张牌', () => {
    const sorted = (ts) => ts.map(t => t.id).sort()
    expect(sorted(shuffle(TILES, mulberry32(9)))).toEqual(sorted(TILES))
  })
})

describe('dealGroups 分四组', () => {
  it('四组各 6 张，合计 24 张不重复', () => {
    const groups = dealGroups(mulberry32(3))
    expect(groups).toHaveLength(4)
    const ids = groups.flat().map(t => t.id)
    expect(ids).toHaveLength(24)
    expect(new Set(ids).size).toBe(24)
  })
})
