// src/composables/useGame.js
import { reactive, computed } from 'vue'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds } from '../core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../core/ai.js'
import { mustDiscard as coreMustDiscard, playableTiles as corePlayableTiles } from '../core/rules.js'

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
    const v = viewOf(g, 0)
    // myKept/tableHistory 由 core 原地 push（引用不变），浅拷贝新数组保证 Vue 响应式感知更新
    v.myKept = [...v.myKept]
    v.tableHistory = [...v.tableHistory]
    Object.assign(view, v)
  }

  /** UI 视角座位名：0=我 1=下家 2=对家 3=上家 */
  const seatLabels = ['我', '下家', '对家', '上家']
  const labelOf = (seat) => seatLabels[seat]

  /** 我是否可行动 */
  const myTurn = computed(
    () => view.state === 'PLAYING' && view.currentSeat === 0
  )

  /** 我必须扣牌（无牌可接且桌面有牌）：委托 core 规则 */
  const mustDiscard = computed(
    () => myTurn.value && view.tableTile !== null && coreMustDiscard(view.myHand, view.tableTile)
  )

  /**
   * 当前可跟的牌 id 集合（供高亮）。
   * 依赖纪律：lead 分支读取了非响应式的核心状态 g（leadLegalTileIds(g, 0)），
   * 正确性完全依赖每次状态变更后都调用 syncView() 刷新响应式 view 触发重算——
   * 请勿移除任何 syncView() 调用点。
   */
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.tableTile === null) {
      return leadLegalTileIds(g, 0) // core 导出的合法首出（不拉三家）
    }
    return corePlayableTiles(view.myHand, view.tableTile).map((t) => t.id)
  })

  /** 开局掷骰（点击"掷骰子"按钮触发） */
  function roll(dice) {
    if (view.state !== 'ROLLING') return
    fx.diceRolling = true
    const finalDice = dice ?? 1 + Math.floor(Math.random() * 6)
    setTimeout(() => {
      if (g.state !== 'ROLLING') return // 双击守卫：第二个定时器触发时首掷已使 state 离开 ROLLING
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
        // AI 头牌首出：aiChoosePlay 内部已处理"不拉三家"的合法牌过滤及兜底
        const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: g.players.filter(p => p.seat !== seat).map(p => p.hand) })
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

  return {
    view, fx, myTurn, mustDiscard, playableIds, labelOf,
    roll, myPlay, myDiscard,
  }
}
