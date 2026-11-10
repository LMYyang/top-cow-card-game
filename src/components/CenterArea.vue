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
}
</style>
