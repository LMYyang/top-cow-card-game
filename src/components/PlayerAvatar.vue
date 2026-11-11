<!-- src/components/PlayerAvatar.vue -->
<template>
  <view class="avatar" :class="sizeClass" :style="{ background: bgColor }">
    <view class="head" />
    <view class="body" />
  </view>
</template>

<script>
// 座位色表：供本组件与 TableTimeline 色点复用
export const SEAT_COLORS = {
  0: '#c9a227', // 我（金）
  1: '#a04030', // 下家（红）
  2: '#3a7a6a', // 对家（青）
  3: '#6a4a7a', // 上家（紫）
}

export default {
  name: 'PlayerAvatar',
  props: {
    seat: { type: Number, required: true },
    size: { type: String, default: 'md' }, // md | sm
  },
  computed: {
    sizeClass() {
      return `avatar-${this.size}`
    },
    bgColor() {
      // 非法 seat 回退灰（防御分支，正常不触发）
      return SEAT_COLORS[this.seat] || '#5a4a32'
    },
  },
}
</script>

<style scoped>
.avatar {
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}
.avatar-md { width: 64rpx; height: 64rpx; }
.avatar-sm { width: 40rpx; height: 40rpx; }

/* 人形剪影：圆形头 + 肩部半圆，象牙白 */
.head {
  width: 36%;
  height: 36%;
  border-radius: 50%;
  background: #f5f0e1;
  margin-bottom: 6%;
}
.body {
  width: 64%;
  height: 30%;
  border-radius: 50% 50% 0 0;
  background: #f5f0e1;
}
.avatar-sm .head { margin-bottom: 4%; }
</style>
