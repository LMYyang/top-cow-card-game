<template>
  <view class="roomlist">
    <view class="head">
      <text class="title">房间列表</text>
      <text class="hint">仅显示未开局、有真人在线、未满员的房间，点击即可加入</text>
    </view>
    <view class="list-wrap">
      <view v-if="listLoading" class="list-hint">加载中…</view>
      <view v-else-if="rooms.length === 0" class="list-hint">暂无可加入的房间，去创建一个吧</view>
      <template v-else>
        <view v-for="r in rooms" :key="r.roomId" class="room-item" @click="joinById(r.roomId)">
          <text class="room-item-id">{{ r.roomId }}</text>
          <view class="room-item-members">
            <text v-for="(m, i) in r.members" :key="i" class="room-item-member" :class="{ offline: !m.connected }">
              {{ m.name }}{{ m.isHost ? '(房主)' : '' }}{{ m.connected ? '' : '(掉线)' }}
            </text>
          </view>
          <text class="room-item-count">{{ r.playerCount }}/4 人</text>
          <text class="room-item-join">加入 ›</text>
        </view>
      </template>
    </view>
    <view class="actions">
      <button class="btn-secondary refresh-btn" :disabled="listLoading" @click="refreshRooms">
        {{ listLoading ? '刷新中…' : '刷新列表' }}
      </button>
      <button class="btn-back" @click="goLobby">返回大厅</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const listLoading = ref(false)
const rooms = ref([])

/** 拉取有效房间列表（失败仅提示，保留旧数据可再刷） */
async function refreshRooms() {
  listLoading.value = true
  try {
    if (net.status.value !== 'open') await net.connect()
    const res = await net.request('room.list', {})
    if (res.type === 'error') {
      uni.showToast({ title: res.payload.message || '获取房间列表失败', icon: 'none' })
      return
    }
    rooms.value = res.payload.rooms || []
  } catch (e) {
    uni.showToast({ title: e.message || '连接失败', icon: 'none' })
  } finally {
    listLoading.value = false
  }
}

/** 点击房间条目加入：带昵称与本地旧 token 请求入房，断线重进时服务器复用历史座位 */
async function joinById(roomId) {
  if (listLoading.value) return
  try {
    if (net.status.value !== 'open') await net.connect()
    const name = uni.getStorageSync('dingniuzi_player_name') || `玩家${Math.floor(1000 + Math.random() * 9000)}`
    uni.setStorageSync('dingniuzi_player_name', name)
    const oldToken = uni.getStorageSync('dingniuzi_player_token')
    const res = await net.request('room.join', { name, roomId, token: oldToken || '' })
    if (res.type === 'error') {
      uni.showToast({ title: res.payload.message, icon: 'none' })
      refreshRooms() // 加入失败（满员/已开局等）：刷新列表去掉失效条目
      return
    }
    uni.setStorageSync('dingniuzi_player_token', res.payload.token)
    uni.redirectTo({ url: `/pages/room/room?roomId=${res.payload.room.roomId}` })
  } catch (e) {
    uni.showToast({ title: e.message || '连接失败', icon: 'none' })
  }
}

const goLobby = () => uni.redirectTo({ url: '/pages/lobby/lobby' })
refreshRooms()
</script>

<style scoped>
.roomlist { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx 60rpx; gap: 40rpx; box-sizing: border-box; }
.head { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #f5f0e1; letter-spacing: 4rpx; }
.hint { font-size: 24rpx; color: #b0a685; text-align: center; }
.list-wrap { width: 100%; max-width: 640rpx; display: flex; flex-direction: column; gap: 12rpx; }
.room-item {
  display: flex; align-items: center; gap: 16rpx;
  background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32; border-radius: 12rpx;
  padding: 20rpx 24rpx;
}
.room-item-id { font-size: 30rpx; color: #c9a227; letter-spacing: 2rpx; flex: none; }
.room-item-members { flex: 1; display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.room-item-member { font-size: 24rpx; color: #f5f0e1; }
.room-item-member.offline { color: #8a7a5a; }
.room-item-count { font-size: 24rpx; color: #b0a685; flex: none; }
.room-item-join { font-size: 24rpx; color: #c9a227; flex: none; }
.list-hint { text-align: center; font-size: 24rpx; color: #b0a685; padding: 32rpx 0; }
.actions { display: flex; flex-direction: column; gap: 16rpx; width: 100%; max-width: 640rpx; margin-top: 12rpx; }
.refresh-btn { width: 100%; }
.btn-back { background: transparent; color: #b0a685; border: none; font-size: 26rpx; }
</style>
