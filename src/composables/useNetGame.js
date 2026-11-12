// src/composables/useNetGame.js
import { reactive, computed, ref, watch, getCurrentInstance, onUnmounted } from 'vue'
import { sharedNet } from '../utils/net.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds } from '../core/rules.js'

/**
 * 联网局管理：接口与 useGame 一致，数据源为服务器推送。
 * view/fx 整体替换自 game.state 推送；动作为网络请求，结果以服务器推送为准。
 * 额外导出：connection（连接状态 ref）、restart()（发 settleContinue）、roomId、mySeat。
 * 挂载/订阅后拉一次快照（reconnect 携带存储 token）：
 * 开局时 room.vue 先于本页收到 game.state 推送即跳走，那条开局推送本页永远收不到，
 * 必须主动拉快照才能进入牌桌。
 */
export function useNetGame(net = sharedNet()) {
  const view = reactive({
    state: '', leaderSeat: null, rollerSeat: null, currentSeat: null,
    tableTile: null, openEnds: null, myHand: [], myKept: [],
    opponents: [], result: null, tableHistory: [],
  })
  const fx = reactive({ dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null })
  const connection = net.status
  let stopWatch = null
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
  // sharedNet() 是跨页面存活的模块单例：组件卸载时须退订，否则 game.vue 每次挂载都累积两个处理器
  // （仅组件上下文注册生命周期钩子；单测在组件外直接调用时不注册，避免警告）
  if (getCurrentInstance()) onUnmounted(() => { offState(); offOver(); stopWatch?.() })

  /** 拉一次当前快照（fire-and-forget）：游戏未开局时无 gameState 推送，静默忽略错误 */
  async function fetchSnapshot() {
    try {
      if (net.status.value !== 'open') await net.connect()
      const token = uni.getStorageSync('dingniuzi_player_token')
      const res = await net.request('reconnect', { token })
      if (res.type === 'error') return // 房间已解散等：快照缺失，不弹错（页面留着等下一次推送）
    } catch { /* 未连接/超时：状态条已提示，快照缺失仅表现为空桌面 */ }
  }
  fetchSnapshot()
  // 断线自动重连后的新 socket 未认证（conn.token=null，服务器推送按成员路由会漏发本端），
  // 且服务器把掉线成员转 AI 托管——重连成功即重跑 reconnect 握手，恢复认证并拿回最新快照。
  // 也兜底「首连失败后手动重试」场景（net.js 首连失败不自动重连）。
  // 首次 'connecting'→'open' 也会触发一次重复拉取：幂等（服务器快照重发覆盖同一状态），可接受。
  if (getCurrentInstance()) {
    stopWatch = watch(connection, (s) => { if (s === 'open') fetchSnapshot() })
    onUnmounted(() => stopWatch?.())
  }

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

  /** 退房：结算页回主菜单前调用；对局中服务器视为断线（宽限+托管），WAITING 中直接移除 */
  async function leave() {
    try { await net.request('room.leave', {}) } catch { /* 连接已断：服务器宽限/清理兜底 */ }
  }

  /** 掷骰权座位：以服务器 view.rollerSeat 为准；未开局时回退自己座位（单机语义为 0） */
  const diceRollerSeat = computed(() => view.rollerSeat ?? mySeat.value)

  return { view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat, roll, myPlay, myDiscard, restart, leave, connection, roomId, mySeat, fetchSnapshot }
}
