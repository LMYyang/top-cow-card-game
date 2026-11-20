// src/composables/useNetGame.js
import { reactive, computed, ref, watch, getCurrentInstance, onUnmounted } from 'vue'
import { sharedNet } from '../utils/net.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds, canRedeal } from '../core/rules.js'
import { appendHistory } from './history.js'

/**
 * 联网局管理：接口与 useGame 一致，数据源为服务器推送。
 * 挂载后主动拉一次快照（reconnect 携带存储 token），否则开局推送本页收不到。
 */
export function useNetGame(net = sharedNet()) {
  const view = reactive({
    state: '', leaderSeat: null, rollerSeat: null, currentSeat: null,
    tableTile: null, openEnds: null, myHand: [], myKept: [],
    opponents: [], result: null, tableHistory: [], redealUsed: [],
    account: null, settings: null,
  })
  const fx = reactive({ dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null, accountSplash: null })
  const connection = net.status
  let stopWatch = null
  const roomId = ref(null)
  const mySeat = ref(0)
  // 座位→昵称表：由服务器 game.state 下发
  const names = reactive({})

  const offState = net.on('game.state', ({ view: v, fx: f, roomId: rid, yourSeat, names: n }) => {
    Object.keys(v).forEach((k) => { view[k] = v[k] })
    Object.assign(fx, { dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null }, f)
    if (rid !== undefined) roomId.value = rid
    if (yourSeat !== undefined) mySeat.value = yourSeat
    if (n) Object.assign(names, n)
    // 宣告特效：account 首次出现（或值变化）时点亮；account 清空（新局）时重置
    if (!v.account) {
      fx.accountSplash = null
    } else if (!fx.accountSplash || fx.accountSplash.seat !== v.account.seat || fx.accountSplash.type !== v.account.type) {
      fx.accountSplash = { seat: v.account.seat, type: v.account.type }
    }
  })
  const offOver = net.on('game.over', ({ result, view: v, fx: f }) => {
    // 终局推送的 view 必须应用：否则最后一张牌不上链、界面状态矛盾
    if (v) Object.keys(v).forEach((k) => { view[k] = v[k] })
    view.result = result
    Object.assign(fx, { dice: null, diceRolling: false }, f)
    saveNetHistory(result)
  })
  const offRedealt = net.on('game.redealt', ({ seat }) => {
    uni.showToast({ title: `${labelOf(seat)}申请重新发牌`, icon: 'none' })
  })
  /** 联网局落史：随 game.over 只记一次。统计不写 dingniuzi_stats（那是单机口径），
   *  主页联网积分/已对局从历史条目实时汇总；roomId 供「场次汇总」按房归组。 */
  function saveNetHistory(result) {
    const entry = {
      time: Date.now(),
      mode: 'net',
      roomId: roomId.value ?? null,
      scores: result.scores,
      roles: Object.fromEntries((result.ranks || []).map((r) => [r.seat, r.role])),
      points: Object.fromEntries((result.ranks || []).map((r) => [r.seat, r.points])),
      account: result.account || null,
      names: { ...names },
    }
    appendHistory(entry)
  }
  // sharedNet() 是跨页面存活的模块单例：组件卸载时须退订，否则每次挂载都累积处理器
  if (getCurrentInstance()) onUnmounted(() => { offState(); offOver(); offRedealt(); stopWatch?.() })

  /** 拉一次当前快照（fire-and-forget）：游戏未开局时静默忽略错误 */
  async function fetchSnapshot() {
    try {
      if (net.status.value !== 'open') await net.connect()
      const token = uni.getStorageSync('dingniuzi_player_token')
      const res = await net.request('reconnect', { token })
      if (res.type === 'error') return
    } catch { /* 快照缺失仅表现为空桌面 */ }
  }
  fetchSnapshot()
  // 断线自动重连后的新 socket 未认证：重连成功即重跑 reconnect 握手（幂等，重复拉取可接受）
  if (getCurrentInstance()) {
    stopWatch = watch(connection, (s) => { if (s === 'open') fetchSnapshot() })
    onUnmounted(() => stopWatch?.())
  }

  /** UI 视角座位名：自己=「我」，其余显示成员昵称（names 为服务器下发的绝对座位表） */
  const labelOf = (seat) => (seat === mySeat.value ? '我' : names[seat] || `座位${seat}`)

  /** 房间已被服务器销毁：toast 后延时跳回联网大厅，并清理本地 token */
  function roomGoneRedirect(code) {
    if (code !== 'ROOM_GONE') return
    uni.removeStorageSync('dingniuzi_player_token')
    setTimeout(() => uni.reLaunch({ url: '/pages/lobby/lobby' }), 1500)
  }

  const myTurn = computed(() => view.state === 'PLAYING' && view.currentSeat === mySeat.value)
  const mustDiscard = computed(
    () => myTurn.value && view.openEnds !== null && coreMustDiscardEnds(view.myHand, view.openEnds)
  )
  // 客户端只读计算高亮；头牌首出「不拉三家」由服务端裁决
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.openEnds === null) return view.myHand.map((t) => t.id)
    return corePlayableTilesEnds(view.myHand, view.openEnds).map((t) => t.id)
  })

  /** 统一请求出口：type==='error' 回执视为失败；code 透传供页面层区分处理 */
  async function call(type, payload) {
    try {
      const res = await net.request(type, payload)
      if (res && res.type === 'error') {
        return { ok: false, reason: res.payload?.message || '操作失败', code: res.payload?.code }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }

  /** 真人掷骰：仅发请求，动画节奏由服务端 fx 驱动 */
  async function roll() {
    const res = await call('game.roll', {})
    if (!res.ok) { uni.showToast({ title: res.reason, icon: 'none' }); roomGoneRedirect(res.code) }
  }

  async function myPlay(tileId, side = 'bottom', declare = false) {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    return call('game.play', { tileIds: [tileId], side, declare: !!declare })
  }

  async function myDiscard(tileId) {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    return call('game.discard', { tileId })
  }

  async function restart() {
    const res = await call('game.settleContinue', {})
    if (!res.ok) { uni.showToast({ title: res.reason, icon: 'none' }); roomGoneRedirect(res.code) }
    return res.ok
  }

  /** 申请重新发牌（联网）：服务器校验后广播 */
  async function redeal() {
    return call('game.redeal', {})
  }

  /** 修改房间算账设置（房主、WAITING 阶段） */
  async function setRoomSettings(settings) {
    const res = await call('room.setSettings', { settings })
    if (!res.ok) { uni.showToast({ title: res.reason, icon: 'none' }); roomGoneRedirect(res.code) }
    return res
  }

  /** 我是否可申请重新发牌：PLAYING、无人出牌、满足牌型、本局未申请过 */
  const canRedealNow = computed(
    () => view.state === 'PLAYING' &&
      view.tableHistory.length === 0 &&
      !view.redealUsed.includes(mySeat.value) &&
      canRedeal(view.myHand)
  )

  /** 退房：结算页回主菜单前调用 */
  async function leave() {
    try { await net.request('room.leave', {}) } catch { /* 服务器宽限/清理兜底 */ }
  }

  /** 掷骰权座位：未开局时回退自己座位 */
  const diceRollerSeat = computed(() => view.rollerSeat ?? mySeat.value)

  return { view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat, roll, myPlay, myDiscard, restart, redeal, setRoomSettings, canRedealNow, leave, connection, roomId, mySeat, fetchSnapshot }
}
