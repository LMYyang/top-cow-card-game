import { tilePoints } from './tiles.js'
import { playableTiles, playableForLead } from './rules.js'

/**
 * 中等 AI：
 * - 跟牌：出可接牌中点数最高者（高点先走，减少被扣风险）
 * - 头牌首出：合法（不拉三家）牌中出点数最高者
 * - 扣牌：扣点数最低者（扣点计负分，留高点等以后出）
 * 只依赖传入的手牌数据，不会"偷看"其他信息。
 * 返回 { action: 'play', tileIds } 或 { action: 'discard', tileId }。
 * 无可跟牌时返回 null（调用方应转扣牌）。
 */

/**
 * 跟牌/首出选择。tableTile 为 null 且 isLeadFirst 表示头牌首出。
 * @param otherHands 其余三家的手牌（仅头牌首出时使用）
 */
export function aiChoosePlay(hand, tableTile, { isLeadFirst = false, otherHands = [] } = {}) {
  if (isLeadFirst) {
    const legal = playableForLead(hand, otherHands)
    const pool = legal.length > 0 ? legal : hand // 兜底：出手牌中点数最高的一张（其余三家确实全接不上时的极端情况）
    const best = pool.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
    return { action: 'play', tileIds: [best.id] }
  }
  const playable = playableTiles(hand, tableTile)
  if (playable.length === 0) return null // 应转扣牌
  const best = playable.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
  return { action: 'play', tileIds: [best.id] }
}

/** 扣牌选择：扣点数最低的牌 */
export function aiChooseDiscard(hand, tableTile) {
  if (playableTiles(hand, tableTile).length > 0) return null // 不能扣活牌
  const lowest = hand.reduce((a, b) => (tilePoints(a) <= tilePoints(b) ? a : b))
  return { action: 'discard', tileId: lowest.id }
}
