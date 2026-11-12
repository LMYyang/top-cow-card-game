<!-- src/pages/lobby/lobby.vue -->
<template>
  <view class="lobby">
    <text class="title">联网对战</text>
    <view class="form">
      <input class="name-input" v-model="name" placeholder="你的昵称" maxlength="12" />
      <button class="btn-primary" :disabled="busy" @click="quickMatch">快速匹配</button>
      <button class="btn-secondary" :disabled="busy" @click="createRoom">创建房间</button>
      <view class="join-row">
        <input class="room-input" v-model="joinId" type="number" placeholder="房间号" maxlength="6" />
        <button class="btn-secondary join-btn" :disabled="busy || joinId.trim().length !== 6" @click="join">加入</button>
      </view>
    </view>
    <button class="btn-back" @click="goHome">返回主菜单</button>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const name = ref(uni.getStorageSync('dingniuzi_player_name') || `玩家${Math.floor(1000 + Math.random() * 9000)}`)
const joinId = ref('')
const busy = ref(false)

/**
 * 进入房间的统一出口：建连 → 持久化昵称 → 发起入房请求。
 * 服务器错误回执与连接失败（reject）都走 toast；成功后存 token 并跳房间页。
 */
async function enter(requestFn, payload) {
  busy.value = true
  try {
    if (net.status.value !== 'open') await net.connect()
    uni.setStorageSync('dingniuzi_player_name', name.value)
    const res = await net.request(requestFn, { name: name.value, ...payload })
    if (res.type === 'error') {
      uni.showToast({ title: res.payload.message, icon: 'none' })
      return
    }
    uni.setStorageSync('dingniuzi_player_token', res.payload.token)
    uni.redirectTo({ url: `/pages/room/room?roomId=${res.payload.room.roomId}` })
  } catch (e) {
    uni.showToast({ title: e.message || '连接失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}
const quickMatch = () => enter('room.quickMatch', {})
const createRoom = () => enter('room.create', {})
const join = () => enter('room.join', { roomId: Number(joinId.value) })
const goHome = () => uni.reLaunch({ url: '/pages/index/index' })
</script>

<style scoped>
.lobby { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40rpx; padding: 60rpx; box-sizing: border-box; }
.title { font-size: 56rpx; font-weight: bold; color: #f5f0e1; letter-spacing: 6rpx; }
.form { display: flex; flex-direction: column; gap: 24rpx; width: 100%; max-width: 560rpx; }
.name-input, .room-input { background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32; border-radius: 12rpx; padding: 20rpx 24rpx; color: #f5f0e1; font-size: 28rpx; }
.join-row { display: flex; gap: 16rpx; align-items: center; }
.join-row .room-input { flex: 1; }
.join-btn { flex: none; margin: 0; padding: 18rpx 40rpx; }
.btn-back { margin-top: 20rpx; background: transparent; color: #b0a685; border: none; font-size: 26rpx; }
</style>
