import { describe, it, expect } from 'vitest'
import {
  canFollow, playableTiles, mustDiscard, playableForLead,
  canFollowEnds, playableTilesEnds, mustDiscardEnds, placeSides,
  settle, diceToSeatOffset, seatName, canRedeal, declarationFor,
} from '../src/core/rules.js'
import { tile } from './helpers.js'

describe('canFollowEnds 跟牌判定（双端链）', () => {
  it('任一端点与链两端任一待接点相同即可接', () => {
    const openEnds = { top: 6, bottom: 2 }
    expect(canFollowEnds(tile('t4-1'), openEnds)).toBe(true)  // 红十 4/6：b=6 匹配 top
    expect(canFollowEnds(tile('t13-1'), openEnds)).toBe(true) // 二六 2/6：a=2 匹配 bottom
    expect(canFollowEnds(tile('t9-1'), openEnds)).toBe(false) // 一三 1/3：均不匹配
  })
})

describe('playableTilesEnds / mustDiscardEnds（双端链）', () => {
  it('只列出能接链两端的牌', () => {
    const openEnds = { top: 2, bottom: 2 }
    const hand = [tile('t13-1'), tile('t1-1'), tile('t9-1')] // 二六(2/6)、大天(6/6)、一三(1/3)
    const result = playableTilesEnds(hand, openEnds)
    expect(result.map(t => t.id)).toEqual(['t13-1'])
  })
  it('无牌可接时必须扣牌', () => {
    const openEnds = { top: 2, bottom: 2 }
    const hand = [tile('t9-1')] // 一三 1/3
    expect(mustDiscardEnds(hand, openEnds)).toBe(true)
  })
})

describe('placeSides 放置端判定', () => {
  it('仅底端可接', () => {
    // 链 { top: 5, bottom: 6 }；红十 4/6：b=6 → bottom 未镜像；a=4/b=6 均非 5 → 顶端不可
    const sides = placeSides(tile('t4-1'), { top: 5, bottom: 6 })
    expect(sides).toEqual([{ side: 'bottom', mirrored: false }])
  })
  it('仅顶端可接（需镜像）', () => {
    // 链 { top: 4, bottom: 2 }；红十 4/6：朝下端未镜像=a=4 匹配 top 未镜像
    const sides = placeSides(tile('t4-1'), { top: 4, bottom: 2 })
    expect(sides).toEqual([{ side: 'top', mirrored: false }])
  })
  it('两端都可接时返回两个选项', () => {
    // 链 { top: 6, bottom: 4 }；红十 4/6（a=4, b=6）：
    // 底端需朝上端=bottom：未镜像 b=6≠4，镜像 a=4=4 → bottom+镜像；
    // 顶端需朝下端=top：未镜像 a=4≠6，镜像 b=6=6 → top+镜像
    const sides = placeSides(tile('t4-1'), { top: 6, bottom: 4 })
    expect(sides).toEqual([
      { side: 'bottom', mirrored: true },
      { side: 'top', mirrored: true },
    ])
  })
  it('两端都接不上返回空', () => {
    const sides = placeSides(tile('t9-1'), { top: 6, bottom: 6 }) // 一三 1/3
    expect(sides).toEqual([])
  })
})

describe('canFollow 跟牌判定', () => {
  it('任一端点与桌面牌任一端点相同即可接', () => {
    const table = tile('t1-1') // 大天 6/6
    expect(canFollow(tile('t4-1'), table)).toBe(true)  // 红十 4/6
    expect(canFollow(tile('t7-1'), table)).toBe(true)  // 一六 1/6
    expect(canFollow(tile('t9-1'), table)).toBe(false) // 一三 1/3
  })
  it('桌面最新牌是唯一参照', () => {
    const table = tile('t12-1') // 三六 3/6
    expect(canFollow(tile('t6-1'), table)).toBe(true)  // 长三 3/3
  })
})

describe('playableTiles 跟牌可出列表', () => {
  it('只列出能接的牌', () => {
    const table = tile('t10-1') // 二板 2/2
    const hand = [tile('t13-1'), tile('t1-1'), tile('t9-1')] // 二六(2/6)、大天(6/6)、一三(1/3)
    const result = playableTiles(hand, table)
    expect(result.map(t => t.id)).toEqual(['t13-1'])
  })
})

describe('不能扣活牌', () => {
  it('有牌可接时 mustDiscard 为 false', () => {
    const table = tile('t10-1') // 2/2
    const hand = [tile('t13-1')] // 二六 2/6 可接
    expect(mustDiscard(hand, table)).toBe(false)
  })
  it('无牌可接时必须扣牌', () => {
    const table = tile('t10-1') // 2/2
    const hand = [tile('t9-1')] // 一三 1/3
    expect(mustDiscard(hand, table)).toBe(true)
  })
})

describe('playableForLead 头牌不拉三家', () => {
  it('其余三家任一家手里有能接的端点，这张牌可出', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三(3/3)、一三(1/3)
    const others = [
      [tile('t1-1')],  // 对家 大天 6/6
      [tile('t7-1')],  // 下家 一六 1/6 —— 有 1 端，一三可接
      [tile('t11-1')], // 上家 地幺 1/1
    ]
    const result = playableForLead(hand, others)
    // 一三(1/3)：1 端被别人持有 → 可出；长三(3/3)：无人有 3 端 → 不可出
    expect(result.map(t => t.id)).toEqual(['t9-1'])
  })
  it('头牌自己持有的端点不算数（比较的是其余三家）', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三、一三
    const others = [[tile('t1-1')], [tile('t11-1')], [tile('t11-2')]] // 大天6/6、地幺1/1、地幺1/1
    // 一三有 1 端，上家地幺也有 1 端 → 一三可出；长三 3 端无人有 → 不可出
    const result = playableForLead(hand, others)
    expect(result.map(t => t.id)).toEqual(['t9-1'])
  })
})

describe('diceToSeatOffset 骰点映射', () => {
  it('1/5→掷骰者自己, 2/6→下家, 3→对家, 4→上家', () => {
    expect(diceToSeatOffset(1)).toBe(0)
    expect(diceToSeatOffset(5)).toBe(0)
    expect(diceToSeatOffset(2)).toBe(1)
    expect(diceToSeatOffset(6)).toBe(1)
    expect(diceToSeatOffset(3)).toBe(2)
    expect(diceToSeatOffset(4)).toBe(3)
  })
  it('非法点数抛错', () => {
    expect(() => diceToSeatOffset(0)).toThrow()
    expect(() => diceToSeatOffset(7)).toThrow()
  })
})

describe('seatName 座位名', () => {
  it('0=掷骰者(自己) 1=下家 2=对家 3=上家', () => {
    expect(seatName(0)).toBe('自己')
    expect(seatName(1)).toBe('下家')
    expect(seatName(2)).toBe('对家')
    expect(seatName(3)).toBe('上家')
  })
})

describe('settle 结算', () => {
  it('扣牌最少者赢，最多者大庄', () => {
    const players = [
      { seat: 0, hand: [], kept: [tile('t9-1')] },  // 一三 4点 → 赢
      { seat: 1, hand: [], kept: [tile('t1-1')] },  // 大天 12点 → 大庄（扣点最多）
      { seat: 2, hand: [], kept: [tile('t13-1')] }, // 二六 8点 → 二庄
      { seat: 3, hand: [], kept: [tile('t8-1')] },  // 一五 6点 → 小庄
    ]
    const result = settle(players, 0) // 头牌是 seat 0
    expect(result.winner).toBe(0)
    // ranks 按庄位序：赢家 → 大庄(扣点最多) → 二庄 → 小庄
    expect(result.ranks.map(r => r.seat)).toEqual([0, 1, 2, 3])
    expect(result.ranks.find(r => r.seat === 1).role).toBe('大庄')
    expect(result.scores[0]).toBe(6)
    expect(result.scores[1]).toBe(-3)
    expect(result.scores[2]).toBe(-2)
    expect(result.scores[3]).toBe(-1)
  })

  it('同点数输家按离头牌距离定庄位', () => {
    const players = [
      { seat: 0, hand: [], kept: [] },              // 头牌净手 0点 → 赢
      { seat: 1, hand: [], kept: [tile('t9-1')] },  // 4点
      { seat: 2, hand: [], kept: [tile('t10-1')] }, // 4点
      { seat: 3, hand: [], kept: [tile('t8-1')] },  // 6点
    ]
    const result = settle(players, 0)
    expect(result.winner).toBe(0)
    // seat3 6点最差=大庄；seat1 与 seat2 同 4 点，离头牌近的庄大 → seat1=二庄, seat2=小庄
    expect(result.ranks.map(r => r.seat)).toEqual([0, 3, 1, 2])
  })

  it('四家净手：头牌赢，其余按出牌次序大庄二庄小庄', () => {
    const players = [
      { seat: 0, hand: [], kept: [] },
      { seat: 1, hand: [], kept: [] },
      { seat: 2, hand: [], kept: [] },
      { seat: 3, hand: [], kept: [] },
    ]
    const result = settle(players, 0)
    expect(result.winner).toBe(0)
    expect(result.ranks.map(r => r.seat)).toEqual([0, 1, 2, 3])
    expect(result.ranks.find(r => r.seat === 1).role).toBe('大庄')
  })

  it('积分总和为 0（零和）', () => {
    const players = [
      { seat: 0, hand: [], kept: [tile('t1-1')] },
      { seat: 1, hand: [], kept: [tile('t9-1')] },
      { seat: 2, hand: [], kept: [] },
      { seat: 3, hand: [], kept: [tile('t8-1'), tile('t10-1')] },
    ]
    const result = settle(players, 0)
    const sum = Object.values(result.scores).reduce((a, b) => a + b, 0)
    expect(sum).toBe(0)
  })
})

describe('canRedeal 申请重新发牌条件', () => {
  it('两红八无红十：满足', () => {
    const hand = [tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1')]
    expect(canRedeal(hand)).toBe(true)
  })
  it('两红八且有红十：不满足', () => {
    const hand = [tile('t5-1'), tile('t5-2'), tile('t4-1'), tile('t1-1'), tile('t2-1'), tile('t3-1')]
    expect(canRedeal(hand)).toBe(false)
  })
  it('一红八无红十：不满足', () => {
    const hand = [tile('t5-1'), tile('t2-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1')]
    expect(canRedeal(hand)).toBe(false)
  })
  it('六张全横牌：满足', () => {
    // 大天(6/6)、大五(5/5)、红八(4/4)、长三(3/3)、二板(2/2)、地幺(1/1)
    const hand = [tile('t1-1'), tile('t3-1'), tile('t5-1'), tile('t6-1'), tile('t10-1'), tile('t11-1')]
    expect(canRedeal(hand)).toBe(true)
  })
  it('五张横牌加一张竖牌：不满足', () => {
    const hand = [tile('t1-1'), tile('t3-1'), tile('t5-1'), tile('t6-1'), tile('t10-1'), tile('t4-1')] // 红十为竖牌
    expect(canRedeal(hand)).toBe(false)
  })
  it('两张红八且全横牌：两条件重叠仍满足（同一申请）', () => {
    const hand = [tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t3-1'), tile('t10-1'), tile('t11-1')]
    expect(canRedeal(hand)).toBe(true)
  })
  it('空手牌：不满足', () => {
    expect(canRedeal([])).toBe(false)
  })
})

const FULL_ON = { enabled: true, red: true, yao: true, erSan: true, wu: true }

describe('declarationFor 算账宣告判定', () => {
  // ---- 红账：链上已有红十 t4-1，我持红十 t4-2，两端 4 和 6，接 6 端 → 两端皆 4，只剩红八能接
  // （6 端在链底：bottom=6；接 bottom 暴露 4 → 端 4,4 封账）
  const redEnds = { top: 4, bottom: 6 }
  const redChain = [tile('t4-1')] // 链上已有另一张红十
  it('红账正例：红十接 6 端（bottom）返回红账', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '红账', side: 'bottom' }])
  })
  it('红账反例：红十接 4 端不算账', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    // { top: 4, bottom: 6 } 接 top（暴露 6）→ 端 6,4：6 端不冻结（一六/幺六等可接）
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, FULL_ON)
    expect(opts.some(o => o.side === 'top')).toBe(false)
  })
  it('红账反例：链上没有另一张红十（4 端不冻结）', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const chain = [tile('t2-1')] // 链上只有二板，没有红十
    const opts = declarationFor(tile('t4-2'), { top: 4, bottom: 6 }, chain, hand, FULL_ON)
    expect(opts).toEqual([])
  })
  it('红账反例：红八（横牌）不触发', () => {
    const hand = [tile('t5-1'), tile('t5-2')]
    const opts = declarationFor(tile('t5-1'), { top: 4, bottom: 4 }, [tile('t4-1')], hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 幺账：链上已有 5 张带 1 竖牌（幺三×2 幺五×2 幺六×1），我持幺六 t7-2，两端 1 和 6，接 6 端
  // （6 端在链底：bottom=6；接 bottom 暴露 1 → 端 1,1 封账）
  const yaoChain = [tile('t9-1'), tile('t9-2'), tile('t8-1'), tile('t8-2'), tile('t7-1')]
  it('幺账正例：幺六接 6 端返回幺账', () => {
    const hand = [tile('t7-2'), tile('t11-1')]
    const opts = declarationFor(tile('t7-2'), { top: 1, bottom: 6 }, yaoChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '幺账', side: 'bottom' }])
  })
  it('幺账反例：链上缺一张带 1 竖牌', () => {
    const hand = [tile('t7-2'), tile('t11-1')]
    const opts = declarationFor(tile('t7-2'), { top: 1, bottom: 6 }, yaoChain.slice(0, 4), hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 五账：链上已有 3 张带 5 竖牌（虎头×2 + 幺五×1），我持幺五 t8-2（唯一 5 端另一张已用），
  //      两端 5 和 1，接 1 端 → 两端皆 5，只剩大五能接
  // （1 端在链底：bottom=1；接 bottom 暴露 5 → 端 5,5 封账）
  const wuChain = [tile('t2-1'), tile('t2-2'), tile('t8-1')]
  it('五账正例：幺五接 1 端返回五账', () => {
    const hand = [tile('t8-2'), tile('t11-1')]
    const opts = declarationFor(tile('t8-2'), { top: 5, bottom: 1 }, wuChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '五账', side: 'bottom' }])
  })
  it('五账反例：虎头接 5 端（接的正是封点那端）不算账', () => {
    // 我持虎头 t2-1？不可能（t2-1 在链上）。构造：链上有 3 张带 5 竖牌，我持另一张虎头
    const chain = [tile('t2-1'), tile('t8-1'), tile('t8-2')] // 虎头×1 + 幺五×2
    const hand = [tile('t2-2'), tile('t11-1')]
    // 两端 5 和 6：虎头接 6 端暴露 5 → 冻结；接 5 端暴露 6 → 不冻结
    const opts = declarationFor(tile('t2-2'), { top: 5, bottom: 6 }, chain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '五账', side: 'bottom' }])
  })

  // ---- 三二账：链上有幺三×1 + 三六 + 二六（4 张中的 3 张），我持幺三 t9-2，两端 1 和 2，
  //      接 1 端暴露 3 → 端 2,3 冻结（幺三×2/三六/二六全上链）
  // （1 端在链底：bottom=1；接 bottom 暴露 3 → 端 2,3 封账）
  const esChain = [tile('t9-1'), tile('t12-1'), tile('t13-1')]
  it('三二账正例：手里有其他可接牌时选这张返回三二账', () => {
    const hand = [tile('t9-2'), tile('t11-1'), tile('t1-1')]
    // t11-1 地幺 1/1 可接 1 端（=其他可接牌）
    const opts = declarationFor(tile('t9-2'), { top: 2, bottom: 1 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '三二账', side: 'bottom' }])
  })
  it('三二账反例：手里没有其他可接牌时不弹算账', () => {
    const hand = [tile('t9-2'), tile('t3-1')] // 长三 3/3 接不上 1/2 端
    const opts = declarationFor(tile('t9-2'), { top: 2, bottom: 1 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([])
  })
  it('三二账反例：这张牌接不了任何一端', () => {
    const hand = [tile('t9-2'), tile('t11-1')]
    const opts = declarationFor(tile('t9-2'), { top: 5, bottom: 4 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 开关与账种过滤
  it('总开关关闭恒空', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, { ...FULL_ON, enabled: false })
    expect(opts).toEqual([])
  })
  it('账种未勾选不返回', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, { ...FULL_ON, red: false })
    expect(opts).toEqual([])
  })
  it('头牌首出场景（openEnds=null）恒空', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), null, [], hand, FULL_ON)
    expect(opts).toEqual([])
  })
})
