// src/composables/useNetGame.js
import { reactive, computed, ref } from 'vue'
import { sharedNet } from '../utils/net.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds } from '../core/rules.js'

/**
 * 联网局管理：接口与 useGame 一致，数据源为服务器推送。
 * view/fx 整体替换自 game.state 推送；动作为网络请求，结果以服务器推送为准。
 * 额外导出：connection（连接状态 ref）、restart()（发 settleContinue）、roomId、mySeat。
 */
export function useNetGame(net = sharedNet()) {
  const view = reactive({
    state: '', leaderSeat: null, rollerSeat: null, currentSeat: null,
    tableTile: null, openEnds: null, myHand: [], myKept: [],
    opponents: [], result: null, tableHistory: [],
  })
  const fx = reactive({ dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null })
  const connection = net.status
  const roomId = ref(null)
  const mySeat = ref(0)
  const names = reactive({ 0: '我', 1: '下家', 2: '对家', 3: '上家' })

  const offState = net.on('game.state', ({ view: v, fx: f, roomId: rid, yourSeat, names: n }) => {
    Object.keys(v).forEach((k) => { view[k] = v[k] })
    Object.assign(fx, { dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null }, f)
    if (rid !== undefined) roomId.value = rid
    if (yourSeat !== undefined) mySeat.value = yourSeat
    if (n) Object.assign(names, n)
  })
  const offOver = net.on('game.over', ({ result, fx: f }) => {
    view.result = result
    Object.assign(fx, { dice: null, diceRolling: false }, f)
  })

  /** UI 视角座位名：自己=「我」，其余显示成员昵称 */
  const labelOf = (seat) => (seat === mySeat.value ? '我' : names[seat] || `座位${seat}`)

  const myTurn = computed(() => view.state === 'PLAYING' && view.currentSeat === mySeat.value)
  const mustDiscard = computed(
    () => myTurn.value && view.openEnds !== null && coreMustDiscardEnds(view.myHand, view.openEnds)
  )
  // 客户端只读计算高亮（无作弊面）；头牌首出「不拉三家」由服务端裁决，客户端不预过滤
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.openEnds === null) return view.myHand.map((t) => t.id)
    return corePlayableTilesEnds(view.myHand, view.openEnds).map((t) => t.id)
  })

  /** 统一请求出口：type==='error' 回执视为失败（reason 取服务器 message）；网络异常（超时/断线）同样转为失败 */
  async function call(type, payload) {
    try {
      const res = await net.request(type, payload)
      if (res && res.type === 'error') return { ok: false, reason: res.payload?.message || '操作失败' }
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }

  /** 真人掷骰（动画节奏由服务端 fx 驱动，这里仅发请求；失败 toast 服务器原因） */
  async function roll() {
    const res = await call('game.roll', {})
    if (!res.ok) uni.showToast({ title: res.reason, icon: 'none' })
  }

  async function myPlay(tileId, side = 'bottom') {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    return call('game.play', { tileIds: [tileId], side })
  }

  async function myDiscard(tileId) {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    return call('game.discard', { tileId })
  }

  async function restart() {
    const res = await call('game.settleContinue', {})
    if (!res.ok) uni.showToast({ title: res.reason, icon: 'none' })
  }

  /** 掷骰权座位：以服务器 view.rollerSeat 为准；未开局时回退自己座位（单机语义为 0） */
  const diceRollerSeat = computed(() => view.rollerSeat ?? mySeat.value)

  return { view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat, roll, myPlay, myDiscard, restart, connection, roomId, mySeat }
}
