// src/composables/useGame.js
import { reactive, computed } from 'vue'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds, redeal as coreRedeal } from '../core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../core/ai.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds, canRedeal } from '../core/rules.js'
import { normalizeSettings } from '../core/settings.js'
import { loadHistory, appendHistory } from './history.js'

/**
 * 单机局管理。真人固定 seat 0。
 */
export function useGame() {
  // 连续局：读取上一局赢家作为本局掷骰者（首局无记录默认 0）
  const lastWinner = uni.getStorageSync('dingniuzi_last_winner')
  const roller = typeof lastWinner === 'number' ? lastWinner : 0
  const settings = normalizeSettings(uni.getStorageSync('dingniuzi_settings'))
  const g = createGame(Math.random, roller, settings)
  const fx = reactive({
    dice: null,
    diceRolling: false,
    lastMove: null, // { seat, tileIds }
    settleShow: false,
    revealKept: false, // 局末亮牌阶段：翻开所有人扣的牌
    accountSplash: null, // { seat, type } 宣告特效
  })

  const view = reactive(viewOf(g, 0))

  /** 掷骰权座位：0=我；1/2/3=AI（自动触发） */
  const diceRollerSeat = view.rollerSeat ?? 0

  function syncView() {
    const v = viewOf(g, 0)
    // myKept/tableHistory 由 core 原地 push（引用不变），浅拷贝新数组保证 Vue 响应式感知
    v.myKept = [...v.myKept]
    v.tableHistory = [...v.tableHistory]
    Object.assign(view, v)
    if (g.account && (!fx.accountSplash || fx.accountSplash.seat !== g.account.seat || fx.accountSplash.type !== g.account.type)) {
      fx.accountSplash = { seat: g.account.seat, type: g.account.type }
    }
  }

  /** 我是否可申请重新发牌 */
  const canRedealNow = computed(
    () => view.state === 'PLAYING' &&
      view.tableHistory.length === 0 &&
      !view.redealUsed.includes(0) &&
      canRedeal(view.myHand)
  )

  /** UI 视角座位名：0=我 1=下家 2=对家 3=上家 */
  const seatLabels = ['我', '下家', '对家', '上家']
  const labelOf = (seat) => seatLabels[seat]

  /** 我是否可行动 */
  const myTurn = computed(
    () => view.state === 'PLAYING' && view.currentSeat === 0
  )

  /** 我必须扣牌：委托 core 规则（双端） */
  const mustDiscard = computed(
    () => myTurn.value && view.openEnds !== null && coreMustDiscardEnds(view.myHand, view.openEnds)
  )

  /**
   * 当前可跟的牌 id 集合（供高亮）。
   * lead 分支读取了非响应式的核心状态 g，正确性依赖每次状态变更后 syncView() 刷新触发重算。
   */
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.openEnds === null) {
      return leadLegalTileIds(g, 0)
    }
    return corePlayableTilesEnds(view.myHand, view.openEnds).map((t) => t.id)
  })

  /** 开局掷骰（真人掷骰时点击按钮触发）：摇 1.2s → 停 2.4s → 揭头牌进入出牌阶段 */
  function roll(dice) {
    if (view.state !== 'ROLLING') return
    if (view.rollerSeat !== 0) return
    fx.diceRolling = true
    const finalDice = dice ?? 1 + Math.floor(Math.random() * 6)
    setTimeout(() => {
      if (g.state !== 'ROLLING') return // 双击守卫
      setTimeout(() => {
        const res = rollDice(g, finalDice)
        if (res.ok) {
          syncView()
          scheduleAiIfNeeded()
          maybeAiRedeal() // 发牌完成后检查 AI 重发
        }
      }, 2400)
    }, 1200)
  }

  /** AI 掷骰：掷骰权在机器人时开局自动掷，动画节奏与 roll 一致 */
  function maybeAutoRoll() {
    if (view.state !== 'ROLLING' || view.rollerSeat === 0) return
    setTimeout(() => {
      if (g.state !== 'ROLLING') return
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
            maybeAiRedeal()
          }
        }, 2400)
      }, 1200)
    }, 1000)
  }
  maybeAutoRoll()

  /** 发牌完成后检查 AI 手牌：某 AI 满足重发条件且我不满足时，该 AI 延时自动申请（我优先） */
  function maybeAiRedeal() {
    if (view.state !== 'PLAYING' || view.tableHistory.length > 0) return
    if (canRedealNow.value) return
    const aiSeat = [1, 2, 3].find((s) => canRedeal(g.players[s].hand) && !g.redealUsed.has(s))
    if (aiSeat === undefined) return
    setTimeout(() => {
      if (g.state !== 'PLAYING' || g.tableHistory.length > 0 || g.redealUsed.has(aiSeat)) return
      if (canRedeal(g.players[aiSeat].hand)) {
        const res = coreRedeal(g, aiSeat)
        if (res.ok) {
          uni.showToast({ title: `${labelOf(aiSeat)}申请重新发牌`, icon: 'none' })
          syncView()
          maybeAutoRoll()
        }
      }
    }, 1200)
  }

  /** 我出牌。side: 跟牌放置端；declare: 同时宣告算账 */
  function myPlay(tileId, side = 'bottom', declare = false) {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = play(g, 0, [tileId], side, declare)
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

  /** 我申请重新发牌：委托 core（校验+重置），成功后回到掷骰阶段 */
  function redeal() {
    if (view.state !== 'PLAYING') return { ok: false, reason: '当前不可申请' }
    const res = coreRedeal(g, 0)
    if (res.ok) syncView()
    return res
  }

  /** AI 回合调度：当前座位是 AI 时延时出牌 */
  function scheduleAiIfNeeded() {
    if (view.state !== 'PLAYING') {
      if (view.state === 'SETTLE') {
        // 持久化战绩与历史明细（每局仅 SETTLE 翻转后到达一次；迟到 AI 定时器已提前返回）
        const prev = uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 }
        const my = view.result.scores[0] || 0
        uni.setStorageSync('dingniuzi_stats', {
          rounds: prev.rounds + 1,
          totalScore: prev.totalScore + my,
        })
        const prevHistory = loadHistory()
        // 累计链以最近一条单机局为锚，联网局插在其后但不参与单机累计
        let running = prevHistory.length > 0 ? prevHistory[0].totalsAfter : { 0: 0, 1: 0, 2: 0, 3: 0 }
        const anchor = [...prevHistory].find((h) => h.mode === 'solo')
        running = anchor ? anchor.totalsAfter : running
        const totalsAfter = {}
        for (const s of [0, 1, 2, 3]) totalsAfter[s] = (running[s] || 0) + (view.result.scores[s] || 0)
        appendHistory({
          time: Date.now(),
          mode: 'solo',
          scores: view.result.scores,
          roles: Object.fromEntries(view.result.ranks.map((r) => [r.seat, r.role])),
          points: Object.fromEntries(view.result.ranks.map((r) => [r.seat, r.points])),
          account: view.result.account || null,
          totalsAfter,
        })
        // 局末节奏由 game.vue 的 paceSettle 统一编排（两模式一致）
      }
      return
    }
    if (view.currentSeat === 0) return
    const seat = view.currentSeat
    const isLead = g.openEnds === null
    // 延时放宽：语音播报约 1s 且通道独占，间隔太短会顶掉上一家的播报
    const delay = isLead ? 1800 + Math.floor(Math.random() * 700) : 1200 + Math.floor(Math.random() * 700)
    setTimeout(() => {
      if (g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const hand = g.players[seat].hand
      if (g.openEnds === null) {
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
    roll, myPlay, myDiscard, redeal, canRedealNow,
  }
}
