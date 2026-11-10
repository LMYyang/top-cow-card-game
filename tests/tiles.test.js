import { describe, it, expect } from 'vitest'
import { TILES, CATALOG } from '../src/core/tiles.js'

describe('牌张数据完整性', () => {
  it('恰好 24 张牌', () => {
    expect(TILES).toHaveLength(24)
  })

  it('恰好 13 种牌型，11 种 2 张、2 种 1 张（三六、二六各 1 张）', () => {
    expect(CATALOG).toHaveLength(13)
    const doubleTypes = CATALOG.filter(c => c.count === 2)
    const singleTypes = CATALOG.filter(c => c.count === 1)
    expect(doubleTypes).toHaveLength(11)
    // 注：JS 默认 sort 按码点排序，'三'(U+4E09) < '二'(U+4E8C)
    expect(singleTypes.map(c => c.name).sort()).toEqual(['三六', '二六'])
  })

  it('全部牌总点数为 177', () => {
    const total = TILES.reduce((s, t) => s + t.a + t.b, 0)
    expect(total).toBe(177)
  })

  it('没有 ID 重复', () => {
    const ids = new Set(TILES.map(t => t.id))
    expect(ids.size).toBe(24)
  })

  it('横牌两端相同，竖牌两端不同（共 12 张横牌、12 张竖牌）', () => {
    for (const c of CATALOG) {
      if (c.type === '横牌') expect(c.a).toBe(c.b)
      else expect(c.a).not.toBe(c.b)
    }
    const hengTiles = TILES.filter(t => t.type === '横牌')
    const shuTiles = TILES.filter(t => t.type === '竖牌')
    expect(hengTiles).toHaveLength(12)
    expect(shuTiles).toHaveLength(12)
  })

  it('红牌只有红八、红十', () => {
    const red = CATALOG.filter(c => c.red)
    expect(red.map(c => c.name).sort()).toEqual(['红八', '红十'])
  })
})
