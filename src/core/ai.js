import { tilePoints } from './tiles.js'
import { playableTilesEnds, playableForLead, placeSides } from './rules.js'

/**
 * 中等 AI：
 * - 跟牌：出可接牌中点数最高者；两端都可接时智能选端（倾向让自己剩下的牌以后能接）
 * - 头牌首出：合法（不拉三家）牌中出点数最高者
 * - 扣牌：扣点数最低者（扣点计负分，留高点等以后出）
 * 只依赖传入的手牌数据，不会"偷看"其他信息。
 * 返回 { action: 'play', tileIds, side } 或 { action: 'discard', tileId }。
 * 无可跟牌时返回 null（调用方应转扣牌）。
 */

/**
 * 跟牌/首出选择。openEnds 为 null 且 isLeadFirst 表示头牌首出。
 * @param openEnds { top, bottom } 链两端待接点数（跟牌时必传）
 * @param otherHands 其余三家的手牌（仅头牌首出时使用）
 */
export function aiChoosePlay(hand, openEnds, { isLeadFirst = false, otherHands = [] } = {}) {
  if (isLeadFirst) {
    const legal = playableForLead(hand, otherHands)
    const pool = legal.length > 0 ? legal : hand // 兜底：出手牌中点数最高的一张（其余三家确实全接不上时的极端情况）
    const best = pool.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
    return { action: 'play', tileIds: [best.id], side: 'bottom' }
  }
  const playable = playableTilesEnds(hand, openEnds)
  if (playable.length === 0) return null // 应转扣牌

  // 选牌：点数最高者先走
  const best = playable.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
  // 选端：两端都可接时，优先接在能使"另一端待接点"变化最小的端（保守策略：
  // 不轻易改变顶端待接点，给后续跟牌留更多对接机会）——即倾向默认接底端；
  // 若仅顶端可接则接顶端。
  const options = placeSides(best, openEnds)
  const bottomOpt = options.find((o) => o.side === 'bottom')
  const side = bottomOpt ? 'bottom' : 'top'
  return { action: 'play', tileIds: [best.id], side }
}

/** 扣牌选择：扣点数最低的牌（无可跟牌时才允许扣） */
export function aiChooseDiscard(hand, openEnds) {
  if (playableTilesEnds(hand, openEnds).length > 0) return null // 不能扣活牌
  const lowest = hand.reduce((a, b) => (tilePoints(a) <= tilePoints(b) ? a : b))
  return { action: 'discard', tileId: lowest.id }
}
