<!-- src/pages/lobby/lobby.vue -->
<template>
  <view class="lobby">
    <text class="title">联网对战</text>
    <view class="form">
      <input class="name-input" v-model="name" placeholder="你的昵称" maxlength="12" />
      <button class="btn-primary" :disabled="busy" @click="quickMatch">快速匹配</button>
      <button class="btn-secondary" :disabled="busy" @click="createRoom">创建房间</button>
      <button class="btn-secondary" :disabled="busy" @click="openRoomList">查看房间列表</button>
      <view class="join-row">
        <input class="room-input" v-model="joinId" type="number" placeholder="房间号" maxlength="6" />
        <button class="btn-secondary join-btn" :disabled="busy || joinId.trim().length !== 6" @click="join">加入</button>
      </view>
    </view>
    <!-- 有可恢复的对局会话时显示：断线/退出后 60s 宽限期内，点此回到原对局 -->
    <button v-if="resumable" class="btn-resume" @click="resumeGame">↩ 回到对局中（{{ resumeRoomId }}）</button>
    <!-- 有效房间列表已独立成页：点击「查看房间列表」跳转 roomlist 页浏览/刷新/加入 -->
    <button class="btn-back" @click="goHome">返回主菜单</button>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const name = ref(uni.getStorageSync('dingniuzi_player_name') || `玩家${Math.floor(1000 + Math.random() * 9000)}`)
const joinId = ref('')
const busy = ref(false)
// 可恢复会话：本地存有 token 且服务器上该 token 仍挂在未销毁的房里（多为对局中掉线/退出宽限期）
const resumable = ref(false)
const resumeRoomId = ref(null)

/** 检查本地 token 是否还挂着有效房（session.check 只读预检，不改连接身份） */
async function checkResumable() {
  const token = uni.getStorageSync('dingniuzi_player_token')
  if (!token) return
  try {
    if (net.status.value !== 'open') await net.connect()
    const res = await net.request('session.check', { token })
    if (res.type === 'error') return
    if (res.payload.session) {
      resumable.value = true
      resumeRoomId.value = res.payload.session.roomId
    }
  } catch { /* 连不上就不显示恢复入口 */ }
}

/** 回到对局：直接跳牌桌（useNetGame 挂载时自动 reconnect 拉快照、收回收管） */
const resumeGame = () => uni.redirectTo({ url: '/pages/game/game?mode=net' })

/**
 * 进入房间的统一出口：建连 → 持久化昵称 → 发起入房请求。
 * 请求携带本地旧 token：断线后重进时服务器按 token 复用历史座位，
 * 避免"原成员残留 + 新座位并存"出现两个自己。
 * 服务器错误回执与连接失败（reject）都走 toast；成功后存 token 并跳房间页。
 */
async function enter(requestFn, payload) {
  busy.value = true
  try {
    if (net.status.value !== 'open') await net.connect()
    uni.setStorageSync('dingniuzi_player_name', name.value)
    const oldToken = uni.getStorageSync('dingniuzi_player_token')
    const res = await net.request(requestFn, { name: name.value, token: oldToken || '', ...payload })
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

const openRoomList = () => uni.redirectTo({ url: '/pages/roomlist/roomlist' })
const quickMatch = () => enter('room.quickMatch', {})
const createRoom = () => enter('room.create', {})
const join = () => enter('room.join', { roomId: Number(joinId.value) })
const goHome = () => uni.reLaunch({ url: '/pages/index/index' })
onLoad(() => { checkResumable() })
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
.btn-resume { width: 100%; max-width: 560rpx; background: rgba(201, 162, 39, 0.18); color: #c9a227; border: 2rpx solid #c9a227; border-radius: 24rpx; font-size: 28rpx; padding: 16rpx 40rpx; }
</style>
