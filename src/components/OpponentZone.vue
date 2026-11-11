<template>
  <view class="zone" :class="position">
    <view class="profile">
      <PlayerAvatar :seat="seat" />
      <view class="info">
        <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
        <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
      </view>
    </view>
    <view v-if="keptTiles.length" class="kept-row">
      <PlayingTile v-for="t in keptTiles" :key="t.id" :tile="null" size="xs" face-down />
    </view>
    <view v-if="lastMove" class="bubble">
      {{ lastMove.discarded ? '扣牌' : '出牌' }}
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
})

/** 本座位扣的牌（仅牌背展示，不亮明细） */
const keptTiles = computed(() =>
  props.discardHistory.filter((e) => e.seat === props.seat).map((e) => e.discarded)
)
</script>

<style scoped>
.zone { display: flex; align-items: center; gap: 12rpx; position: relative; }
.zone.left, .zone.right { flex-direction: column; justify-content: center; }
.zone.top { justify-content: center; } /* 对家内容在顶部区域水平居中 */
/* 头像与文字始终同行（头像+名字/牌数一组），左右家纵向排列时也保持水平居中 */
.profile { display: flex; align-items: center; gap: 10rpx; }
.info { display: flex; flex-direction: column; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
/* 扣牌牌背：位于信息区右侧 */
.kept-row { display: flex; gap: 4rpx; align-items: center; }
.zone.left .kept-row { order: 3; }
.bubble {
  position: absolute; top: -36rpx; right: -8rpx;
  background: #c9a227; color: #fff; font-size: 20rpx;
  padding: 4rpx 12rpx; border-radius: 12rpx;
}
.zone.top .bubble { top: -36rpx; }
.zone.left .bubble, .zone.right .bubble { top: -36rpx; right: auto; left: 50%; transform: translateX(-50%); }
</style>
