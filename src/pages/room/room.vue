<!-- src/pages/room/room.vue -->
<template>
  <view class="room">
    <view class="head">
      <text class="room-id">房间号 {{ roomId }}</text>
      <text class="hint">开局时空位自动补 AI 代打，人不够也能玩</text>
    </view>
    <view class="seats">
      <view
        v-for="seat in [0, 1, 2, 3]"
        :key="seat"
        class="seat"
        :class="{ me: seat === mySeat, taken: !!memberOf(seat) }"
        @click="tapSeat(seat)"
      >
        <text class="seat-no">{{ seatName(seat) }}</text>
        <text class="seat-name">{{ memberOf(seat)?.name || '空位' }}</text>
        <text v-if="memberOf(seat)" class="seat-status">
          {{ memberOf(seat).isHost ? '房主 · ' : '' }}{{ memberOf(seat).isAI ? 'AI 代打' : seatReadyText(memberOf(seat)) }}{{ memberOf(seat).connected ? '' : ' · 掉线' }}
        </text>
        <text v-else class="seat-status">点击入座</text>
      </view>
    </view>
    <view class="actions">
      <button v-if="isHost" class="btn-primary" :disabled="!canStart" @click="start">{{ startHint }}</button>
      <button v-if="myMember && !myMember.ready" class="btn-secondary" @click="setReady(true)">准备</button>
      <button v-else-if="myMember" class="btn-secondary" @click="setReady(false)">取消准备</button>
      <button class="btn-leave" @click="leave">离开房间</button>
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
const SEAT_NAMES = ['自己', '下家', '对家', '上家']

const redirected = ref(false) // game.state 只跳一次：重连握手等场景服务器可能重发开局推送
const offRoom = net.on('room.state', ({ room: r }) => {
  room.value = r
  roomId.value = r.roomId
})
const offStart = net.on('game.state', () => {
  if (redirected.value) return
  redirected.value = true
  // 服务器开局推送 game.state → 跳牌桌（net 模式，Task 8 接入）
  uni.redirectTo({ url: '/pages/game/game?mode=net' })
})

function memberOf(seat) { return room.value?.members.find((m) => m.seat === seat) || null }
const myMember = computed(() => (mySeat.value === null ? null : memberOf(mySeat.value)))
const isHost = computed(() => myMember.value?.isHost || false)
// 与服务器 canStart 同规则：AI 补位座位天然已准备；真人不足 4 人也可开局（空位由服务器自动补 AI）
const canStart = computed(() => {
  if (!room.value) return false
  const real = room.value.members.filter((m) => !m.isAI)
  return real.length > 0 && real.every((m) => m.ready)
})
const startHint = computed(() => {
  if (canStart.value) return '开始游戏'
  // 开局时空位自动补 AI：提示里说明缺的人由 AI 托底，房主可提前开局
  const real = room.value ? room.value.members.filter((m) => !m.isAI).length : 0
  const ready = room.value ? room.value.members.filter((m) => m.ready || m.isAI).length : 0
  if (ready < real) return `还差 ${real - ready} 人准备（空位由 AI 补齐）`
  return '可开始（空位由 AI 补齐）'
})
const seatName = (seat) => `${seat + 1}号位 · ${SEAT_NAMES[seat]}`
const seatReadyText = (m) => (m.isAI ? '' : m.ready ? '已准备' : '未准备')

async function tapSeat(seat) {
  if (!room.value || mySeat.value === null) return // reconnect 快照未到时无从判断自己座位
  if (seat === mySeat.value || memberOf(seat)) return
  try {
    const res = await net.request('room.seat', { seat })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
    else mySeat.value = seat // room.seat.ok 回执无座位号，本地记账；状态以 room.state 推送为准
  } catch (e) {
    uni.showToast({ title: e.message || '请求失败', icon: 'none' })
  }
}
async function setReady(ready) {
  try {
    const res = await net.request('room.ready', { ready })
    if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
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
 * onLoad 与「断线自动重连成功」两个入口共用；失败（房间已解散/token 失效）回大厅。
 */
async function restoreSession() {
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
onUnmounted(() => { offRoom?.(); offStart?.() })
</script>

<style scoped>
.room { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx 60rpx; gap: 40rpx; box-sizing: border-box; }
.head { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.room-id { font-size: 56rpx; font-weight: bold; color: #c9a227; letter-spacing: 8rpx; }
.hint { font-size: 24rpx; color: #b0a685; }
.seats { display: flex; flex-wrap: wrap; gap: 20rpx; justify-content: center; }
.seat { width: 300rpx; padding: 28rpx 24rpx; border-radius: 16rpx; background: rgba(58, 44, 20, 0.5); border: 2rpx solid #5a4a32; display: flex; flex-direction: column; gap: 8rpx; }
.seat.me { border-color: #c9a227; }
.seat.taken { background: rgba(74, 52, 24, 0.7); }
.seat-no { font-size: 22rpx; color: #b0a685; }
.seat-name { font-size: 32rpx; color: #f5f0e1; }
.seat-status { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; flex-direction: column; gap: 20rpx; width: 100%; max-width: 560rpx; margin-top: 20rpx; }
.btn-leave { background: transparent; color: #b0a685; border: 2rpx solid #5a4a32; }
</style>
