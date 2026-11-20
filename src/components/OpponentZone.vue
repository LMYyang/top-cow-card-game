<template>
  <view class="zone" :class="position">
    <view class="profile">
      <!-- 对家横排；左右家竖排，收窄两侧宽度给中央牌桌 -->
      <template v-if="position === 'top'">
        <PlayerAvatar :seat="seat" />
        <view class="info">
          <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
          <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
        </view>
      </template>
      <template v-else>
        <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
        <PlayerAvatar :seat="seat" />
        <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
      </template>
      <view v-if="lastMove" class="bubble">
        {{ lastMove.discarded ? '扣牌' : '出牌' }}
      </view>
    </view>
    <view v-if="keptTiles.length" class="kept-row">
      <PlayingTile
        v-for="t in keptTiles"
        :key="t.id"
        :tile="revealKept ? t : null"
        size="sm"
        :face-down="!revealKept"
      />
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import PlayerAvatar from './PlayerAvatar.vue'
import PlayingTile from './PlayingTile.vue'

const props = defineProps({
  position: String, // top | left | right
  seat: { type: Number, required: true },
  label: String,
  handCount: Number,
  keptCount: Number,
  isLeader: Boolean,
  lastMove: Object,
  discardHistory: { type: Array, default: () => [] }, // [{ seat, discarded }]，过滤出本座位扣的牌
  revealKept: { type: Boolean, default: false }, // 局末亮牌：翻开扣的牌面
})

/** 本座位扣的牌（仅牌背展示，不亮明细） */
const keptTiles = computed(() =>
  props.discardHistory.filter((e) => e.seat === props.seat).map((e) => e.discarded)
)
</script>

<style scoped>
.zone { display: flex; align-items: center; gap: 12rpx; position: relative; }
.zone.left, .zone.right { flex-direction: column; justify-content: center; }
.zone.top { justify-content: center; }
/* 亮牌阶段行数变多，给左右家额外底部空间避免牌面被裁 */
.zone.left, .zone.right { padding-bottom: 8rpx; }
.profile { display: flex; align-items: center; gap: 10rpx; position: relative; }
.info { display: flex; flex-direction: column; }
.zone.left .profile, .zone.right .profile { flex-direction: column; gap: 4rpx; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
/* 左右家每行最多 2 张，其余换行 */
.kept-row { display: flex; gap: 4rpx; align-items: center; flex-wrap: wrap; justify-content: center; max-width: 280rpx; }
.zone.left .kept-row, .zone.right .kept-row { max-width: 132rpx; }
.zone.left .kept-row { order: 3; }
.bubble {
  position: absolute;
  background: #c9a227; color: #fff; font-size: 20rpx;
  padding: 4rpx 12rpx; border-radius: 12rpx;
}
/* 对家：气泡在头像正下方 */
.zone.top .bubble { top: 100%; left: 50%; transform: translateX(-50%); margin-top: -6rpx; }
/* 左右家：气泡悬在整组上方 */
.zone.left .bubble, .zone.right .bubble {
  bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 6rpx;
}
</style>
