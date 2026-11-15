<template>
  <view class="hand-area">
    <view class="hand-header">
      <view class="avatar-wrap">
        <PlayerAvatar :seat="seat" size="md" />
        <slot /> <!-- 亮牌阶段等提示：显示在头像正上方 -->
      </view>
      <view class="header-info">
        <text class="name">我{{ isLeader ? ' 👑' : '' }}</text>
        <text class="counts">牌 {{ hand.length }} · 扣 {{ kept.length }}</text>
      </view>
    </view>
    <view v-if="mustDiscard" class="hint warn">无牌可接，请选一张扣下</view>
    <view class="hand">
      <view v-for="t in hand" :key="t.id" class="tile-wrap">
        <!-- 双端都可接时：两个小端按钮悬浮在选中牌的正上方，点任一端直接出牌 -->
        <view v-if="bothEnds && t.id === selectedId" class="side-float">
          <button class="btn-side" @click="$emit('side-pick', { id: t.id, side: 'top' })">上端</button>
          <button class="btn-side" @click="$emit('side-pick', { id: t.id, side: 'bottom' })">下端</button>
        </view>
        <PlayingTile
          :tile="t"
          :selected="t.id === selectedId"
          :dimmed="myTurn && playableIds.length > 0 && !playableIds.includes(t.id)"
          @click="onTileTap(t.id)"
        />
      </view>
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
      <view class="btn-row">
        <!-- 该牌上下端都可接且两端点数不同：必须先点"上端/下端"选端（点选端即出牌），出牌按钮禁用防误触默认端 -->
        <button class="btn-primary" :disabled="!selectedId || mustDiscard || bothEnds" @click="$emit('confirm-play')">出牌</button>
        <button class="btn-secondary" :disabled="!selectedId || !mustDiscard" @click="$emit('confirm-discard')">扣牌</button>
      </view>
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
  // 我的绝对座位：头像颜色与其他玩家视角中"我"的颜色一致（颜色绑定座位而非位置）
  seat: { type: Number, default: 0 },
  playableIds: Array,
  myTurn: Boolean,
  mustDiscard: Boolean,
  selectedId: String,
  side: { type: String, default: 'bottom' }, // 我选的放置端 bottom | top
  openEnds: { type: Object, default: null }, // 链两端待接点 { top, bottom }，首出前 null
  revealKept: { type: Boolean, default: false }, // 局末亮牌：翻开我扣的牌面
  isLeader: { type: Boolean, default: false }, // 我是头牌（与各家 OpponentZone 的 👑 标记一致）
})
const emit = defineEmits(['select', 'confirm-play', 'confirm-discard', 'choose-side', 'side-pick'])

/** 双击快速出牌：仅当该牌无需选端（唯一可接端 / 链两端同点 / 首出）时生效，需选端时仍走"选中→选端→出牌"流程 */
let lastTapId = null
let lastTapTime = 0
function onTileTap(id) {
  const now = Date.now()
  const isDoubleTap = lastTapId === id && now - lastTapTime < 350
  lastTapId = id
  lastTapTime = now
  emit('select', id)
  if (isDoubleTap && props.myTurn && !props.mustDiscard && !bothEnds.value) {
    emit('confirm-play')
  }
}

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

defineExpose({ bothEnds })
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
.actions { display: flex; gap: 20rpx; align-items: center; justify-content: center; flex-wrap: nowrap; white-space: nowrap; }
/* 出牌/扣牌按钮行：uni-app button 默认 display:block 会竖着堆叠，必须显式开 flex 才能并排同一行 */
.btn-row { display: flex; gap: 20rpx; align-items: center; justify-content: center; flex-wrap: nowrap; }
/* 出牌/扣牌按钮收窄内边距，保证窄屏（手机竖屏）下两个按钮也稳在同一行不换行 */
.actions .btn-primary, .actions .btn-secondary { padding: 18rpx 48rpx; }
/* 每张手牌的包裹层：作为悬浮端按钮（side-float）的绝对定位基准 */
.tile-wrap { position: relative; }
/* 悬浮在选中牌正上方的两个端按钮：加大到易点的尺寸（约 72rpx 高的拇指按钮），
   再向上偏移（约一张牌高），完全不遮牌面。按钮间距拉开，减少连点误触 */
.side-float {
  position: absolute;
  left: 50%; top: -128rpx;
  transform: translateX(-50%);
  display: flex; gap: 28rpx;
  z-index: 2;
}
.btn-side {
  font-size: 30rpx; font-weight: bold; padding: 22rpx 44rpx; margin: 0; line-height: 1.2;
  min-width: 152rpx;
  background: #3a2c14; color: #f5f0e1; border-radius: 14rpx; border: 3rpx solid #8a7040;
  box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.45);
}
.btn-side.active { background: #c9a227; color: #fff; border-color: #c9a227; }
</style>
