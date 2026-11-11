import { tilePoints } from './tiles.js'

/**
 * 座位约定：0=掷骰者, 1=下家, 2=对家, 3=上家；逆时针 0→1→2→3。
 * 玩家状态：{ seat, hand: Tile[], kept: Tile[] }
 */

/** 跟牌判定：candidate 任一端 === 桌面牌任一端 */
export function canFollow(candidate, tableTile) {
  return candidate.a === tableTile.a || candidate.a === tableTile.b ||
         candidate.b === tableTile.a || candidate.b === tableTile.b
}

/** 跟牌判定（双端链）：candidate 任一端 === 链两端任一待接端点 */
export function canFollowEnds(candidate, openEnds) {
  return candidate.a === openEnds.bottom || candidate.a === openEnds.top ||
         candidate.b === openEnds.bottom || candidate.b === openEnds.top
}

/** 手牌中所有可跟的牌 */
export function playableTiles(hand, tableTile) {
  return hand.filter((t) => canFollow(t, tableTile))
}

/** 手牌中所有可跟的牌（双端链版）：任一端点匹配链两端待接点即可 */
export function playableTilesEnds(hand, openEnds) {
  return hand.filter((t) => canFollowEnds(t, openEnds))
}

/** 是否必须扣牌：手里没有任何可跟的牌 */
export function mustDiscard(hand, tableTile) {
  return playableTiles(hand, tableTile).length === 0
}

/** 是否必须扣牌（双端链版） */
export function mustDiscardEnds(hand, openEnds) {
  return playableTilesEnds(hand, openEnds).length === 0
}

/**
 * 出牌端选择：给一张可跟的牌和当前链两端待接点，判断它能接哪端。
 * @returns {{ side: 'bottom'|'top', mirrored: boolean }[]} 可放置的端列表（0-2 个）
 *   mirrored=true 表示需上下镜像渲染使点数相对对接（牌 a 端为对接端）。
 *   未镜像时未翻转牌朝上端是 b：底端对接端为牌 b；镜像后朝上端是 a：底端对接端为牌 a。
 */
export function placeSides(tile, openEnds) {
  const sides = []
  // 底端：牌的"朝上端"必须等于 openEnds.bottom；朝上端未镜像=b，镜像=a
  if (tile.b === openEnds.bottom) sides.push({ side: 'bottom', mirrored: false })
  else if (tile.a === openEnds.bottom) sides.push({ side: 'bottom', mirrored: true })
  // 顶端：牌的"朝下端"必须等于 openEnds.top；朝下端未镜像=a，镜像=b
  if (tile.a === openEnds.top) sides.push({ side: 'top', mirrored: false })
  else if (tile.b === openEnds.top) sides.push({ side: 'top', mirrored: true })
  return sides
}

/** 头牌首出可出的牌：不能"拉"三家——其余三家任一家持有该牌任一端点才可出 */
export function playableForLead(hand, otherHands) {
  const otherEnds = new Set()
  for (const handOfOther of otherHands) {
    for (const t of handOfOther) {
      otherEnds.add(t.a)
      otherEnds.add(t.b)
    }
  }
  return hand.filter((t) => otherEnds.has(t.a) || otherEnds.has(t.b))
}

/** 骰点 → 相对掷骰者的座位偏移（1/5 自己, 2/6 下家, 3 对家, 4 上家） */
export function diceToSeatOffset(dice) {
  const map = { 1: 0, 5: 0, 2: 1, 6: 1, 3: 2, 4: 3 }
  if (!(dice in map)) throw new Error(`非法骰点: ${dice}`)
  return map[dice]
}

/** 相对座位名（以掷骰者为参照） */
export function seatName(offset) {
  return ['自己', '下家', '对家', '上家'][offset]
}

/**
 * 结算。
 * @param players 四个 { seat, hand, kept }
 * @param leaderSeat 头牌座位
 * @returns {{ winner: number, ranks: [{seat, points, role}], scores: {seat: number} }}
 * role: '赢家'|'大庄'|'二庄'|'小庄'
 */
export function settle(players, leaderSeat) {
  const info = players.map((p) => ({
    seat: p.seat,
    points: p.kept.reduce((s, t) => s + tilePoints(t), 0),
  }))

  const allClean = info.every((i) => i.points === 0)

  const leadDist = (seat) => (seat - leaderSeat + 4) % 4

  // 赢家：扣点最少；同点时离头牌近者赢
  const winnerInfo = [...info].sort(
    (a, b) => a.points - b.points || leadDist(a.seat) - leadDist(b.seat)
  )[0]

  // ranks 固定按庄位序排列：赢家 → 大庄 → 二庄 → 小庄
  let ordered
  if (allClean) {
    // 四家净手特例：头牌赢，其余按出牌次序（头牌下家开始）大庄、二庄、小庄
    ordered = [0, 1, 2, 3].map((k) => (leaderSeat + k) % 4)
      .map((seat) => info.find((i) => i.seat === seat))
  } else {
    // 输家按扣点降序（最多=大庄排前）；同点时离头牌近者庄大（排前）
    const losers = info
      .filter((i) => i.seat !== winnerInfo.seat)
      .sort((a, b) => b.points - a.points || leadDist(a.seat) - leadDist(b.seat))
    ordered = [winnerInfo, ...losers]
  }

  const roles = ['赢家', '大庄', '二庄', '小庄']
  const rankScores = [6, -3, -2, -1]

  const ranks = ordered.map((p, idx) => ({ ...p, role: roles[idx] }))
  const scores = {}
  for (const r of ranks) {
    scores[r.seat] = rankScores[roles.indexOf(r.role)]
  }

  return {
    winner: ordered[0].seat,
    ranks,
    scores,
  }
}
