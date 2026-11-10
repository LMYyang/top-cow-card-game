import { dealGroups } from './deck.js'
import { playableForLead, canFollow, mustDiscard, diceToSeatOffset, settle } from './rules.js'

/**
 * 游戏状态机（纯 JS、平台无关、可变状态对象）。
 * state: 'ROLLING' | 'PLAYING' | 'SETTLE'
 * 动作函数都返回 { ok: boolean, reason?: string }，非法动作不改状态。
 */

export function createGame(rng = Math.random, rollerSeat = 0) {
  return {
    rng,
    state: 'ROLLING',
    roundNo: 1,
    rollerSeat, // 第一局默认 0；连续局传入上一局赢家
    leaderSeat: null,
    tableTile: null,
    tableHistory: [], // [{ seat, tiles: [tile] }] 出牌历史（扣牌为 { seat, discarded: tile }）
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [], kept: [] })),
    currentSeat: null,
    result: null,
  }
}

function isRedEightPair(tiles) {
  return tiles.length === 2 && tiles.every((t) => t.a === 4 && t.b === 4)
}

/** 掷骰定头牌并直接完成发牌 */
export function rollDice(g, dice) {
  if (g.state !== 'ROLLING') return { ok: false, reason: '当前不可掷骰' }
  let offset
  try {
    offset = diceToSeatOffset(dice)
  } catch (e) {
    return { ok: false, reason: e.message }
  }
  const leaderSeat = (g.rollerSeat + offset) % 4
  const groups = dealGroups(g.rng)
  for (let i = 0; i < 4; i++) {
    const seat = (leaderSeat + i) % 4
    g.players[seat].hand = groups[i]
  }
  g.leaderSeat = leaderSeat
  g.currentSeat = leaderSeat
  g.tableTile = null
  g.state = 'PLAYING'
  return { ok: true, leaderSeat }
}

function advanceTurn(g) {
  if (g.players.every((p) => p.hand.length === 0)) {
    g.result = settle(g.players, g.leaderSeat)
    g.state = 'SETTLE'
    return
  }
  g.currentSeat = (g.currentSeat + 1) % 4
}

/** 某座位头牌首出的合法牌 id 数组（不拉三家约束） */
export function leadLegalTileIds(g, seat) {
  const others = g.players.filter((p) => p.seat !== seat).map((p) => p.hand)
  return playableForLead(g.players[seat].hand, others).map((t) => t.id)
}

/** 出牌。tileIds: [id] 或 [id, id]（仅头牌首出双张红八） */
export function play(g, seat, tileIds) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '非出牌阶段' }
  if (seat !== g.currentSeat) return { ok: false, reason: '没轮到该座位' }
  const player = g.players[seat]
  const tiles = tileIds.map((id) => player.hand.find((t) => t.id === id))
  if (tiles.some((t) => !t)) return { ok: false, reason: '手牌中不存在该牌' }

  if (tileIds.length === 2) {
    if (seat !== g.leaderSeat || g.tableTile !== null || !isRedEightPair(tiles)) {
      return { ok: false, reason: '只有头牌首出可双出两张红八' }
    }
  } else if (tileIds.length !== 1) {
    return { ok: false, reason: '出牌数量非法' }
  }

  if (g.tableTile === null) {
    if (seat !== g.leaderSeat) return { ok: false, reason: '首出必须是头牌' }
    if (tiles.length === 1) {
      const legal = leadLegalTileIds(g, seat)
      if (!legal.includes(tiles[0].id)) {
        return { ok: false, reason: '头牌不能拉三家：其余三家无人能接这张牌' }
      }
    }
  } else {
    if (tiles.length !== 1) return { ok: false, reason: '跟牌只能出一张' }
    if (!canFollow(tiles[0], g.tableTile)) {
      return { ok: false, reason: '这张牌接不上桌面牌' }
    }
  }

  player.hand = player.hand.filter((t) => !tileIds.includes(t.id))
  g.tableTile = tiles[tiles.length - 1]
  g.tableHistory.push({ seat, tiles })
  advanceTurn(g)
  return { ok: true }
}

/** 扣牌 */
export function discard(g, seat, tileId) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '非出牌阶段' }
  if (seat !== g.currentSeat) return { ok: false, reason: '没轮到该座位' }
  const player = g.players[seat]
  const tile = player.hand.find((t) => t.id === tileId)
  if (!tile) return { ok: false, reason: '手牌中不存在该牌' }
  if (g.tableTile === null) {
    return { ok: false, reason: '头牌首出不能扣牌' }
  }
  if (!mustDiscard(player.hand, g.tableTile)) {
    return { ok: false, reason: '不能扣活牌：手中有可接的牌' }
  }
  player.hand = player.hand.filter((t) => t.id !== tileId)
  player.kept.push(tile)
  g.tableHistory.push({ seat, discarded: tile })
  advanceTurn(g)
  return { ok: true }
}

/** 为 UI 准备的只读视图（过滤他人手牌详情） */
export function viewOf(g, viewerSeat) {
  return {
    state: g.state,
    leaderSeat: g.leaderSeat,
    rollerSeat: g.rollerSeat,
    currentSeat: g.currentSeat,
    tableTile: g.tableTile,
    myHand: g.players[viewerSeat].hand,
    myKept: g.players[viewerSeat].kept,
    opponents: g.players
      .filter((p) => p.seat !== viewerSeat)
      .map((p) => ({ seat: p.seat, handCount: p.hand.length, keptCount: p.kept.length })),
    result: g.result,
    tableHistory: g.tableHistory,
  }
}
