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
        <view class="stats-cols">
          <view class="stats-block" @click="openHistory('solo')">
            <view class="stats-row">
              <text class="stats-label">单机积分</text>
              <text class="stats-score" :class="{ negative: soloStats.totalScore < 0 }">{{ soloStats.totalScore > 0 ? '+' : '' }}{{ soloStats.totalScore }}</text>
            </view>
            <text class="stats-sub">已对局 {{ soloStats.rounds }} 局 ›</text>
          </view>
          <view class="stats-divider" />
          <view class="stats-block" @click="openHistory('net')">
            <view class="stats-row">
              <text class="stats-label net">联网积分</text>
              <text class="stats-score net" :class="{ negative: netStats.totalScore < 0 }">{{ netStats.totalScore > 0 ? '+' : '' }}{{ netStats.totalScore }}</text>
            </view>
            <text class="stats-sub">已对局 {{ netStats.rounds }} 局 ›</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 历史记录弹框：点统计卡「单机/联网」区域打开，展示对应模式的历史记录 -->
    <view v-if="historyOpen" class="settle-overlay" @click="historyOpen = false">
      <view class="history-modal" @click.stop>
        <view class="modal-header">
          <text class="modal-title" :class="{ net: historyMode === 'net' }">{{ historyMode === 'net' ? '联网对战记录' : '单机对战记录' }}</text>
          <text class="modal-close" @click="historyOpen = false">✕</text>
        </view>
        <view class="history-list">
          <view v-if="modeHistory.length === 0" class="history-empty">还没有对局记录</view>
          <view
            v-for="(h, i) in pagedHistory"
            :key="h.time"
            class="history-item"
            @click="toggleExpand(i)"
          >
            <!-- 点击处理只在父级 .history-item 上：这里若再绑 @click 会因事件冒泡触发两次 toggle（展开又立刻收起） -->
            <view class="item-head">
              <text class="item-time">{{ formatTime(h.time) }}</text>
              <text class="item-expand">{{ expandedIdx === i ? '收起 ▲' : '展开 ▼' }}</text>
              <text class="item-my-score" :class="{ negative: h.scores[0] < 0 }">
                {{ h.scores[0] > 0 ? '+' : '' }}{{ h.scores[0] }}
              </text>
            </view>
            <view v-if="expandedIdx === i" class="item-detail">
              <view
                v-for="seat in [0, 1, 2, 3]"
                :key="seat"
                class="detail-row"
                :class="{ me: seat === 0, winner: h.roles[seat] === '赢家', net: historyMode === 'net' }"
              >
                <PlayerAvatar :seat="seat" size="sm" />
                <text class="d-name">{{ labelOf(h, seat) }}</text>
                <text class="d-role">{{ h.roles[seat] }}</text>
                <text class="d-points">扣 {{ h.points[seat] }} 点</text>
                <text class="d-score" :class="{ negative: h.scores[seat] < 0 }">
                  {{ h.scores[seat] > 0 ? '+' : '' }}{{ h.scores[seat] }}
                </text>
                <text v-if="historyMode !== 'net'" class="d-total">累计 {{ h.totalsAfter[seat] || 0 }}</text>
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
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PlayingTile from '../../components/PlayingTile.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'
import { backfillNetStats } from '../../composables/history.js'

const demoTile1 = { id: 'd1', name: '大天', a: 6, b: 6 }
const demoTile2 = { id: 'd2', name: '地幺', a: 1, b: 1 }

const statsRaw = ref(uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 })
// 历史记录按模式拆分统计：单机看 dingniuzi_stats（只含单机局），联网从历史条目汇总
const historyRaw = ref(uni.getStorageSync('dingniuzi_history') || [])
const history = computed(() => historyRaw.value)
const soloStats = computed(() => statsRaw.value)
const netStats = computed(() => {
  const netEntries = history.value.filter((h) => h.mode === 'net')
  return {
    rounds: netEntries.length,
    totalScore: netEntries.reduce((s, h) => s + (h.scores?.[0] || 0), 0),
  }
})
const historyOpen = ref(false)
const historyMode = ref('solo') // 弹框当前展示的模式：'solo' | 'net'
const expandedIdx = ref(-1) // 弹框内展开的条目下标，-1 = 全部收起

// 弹框按模式过滤历史（时间正序存储，最新在前已由写入方保证）
const modeHistory = computed(() =>
  history.value.filter((h) => (historyMode.value === 'net' ? h.mode === 'net' : h.mode !== 'net'))
)

/** 点统计卡「单机/联网」区域：打开对应模式的历史弹框（每次打开重置展开与页码） */
function openHistory(mode) {
  historyMode.value = mode
  expandedIdx.value = -1
  page.value = 1
  historyOpen.value = true
}

// 分页：每 20 条一页
const PAGE_SIZE = 20
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(modeHistory.value.length / PAGE_SIZE)))
const pagedHistory = computed(() =>
  modeHistory.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
function toggleExpand(idx) {
  expandedIdx.value = expandedIdx.value === idx ? -1 : idx
}

const SEAT_LABELS = ['我', '下家', '对家', '上家']
/** 条目视角称呼：单机固定四家称呼；联网显示本端记录的座位→昵称快照（h.names），缺失时退化为「座位N」 */
const labelOf = (h, seat) => {
  if (h.mode === 'net') return (h.names && h.names[seat]) || `座位${seat}`
  return SEAT_LABELS[seat] || `座位${seat}`
}

function formatTime(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 打完一局返回主菜单时刷新战绩与历史（navigateBack 复用页面实例，setup 不会重跑）。
// backfillNetStats：把修复前已打、未计入统计的联网局一次性补进 dingniuzi_stats
// ——迁移完成后 dingniuzi_stats 只剩单机口径（联网统计改为从历史条目实时汇总，不再写入）
onShow(() => {
  const stats = backfillNetStats()
  const netEntries = (uni.getStorageSync('dingniuzi_history') || []).filter((h) => h.mode === 'net')
  // 统计里减去联网局部分，得到纯单机口径（backfill 后 stats.rounds 含联网历史数）
  statsRaw.value = {
    rounds: Math.max(0, stats.rounds - netEntries.length),
    totalScore: stats.totalScore - netEntries.reduce((s, h) => s + (h.scores?.[0] || 0), 0),
  }
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
  padding: 24rpx 40rpx; border-radius: 16rpx;
  background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32;
  min-width: 440rpx;
}
/* 双模式统计：单机 | 联网 左右并排 */
.stats-cols { display: flex; align-items: stretch; gap: 32rpx; }
.stats-block { display: flex; flex-direction: column; align-items: center; gap: 8rpx; min-width: 160rpx; }
.stats-divider { width: 2rpx; background: #5a4a32; }
.stats-row { display: flex; align-items: baseline; gap: 12rpx; }
.stats-label { font-size: 24rpx; color: #b0a685; }
.stats-label.net { color: #c9a227; }
.stats-score { font-size: 44rpx; font-weight: bold; color: #c9a227; }
.stats-score.net { color: #e8c95a; }
.stats-score.negative { color: #a04030; }
.stats-sub { font-size: 22rpx; color: #b0a685; }

/* 历史记录弹框：与 game.vue 结算弹窗同风格的深木色卡片 */
.settle-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
}
.history-modal {
  background: rgba(74, 52, 24, 0.92);
  border: 2rpx solid #5a4a32;
  border-radius: 24rpx;
  padding: 32rpx 28rpx;
  width: 640rpx; max-height: 78vh;
  box-sizing: border-box;
  display: flex; flex-direction: column; gap: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.5);
}
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-title { font-size: 32rpx; font-weight: bold; color: #f5f0e1; }
.modal-title.net { color: #c9a227; }
.modal-close {
  font-size: 32rpx; color: #b0a685; padding: 8rpx 20rpx;
}
.stats-block { cursor: pointer; }
.stats-sub { cursor: pointer; }

/* 历史列表（弹框内） */
.history-list { display: flex; flex-direction: column; gap: 12rpx; overflow-y: auto; }
.history-empty { text-align: center; color: #b0a685; font-size: 24rpx; padding: 24rpx 0; }
.history-item {
  padding: 16rpx 24rpx; border-radius: 12rpx;
  background: rgba(58, 44, 20, 0.4); border: 2rpx solid #4a3c22;
}
.item-head { display: flex; align-items: center; gap: 16rpx; }
.item-time { font-size: 24rpx; color: #b0a685; flex: 1; }
/* 展开/分数列固定宽+右对齐：各条目纵向对齐（分数位数不同时不互相挤动） */
.item-expand { font-size: 20rpx; color: #8a7d5c; width: 104rpx; text-align: right; }
.item-my-score { font-size: 28rpx; font-weight: bold; color: #c9a227; width: 88rpx; text-align: right; }
.item-my-score.negative { color: #a04030; }
.item-detail { margin-top: 12rpx; display: flex; flex-direction: column; gap: 8rpx; }
.detail-row { display: flex; align-items: center; gap: 12rpx; padding: 6rpx 8rpx; border-radius: 8rpx; }
.detail-row.me { background: rgba(201, 162, 39, 0.12); }
.detail-row.winner .d-role { color: #c9a227; font-weight: bold; }
/* 联网条目：昵称固定宽（超长省略），其余列宽与单机一致——四行列纵向对齐 */
.detail-row.net .d-name {
  width: 176rpx; flex: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
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
