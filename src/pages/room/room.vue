<!-- src/pages/room/room.vue -->
<template>
  <view class="room">
    <view class="head">
      <text class="room-id">房间号 {{ roomId }}</text>
      <text class="hint">全员准备后开局，空位自动补 AI</text>
    </view>
    <view class="seats">
      <view
        v-for="seat in [0, 1, 2, 3]"
        :key="seat"
        class="seat"
        :class="{ me: seat === mySeat, taken: !!memberOf(seat), host: memberOf(seat)?.isHost }"
        @click="tapSeat(seat)"
      >
        <text class="seat-no">{{ seat + 1 }}号位{{ seat === mySeat ? '（我）' : '' }}</text>
        <!-- 右上角同一位置互斥显示：房主座位显示「✦ 房主」，其余真人座位在房主视角下显示「移出」 -->
        <view v-if="memberOf(seat)?.isHost" class="host-badge">
          <text class="host-badge-star">✦</text>
          <text class="host-badge-text">房主</text>
        </view>
        <text
          v-else-if="isHost && memberOf(seat) && !memberOf(seat).isAI"
          class="seat-kick"
          @click.stop="kick(memberOf(seat))"
        >移出</text>
        <view class="seat-name-row">
          <text class="seat-name">{{ memberOf(seat)?.name || '空位' }}</text>
        </view>
        <view v-if="memberOf(seat)" class="seat-status-row">
          <text class="seat-status">
            {{ memberOf(seat).isAI ? 'AI 代打' : seatReadyText(memberOf(seat)) }}{{ memberOf(seat).connected ? '' : ' · 掉线' }}
          </text>
          <!-- 房主视角：未准备真人座位右侧同行「提醒准备」按钮；被提醒方收 poke 推送弹窗 -->
          <text
            v-if="isHost && !roomSettling && !memberOf(seat).isAI && !memberOf(seat).ready && memberOf(seat).connected"
            class="seat-poke"
            @click.stop="poke(memberOf(seat))"
          >提醒准备</text>
        </view>
        <text v-if="!memberOf(seat)" class="seat-status">点击入座</text>
      </view>
    </view>
    <view class="actions">
      <button v-if="isHost" class="btn-primary start-btn" :disabled="!canStart" @click="start">{{ startHint }}</button>
      <button v-if="myMember && !isHost && !myMember.ready && !roomSettling" class="btn-secondary" @click="setReady(true)">准备</button>
      <button v-else-if="myMember && !isHost && (myMember.ready || roomSettling)" class="btn-secondary" @click="setReady(false)">取消准备</button>
      <button class="btn-leave" @click="leave">离开房间</button>
    </view>
    <!-- 房主提醒弹窗：自绘遮罩卡片，与结算弹窗同风格（深木色卡片 + 金色标题），uni.showModal 样式无法定制 -->
    <view v-if="pokeShow" class="poke-overlay" @click="pokeShow = false">
      <view class="poke-card" @click.stop>
        <text class="poke-title">✦ 提醒 ✦</text>
        <text class="poke-text">{{ pokeMessage }}</text>
        <button class="btn-primary poke-btn" @click="pokeShow = false">知道了</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const roomId = ref(null)
const room = ref(null)
// mySeat 以 reconnect 快照（yourSeat）与换座回执为准：room.state 推送不携带 token，无法自行定位
const mySeat = ref(null)

const redirected = ref(false) // game.state 只跳一次：重连握手等场景服务器可能重发开局推送
// 结算收尾未完成（还有人在结算弹窗没点「再来一局」）：SETTLE 态 room.state 也会推送到本页。
// 影响开始按钮（禁用+等待提示）、操作守卫与座位文案（未点者显示「结算中」，见 seatReadyText）
const roomSettling = computed(() => room.value?.settling || false)
const offRoom = net.on('room.state', ({ room: r }) => {
  room.value = r
  roomId.value = r.roomId
  // 结算回房再开局：本页可能复用实例（H5 redirectTo 后 uni-app 页面栈复用），重置开局跳转闸门
  if (r.state === 'WAITING') redirected.value = false
  // 推送不携带 token 无法定位自己：mySeat 为 null（重连握手未回/回执竞态丢失）时补拉快照，
  // 否则座位区无「（我）」标记、我的准备按钮不渲染，后续开局也易踩 NOT_IN_ROOM
  if (r.state === 'WAITING' && mySeat.value === null) restoreSession()
})
// 被房主移出：清 token 回大厅（token 已被服务器删除，留着只会误导重连）
const offKicked = net.on('kicked', () => {
  uni.removeStorageSync('dingniuzi_player_token')
  uni.showToast({ title: '你已被房主移出房间', icon: 'none' })
  uni.reLaunch({ url: '/pages/lobby/lobby' })
})
// 房主提醒准备：自绘弹窗（与结算弹窗同风格），点遮罩或按钮关闭
const pokeShow = ref(false)
const pokeMessage = ref('')
const offPoke = net.on('poke', ({ message }) => {
  pokeMessage.value = message || '房主提醒你准备'
  pokeShow.value = true
})
const offStart = net.on('game.state', ({ view }) => {
  // 只对真正开新局（ROLLING/PLAYING）跳牌桌。SETTLE 态的 game.state 必须忽略：
  // 点「再来一局」本地跳回房间后，对局尚未收尾（其他真人未确认/5s 超时未到），
  // restoreSession 的 reconnect 快照会补发 SETTLE 态 game.state——若响应它会把玩家
  // 立刻弹回结算界面，表现为「点了再来一局没跳转，几秒后才跳走」。
  if (!view || (view.state !== 'ROLLING' && view.state !== 'PLAYING')) return
  if (redirected.value) return
  redirected.value = true
  // 服务器开局推送 game.state → 跳牌桌（net 模式，Task 8 接入）
  uni.redirectTo({ url: '/pages/game/game?mode=net' })
})

function memberOf(seat) { return room.value?.members.find((m) => m.seat === seat) || null }
const myMember = computed(() => (mySeat.value === null ? null : memberOf(mySeat.value)))
const isHost = computed(() => myMember.value?.isHost || false)
// 与服务器 canStart 同规则：AI 补位座位天然已准备；真人不足 4 人也可开局（空位由服务器自动补 AI）。
// 结算收尾未完成（roomSettling）时不放行开局：未点「再来一局」的玩家还没真正 ready，
// 由服务器在全员确认（或 5s 超时）收尾后再开
const canStart = computed(() => {
  if (!room.value || roomSettling.value) return false
  const real = room.value.members.filter((m) => !m.isAI)
  return real.length > 0 && real.every((m) => m.ready)
})
const startHint = computed(() => {
  if (roomSettling.value) return '等待其他玩家结算完成…'
  if (canStart.value) return '开始游戏'
  // 房主免准备、其余真人需手动准备：差人数 = 未准备的真人数
  const real = room.value ? room.value.members.filter((m) => !m.isAI) : []
  const unready = real.filter((m) => !m.ready).length
  if (unready > 0) return `还差${unready}人准备·空位AI补齐`
  return '可开始·空位AI补齐'
})
// 结算收尾期间座位文案（服务端 settleAck → settled 字段）：
// 已点「再来一局」的真人显示「已准备」，还没点的显示「结算中」——不能用 ready 区分，
// 连续局收尾时全员 ready 已是 true（上一局收尾置位），settleAck 才是本次点击事实
const seatReadyText = (m) =>
  m.isAI ? '' : roomSettling.value && !m.settled ? '结算中' : m.ready ? '已准备' : '未准备'

async function tapSeat(seat) {
  if (!room.value || mySeat.value === null) return // reconnect 快照未到时无从判断自己座位
  if (seat === mySeat.value || memberOf(seat)) return
  if (roomSettling.value) { uni.showToast({ title: '结算中，稍后再换座位', icon: 'none' }); return }
  try {
    const res = await net.request('room.seat', { seat })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
    else mySeat.value = seat // room.seat.ok 回执无座位号，本地记账；状态以 room.state 推送为准
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function setReady(ready) {
  // 结算收尾未完成时服务器只接受 game.settleContinue（room.ready 会被 ROOM_STARTED 拒）：
  // settleContinue 幂等且效果即「已准备」，用它代替，点「取消准备」则无操作
  if (roomSettling.value) {
    if (ready) {
      try {
        const res = await net.request('game.settleContinue', {})
        if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e.message || '请求失败', icon: 'none' })
      }
    }
    return
  }
  try {
    const res = await net.request('room.ready', { ready })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function kick(member) {
  // 结算收尾未完成时踢人会被服务器拒（非 WAITING 态）；收尾最多 5s，稍等即可
  if (roomSettling.value) { uni.showToast({ title: '结算中，稍后再操作', icon: 'none' }); return }
  try {
    const res = await net.request('room.kick', { token: member.token })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function poke(member) {
  if (roomSettling.value) return // 「提醒准备」按钮在结算态不渲染，防御性守卫
  try {
    const res = await net.request('room.poke', { token: member.token })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
    else uni.showToast({ title: '已提醒', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function start() {
  try {
    const res = await net.request('game.start', {})
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function leave() {
  try {
    await net.request('room.leave', {})
  } catch (e) {
    // 回执失败也继续离开：服务器 sweep 会兜底清理僵尸房；仅提示原因，不阻塞跳转
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
  // 服务器 WAITING 离开即删除 token（removeMember → tokens.delete），本地留它已无意义；清掉避免误重连
  uni.removeStorageSync('dingniuzi_player_token')
  uni.reLaunch({ url: '/pages/lobby/lobby' })
}

/**
 * 恢复会话：用 token 重连拿房间快照 + 自己座位（页面跳转/刷新后状态不丢）。
 * onLoad、「断线自动重连成功」与「WAITING 推送时 mySeat 缺失兜底」三个入口共用；
 * 重入保护：reconnect 握手会先回 room.state 再回 reconnected 回执，推送处理器可能在
 * 回执落地前再次触发本函数，不挡会多打一轮冗余重连。
 * 失败（房间已解散/token 失效）回大厅。
 */
let restoring = false
async function restoreSession() {
  if (restoring) return
  restoring = true
  try {
    const token = uni.getStorageSync('dingniuzi_player_token')
    if (!token) { uni.reLaunch({ url: '/pages/lobby/lobby' }); return }
    try {
      if (net.status.value !== 'open') await net.connect()
      const res = await net.request('reconnect', { token })
      if (res.type === 'error') {
        uni.removeStorageSync('dingniuzi_player_token') // 房间已解散等：token 失效，清理
        uni.reLaunch({ url: '/pages/lobby/lobby' })
        return
      }
      room.value = res.payload.room
      mySeat.value = res.payload.yourSeat
      roomId.value = res.payload.room.roomId
    } catch (e) {
      uni.showToast({ title: e.message || '连接失败', icon: 'none' })
      // 首连失败/握手超时：页面无快照不可用，回大厅（与 error 回执路径同样兜底）
      uni.reLaunch({ url: '/pages/lobby/lobby' })
    }
  } finally {
    restoring = false
  }
}

onLoad(async (query) => {
  roomId.value = Number(query.roomId)
  await restoreSession()
})

// net.js 断线后只重连 socket 不会重新认证：重连成功（reconnecting → open）即重跑 reconnect 握手，
// 否则服务器视本连接为未认证，所有请求都会「不在此房间」。首连（connecting → open）不经过
// reconnecting，不会误触发；重连握手失败 → 回大厅（宽限超时后 token 已被服务器删除）。
watch(net.status, async (val, old) => {
  if (val !== 'open' || old !== 'reconnecting') return
  await restoreSession()
})
onUnmounted(() => { offRoom?.(); offStart?.(); offKicked?.(); offPoke?.() })
</script>

<style scoped>
.room { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx 60rpx; gap: 40rpx; box-sizing: border-box; }
.head { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.room-id { font-size: 56rpx; font-weight: bold; color: #c9a227; letter-spacing: 8rpx; }
.hint { font-size: 24rpx; color: #b0a685; }
.seats { display: flex; flex-wrap: wrap; gap: 20rpx; justify-content: center; }
.seat { position: relative; width: 300rpx; padding: 28rpx 24rpx; border-radius: 16rpx; background: rgba(58, 44, 20, 0.5); border: 2rpx solid #5a4a32; display: flex; flex-direction: column; gap: 8rpx; }
.seat.me { border-color: #c9a227; }
.seat.host { border-color: #c9a227; border-width: 4rpx; background: linear-gradient(160deg, rgba(120, 88, 26, 0.55), rgba(58, 44, 20, 0.5)); box-shadow: 0 0 16rpx rgba(201, 162, 39, 0.35); }
.seat.host .seat-name { color: #c9a227; }
.seat.taken { background: rgba(74, 52, 24, 0.7); }
.seat.host.taken { background: linear-gradient(160deg, rgba(120, 88, 26, 0.55), rgba(58, 44, 20, 0.5)); }
.seat-no { font-size: 22rpx; color: #b0a685; }
.seat-name { font-size: 32rpx; color: #f5f0e1; }
.seat-name-row { display: flex; align-items: center; min-width: 0; padding-right: 100rpx; }
.seat-name-row .seat-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-badge { position: absolute; top: 12rpx; right: 12rpx; display: flex; align-items: center; gap: 4rpx; padding: 2rpx 12rpx; border: 2rpx solid #c9a227; border-radius: 999rpx; background: rgba(201, 162, 39, 0.14); }
.host-badge-star { font-size: 20rpx; color: #c9a227; line-height: 1; }
.host-badge-text { font-size: 20rpx; color: #c9a227; line-height: 1.4; }
.seat-status { font-size: 22rpx; color: #b0a685; }
.seat-kick { position: absolute; top: 12rpx; right: 12rpx; font-size: 22rpx; color: #c0563a; padding: 4rpx 8rpx; }
.seat-status-row { display: flex; align-items: center; gap: 12rpx; }
.seat-poke { margin-left: auto; font-size: 22rpx; color: #c9a227; padding: 2rpx 12rpx; border: 2rpx solid #c9a227; border-radius: 999rpx; flex: none; }
.actions { display: flex; flex-direction: column; align-items: center; gap: 20rpx; width: 100%; max-width: 560rpx; margin-top: 20rpx; }
.start-btn { width: auto; min-width: 0; padding: 18rpx 64rpx; font-size: 32rpx; white-space: nowrap; line-height: 1.4; }
.btn-leave { background: transparent; color: #b0a685; border: 2rpx solid #5a4a32; }
.poke-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 99; }
.poke-card { background: rgba(74, 52, 24, 0.88); border-radius: 24rpx; padding: 48rpx 40rpx; width: 560rpx; display: flex; flex-direction: column; gap: 24rpx; align-items: center; box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.5); border: 2rpx solid #5a4a32; }
.poke-title { font-size: 36rpx; font-weight: bold; color: #c9a227; letter-spacing: 4rpx; }
.poke-text { font-size: 30rpx; color: #f5f0e1; text-align: center; }
.poke-btn { width: auto; padding: 14rpx 56rpx; }
</style>
