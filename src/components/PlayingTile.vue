<!-- src/components/PlayingTile.vue -->
<template>
  <view class="tile" :class="[sizeClass, { selected, dimmed, faceDown, horizontal: isHorizontal, mirrored }]" @click="$emit('tap')">
    <template v-if="!faceDown">
      <view class="half">
        <view
          v-for="p in halfTop"
          :key="'t' + p.pos"
          class="pip"
          :class="p.red ? 'red' : 'black'"
          :style="pipStyle(p.pos)"
        />
      </view>
      <view class="divider" />
      <view class="half">
        <view
          v-for="p in halfBottom"
          :key="'b' + p.pos"
          class="pip"
          :class="p.red ? 'red' : 'black'"
          :style="pipStyle(p.pos)"
        />
      </view>
    </template>
    <view v-else class="tile-back" />
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { PIP_LAYOUTS, pipColorAt, rotatePipsCCW } from '../core/pips.js'

const props = defineProps({
  tile: { type: Object, default: null }, // { a, b, name, ... }，faceDown 时可为 null
  faceDown: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // sm | md | lg | xs | xxs
  horizontal: { type: Boolean, default: false }, // 横放（宽高互换），默认竖放；由调用方显式指定
  mirrored: { type: Boolean, default: false }, // 上下镜像：b 在下、a 在上（点数对接用，无旋转动画）
})

const isHorizontal = computed(() => props.horizontal)

const sizeClass = computed(() => `tile-${props.size}`)
// 横放时点阵按"竖牌旋转 90°"渲染（二点变上下排、六点变两行三列、对角线换向），保持点数与牌面方位一致
const rotate = (layout) => (isHorizontal.value ? rotatePipsCCW(layout) : layout)
// 上半区点数：未镜像显示 b，镜像后显示 a；下半区相反。
// 1 点、2 点贴半区外边缘（上半区贴顶 *_TOP、下半区贴底 *_BOTTOM，传统骨牌样式）。
// pos 为未旋转的基准位置，face 标明该半区原本代表 a 还是 b（红黑判定基于点阵原始方位，
// 如大天 b 端左列红、a 端右列红），旋转后仅位置变
const layoutKey = (n, half) => {
  if (n === 1) return half === 'top' ? '1_TOP' : '1_BOTTOM'
  if (n === 2) return half === 'top' ? '2_TOP' : '2_BOTTOM'
  return n
}
const halfTop = computed(() => {
  if (!props.tile) return []
  const n = props.mirrored ? props.tile.a : props.tile.b
  return decorate(n, props.mirrored ? 'a' : 'b', PIP_LAYOUTS[layoutKey(n, 'top')])
})
const halfBottom = computed(() => {
  if (!props.tile) return []
  const n = props.mirrored ? props.tile.b : props.tile.a
  return decorate(n, props.mirrored ? 'b' : 'a', PIP_LAYOUTS[layoutKey(n, 'bottom')])
})

function decorate(n, face, baseLayout) {
  const rotated = rotate(baseLayout)
  return rotated.map((pos, i) => ({ pos, red: pipColorAt(props.tile.name, n, face, baseLayout[i]) === 'red' }))
}

function pipStyle(pos) {
  const row = Math.floor(pos / 3)
  const col = pos % 3
  return { gridRow: row + 1, gridColumn: col + 1 }
}
</script>

<style scoped>
.tile {
  width: 96rpx;
  height: 144rpx;
  background: linear-gradient(145deg, #f5f0e1, #d8cfb8);
  border-radius: 12rpx;
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  padding: 8rpx;
  box-sizing: border-box;
  position: relative;
  transition: transform 0.15s, box-shadow 0.15s;
}
.tile-sm { width: 64rpx; height: 96rpx; border-radius: 8rpx; }
.tile-xs { width: 48rpx; height: 72rpx; border-radius: 6rpx; }
.tile-xs .pip { width: 8rpx; height: 8rpx; }
.tile-xxs { width: 36rpx; height: 54rpx; border-radius: 6rpx; }
.tile-xxs .pip { width: 6rpx; height: 6rpx; }
.tile-lg { width: 128rpx; height: 192rpx; }

.tile.selected {
  transform: translateY(-16rpx);
  box-shadow: 0 8rpx 16rpx rgba(0, 0, 0, 0.6), 0 0 0 4rpx #c9a227;
}
.tile.dimmed { opacity: 0.35; }

/* 横放：盒子直接横过来（宽高互换、两半区左右排列），不用 transform 旋转，
   避免旋转溢出与负 margin 补偿，保证与竖牌垂直居中对齐 */
.tile.horizontal { flex-direction: row; }
.tile.horizontal .divider { width: 2rpx; height: auto; align-self: stretch; margin: 10rpx 0; }
.tile-md.horizontal { width: 144rpx; height: 96rpx; }
.tile-sm.horizontal { width: 96rpx; height: 64rpx; }
.tile-xs.horizontal { width: 72rpx; height: 48rpx; }
.tile-xxs.horizontal { width: 54rpx; height: 36rpx; }
.tile-lg.horizontal { width: 192rpx; height: 128rpx; }
/* 镜像（mirrored）通过模板交换上下半区渲染，无 transform，避免与 selected/horizontal 组合冲突 */

.half {
  flex: 1;
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  grid-template-columns: repeat(3, 1fr);
  padding: 6rpx;
}
.divider {
  height: 2rpx;
  background: #b0a685;
  margin: 0 10rpx;
}
.pip {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  align-self: center;
  justify-self: center;
}
.tile-sm .pip { width: 10rpx; height: 10rpx; }
.tile-lg .pip { width: 18rpx; height: 18rpx; }
.pip.red { background: #c0392b; }
.pip.black { background: #1a1a1a; }

.tile-back {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, #1a5c2a, #0d3315);
  border-radius: inherit;
}
</style>
