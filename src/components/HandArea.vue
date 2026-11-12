<template>
  <view class="hand-area">
    <view class="hand-header">
      <view class="avatar-wrap">
        <PlayerAvatar :seat="0" size="md" />
        <slot /> <!-- 亮牌阶段等提示：显示在头像正上方 -->
      </view>
      <view class="header-info">
        <text class="name">我</text>
        <text class="counts">牌 {{ hand.length }} · 扣 {{ kept.length }}</text>
      </view>
    </view>
    <view v-if="mustDiscard" class="hint warn">无牌可接，请选一张扣下</view>
    <view class="hand">
      <PlayingTile
        v-for="t in hand"
        :key="t.id"
        :tile="t"
        :selected="t.id === selectedId"
        :dimmed="myTurn && playableIds.length > 0 && !playableIds.includes(t.id)"
        @click="$emit('select', t.id)"
      />
      <!-- 扣牌与手牌同一行（不单独占行）：不挤压下方出牌/扣牌按钮空间 -->
      <template v-if="kept.length">
        <text class="kept-label">扣牌：</text>
        <PlayingTile
          v-for="t in kept"
          :key="t.id"
          :tile="revealKept ? t : null"
          size="sm"
          :face-down="!revealKept"
        />
      </template>
    </view>
    <view class="actions" v-if="myTurn">
      <view v-if="bothEnds" class="side-picker">
        <text class="side-label">放置端：</text>
        <button
          v-for="opt in sideOptions"
          :key="opt.side"
          class="btn-side"
          :class="{ active: side === opt.side }"
          @click="$emit('choose-side', opt.side)"
        >{{ opt.side === 'top' ? '上端' : '下端' }}</button>
      </view>
      <button class="btn-primary" :disabled="!selectedId || mustDiscard" @click="$emit('confirm-play')">出牌</button>
      <button class="btn-secondary" :disabled="!selectedId || !mustDiscard" @click="$emit('confirm-discard')">扣牌</button>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import PlayingTile from './PlayingTile.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { placeSides } from '../core/rules.js'

const props = defineProps({
  hand: Array,
  kept: Array,
  playableIds: Array,
  myTurn: Boolean,
  mustDiscard: Boolean,
  selectedId: String,
  side: { type: String, default: 'bottom' }, // 我选的放置端 bottom | top
  openEnds: { type: Object, default: null }, // 链两端待接点 { top, bottom }，首出前 null
  revealKept: { type: Boolean, default: false }, // 局末亮牌：翻开我扣的牌面
})
defineEmits(['select', 'confirm-play', 'confirm-discard', 'choose-side'])

const selectedTile = computed(() =>
  props.selectedId ? (props.hand || []).find((x) => x.id === props.selectedId) || null : null
)

/**
 * 选中的牌可放置端选项：首出前为 []（无选择器）；可接时为 placeSides 结果（0/1/2 项）。
 * 1 项 = 只有一端可接，不显示选择器（出牌时按唯一端自动放置）；2 项 = 两端都可接，显示选择器。
 */
const sideOptions = computed(() => {
  if (!props.myTurn || !selectedTile.value || !props.openEnds) return []
  const options = placeSides(selectedTile.value, props.openEnds)
  // 链两端待接点数相同（如 3|3）：上下端无差异，不显示选择器，出牌固定放下端
  if (options.length === 2 && props.openEnds.top === props.openEnds.bottom) return []
  return options
})
const bothEnds = computed(() => sideOptions.value.length === 2)
</script>

<style scoped>
.hand-area { display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 16rpx 0; }
.hand-header { width: 100%; display: flex; justify-content: center; align-items: center; gap: 12rpx; }
/* 头像包裹层：作为 slot 提示（如"点击屏幕任意处继续"）的绝对定位基准 */
.avatar-wrap { position: relative; }
.header-info { display: flex; flex-direction: column; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
.hint.warn { color: #e0a030; font-size: 24rpx; }
.hand { display: flex; gap: 10rpx; justify-content: center; align-items: center; flex-wrap: wrap; }
.kept-label { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; gap: 20rpx; align-items: center; flex-wrap: wrap; justify-content: center; }
.side-picker { display: flex; align-items: center; gap: 8rpx; }
.side-fixed { display: flex; align-items: center; }
.side-label { font-size: 22rpx; color: #b0a685; }
.btn-side {
  font-size: 22rpx; padding: 6rpx 20rpx; margin: 0;
  background: #3a2c14; color: #b0a685; border-radius: 10rpx; border: 2rpx solid #5a4a32;
}
.btn-side.active { background: #c9a227; color: #fff; border-color: #c9a227; }
</style>
