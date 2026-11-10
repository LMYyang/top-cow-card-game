<template>
  <view class="zone" :class="position">
    <view class="avatar">{{ label.slice(0, 1) }}</view>
    <view class="info">
      <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
      <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
    </view>
    <view v-if="lastMove" class="bubble">
      {{ lastMove.discarded ? '扣牌' : '出牌' }}
    </view>
  </view>
</template>

<script setup>
defineProps({
  position: String, // top | left | right
  label: String,
  handCount: Number,
  keptCount: Number,
  isLeader: Boolean,
  lastMove: Object,
})
</script>

<style scoped>
.zone { display: flex; align-items: center; gap: 12rpx; position: relative; }
.zone.left, .zone.right { flex-direction: column; }
.avatar {
  width: 64rpx; height: 64rpx; border-radius: 50%;
  background: #5a4a32; color: #f5f0e1;
  display: flex; align-items: center; justify-content: center; font-size: 28rpx;
}
.info { display: flex; flex-direction: column; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
.bubble {
  position: absolute; top: -36rpx; right: -8rpx;
  background: #c9a227; color: #fff; font-size: 20rpx;
  padding: 4rpx 12rpx; border-radius: 12rpx;
}
</style>
