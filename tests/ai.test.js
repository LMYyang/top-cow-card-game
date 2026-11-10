import { describe, it, expect } from 'vitest'
import { aiChoosePlay, aiChooseDiscard } from '../src/core/ai.js'
import { tile } from './helpers.js'

describe('aiChoosePlay 跟牌', () => {
  it('多张可接时出点数最高的', () => {
    const table = tile('t1-1') // 大天 6/6
    const hand = [tile('t9-1'), tile('t4-1'), tile('t7-1')] // 一三4点、红十10点、一六7点
    const choice = aiChoosePlay(hand, table, { isLeadFirst: false })
    expect(choice.action).toBe('play')
    expect(choice.tileIds).toEqual(['t4-1']) // 红十 10 点最高
  })
  it('没有可接的牌时返回 null', () => {
    const table = tile('t1-1') // 大天 6/6
    const hand = [tile('t9-1'), tile('t10-1')] // 一三1/3 4点、二板2/2 4点，均无 6 端
    expect(aiChoosePlay(hand, table, { isLeadFirst: false })).toBeNull()
  })
})

describe('aiChoosePlay 头牌首出', () => {
  it('在合法（不拉三家）牌中出点数最高的', () => {
    // 手：长三(6)、一三(4)；其余三家有 1 端（一三可出）、有 3 端（长三可出）
    // 两张都合法 → 出长三（6点 > 4点）
    const hand = [tile('t6-1'), tile('t9-1')]
    const others = [[tile('t11-1')], [tile('t12-1')], [tile('t8-1')]] // 地幺1/1、三六3/6、一五1/5
    const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: others })
    expect(choice.tileIds).toEqual(['t6-1'])
  })
  it('合法牌中排除会拉三家的牌', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三3/3、一三1/3
    const others = [[tile('t11-1')], [tile('t11-2')], [tile('t1-1')]] // 只有1端和6端，无3端
    const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: others })
    expect(choice.tileIds).toEqual(['t9-1']) // 长三拉三家被排除
  })
})

describe('aiChooseDiscard 扣牌', () => {
  it('扣点数最低的牌', () => {
    const table = tile('t1-1') // 6/6，手里这些都接不上
    const hand = [tile('t9-1'), tile('t10-1'), tile('t8-1')] // 4点、4点、6点
    const choice = aiChooseDiscard(hand, table)
    expect(choice.action).toBe('discard')
    expect(['t9-1', 't10-1']).toContain(choice.tileId)
  })
  it('手里有能接上的活牌时返回 null（不能扣活牌）', () => {
    const table = tile('t1-1') // 大天 6/6
    const hand = [tile('t4-1'), tile('t9-1')] // 红十4/6 可接、一三1/3 不可接
    expect(aiChooseDiscard(hand, table)).toBeNull()
  })
})
