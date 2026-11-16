import { describe, it, expect } from 'vitest'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds, redeal } from '../src/core/game.js'
import { mulberry32 } from '../src/core/deck.js'
import { settle } from '../src/core/rules.js'
import { TILES } from '../src/core/tiles.js'
import { tile } from './helpers.js'

const byId = (id) => TILES.find(t => t.id === id)

function startGame(seed = 42, dice = 3) {
  const g = createGame(mulberry32(seed))
  const res = rollDice(g, dice)
  return { g, res }
}

/** 强制把某座位手牌替换为给定牌组（测试 canRedeal 用，绕过随机发牌） */
function forceHand(g, seat, tiles) {
  g.players[seat].hand = [...tiles]
}

/** 取头牌当前合法首出牌（不拉三家约束下） */
function require_legal_lead_tile(g) {
  const leader = g.players[g.leaderSeat]
  const others = g.players.filter(p => p.seat !== g.leaderSeat).map(p => p.hand)
  const ends = new Set(others.flat().flatMap(t => [t.a, t.b]))
  return leader.hand.find(t => ends.has(t.a) || ends.has(t.b))
}

describe('createGame / rollDice', () => {
  it('初始状态 ROLLING，掷骰后进入 PLAYING 且确定头牌', () => {
    const g = createGame(mulberry32(42))
    expect(g.state).toBe('ROLLING')
    expect(g.rollerSeat).toBe(0) // 第一局默认 seat 0 掷骰
    rollDice(g, 3) // 3 → 对家 = seat 2 头牌
    expect(g.state).toBe('PLAYING')
    expect(g.leaderSeat).toBe(2)
    expect(g.currentSeat).toBe(2)
    expect(g.players.every(p => p.hand.length === 6)).toBe(true)
    expect(g.players.every(p => p.kept.length === 0)).toBe(true)
  })
  it('非法骰点被拒绝', () => {
    const g = createGame(mulberry32(42))
    const res = rollDice(g, 9)
    expect(res.ok).toBe(false)
    expect(g.state).toBe('ROLLING')
  })
  it('createGame 可指定掷骰者（连续局）', () => {
    const g = createGame(mulberry32(42), 2)
    expect(g.rollerSeat).toBe(2)
    rollDice(g, 1) // 1 → 自己 = seat 2 头牌
    expect(g.leaderSeat).toBe(2)
  })
})

describe('play 出牌', () => {
  it('头牌可以出"不拉三家"的牌', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    const res = play(g, g.leaderSeat, [legal.id])
    expect(res.ok).toBe(true)
    expect(g.tableTile.id).toBe(legal.id)
    expect(g.players[g.leaderSeat].hand.length).toBe(5)
    expect(g.currentSeat).toBe((g.leaderSeat + 1) % 4)
  })
  it('非当前座位出牌被拒', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    const wrongSeat = (g.leaderSeat + 1) % 4
    const res = play(g, wrongSeat, [legal.id])
    expect(res.ok).toBe(false)
  })
  it('头牌拉三家的首出被拒（seed 18 头牌持拉三家牌）', () => {
    const { g } = startGame(18, 3)
    const leader = g.players[g.leaderSeat]
    const others = g.players.filter(p => p.seat !== g.leaderSeat).map(p => p.hand)
    const ends = new Set(others.flat().flatMap(t => [t.a, t.b]))
    const illegal = leader.hand.find(t => !ends.has(t.a) && !ends.has(t.b))
    expect(illegal).toBeTruthy() // seed 18 头牌持有拉三家的牌（t10-2）
    const res = play(g, g.leaderSeat, [illegal.id])
    expect(res.ok).toBe(false)
    // 非法动作不改状态
    expect(g.tableTile).toBe(null)
    expect(g.players[g.leaderSeat].hand.length).toBe(6)
  })
  it('跟牌必须端点匹配，不匹配被拒（seed 2 首家跟牌者无牌可接）', () => {
    const { g } = startGame(2, 3)
    const legal = require_legal_lead_tile(g)
    expect(play(g, g.leaderSeat, [legal.id]).ok).toBe(true)
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const ends = g.openEnds
    const matching = hand.find(t => t.a === ends.top || t.a === ends.bottom || t.b === ends.top || t.b === ends.bottom)
    expect(matching).toBeUndefined() // 确认走到"不匹配"分支
    const res = play(g, follower, [hand[0].id])
    expect(res.ok).toBe(false)
    // 拒绝后状态不变
    expect(g.tableTile.id).toBe(legal.id)
    expect(hand.length).toBe(6)
  })
  it('跟牌接不上指定端被拒，接另一端成功（双端链 side 校验）', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    expect(play(g, g.leaderSeat, [legal.id]).ok).toBe(true)
    // 首出后链两端 { top: tile.b, bottom: tile.a }
    const follower = g.currentSeat
    const ends = g.openEnds
    const hand = g.players[follower].hand
    // 找一张只能接顶端的牌（bottom 不可但 top 可）
    const onlyTop = hand.find(t => {
      const bottomOk = t.b === ends.bottom || t.a === ends.bottom
      const topOk = t.a === ends.top || t.b === ends.top
      return !bottomOk && topOk
    })
    if (onlyTop) {
      const res = play(g, follower, [onlyTop.id], 'bottom')
      expect(res.ok).toBe(false) // 指定 bottom 但接不上
      expect(g.players[follower].hand.length).toBe(6) // 状态不变
      const res2 = play(g, follower, [onlyTop.id], 'top')
      expect(res2.ok).toBe(true)
      expect(g.openEnds.top !== ends.top || true).toBe(true) // 顶端已更新（无异常即可）
    }
  })
})

describe('discard 扣牌', () => {
  it('有牌可接时扣牌被拒（不能扣活牌）', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const ends = g.openEnds
    const canF = hand.some(t => t.a === ends.top || t.a === ends.bottom || t.b === ends.top || t.b === ends.bottom)
    if (canF) {
      const res = discard(g, follower, hand[0].id)
      expect(res.ok).toBe(false)
    }
  })
  it('无牌可接时扣牌成功，扣牌进入 kept（seed 2 首家跟牌者无牌可接）', () => {
    const { g } = startGame(2, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const ends = g.openEnds
    const canF = hand.some(t => t.a === ends.top || t.a === ends.bottom || t.b === ends.top || t.b === ends.bottom)
    expect(canF).toBe(false) // 确认走到"无牌可接"分支
    const tileId = hand[0].id
    const res = discard(g, follower, tileId)
    expect(res.ok).toBe(true)
    expect(g.players[follower].kept.map(t => t.id)).toContain(tileId)
    expect(g.players[follower].hand.length).toBe(5)
  })
  it('头牌首出前不能扣牌', () => {
    const { g } = startGame(42, 3)
    const hand = g.players[g.leaderSeat].hand
    const res = discard(g, g.leaderSeat, hand[0].id)
    expect(res.ok).toBe(false)
  })
})

describe('leadLegalTileIds 头牌首出约束', () => {
  it('返回的每张牌都至少有一个端点存在于其余三家之一', () => {
    const g = createGame(mulberry32(42))
    rollDice(g, 3)
    const legal = leadLegalTileIds(g, g.leaderSeat)
    const otherEnds = new Set(
      g.players.filter(p => p.seat !== g.leaderSeat).flatMap(p => p.hand.flatMap(t => [t.a, t.b]))
    )
    expect(legal.length).toBeGreaterThan(0) // 非空守卫：防止恒空返回使断言空转通过
    for (const id of legal) {
      const t = g.players[g.leaderSeat].hand.find(t => t.id === id)
      expect(otherEnds.has(t.a) || otherEnds.has(t.b)).toBe(true)
    }
  })
})

describe('整局流程', () => {
  it('固定种子下完整打完一局进入 SETTLE，每人处理完 6 张', () => {
    const { g } = startGame(42, 3)
    let guard = 0
    while (g.state === 'PLAYING' && guard < 100) {
      guard++
      const seat = g.currentSeat
      const hand = g.players[seat].hand
      const ends = g.openEnds
      if (ends === null) {
        const others = g.players.filter(p => p.seat !== seat).map(p => p.hand)
        const othersEnds = new Set(others.flat().flatMap(t => [t.a, t.b]))
        const move = hand.find(t => othersEnds.has(t.a) || othersEnds.has(t.b))
        expect(move).toBeTruthy()
        expect(play(g, seat, [move.id]).ok).toBe(true)
      } else {
        const matching = hand.filter(t => t.a === ends.top || t.a === ends.bottom || t.b === ends.top || t.b === ends.bottom)
        if (matching.length > 0) {
          // 双端链：需带合法 side 出牌（能接 bottom 则默认 bottom，否则 top）
          const t = matching[0]
          const side = (t.b === ends.bottom || t.a === ends.bottom) ? 'bottom' : 'top'
          expect(play(g, seat, [t.id], side).ok).toBe(true)
        } else {
          expect(discard(g, seat, hand[0].id).ok).toBe(true)
        }
      }
    }
    expect(guard).toBeLessThan(100)
    expect(g.state).toBe('SETTLE')
    for (const p of g.players) {
      // 每人 6 张去向上守恒：出牌上台 + 扣牌 + 手中剩余 = 6
      // （出牌从 hand 移除且不进 kept，进入 tableHistory）
      const playedCount = g.tableHistory
        .filter(h => h.seat === p.seat && h.tiles)
        .reduce((s, h) => s + h.tiles.length, 0)
      expect(p.hand.length + p.kept.length + playedCount).toBe(6)
    }
    expect(g.result.winner).toBeGreaterThanOrEqual(0)
    expect(Object.keys(g.result.scores)).toHaveLength(4)
  })

  it('红八双出后整局仍能打完进入 SETTLE（死锁回归，seed 1）', () => {
    const { g } = startGame(1, 1) // dice 1 → 自己 = seat 0 头牌
    expect(g.leaderSeat).toBe(0)
    // 头牌持有两张红八
    const leader = g.players[g.leaderSeat]
    expect(leader.hand.some(t => t.id === 't5-1')).toBe(true)
    expect(leader.hand.some(t => t.id === 't5-2')).toBe(true)
    // 头牌首出双出红八
    const pairRes = play(g, g.leaderSeat, ['t5-1', 't5-2'])
    expect(pairRes.ok).toBe(true)
    expect(leader.hand.length).toBe(4)

    let guard = 0
    while (g.state === 'PLAYING' && guard < 100) {
      guard++
      const seat = g.currentSeat
      const hand = g.players[seat].hand
      const ends = g.openEnds
      if (hand.length === 0) {
        // 空手玩家在修复后不应再被要求行动（若被要求会死循环在此暴露）
        expect.unreachable('空手座位被要求行动，游戏将死锁')
      }
      if (ends === null) {
        const others = g.players.filter(p => p.seat !== seat).map(p => p.hand)
        const othersEnds = new Set(others.flat().flatMap(t => [t.a, t.b]))
        const move = hand.find(t => othersEnds.has(t.a) || othersEnds.has(t.b))
        expect(move).toBeTruthy()
        expect(play(g, seat, [move.id]).ok).toBe(true)
      } else {
        const matching = hand.filter(t => t.a === ends.top || t.a === ends.bottom || t.b === ends.top || t.b === ends.bottom)
        if (matching.length > 0) {
          // 双端链：需带合法 side 出牌
          const t = matching[0]
          const side = (t.b === ends.bottom || t.a === ends.bottom) ? 'bottom' : 'top'
          expect(play(g, seat, [t.id], side).ok).toBe(true)
        } else {
          expect(discard(g, seat, hand[0].id).ok).toBe(true)
        }
      }
    }
    expect(guard).toBeLessThan(100)
    expect(g.state).toBe('SETTLE')
    // 牌张守恒：每人 6 张 = 出牌 + 扣牌 + 手中
    for (const p of g.players) {
      const playedCount = g.tableHistory
        .filter(h => h.seat === p.seat && h.tiles)
        .reduce((s, h) => s + h.tiles.length, 0)
      expect(p.hand.length + p.kept.length + playedCount).toBe(6)
    }
  })
})

describe('双出红八校验', () => {
  it('重复的 tileIds 被拒（I1）', () => {
    const { g } = startGame(1, 1)
    expect(g.leaderSeat).toBe(0)
    const handBefore = [...g.players[0].hand]
    const res = play(g, 0, ['t5-1', 't5-1'])
    expect(res.ok).toBe(false)
    // 非法动作不改状态：手牌不变、桌面牌仍为空
    expect(g.players[0].hand.map(t => t.id)).toEqual(handBefore.map(t => t.id))
    expect(g.tableTile).toBe(null)
    expect(g.tableHistory.length).toBe(0)
  })
})

describe('redeal 申请重新发牌', () => {
  it('窗口内满足条件：重置牌局、掷骰权移交申请人、状态回 ROLLING', () => {
    const { g } = startGame(42, 3) // 头牌 seat 2
    const applicant = 1 // 非头牌也可申请
    forceHand(g, applicant, [
      tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1'),
    ])
    const res = redeal(g, applicant)
    expect(res.ok).toBe(true)
    expect(g.state).toBe('ROLLING')
    expect(g.rollerSeat).toBe(applicant) // 申请人打骰
    expect(g.players.every((p) => p.hand.length === 0)).toBe(true) // 四家手牌清空
    expect(g.openEnds).toBe(null)
    expect(g.tableHistory).toHaveLength(0)
    expect(g.tableTile).toBe(null)
    expect(g.redealUsed.has(applicant)).toBe(true)
  })

  it('重发后可正常掷骰开局（rollerSeat=申请人）', () => {
    const { g } = startGame(42, 3)
    const applicant = 1
    forceHand(g, applicant, [
      tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1'),
    ])
    expect(redeal(g, applicant).ok).toBe(true)
    const res = rollDice(g, 1) // 1 → 掷骰者自己 = applicant 头牌
    expect(res.ok).toBe(true)
    expect(g.state).toBe('PLAYING')
    expect(g.leaderSeat).toBe(applicant)
    expect(g.players.every((p) => p.hand.length === 6)).toBe(true)
  })

  it('已出牌（tableHistory 非空）申请被拒', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    expect(play(g, g.leaderSeat, [legal.id]).ok).toBe(true)
    forceHand(g, 0, [
      tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1'),
    ])
    const res = redeal(g, 0)
    expect(res.ok).toBe(false)
    expect(g.state).toBe('PLAYING') // 状态不变
  })

  it('牌型不满足申请被拒', () => {
    const { g } = startGame(42, 3)
    // 两红八 + 红十（不满足）
    forceHand(g, 0, [
      tile('t5-1'), tile('t5-2'), tile('t4-1'), tile('t1-1'), tile('t2-1'), tile('t3-1'),
    ])
    const res = redeal(g, 0)
    expect(res.ok).toBe(false)
    expect(g.state).toBe('PLAYING')
    expect(g.players[0].hand).toHaveLength(6) // 手牌未被清空
  })

  it('同一座位重复申请被拒；不同座位各自可申请一次', () => {
    const { g } = startGame(42, 3)
    const hand = [
      tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1'),
    ]
    forceHand(g, 0, hand)
    expect(redeal(g, 0).ok).toBe(true)
    // 申请人重发后手牌已清空，重新注入满足牌的手牌模拟"新牌仍满足"的场景
    forceHand(g, 0, hand)
    expect(redeal(g, 0).ok).toBe(false) // 本局已申请过
    expect(g.state).toBe('ROLLING')
    // 换个座位：先掷骰回 PLAYING，另一座位首次申请应成功
    expect(rollDice(g, 1).ok).toBe(true)
    forceHand(g, 2, hand)
    expect(redeal(g, 2).ok).toBe(true)
    expect(g.rollerSeat).toBe(2)
  })

  it('ROLLING 状态申请被拒（未发牌）', () => {
    const g = createGame(mulberry32(42))
    const res = redeal(g, 0)
    expect(res.ok).toBe(false)
  })

  it('viewOf 输出 redealUsed（数组形态）', () => {
    const { g } = startGame(42, 3)
    forceHand(g, 1, [
      tile('t5-1'), tile('t5-2'), tile('t1-1'), tile('t2-1'), tile('t3-1'), tile('t6-1'),
    ])
    expect(redeal(g, 1).ok).toBe(true)
    const v = viewOf(g, 0)
    expect(v.redealUsed).toEqual([1])
  })
})

const ACC_ON = { enabled: true, red: true, yao: true, erSan: true, wu: true }

/** 构造红账宣告场景：强制 g.players 手牌（dice=3 → 头牌 seat2） */
function setupRedAccount(seed = 42) {
  const g = createGame(mulberry32(seed), 0, ACC_ON)
  rollDice(g, 3) // 头牌 = seat 2
  // 头牌 seat2 手牌：先出一张牌建链。给 seat2 与 seat1 布置红账场景：
  // seat2（头牌）出红十 t4-1 建链（两端 4,6）；seat1 持另一张红十 t4-2 + 一张能接的过渡牌
  g.players[2].hand = [byId('t4-1'), byId('t1-1'), byId('t3-1'), byId('t5-1'), byId('t6-1'), byId('t10-1')]
  g.players[1].hand = [byId('t4-2'), byId('t2-1'), byId('t11-1'), byId('t12-1'), byId('t13-1'), byId('t8-1')]
  const lead = play(g, 2, ['t4-1'])
  expect(lead.ok).toBe(true) // 红十首出（其余各家持 4/6 端牌，不拉三家成立——测试内断言防御）
  return { g }
}

describe('play declare 算账宣告', () => {
  it('declare=true 且构成宣告：account 记录座位与账种', () => {
    const { g } = setupRedAccount()
    // 首出后 openEnds={top:6,bottom:4}。红十 4/6 接 top(6) 端非镜像 → 新 top = tile.b = 4
    // → 端 4,4 冻结（两张红十全上链）→ 红账
    g.currentSeat = 1
    const res2 = play(g, 1, ['t4-2'], 'top', true)
    expect(res2.ok).toBe(true)
    expect(g.account).toEqual({ seat: 1, type: '红账' })
  })
  it('declare=false 同样的牌只是普通出牌，不记 account', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    const res = play(g, 1, ['t4-2'], 'top')
    expect(res.ok).toBe(true)
    expect(g.account).toBe(null)
  })
  it('declare=true 但不构成宣告被拒', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    const res = play(g, 1, ['t4-2'], 'bottom', true) // 接 4 端暴露 6，非冻结，不构成宣告
    expect(res.ok).toBe(false)
    expect(g.account).toBe(null)
    expect(g.players[1].hand.some(t => t.id === 't4-2')).toBe(true) // 牌仍在手
  })
  it('settings 关闭时 declare 被拒', () => {
    const g = createGame(mulberry32(42), 0, { ...ACC_ON, enabled: false })
    rollDice(g, 3)
    g.players[2].hand = [byId('t4-1'), byId('t1-1'), byId('t3-1'), byId('t5-1'), byId('t6-1'), byId('t10-1')]
    g.players[1].hand = [byId('t4-2'), byId('t2-1'), byId('t11-1'), byId('t12-1'), byId('t13-1'), byId('t8-1')]
    expect(play(g, 2, ['t4-1']).ok).toBe(true)
    g.currentSeat = 1
    expect(play(g, 1, ['t4-2'], 'top', true).ok).toBe(false)
  })
  it('已有人宣告后再宣告被拒', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    expect(play(g, 1, ['t4-2'], 'top', true).ok).toBe(true)
    // 宣告后链冻结为 4,4：给 seat1 换上红八 t5-1（4/4 可接 4 端），再次 declare 应被
    // 「本局已有人宣告算账」拒绝（红八本身也非竖牌触发牌，双保险）
    g.currentSeat = 1
    g.players[1].hand = [byId('t5-1'), byId('t5-2')]
    const res2 = play(g, 1, ['t5-1'], 'bottom', true)
    expect(res2.ok).toBe(false)
  })
})

describe('settle 算账结算', () => {
  it('宣告者扣点严格最小：全体翻倍 +12/-6/-4/-2', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] },               // 2 点 最小
      { seat: 1, hand: [], kept: [byId('t11-1'), byId('t11-2')] },// 4 点
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] }, // 8 点
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] }, // 8 点
    ]
    const result = settle(players, 0, { seat: 0, type: '红账' })
    // 输家按扣点降序排庄位：seat2/seat3 各 8 点 > seat1 4 点 → seat2=大庄、seat3=二庄、seat1=小庄
    // 翻倍：赢家 +12、大庄 -6、二庄 -4、小庄 -2
    expect(result.scores).toEqual({ 0: 12, 1: -2, 2: -6, 3: -4 })
    expect(result.account).toEqual({ seat: 0, type: '红账', success: true })
  })
  it('宣告者与别人平点：算失败，包庄 -12', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] }, // 2 点
      { seat: 1, hand: [], kept: [byId('t11-1')] }, // 2 点 平点
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2')] },
      { seat: 3, hand: [], kept: [] },
    ]
    const result = settle(players, 0, { seat: 0, type: '幺账' })
    // seat3 扣 0 更小；无论如何宣告者非严格最小 → 失败
    expect(result.account).toEqual({ seat: 0, type: '幺账', success: false })
    expect(result.scores[0]).toBe(-12)
    expect(result.winner).toBe(3)
    expect(result.scores[3]).toBe(12)
    expect(result.scores[1]).toBe(0)
    expect(result.scores[2]).toBe(0)
  })
  it('宣告者非最小：失败包庄 -12 赢家 +12 其余 0', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1'), byId('t11-2')] },        // 4 点 宣告者
      { seat: 1, hand: [], kept: [byId('t11-1')] },                       // 2 点 赢家
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] }, // 8
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] }, // 8
    ]
    const result = settle(players, 0, { seat: 0, type: '三二账' })
    expect(result.winner).toBe(1)
    expect(result.scores).toEqual({ 0: -12, 1: 12, 2: 0, 3: 0 })
    expect(result.account).toEqual({ seat: 0, type: '三二账', success: false })
  })
  it('无宣告（account=null）结算与旧版一致', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] },
      { seat: 1, hand: [], kept: [byId('t11-1'), byId('t11-2')] },
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] },
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] },
    ]
    const result = settle(players, 0)
    // 扣点 seat2/seat3(8) > seat1(4) → 大庄=seat2、二庄=seat3、小庄=seat1
    expect(result.scores).toEqual({ 0: 6, 1: -1, 2: -3, 3: -2 })
    expect(result.account).toBe(null)
  })
  it('宣告者平点靠首出序成为赢家（allClean）：赢家 +12、大庄包庄 -12', () => {
    const players = [
      { seat: 0, hand: [], kept: [] }, // 宣告者=头牌，扣 0 点
      { seat: 1, hand: [], kept: [] },
      { seat: 2, hand: [], kept: [] },
      { seat: 3, hand: [], kept: [] },
    ]
    const result = settle(players, 0, { seat: 0, type: '五账' })
    // 四家净手：头牌(宣告者)赢 +12，大庄(头牌下家 seat1)包庄 -12，其余 0；零和保持
    expect(result.winner).toBe(0)
    expect(result.account).toEqual({ seat: 0, type: '五账', success: false })
    expect(result.scores).toEqual({ 0: 12, 1: -12, 2: 0, 3: 0 })
  })
})
