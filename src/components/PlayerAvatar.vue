<template>
  <view class="avatar" :class="sizeClass" :style="{ background: bgColor }">
    <view class="head" />
    <view class="body" />
  </view>
</template>

<script>
// 座位色表：颜色绑定绝对座位，视图按本人旋转时颜色不随位置漂移
export const SEAT_COLORS = {
  0: '#c9a227', // 座位 0（金）
  1: '#a04030', // 座位 1（红）
  2: '#3a7a6a', // 座位 2（青）
  3: '#6a4a7a', // 座位 3（紫）
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
