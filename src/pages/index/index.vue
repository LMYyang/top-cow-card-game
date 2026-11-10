<!-- src/pages/index/index.vue -->
<template>
  <view class="menu">
    <view class="logo-area">
      <view class="logo-tiles">
        <PlayingTile :tile="demoTile1" size="lg" />
        <PlayingTile :tile="demoTile2" size="lg" />
      </view>
      <text class="title">顶牛子</text>
      <text class="subtitle">民间骨牌 · 24张 · 四人对局</text>
    </view>
    <view class="menu-buttons">
      <button class="btn-primary" @click="startGame">开始游戏</button>
      <button class="btn-secondary" @click="showStats">战绩</button>
      <view v-if="statsVisible" class="stats-panel">
        <text>对局 {{ stats.rounds }} 局 · 总积分 {{ stats.totalScore }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PlayingTile from '../../components/PlayingTile.vue'

const demoTile1 = { id: 'd1', name: '大天', a: 6, b: 6 }
const demoTile2 = { id: 'd2', name: '地幺', a: 1, b: 1 }

const statsRaw = ref(uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 })
const statsVisible = ref(false)
const stats = computed(() => statsRaw.value)

// 打完一局返回主菜单时刷新战绩（navigateBack 复用页面实例，setup 不会重跑）
onShow(() => {
  statsRaw.value = uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 }
})

function startGame() {
  uni.navigateTo({ url: '/pages/game/game' })
}
function showStats() {
  statsVisible.value = !statsVisible.value
}
</script>

<style scoped>
.menu {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  padding: 120rpx 60rpx;
  box-sizing: border-box;
}
.logo-area { display: flex; flex-direction: column; align-items: center; }
.logo-tiles { display: flex; gap: 24rpx; margin-bottom: 40rpx; }
.logo-tiles > :last-child { transform: rotate(8deg) translateY(12rpx); }
.logo-tiles > :first-child { transform: rotate(-8deg); }
.title { font-size: 72rpx; font-weight: bold; letter-spacing: 8rpx; color: #f5f0e1; }
.subtitle { font-size: 26rpx; color: #b0a685; margin-top: 12rpx; }
.menu-buttons { display: flex; flex-direction: column; gap: 28rpx; width: 100%; align-items: center; }
.stats-panel { color: #b0a685; font-size: 26rpx; }
</style>
