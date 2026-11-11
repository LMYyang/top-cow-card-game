<template>
  <view class="center">
    <slot />
  </view>
</template>

<style scoped>
.center {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  min-width: 0;
  overflow-x: auto; /* 蛇形多列超宽时横向滚动兜底，牌面不缩小 */
}
</style>
