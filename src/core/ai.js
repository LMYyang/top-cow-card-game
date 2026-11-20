import { tilePoints } from './tiles.js'
import { playableTilesEnds, playableForLead, placeSides } from './rules.js'

/**
 * 中等 AI：跟牌出点数最高者、两端都可接时倾向接底端；头牌首出合法牌中出点数最高者；
 * 扣牌扣点数最低者。只依赖传入的手牌数据。
 * 返回 { action: 'play', tileIds, side } 或 { action: 'discard', tileId }；
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
    const pool = legal.length > 0 ? legal : hand
    const best = pool.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
    return { action: 'play', tileIds: [best.id], side: 'bottom' }
  }
  const playable = playableTilesEnds(hand, openEnds)
  if (playable.length === 0) return null

  const best = playable.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
  // 选端：两端都可接时优先接底端（保守策略，给后续跟牌留更多对接机会）
  const options = placeSides(best, openEnds)
  const bottomOpt = options.find((o) => o.side === 'bottom')
  const side = bottomOpt ? 'bottom' : 'top'
  return { action: 'play', tileIds: [best.id], side }
}

/** 扣牌选择：扣点数最低的牌（无可跟牌时才允许扣） */
export function aiChooseDiscard(hand, openEnds) {
  if (playableTilesEnds(hand, openEnds).length > 0) return null
  const lowest = hand.reduce((a, b) => (tilePoints(a) <= tilePoints(b) ? a : b))
  return { action: 'discard', tileId: lowest.id }
}
