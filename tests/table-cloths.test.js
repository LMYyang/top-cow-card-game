// tests/table-cloths.test.js
import { describe, it, expect } from 'vitest'
import { TABLE_CLOTHS, DEFAULT_CLOTH, clothClass } from '../src/core/tableCloths.js'

describe('桌布清单与映射', () => {
  it('清单非空，id 与 css 类唯一', () => {
    expect(TABLE_CLOTHS.length).toBeGreaterThan(0)
    const ids = TABLE_CLOTHS.map((c) => c.id)
    const css = TABLE_CLOTHS.map((c) => c.css)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(css).size).toBe(css.length)
  })

  it('默认桌布在清单内', () => {
    expect(TABLE_CLOTHS.some((c) => c.id === DEFAULT_CLOTH)).toBe(true)
  })

  it('合法 id 映射到对应主题类', () => {
    const first = TABLE_CLOTHS[0]
    expect(clothClass(first.id)).toBe(first.css)
  })

  it('非法/空 id 回退默认类', () => {
    expect(clothClass('not-exist')).toBe(clothClass(DEFAULT_CLOTH))
    expect(clothClass('')).toBe(clothClass(DEFAULT_CLOTH))
    expect(clothClass(undefined)).toBe(clothClass(DEFAULT_CLOTH))
  })
})
