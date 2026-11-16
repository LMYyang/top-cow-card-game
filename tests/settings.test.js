// tests/settings.test.js
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js'

describe('normalizeSettings 设置规整', () => {
  it('空值回默认：关闭 + 四账种全选', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
  it('DEFAULT_SETTINGS：enabled=false，四账种 true', () => {
    expect(DEFAULT_SETTINGS).toEqual({ enabled: false, red: true, yao: true, erSan: true, wu: true })
  })
  it('合法对象原样保留', () => {
    const s = { enabled: true, red: true, yao: false, erSan: true, wu: false }
    expect(normalizeSettings(s)).toEqual(s)
  })
  it('缺字段补默认、非法类型回退', () => {
    expect(normalizeSettings({ enabled: true })).toEqual({ enabled: true, red: true, yao: true, erSan: true, wu: true })
    expect(normalizeSettings({ enabled: 'yes', red: 1, yao: null, erSan: undefined, wu: false })).toEqual({
      enabled: false, red: true, yao: true, erSan: true, wu: false,
    })
  })
  it('多余字段被剥离', () => {
    const s = normalizeSettings({ enabled: true, wu: true, hack: 1 })
    expect(s).toEqual({ enabled: true, red: true, yao: true, erSan: true, wu: true })
    expect('hack' in s).toBe(false)
  })
})
