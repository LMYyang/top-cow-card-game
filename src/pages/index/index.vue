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
      <button class="btn-secondary" @click="startOnline">联网对战</button>
      <view class="stats-card">
        <view class="stats-row">
          <text class="stats-label">总积分</text>
          <text class="stats-score" :class="{ negative: stats.totalScore < 0 }">{{ stats.totalScore > 0 ? '+' : '' }}{{ stats.totalScore }}</text>
        </view>
        <text class="stats-sub">已对局 {{ stats.rounds }} 局</text>
      </view>
    </view>

    <!-- 历史记录 -->
    <view class="history-area">
      <view class="history-header" @click="historyOpen = !historyOpen">
        <text class="history-title">历史记录</text>
        <text class="history-toggle">{{ historyOpen ? '收起 ▲' : '展开 ▼' }}</text>
      </view>
      <view v-if="historyOpen" class="history-list">
        <view v-if="history.length === 0" class="history-empty">还没有对局记录</view>
        <view
          v-for="(h, i) in pagedHistory"
          :key="h.time"
          class="history-item"
          @click="toggleExpand(globalIdx(i))"
        >
          <view class="item-head">
            <text class="item-time">{{ formatTime(h.time) }}</text>
            <text class="item-my-score" :class="{ negative: h.scores[0] < 0 }">
              {{ h.scores[0] > 0 ? '+' : '' }}{{ h.scores[0] }}
            </text>
          </view>
          <view v-if="expandedIdx === globalIdx(i)" class="item-detail">
            <view
              v-for="seat in [0, 1, 2, 3]"
              :key="seat"
              class="detail-row"
              :class="{ me: seat === 0, winner: h.roles[seat] === '赢家' }"
            >
              <PlayerAvatar :seat="seat" size="sm" />
              <text class="d-name">{{ labelOf(seat) }}</text>
              <text class="d-role">{{ h.roles[seat] }}</text>
              <text class="d-points">扣 {{ h.points[seat] }} 点</text>
              <text class="d-score" :class="{ negative: h.scores[seat] < 0 }">
                {{ h.scores[seat] > 0 ? '+' : '' }}{{ h.scores[seat] }}
              </text>
              <text class="d-total">累计 {{ h.totalsAfter[seat] || 0 }}</text>
            </view>
          </view>
        </view>
        <!-- 分页控件 -->
        <view v-if="totalPages > 1" class="pagination">
          <button class="page-btn" :disabled="page === 1" @click="page--">上一页</button>
          <text class="page-info">{{ page }} / {{ totalPages }}</text>
          <button class="page-btn" :disabled="page === totalPages" @click="page++">下一页</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PlayingTile from '../../components/PlayingTile.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'

const demoTile1 = { id: 'd1', name: '大天', a: 6, b: 6 }
const demoTile2 = { id: 'd2', name: '地幺', a: 1, b: 1 }

const statsRaw = ref(uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 })
const stats = computed(() => statsRaw.value)

const historyRaw = ref(uni.getStorageSync('dingniuzi_history') || [])
const history = computed(() => historyRaw.value)
const historyOpen = ref(false)
const expandedIdx = ref(-1) // 当前展开的历史条目全局下标，-1 = 全部收起

// 分页：每 20 条一页
const PAGE_SIZE = 20
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(history.value.length / PAGE_SIZE)))
const pagedHistory = computed(() =>
  history.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
// 分页下标 → 全局下标（展开状态跨页保持一致）
const globalIdx = (localIdx) => (page.value - 1) * PAGE_SIZE + localIdx
function toggleExpand(idx) {
  expandedIdx.value = expandedIdx.value === idx ? -1 : idx
}

const SEAT_LABELS = ['我', '下家', '对家', '上家']
const labelOf = (seat) => SEAT_LABELS[seat] || `座位${seat}`

function formatTime(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 打完一局返回主菜单时刷新战绩与历史（navigateBack 复用页面实例，setup 不会重跑）
onShow(() => {
  statsRaw.value = uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 }
  historyRaw.value = uni.getStorageSync('dingniuzi_history') || []
})

function startGame() {
  uni.navigateTo({ url: '/pages/game/game' })
}

function startOnline() {
  uni.navigateTo({ url: '/pages/lobby/lobby' })
}
</script>

<style scoped>
.menu {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 60rpx 60rpx;
  box-sizing: border-box;
  gap: 48rpx;
}
.logo-area { display: flex; flex-direction: column; align-items: center; }
.logo-tiles { display: flex; gap: 24rpx; margin-bottom: 40rpx; }
.logo-tiles > :last-child { transform: rotate(8deg) translateY(12rpx); }
.logo-tiles > :first-child { transform: rotate(-8deg); }
.title { font-size: 72rpx; font-weight: bold; letter-spacing: 8rpx; color: #f5f0e1; }
.subtitle { font-size: 26rpx; color: #b0a685; margin-top: 12rpx; }
.menu-buttons { display: flex; flex-direction: column; gap: 28rpx; width: 100%; align-items: center; }
.stats-card {
  display: flex; flex-direction: column; align-items: center; gap: 8rpx;
  padding: 24rpx 48rpx; border-radius: 16rpx;
  background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32;
  min-width: 320rpx;
}
.stats-row { display: flex; align-items: baseline; gap: 16rpx; }
.stats-label { font-size: 24rpx; color: #b0a685; }
.stats-score { font-size: 48rpx; font-weight: bold; color: #c9a227; }
.stats-score.negative { color: #a04030; }
.stats-sub { font-size: 22rpx; color: #b0a685; }

/* 历史记录 */
.history-area { width: 100%; max-width: 640rpx; }
.history-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16rpx 24rpx; border-radius: 12rpx;
  background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32;
}
.history-title { font-size: 28rpx; color: #f5f0e1; }
.history-toggle { font-size: 22rpx; color: #b0a685; }
.history-list { margin-top: 12rpx; display: flex; flex-direction: column; gap: 12rpx; max-height: 560rpx; overflow-y: auto; }
.history-empty { text-align: center; color: #b0a685; font-size: 24rpx; padding: 24rpx 0; }
.history-item {
  padding: 16rpx 24rpx; border-radius: 12rpx;
  background: rgba(58, 44, 20, 0.4); border: 2rpx solid #4a3c22;
}
.item-head { display: flex; justify-content: space-between; align-items: center; }
.item-time { font-size: 24rpx; color: #b0a685; }
.item-my-score { font-size: 28rpx; font-weight: bold; color: #c9a227; }
.item-my-score.negative { color: #a04030; }
.item-detail { margin-top: 12rpx; display: flex; flex-direction: column; gap: 8rpx; }
.detail-row { display: flex; align-items: center; gap: 12rpx; padding: 6rpx 8rpx; border-radius: 8rpx; }
.detail-row.me { background: rgba(201, 162, 39, 0.12); }
.detail-row.winner .d-role { color: #c9a227; font-weight: bold; }
.d-name { font-size: 22rpx; color: #f5f0e1; width: 64rpx; }
.d-role { font-size: 22rpx; color: #b0a685; width: 80rpx; }
.d-points { font-size: 22rpx; color: #b0a685; flex: 1; }
.d-score { font-size: 24rpx; font-weight: bold; color: #c9a227; width: 64rpx; text-align: right; }
.d-score.negative { color: #a04030; }
.d-total { font-size: 22rpx; color: #b0a685; width: 96rpx; text-align: right; }
/* 分页 */
.pagination { display: flex; align-items: center; justify-content: center; gap: 24rpx; padding: 16rpx 0; }
.page-btn {
  font-size: 22rpx; padding: 8rpx 28rpx; margin: 0; line-height: 1.4;
  background: #3a2c14; color: #b0a685; border-radius: 10rpx; border: 2rpx solid #5a4a32;
}
.page-btn[disabled] { opacity: 0.4; color: #b0a685; background: #3a2c14; }
.page-info { font-size: 24rpx; color: #b0a685; }
</style>
