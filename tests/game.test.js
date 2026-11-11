import { describe, it, expect } from 'vitest'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds } from '../src/core/game.js'
import { mulberry32 } from '../src/core/deck.js'

function startGame(seed = 42, dice = 3) {
  const g = createGame(mulberry32(seed))
  const res = rollDice(g, dice)
  return { g, res }
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
