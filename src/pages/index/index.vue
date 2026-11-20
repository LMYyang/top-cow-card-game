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
      <button class="btn-secondary" @click="openSettings">游戏设置</button>
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

    <!-- 历史记录弹框：点统计卡「单机/联网」区域打开 -->
    <view v-if="historyOpen" class="settle-overlay" @click="historyOpen = false">
      <view class="history-modal" @click.stop>
        <view class="modal-header">
          <text class="modal-title" :class="{ net: historyMode === 'net' }">{{ historyMode === 'net' ? '联网对战' : '单机对战' }}</text>
          <text class="modal-close" @click="historyOpen = false">✕</text>
        </view>
        <!-- 联网页签：场次汇总与逐局记录分开查看 -->
        <view v-if="historyMode === 'net'" class="net-tabs">
          <text class="net-tab" :class="{ on: netTab === 'sessions' }" @click="switchNetTab('sessions')">场次积分</text>
          <text class="net-tab" :class="{ on: netTab === 'rounds' }" @click="switchNetTab('rounds')">逐局记录</text>
        </view>
        <!-- 页签一：场次汇总（仅联网）：同房多局按 roomId 归成一场，朋友局终了对账用 -->
        <view v-if="historyMode === 'net' && netTab === 'sessions'" class="history-list session-list">
          <view v-if="netSessions.length === 0" class="history-empty">还没有场次记录</view>
          <view v-for="s in netSessions" :key="s.roomId ?? 'legacy'" class="session-card" @click="toggleExpand('s' + (s.roomId ?? 'legacy'))">
            <view class="session-head">
              <text class="session-title">{{ s.roomId ? `房间 ${s.roomId}` : '早期对局' }}</text>
              <text class="session-rounds">{{ s.rounds }} 局 · {{ formatTime(s.lastTime) }}</text>
              <text class="item-expand">{{ expandedIdx === 's' + (s.roomId ?? 'legacy') ? '收起 ▲' : '展开 ▼' }}</text>
            </view>
            <view v-if="expandedIdx === 's' + (s.roomId ?? 'legacy')" class="session-rows">
              <view v-for="p in s.players" :key="p.seat" class="session-row" :class="{ champ: p.total === s.players[0].total && s.players[0].total > 0 }">
                <text class="session-name">{{ p.name }}</text>
                <text class="session-score" :class="{ negative: p.total < 0 }">{{ p.total > 0 ? '+' : '' }}{{ p.total }}</text>
              </view>
            </view>
          </view>
        </view>
        <!-- 页签二：逐局记录（联网）/ 单机记录（无页签） -->
        <view v-if="historyMode === 'solo' || netTab === 'rounds'" class="history-list">
          <view v-if="modeHistory.length === 0" class="history-empty">还没有对局记录</view>
          <view
            v-for="(h, i) in pagedHistory"
            :key="h.time"
            class="history-item"
            @click="toggleExpand(i)"
          >
            <!-- 点击处理只在父级 .history-item 上，避免事件冒泡触发两次 toggle -->
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
                <view class="d-who">
                  <text class="d-name">{{ labelOf(h, seat) }}</text>
                  <text class="d-role">{{ h.roles[seat] }}</text>
                </view>
                <!-- 算账徽章挂在扣点下方（仅宣告座位行有） -->
                <view class="d-points">
                  <text>扣 {{ h.points[seat] }} 点</text>
                  <text v-if="h.account && h.account.seat === seat" class="d-account" :class="{ fail: !h.account.success }">
                    {{ h.account.type + (h.account.success ? ' ✓' : ' ✗包庄') }}
                  </text>
                </view>
                <text class="d-score" :class="{ negative: h.scores[seat] < 0 }">
                  {{ h.scores[seat] > 0 ? '+' : '' }}{{ h.scores[seat] }} 积分
                </text>
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
// 单机看 dingniuzi_stats（只含单机局），联网从历史条目汇总
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
const historyMode = ref('solo')
const expandedIdx = ref(-1) // -1 = 全部收起

const modeHistory = computed(() =>
  history.value.filter((h) => (historyMode.value === 'net' ? h.mode === 'net' : h.mode !== 'net'))
)

// ---- 联网场次汇总：按 roomId 归场，统计每人总积分 ----
// 老版本条目无 roomId（null）：单独归「早期对局」组，不与新版场次混算。
const netSessions = computed(() => {
  const netEntries = history.value.filter((h) => h.mode === 'net')
  const groups = new Map()
  for (const h of netEntries) {
    const key = h.roomId ?? 'legacy'
    if (!groups.has(key)) groups.set(key, { roomId: h.roomId ?? null, entries: [] })
    groups.get(key).entries.push(h)
  }
  return [...groups.values()]
    .map(({ roomId, entries }) => {
      // 昵称取该场最新一局的 names（座位→人中途可能因掉线重进而变化）
      const bySeat = {}
      for (const h of entries) {
        for (const seat of [0, 1, 2, 3]) {
          totalSeat(bySeat, seat, h.scores?.[seat] || 0)
        }
      }
      const names = entries[0]?.names || {}
      const players = [0, 1, 2, 3]
        .map((seat) => ({ seat, name: names[seat] || `座位${seat}`, total: bySeat[seat] || 0 }))
        .sort((a, b) => b.total - a.total)
      return {
        roomId,
        rounds: entries.length,
        lastTime: entries[0]?.time || 0,
        players,
      }
    })
    .sort((a, b) => b.lastTime - a.lastTime)
})
function totalSeat(map, seat, delta) {
  map[seat] = (map[seat] || 0) + delta
}

/** 打开对应模式的历史弹框（每次打开重置展开与页码） */
function openHistory(mode) {
  historyMode.value = mode
  netTab.value = 'sessions' // 联网默认看场次积分（对账是高频诉求）
  expandedIdx.value = -1
  page.value = 1
  historyOpen.value = true
}

const netTab = ref('sessions')
function switchNetTab(tab) {
  netTab.value = tab
  expandedIdx.value = -1
  page.value = 1
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
/** 条目视角称呼：单机固定四家称呼；联网显示本端记录的昵称快照，缺失时退化为「座位N」 */
const labelOf = (h, seat) => {
  if (h.mode === 'net') return (h.names && h.names[seat]) || `座位${seat}`
  return SEAT_LABELS[seat] || `座位${seat}`
}

function formatTime(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 打完一局返回主菜单时刷新（navigateBack 复用页面实例，setup 不会重跑）。
// backfillNetStats 首次运行时把修复前混进 dingniuzi_stats 的联网局一次性剔除
onShow(() => {
  statsRaw.value = backfillNetStats()
  historyRaw.value = uni.getStorageSync('dingniuzi_history') || []
})

function startGame() {
  uni.navigateTo({ url: '/pages/game/game' })
}

function startOnline() {
  uni.navigateTo({ url: '/pages/lobby/lobby' })
}

function openSettings() {
  uni.navigateTo({ url: '/pages/settings/settings' })
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
/* 单机 | 联网 左右并排 */
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
/* 联网页签：场次积分 / 逐局记录 */
.net-tabs { display: flex; gap: 12rpx; }
.net-tab {
  flex: 1; text-align: center; padding: 12rpx 0; border-radius: 10rpx;
  font-size: 26rpx; color: #b0a685; background: rgba(58, 44, 20, 0.4); border: 2rpx solid #4a3c22;
}
.net-tab.on { color: #c9a227; border-color: #c9a227; background: rgba(201, 162, 39, 0.14); font-weight: bold; }
/* 场次汇总：同房多局一场一卡 */
.session-list { display: flex; flex-direction: column; gap: 12rpx; }
.session-card {
  padding: 16rpx 24rpx; border-radius: 12rpx;
  background: rgba(201, 162, 39, 0.08); border: 2rpx solid #6a5632;
}
.session-head { display: flex; align-items: center; gap: 16rpx; }
.session-title { font-size: 26rpx; font-weight: bold; color: #c9a227; flex: 1; }
.session-rounds { font-size: 22rpx; color: #b0a685; }
.session-rows { margin-top: 12rpx; display: flex; flex-direction: column; gap: 8rpx; }
.session-row { display: flex; align-items: center; justify-content: space-between; padding: 4rpx 8rpx; border-radius: 8rpx; }
.session-row.champ { background: rgba(201, 162, 39, 0.14); }
.session-row.champ .session-name { color: #c9a227; font-weight: bold; }
.session-name { font-size: 24rpx; color: #f5f0e1; }
.session-score { font-size: 26rpx; font-weight: bold; color: #f5f0e1; }
.session-score.negative { color: #a04030; }
.history-empty { text-align: center; color: #b0a685; font-size: 24rpx; padding: 24rpx 0; }
.history-item {
  padding: 16rpx 24rpx; border-radius: 12rpx;
  background: rgba(58, 44, 20, 0.4); border: 2rpx solid #4a3c22;
}
.item-head { display: flex; align-items: center; gap: 16rpx; }
.item-time { font-size: 24rpx; color: #b0a685; flex: 1; }
/* 展开/分数列固定宽+右对齐：各条目纵向对齐 */
.item-expand { font-size: 20rpx; color: #8a7d5c; width: 104rpx; text-align: right; }
.item-my-score { font-size: 28rpx; font-weight: bold; color: #c9a227; width: 88rpx; text-align: right; }
.item-my-score.negative { color: #a04030; }
.item-detail { margin-top: 12rpx; display: flex; flex-direction: column; gap: 8rpx; }
.detail-row { display: flex; align-items: center; gap: 12rpx; padding: 6rpx 8rpx; border-radius: 8rpx; }
.detail-row.me { background: rgba(201, 162, 39, 0.12); }
.detail-row.winner .d-role { color: #c9a227; font-weight: bold; }
.d-who { display: flex; flex-direction: column; gap: 2rpx; width: 120rpx; flex: none; }
.d-name { font-size: 22rpx; color: #f5f0e1; width: 120rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.d-role { font-size: 20rpx; color: #b0a685; }
.d-points { font-size: 22rpx; color: #b0a685; flex: 1; display: flex; flex-direction: column; gap: 4rpx; align-items: center; }
/* 账目徽章：挂在宣告座位扣点下方 */
.d-account {
  font-size: 20rpx; color: #f5f0e1; background: rgba(201, 162, 39, 0.22);
  padding: 2rpx 12rpx; border-radius: 999rpx; white-space: nowrap;
}
.d-account.fail { color: #ffd9c9; background: rgba(160, 64, 48, 0.55); }
.d-score { font-size: 24rpx; font-weight: bold; color: #c9a227; width: 140rpx; text-align: right; }
.d-score.negative { color: #a04030; }
/* 分页 */
.pagination { display: flex; align-items: center; justify-content: center; gap: 24rpx; padding: 16rpx 0; }
.page-btn {
  font-size: 22rpx; padding: 8rpx 28rpx; margin: 0; line-height: 1.4;
  background: #3a2c14; color: #b0a685; border-radius: 10rpx; border: 2rpx solid #5a4a32;
}
.page-btn[disabled] { opacity: 0.4; color: #b0a685; background: #3a2c14; }
.page-info { font-size: 24rpx; color: #b0a685; }
</style>
