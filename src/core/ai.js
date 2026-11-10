import { tilePoints } from './tiles.js'
import { playableTiles, playableForLead } from './rules.js'

/**
 * 中等 AI：
 * - 跟牌：出可接牌中点数最高者（高点先走，减少被扣风险）
 * - 头牌首出：合法（不拉三家）牌中出点数最高者
 * - 扣牌：扣点数最低者（扣点计负分，留高点等以后出）
 * 只依赖传入的手牌数据，不会"偷看"其他信息。
 * 返回 { action: 'play', tileIds } 或 { action: 'discard', tileId }。
 */

/** 跟牌/首出选择。tableTile 为 null 且 isLeadFirst 表示头牌首出 */
export function aiChoosePlay(hand, tableTile, { isLeadFirst = false, otherHands = [] } = {}) {
  if (isLeadFirst) {
    const legal = playableForLead(hand, otherHands)
    const pool = legal.length > 0 ? legal : hand // 极端情况（理论不发生）：兜底出第一张
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
  const best = hand.reduce((a, b) => (tilePoints(a) <= tilePoints(b) ? a : b))
  return { action: 'discard', tileId: best.id }
}
