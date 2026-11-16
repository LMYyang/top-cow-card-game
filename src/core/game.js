import { dealGroups } from './deck.js'
import { playableForLead, canFollowEnds, mustDiscardEnds, placeSides, nextOpenEnds, diceToSeatOffset, settle, canRedeal, declarationFor } from './rules.js'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js'

/**
 * 游戏状态机（纯 JS、平台无关、可变状态对象）。
 * state: 'ROLLING' | 'PLAYING' | 'SETTLE'
 * 动作函数都返回 { ok: boolean, reason?: string }，非法动作不改状态。
 * 桌面为双端接龙链：openEnds = { top, bottom } 为链两端待接点数；
 * 跟牌可接在任一端，由 play 的 side 参数（'bottom'|'top'）指定，缺省 'bottom'。
 */

export function createGame(rng = Math.random, rollerSeat = 0, settings = DEFAULT_SETTINGS) {
  return {
    rng,
    state: 'ROLLING',
    roundNo: 1,
    rollerSeat, // 第一局默认 0；连续局传入上一局赢家
    leaderSeat: null,
    tableTile: null, // 链上最新出的一张牌（兼容保留）
    openEnds: null, // { top, bottom } 链两端待接点数；首出前为 null
    tableHistory: [], // [{ seat, tiles: [tile] }] 出牌历史（扣牌为 { seat, discarded: tile }）
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [], kept: [] })),
    currentSeat: null,
    result: null,
    redealUsed: new Set(), // 本局已申请过重新发牌的座位（每人每局 1 次，防死循环）
    settings: normalizeSettings(settings),
    account: null, // { seat, type } 本局宣告（一局最多一次）
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
  g.openEnds = null
  g.state = 'PLAYING'
  return { ok: true, leaderSeat }
}

/**
 * 申请重新发牌：手牌满足 canRedeal 且尚无人出牌时，重置牌局并由申请人掷骰。
 * 每人每局限 1 次（redealUsed 按座位记录，重发后其余座位仍可各申请一次）。
 */
export function redeal(g, seat) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '当前不可申请重新发牌' }
  if (g.tableHistory.length > 0) return { ok: false, reason: '已开始出牌，不能再申请重新发牌' }
  if (g.redealUsed.has(seat)) return { ok: false, reason: '本局已申请过重新发牌' }
  if (!canRedeal(g.players[seat].hand)) return { ok: false, reason: '手牌不满足重新发牌条件' }
  g.players.forEach((p) => { p.hand = []; p.kept = [] })
  g.tableTile = null
  g.openEnds = null
  g.tableHistory = []
  g.leaderSeat = null
  g.currentSeat = null
  g.rollerSeat = seat // 申请人打骰
  g.redealUsed.add(seat)
  g.state = 'ROLLING'
  return { ok: true }
}

function advanceTurn(g) {
  if (g.players.every((p) => p.hand.length === 0)) {
    g.result = settle(g.players, g.leaderSeat, g.account)
    g.state = 'SETTLE'
    return
  }
  // 跳过空手座位（红八双出会使头牌手牌数比别家少 2，可能提前打空）
  do {
    g.currentSeat = (g.currentSeat + 1) % 4
  } while (g.players[g.currentSeat].hand.length === 0)
}

/** 某座位头牌首出的合法牌 id 数组（不拉三家约束） */
export function leadLegalTileIds(g, seat) {
  const others = g.players.filter((p) => p.seat !== seat).map((p) => p.hand)
  return playableForLead(g.players[seat].hand, others).map((t) => t.id)
}

/** 出牌。tileIds: [id] 或 [id, id]（仅头牌首出双张红八）；跟牌时 side: 'bottom'|'top' 指定接哪端（缺省 bottom）；declare=true 声明算账宣告（需复核通过） */
export function play(g, seat, tileIds, side = 'bottom', declare = false) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '非出牌阶段' }
  if (seat !== g.currentSeat) return { ok: false, reason: '没轮到该座位' }
  if (new Set(tileIds).size !== tileIds.length) return { ok: false, reason: '重复的牌' }
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

  let placement = { side: 'bottom', mirrored: false }
  if (g.openEnds === null) {
    if (seat !== g.leaderSeat) return { ok: false, reason: '首出必须是头牌' }
    if (tiles.length === 1) {
      const legal = leadLegalTileIds(g, seat)
      if (!legal.includes(tiles[0].id)) {
        return { ok: false, reason: '头牌不能拉三家：其余三家无人能接这张牌' }
      }
    }
  } else {
    if (tiles.length !== 1) return { ok: false, reason: '跟牌只能出一张' }
    const options = placeSides(tiles[0], g.openEnds)
    if (options.length === 0) {
      return { ok: false, reason: '这张牌接不上桌面牌（两端都不匹配）' }
    }
    const chosen = options.find((o) => o.side === side)
    if (!chosen) {
      return { ok: false, reason: `这张牌接不上${side === 'top' ? '顶' : '底'}端` }
    }
    placement = chosen
  }

  // 算账宣告复核：仅单张跟牌可宣告；declare=true 时该端必须构成宣告
  let declared = null
  if (declare) {
    if (g.openEnds === null || tiles.length !== 1) {
      return { ok: false, reason: '只有跟牌可以宣告算账' }
    }
    if (g.account) return { ok: false, reason: '本局已有人宣告算账' }
    const chainTiles = g.tableHistory.flatMap((e) => e.tiles || [])
    const opts = declarationFor(tiles[0], g.openEnds, chainTiles, player.hand, g.settings)
    const hit = opts.find((o) => o.side === placement.side)
    if (!hit) return { ok: false, reason: '这手牌不构成算账宣告' }
    declared = { seat, type: hit.type }
  }

  const tile = tiles[tiles.length - 1]
  player.hand = player.hand.filter((t) => !tileIds.includes(t.id))
  g.tableTile = tile

  if (g.openEnds === null) {
    // 首出：链两端 = 该牌两端（未镜像渲染：上端 b、下端 a）
    g.openEnds = { top: tile.b, bottom: tile.a }
  } else {
    g.openEnds = nextOpenEnds(g.openEnds, tile, placement.side, placement.mirrored)
  }

  if (declared) g.account = declared
  g.tableHistory.push({ seat, tiles, side: placement.side, mirrored: placement.mirrored })
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
  if (g.openEnds === null) {
    return { ok: false, reason: '头牌首出不能扣牌' }
  }
  if (!mustDiscardEnds(player.hand, g.openEnds)) {
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
    openEnds: g.openEnds,
    myHand: g.players[viewerSeat].hand,
    myKept: g.players[viewerSeat].kept,
    opponents: g.players
      .filter((p) => p.seat !== viewerSeat)
      .map((p) => ({ seat: p.seat, handCount: p.hand.length, keptCount: p.kept.length })),
    result: g.result,
    tableHistory: g.tableHistory,
    redealUsed: [...g.redealUsed],
    account: g.account,
    settings: { ...g.settings },
  }
}
