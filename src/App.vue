<script>
export default {
  onLaunch() {},
}
</script>

<style>
/* 全局牌桌主题：深色木纹色系 + 象牙牌面 */
page,
body {
  background-color: #3a2410;
  color: #f5f0e1;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  /* 固定浅色配色方案：防止系统深色模式（手机浏览器强制反色）把米白牌面反转成深色导致点数看不清 */
  color-scheme: light only;
}

/* 通用按钮 */
.btn-primary {
  background: linear-gradient(180deg, #c9a227, #a5821a);
  color: #fff;
  border-radius: 24rpx;
  font-size: 32rpx;
  padding: 18rpx 64rpx;
  border: none;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.4);
}
.btn-primary[disabled] {
  opacity: 0.5;
}
.btn-secondary {
  background: #5a4a32;
  color: #f5f0e1;
  border-radius: 24rpx;
  font-size: 32rpx;
  padding: 18rpx 64rpx;
  border: none;
}
</style>
