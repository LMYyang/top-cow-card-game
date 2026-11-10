// src/composables/useGame.js
import { reactive, computed } from 'vue'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds } from '../core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../core/ai.js'

/**
 * 单机局管理。真人固定 seat 0。
 * fx: { dice: number|null, diceRolling: boolean, lastMove: {seat, tileIds}|null, settleShow: boolean }
 */
export function useGame() {
  // 连续局：读取上一局赢家作为本局掷骰者（redirectTo 重开时生效；首局无记录默认 0）
  const lastWinner = uni.getStorageSync('dingniuzi_last_winner')
  const roller = typeof lastWinner === 'number' ? lastWinner : 0
  const g = createGame(Math.random, roller)
  const fx = reactive({
    dice: null,
    diceRolling: false,
    lastMove: null, // { seat, tileIds }
    settleShow: false,
  })

  const view = reactive(viewOf(g, 0))

  function syncView() {
    Object.assign(view, viewOf(g, 0))
  }

  /** UI 视角座位名：0=我 1=下家 2=对家 3=上家 */
  const seatLabels = ['我', '下家', '对家', '上家']
  const labelOf = (seat) => seatLabels[seat]

  /** 我是否可行动 */
  const myTurn = computed(
    () => view.state === 'PLAYING' && view.currentSeat === 0
  )

  /** 我必须扣牌（无牌可接且桌面有牌） */
  const mustDiscard = computed(
    () => myTurn.value && view.tableTile !== null &&
      view.myHand.every((t) => !(t.a === view.tableTile.a || t.a === view.tableTile.b || t.b === view.tableTile.a || t.b === view.tableTile.b))
  )

  /** 当前可跟的牌 id 集合（供高亮） */
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.tableTile === null) {
      return leadLegalTilesFor(0) // core 导出的合法首出（不拉三家）
    }
    return view.myHand
      .filter((t) => t.a === view.tableTile.a || t.a === view.tableTile.b || t.b === view.tableTile.a || t.b === view.tableTile.b)
      .map((t) => t.id)
  })

  /** 开局掷骰（点击"掷骰子"按钮触发） */
  function roll(dice) {
    if (view.state !== 'ROLLING') return
    fx.diceRolling = true
    const finalDice = dice ?? 1 + Math.floor(Math.random() * 6)
    setTimeout(() => {
      fx.dice = finalDice
      fx.diceRolling = false
      const res = rollDice(g, finalDice)
      if (res.ok) {
        syncView()
        scheduleAiIfNeeded()
      }
    }, 1200)
  }

  /** 我出牌 */
  function myPlay(tileId) {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = play(g, 0, [tileId])
    if (res.ok) {
      fx.lastMove = { seat: 0, tileIds: [tileId] }
      syncView()
      scheduleAiIfNeeded()
    }
    return res
  }

  /** 我扣牌 */
  function myDiscard(tileId) {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = discard(g, 0, tileId)
    if (res.ok) {
      fx.lastMove = { seat: 0, tileIds: [tileId] }
      syncView()
      scheduleAiIfNeeded()
    }
    return res
  }

  /** AI 回合调度：当前座位是 AI 时延时出牌 */
  function scheduleAiIfNeeded() {
    if (view.state !== 'PLAYING') {
      if (view.state === 'SETTLE') fx.settleShow = true
      return
    }
    if (view.currentSeat === 0) return
    const seat = view.currentSeat
    const delay = 600 + Math.floor(Math.random() * 400)
    setTimeout(() => {
      if (g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const hand = g.players[seat].hand
      const table = g.tableTile
      if (table === null) {
        // AI 头牌首出：先取"不拉三家"的合法牌，再交 AI 策略从中选点数最高者
        const legalTiles = leadLegalTileIds(g, seat).map((id) => g.players[seat].hand.find((t) => t.id === id))
        const pool = legalTiles.length > 0 ? legalTiles : hand // 兜底：合法牌为空（理论上不可能）时退回手牌，避免 [].reduce 抛错
        const choice = aiChoosePlay(pool, null, { isLeadFirst: true, otherHands: g.players.filter(p => p.seat !== seat).map(p => p.hand) })
        if (choice) play(g, seat, choice.tileIds)
      } else {
        const choice = aiChoosePlay(hand, table, { isLeadFirst: false })
        if (choice) {
          play(g, seat, choice.tileIds)
        } else {
          const d = aiChooseDiscard(hand, table)
          if (d) discard(g, seat, d.tileId)
        }
      }
      fx.lastMove = { seat, tileIds: [] } // 牌张明细由 UI 依据 view.tableHistory 渲染
      syncView()
      scheduleAiIfNeeded()
    }, delay)
  }

  /** 头牌首出时的合法牌（不拉三家）：委托 core 的 leadLegalTileIds */
  function leadLegalTilesFor(seat) {
    return leadLegalTileIds(g, seat)
  }

  return {
    view, fx, myTurn, mustDiscard, playableIds, labelOf,
    roll, myPlay, myDiscard,
  }
}
