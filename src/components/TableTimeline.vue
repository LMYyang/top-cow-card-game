<!-- src/components/TableTimeline.vue -->
<template>
  <view v-if="chain.length" class="timeline">
    <view
      v-for="(item, i) in chain"
      :key="item.tile.id"
      class="entry"
      :class="{ latest: i === chain.length - 1 }"
      :style="entryStyle(i)"
    >
      <view class="seat-dot" :style="{ background: dotColor(item.seat) }" />
      <PlayingTile
        :tile="item.tile"
        size="sm"
        :horizontal="item.tile.type === '横牌'"
        :mirrored="item.mirrored"
      />
    </view>
  </view>
  <view v-else class="timeline-empty">等待头牌出牌</view>
</template>

<script setup>
import { computed } from 'vue'
import PlayingTile from './PlayingTile.vue'
import { SEAT_COLORS } from './PlayerAvatar.vue'

const props = defineProps({
  history: { type: Array, default: () => [] }, // [{ seat, tiles, side, mirrored }] | [{ seat, discarded }]（discarded 扣牌不进时间线）
  // 牌固定高度（rpx，对应 PlayingTile size="sm"）；牌多了不缩小，靠相互遮盖压缩列高
  tileH: { type: Number, default: 96 },
})

/** 只取出牌条目（扣牌条目不进时间线，各自显示在自己区域旁） */
const playEntries = computed(() => props.history.filter((e) => e.tiles))

/**
 * 双端骨牌链（纵向"蛇"），布局直接取 core 记录的放置信息：
 * - 头牌首出成链的第一颗：上端 b、下端 a（未镜像）。
 * - 每条历史条目带 side（'bottom'|'top'）与 mirrored（镜像渲染标记），
 *   side==='top' 的牌 unshift 到链顶，其余按序追加链底。
 * - 首出条目（core 中 side='bottom'）自然成为链底第一颗，语义一致。
 * - mirrored 不改变牌本身的 a/b 数据，只是渲染时上下对调使点数对接。
 */
const chain = computed(() => {
  const bottom = [] // 链底→链中：[{ tile, seat, mirrored }]
  const top = []    // 链顶→链中（unshift 堆放）：[{ tile, seat, mirrored }]

  for (const entry of playEntries.value) {
    const tiles = entry.tiles // 红八双出为 2 张，按顺序展开；其余 1 张
    for (const tile of tiles) {
      const item = { tile, seat: entry.seat, mirrored: !!entry.mirrored }
      if (entry.side === 'top') top.unshift(item)
      else bottom.push(item)
    }
  }

  return [...top, ...bottom]
})

/**
 * 超出可视高度时收紧条目间距（负 margin 让后出的牌遮盖先出的牌下沿），
 * 牌面尺寸始终不变；链两端的牌（链顶第 1 张与链底最新一张）始终全露不折叠，
 * 只压缩中间牌的间距；中间牌最多遮到保留 25% 牌高。
 */
const VIEW_H = 720       // 中央区域可用高度约值（rpx）
const BASE_GAP = 6       // 正常条目间距（rpx）
const MIN_VISIBLE = 0.25 // 遮盖时中间每张牌至少露出 25% 高度

function entryStyle(i) {
  const n = chain.value.length
  if (n <= 1 || i === 0) return null
  // 端牌全露：第 2 张紧随链顶（不遮链顶）、最后一张紧随倒数第二张（不遮链底），
  // 这两个间隙固定为正常间距
  if (i === 1 || i === n - 1) return { marginTop: `${BASE_GAP}rpx` }
  const totalH = props.tileH + (n - 1) * (props.tileH + BASE_GAP)
  if (totalH <= VIEW_H) return { marginTop: `${BASE_GAP}rpx` } // 放得下，保持正常间距
  // 可压缩预算：扣除两端固定占用（链顶 + 链顶间隙 + 链底 + 链底间隙）
  const fixedH = 3 * props.tileH + 2 * BASE_GAP
  const minStep = Math.round(props.tileH * MIN_VISIBLE)
  const step = Math.max(minStep, Math.min(BASE_GAP, Math.round((VIEW_H - fixedH) / (n - 3))))
  return { marginTop: `${step - props.tileH}rpx` } // 负值 → 后牌遮住前牌下沿
}

function dotColor(seat) {
  return SEAT_COLORS[seat] || '#5a4a32'
}
</script>

<style scoped>
.timeline {
  display: flex;
  flex-flow: column nowrap; /* 从上往下单列排列，不换行，整体居中（首张牌即居中，每出一牌整体重居中） */
  align-items: center;
  justify-content: center;
  max-height: 100%;
  /* 间距完全由 entryStyle 的动态 margin 控制（正常 6rpx / 超列负 margin 遮盖），故不设 gap */
}
.entry {
  position: relative;
  display: flex;
  gap: 4rpx;
}
/* 最新一张牌（链底端最后一张）金色描边，且盖在最上层 */
.entry.latest {
  box-shadow: 0 0 0 3rpx #c9a227;
  border-radius: 8rpx;
  z-index: 1;
}
/* 座位色点：绝对定位于条目容器左上角，多张牌共享同一色点 */
.seat-dot {
  position: absolute;
  top: -4rpx;
  left: -4rpx;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  z-index: 2;
}
.timeline-empty { color: #b0a685; font-size: 26rpx; }
</style>
