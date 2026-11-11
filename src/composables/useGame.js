// src/composables/useGame.js
import { reactive, computed } from 'vue'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds } from '../core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../core/ai.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds } from '../core/rules.js'

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
    revealKept: false, // 局末亮牌阶段：翻开所有人扣的牌（结算弹窗前展示）
  })

  const view = reactive(viewOf(g, 0))

  /** 掷骰权座位：0=我（真人点击）；1/2/3=AI（自动触发掷骰动画与结果） */
  const diceRollerSeat = view.rollerSeat ?? 0

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

  /** 我必须扣牌（链已开出且我无任何可接端的牌）：委托 core 规则（双端） */
  const mustDiscard = computed(
    () => myTurn.value && view.openEnds !== null && coreMustDiscardEnds(view.myHand, view.openEnds)
  )

  /**
   * 当前可跟的牌 id 集合（供高亮）。
   * 依赖纪律：lead 分支读取了非响应式的核心状态 g（leadLegalTileIds(g, 0)），
   * 正确性完全依赖每次状态变更后都调用 syncView() 刷新响应式 view 触发重算——
   * 请勿移除任何 syncView() 调用点。
   */
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.openEnds === null) {
      return leadLegalTileIds(g, 0) // core 导出的合法首出（不拉三家）
    }
    return corePlayableTilesEnds(view.myHand, view.openEnds).map((t) => t.id)
  })

  /** 开局掷骰（真人掷骰时点击按钮触发）。摇 1.2s → 停 2.4s 看点数并揭头牌 → 自动进入出牌阶段 */
  function roll(dice) {
    if (view.state !== 'ROLLING') return
    if (diceRollerSeat !== 0) return // AI 掷骰局：屏蔽真人点击（UI 已隐藏按钮，双保险）
    fx.diceRolling = true
    const finalDice = dice ?? 1 + Math.floor(Math.random() * 6)
    // 摇骰 1.2s → 落定 → 停 2.4s 看点数并揭头牌 → 进入出牌阶段（AI 掷骰走 aiRollSame 流程，节奏一致）
    setTimeout(() => {
      if (g.state !== 'ROLLING') return // 双击守卫：第二个定时器触发时首掷已使 state 离开 ROLLING
      fx.dice = finalDice
      fx.diceRolling = false // 触发落定回弹动画，停在最终点数供玩家查看
      setTimeout(() => {
        const res = rollDice(g, finalDice)
        if (res.ok) {
          syncView()
          scheduleAiIfNeeded()
        }
      }, 2400)
    }, 1200)
  }

  // AI 掷骰：掷骰权在机器人时，开局停 1s 自动掷（复用 roll 的动画节奏：摇 1.2s → 停 2.4s → 进阶段）
  if (diceRollerSeat !== 0) {
    setTimeout(() => {
      if (g.state !== 'ROLLING') return // 守卫：页面已重开等异常情况
      fx.diceRolling = true
      const finalDice = 1 + Math.floor(Math.random() * 6)
      setTimeout(() => {
        if (g.state !== 'ROLLING') return
        fx.dice = finalDice
        fx.diceRolling = false
        setTimeout(() => {
          const res = rollDice(g, finalDice)
          if (res.ok) {
            syncView()
            scheduleAiIfNeeded()
          }
        }, 2400)
      }, 1200)
    }, 1000)
  }

  /** 我出牌。side: 'bottom'|'top' 跟牌放置端（仅链已开出时有意义），缺省 bottom */
  function myPlay(tileId, side = 'bottom') {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = play(g, 0, [tileId], side)
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
      if (view.state === 'SETTLE') {
        // 持久化战绩：本分支每局只会到达一次（唯一一次 SETTLE 翻转后的那次调用；
        // 迟到的 AI 定时器在 g.state !== 'PLAYING' 处提前返回，不会递归到此处）
        const prev = uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 }
        const my = view.result.scores[0] || 0
        uni.setStorageSync('dingniuzi_stats', {
          rounds: prev.rounds + 1,
          totalScore: prev.totalScore + my,
        })
        // 历史记录：追加本局明细（时间、四人角色与得分、累计积分），最新在前，最多留 50 局
        const prevHistory = uni.getStorageSync('dingniuzi_history') || []
        let running = prevHistory.length > 0 ? prevHistory[0].totalsAfter : { 0: 0, 1: 0, 2: 0, 3: 0 }
        const totalsAfter = {}
        for (const s of [0, 1, 2, 3]) totalsAfter[s] = (running[s] || 0) + (view.result.scores[s] || 0)
        const entry = {
          time: Date.now(),
          scores: view.result.scores, // { seat: number }
          roles: Object.fromEntries(view.result.ranks.map((r) => [r.seat, r.role])),
          points: Object.fromEntries(view.result.ranks.map((r) => [r.seat, r.points])), // 扣点
          totalsAfter,
        }
        uni.setStorageSync('dingniuzi_history', [entry, ...prevHistory].slice(0, 50))
        // 局末节奏：先停 800ms 让最后一手落定 → 亮出所有人扣的牌 → 等玩家点击屏幕任意位置 → 再弹结算
        setTimeout(() => {
          fx.revealKept = true
        }, 800)
      }
      return
    }
    if (view.currentSeat === 0) return
    const seat = view.currentSeat
    const delay = 600 + Math.floor(Math.random() * 400)
    setTimeout(() => {
      if (g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const hand = g.players[seat].hand
      if (g.openEnds === null) {
        // AI 头牌首出：aiChoosePlay 内部已处理"不拉三家"的合法牌过滤及兜底
        const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: g.players.filter(p => p.seat !== seat).map(p => p.hand) })
        if (choice) play(g, seat, choice.tileIds, choice.side)
      } else {
        const choice = aiChoosePlay(hand, g.openEnds, { isLeadFirst: false })
        if (choice) {
          play(g, seat, choice.tileIds, choice.side)
        } else {
          const d = aiChooseDiscard(hand, g.openEnds)
          if (d) discard(g, seat, d.tileId)
        }
      }
      fx.lastMove = { seat, tileIds: [] } // 牌张明细由 UI 依据 view.tableHistory 渲染
      syncView()
      scheduleAiIfNeeded()
    }, delay)
  }

  return {
    view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat,
    roll, myPlay, myDiscard,
  }
}
