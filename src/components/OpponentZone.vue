<template>
  <view class="zone" :class="position">
    <view class="profile">
      <PlayerAvatar :seat="seat" />
      <view class="info">
        <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
        <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
      </view>
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
.zone.top { justify-content: center; } /* 对家内容在顶部区域水平居中 */
/* 亮牌阶段换行后行数变多，给纵向布局的左右家额外底部空间，避免牌面底部被裁 */
.zone.left, .zone.right { padding-bottom: 8rpx; }
/* 头像与文字始终同行（头像+名字/牌数一组），左右家纵向排列时也保持水平居中 */
.profile { display: flex; align-items: center; gap: 10rpx; position: relative; }
.info { display: flex; flex-direction: column; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
/* 扣牌与"我"的扣牌同为 sm（64×96rpx）；左右家每行最多 3 张（3×64+2×4=200，280 会排下 4 张），其余换行 */
.kept-row { display: flex; gap: 4rpx; align-items: center; flex-wrap: wrap; justify-content: center; max-width: 280rpx; }
.zone.left .kept-row, .zone.right .kept-row { max-width: 200rpx; }
.zone.left .kept-row { order: 3; }
.bubble {
  position: absolute;
  background: #c9a227; color: #fff; font-size: 20rpx;
  padding: 4rpx 12rpx; border-radius: 12rpx;
}
/* 对家：气泡在头像正下方，相对头像区水平居中、紧贴底边 */
.zone.top .bubble { top: 100%; left: 50%; transform: translateX(-50%); margin-top: -6rpx; }
/* 上下家（左右家）：扣牌牌背在下方会挡住气泡，改为头像正上方 */
.zone.left .bubble, .zone.right .bubble {
  bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: -6rpx;
}
</style>
