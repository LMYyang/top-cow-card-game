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
  it('头牌拉三家的首出被拒', () => {
    const { g } = startGame(42, 3)
    const leader = g.players[g.leaderSeat]
    const others = g.players.filter(p => p.seat !== g.leaderSeat).map(p => p.hand)
    const ends = new Set(others.flat().flatMap(t => [t.a, t.b]))
    const illegal = leader.hand.find(t => !ends.has(t.a) && !ends.has(t.b))
    if (illegal) {
      const res = play(g, g.leaderSeat, [illegal.id])
      expect(res.ok).toBe(false)
    }
  })
  it('跟牌必须端点匹配，不匹配被拒', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const matching = hand.find(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (matching) {
      const res = play(g, follower, [matching.id])
      expect(res.ok).toBe(true)
    } else {
      const res = play(g, follower, [hand[0].id])
      expect(res.ok).toBe(false)
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
    const canF = hand.some(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (canF) {
      const res = discard(g, follower, hand[0].id)
      expect(res.ok).toBe(false)
    }
  })
  it('无牌可接时扣牌成功，扣牌进入 kept', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const canF = hand.some(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (!canF) {
      const tileId = hand[0].id
      const res = discard(g, follower, tileId)
      expect(res.ok).toBe(true)
      expect(g.players[follower].kept.map(t => t.id)).toContain(tileId)
      expect(g.players[follower].hand.length).toBe(5)
    }
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
      const table = g.tableTile
      if (table === null) {
        const others = g.players.filter(p => p.seat !== seat).map(p => p.hand)
        const othersEnds = new Set(others.flat().flatMap(t => [t.a, t.b]))
        const move = hand.find(t => othersEnds.has(t.a) || othersEnds.has(t.b))
        expect(move).toBeTruthy()
        expect(play(g, seat, [move.id]).ok).toBe(true)
      } else {
        const matching = hand.filter(t => t.a === table.a || t.a === table.b || t.b === table.a || t.b === table.b)
        if (matching.length > 0) {
          expect(play(g, seat, [matching[0].id]).ok).toBe(true)
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
})
