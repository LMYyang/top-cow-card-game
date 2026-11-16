import { tilePoints, TILES } from './tiles.js'

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

/** 计算接牌后的新链两端：与 play 的落牌端点更新共用，防宣告复核与实际落牌漂移。
 *  side='bottom'：新牌朝上端（mirrored ? a : b）与旧 bottom 对接，朝下端成为新 bottom；
 *  side='top'：新牌朝下端（mirrored ? b : a）与旧 top 对接，朝上端成为新 top。 */
export function nextOpenEnds(openEnds, tile, side, mirrored) {
  if (side === 'bottom') {
    return { top: openEnds.top, bottom: mirrored ? tile.b : tile.a }
  }
  return { top: mirrored ? tile.a : tile.b, bottom: openEnds.bottom }
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
 * @param account 本局算账宣告 { seat, type }；无宣告传 null/缺省（行为与旧版一致）
 * @returns {{ winner: number, ranks: [{seat, points, role}], scores: {seat: number}, account: {seat, type, success}|null }}
 * role: '赢家'|'大庄'|'二庄'|'小庄'
 * 有宣告时：宣告者扣点严格小于其余三家最小扣点 → 成功（全体分数翻倍 12/-6/-4/-2）；
 * 否则失败：宣告者包庄 -12，赢家 +12，另两输家 0。
 */
export function settle(players, leaderSeat, account = null) {
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
  const ranks = ordered.map((p, idx) => ({ ...p, role: roles[idx] }))
  const scores = {}

  if (account) {
    // 成功 = 宣告者扣点严格小于其余三家的最小扣点（平点即失败）
    const accInfo = info.find((i) => i.seat === account.seat)
    const otherMin = Math.min(...info.filter((i) => i.seat !== account.seat).map((i) => i.points))
    const success = !!accInfo && accInfo.points < otherMin
    if (success) {
      const rankScores = [12, -6, -4, -2] // 翻倍
      for (const r of ranks) scores[r.seat] = rankScores[roles.indexOf(r.role)]
      return {
        winner: ordered[0].seat,
        ranks,
        scores,
        account: { ...account, success },
      }
    }
    // 失败（含平点）：宣告者包庄 -12，赢家 +12，另两输家 0。
    // 宣告者未严格最小即算输——即使平点靠首出序本可当 round 赢家也不算赢；
    // 赢家取其余三家中扣点最小者（同点按离头牌近者，四家净手时即头牌下家）。
    const winSeat = info
      .filter((i) => i.seat !== account.seat)
      .sort((a, b) => a.points - b.points || leadDist(a.seat) - leadDist(b.seat))[0].seat
    // 角色口径：赢家=其余三家中最优者，宣告者改标「输家」，其余两家无庄位概念（role 置空）
    for (const r of ranks) {
      if (r.seat === winSeat) r.role = '赢家'
      else if (r.seat === account.seat) r.role = '输家'
      else r.role = ''
    }
    for (const r of ranks) {
      if (r.seat === account.seat) scores[r.seat] = -12
      else if (r.seat === winSeat) scores[r.seat] = 12
      else scores[r.seat] = 0
    }
    return {
      winner: winSeat,
      ranks,
      scores,
      account: { ...account, success },
    }
  }

  const rankScores = [6, -3, -2, -1]
  for (const r of ranks) scores[r.seat] = rankScores[roles.indexOf(r.role)]

  return {
    winner: ordered[0].seat,
    ranks,
    scores,
    account: null,
  }
}

/**
 * 是否满足「申请重新发牌」牌型（发牌后、首出前）：
 * 1. 两红八（4|4）且无红十（4|6）；
 * 2. 六张全是横牌（两端点数相同）。
 */
export function canRedeal(hand) {
  if (!Array.isArray(hand) || hand.length !== 6) return false
  const redEights = hand.filter((t) => t.a === 4 && t.b === 4)
  const hasRedTen = hand.some((t) => t.a === 4 && t.b === 6)
  if (redEights.length === 2 && !hasRedTen) return true
  return hand.every((t) => t.a === t.b)
}

// ---------- 算账（封账）宣告 ----------

/** 账种定义：冻结端组合 → 账种名。key = 排序后的两端点数字串。
 *  二三账有两种冻结形态：2,3（4 张触发牌中 3 张已上链、接活端暴露另一端）与 1,2（带 1 竖牌全上链后接 3 端暴露 1）。 */
const ACCOUNT_TYPES = {
  '4,4': '红账',
  '1,1': '幺账',
  '5,5': '五账',
  '2,3': '二三账',
  '1,2': '二三账',
}

/** 账种 → settings 布尔字段 */
const ACCOUNT_KEY = { 红账: 'red', 幺账: 'yao', 二三账: 'erSan', 五账: 'wu' }

/**
 * 端点 P 是否被冻结：所有含 P 的竖牌（非对子）都已在链上。
 * afterChain：模拟接牌后的链上全部牌（含刚出的这张）；P 为冻结端点。
 */
function endFrozen(p, afterChain) {
  return !TILES.some(
    (t) => t.type === '竖牌' && (t.a === p || t.b === p) &&
      !afterChain.some((c) => c.id === t.id)
  )
}

/**
 * 判定「这张牌接某端」是否构成算账宣告项。
 * @param tile 手里要出的牌
 * @param openEnds 当前链两端 { top, bottom }；null（头牌首出）恒无宣告
 * @param chainTiles 链上全部已出的牌（tableHistory 的 tiles 展开）
 * @param hand 我当前手牌（含 tile；用于二三账「还有其他可接牌」判定）
 * @param settings 算账设置
 * @returns {{ type: string, side: 'bottom'|'top' }[]} 可宣告项
 */
export function declarationFor(tile, openEnds, chainTiles, hand, settings) {
  if (!settings || !settings.enabled || !openEnds) return []
  // 算账只能由竖牌触发：横牌（如红八 4|4）即使拼出冻结端组合也不算账
  if (tile.type !== '竖牌') return []
  const sides = placeSides(tile, openEnds)
  if (sides.length === 0) return []
  const afterChain = [...chainTiles, tile]
  const opts = []
  for (const { side, mirrored } of sides) {
    // 复用 play 的新端计算
    const newEnds = nextOpenEnds(openEnds, tile, side, mirrored)
    const key = [newEnds.top, newEnds.bottom].sort((a, b) => a - b).join(',')
    const type = ACCOUNT_TYPES[key]
    if (!type) continue
    if (!endFrozen(newEnds.top, afterChain) || !endFrozen(newEnds.bottom, afterChain)) continue
    if (!settings[ACCOUNT_KEY[type]]) continue
    if (type === '二三账') {
      // 特殊条件：手里除这张牌外还有其他可接牌（故意不出别的偏选这张）
      const others = hand.filter((t) => t.id !== tile.id)
      if (!playableTilesEnds(others, openEnds).length) continue
    }
    opts.push({ type, side })
  }
  return opts
}
