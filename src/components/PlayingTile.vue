<template>
  <view class="tile" :class="[sizeClass, skinCls, { selected, dimmed, faceDown, horizontal: isHorizontal, mirrored }]" @click="$emit('tap')">
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
import { loadSkin, skinClass } from '../core/tileSkins.js'

const props = defineProps({
  tile: { type: Object, default: null }, // { a, b, name, ... }，faceDown 时可为 null
  faceDown: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // sm | md | lg | xs | xxs
  horizontal: { type: Boolean, default: false }, // 横放（宽高互换），由调用方显式指定
  mirrored: { type: Boolean, default: false }, // 上下镜像：b 在下、a 在上（点数对接用）
  skin: { type: String, default: '' }, // 皮肤 id 覆盖（设置页预览用）；空 = 读本地设置
})

// 牌面皮肤：默认读本地设置（模块级缓存；显式传 skin prop 时优先，预览即时切换不落缓存）
let skinCache = null
const skinCls = computed(() => skinClass(props.skin || (skinCache ??= loadSkin())))

const isHorizontal = computed(() => props.horizontal)

const sizeClass = computed(() => `tile-${props.size}`)
// 横放时点阵按"竖牌旋转 90°"渲染，保持点数与牌面方位一致
const rotate = (layout) => (isHorizontal.value ? rotatePipsCCW(layout) : layout)
// 上半区点数：未镜像显示 b，镜像后显示 a；下半区相反。
// 1/2 点贴半区外边缘（传统骨牌样式）。红黑判定基于点阵原始方位，旋转后仅位置变
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

/* 横放：盒子直接横过来，不用 transform 旋转，保证与竖牌垂直居中对齐 */
.tile.horizontal { flex-direction: row; }
.tile.horizontal .divider { width: 2rpx; height: auto; align-self: stretch; margin: 10rpx 0; }
.tile-md.horizontal { width: 144rpx; height: 96rpx; }
.tile-sm.horizontal { width: 96rpx; height: 64rpx; }
.tile-xs.horizontal { width: 72rpx; height: 48rpx; }
.tile-xxs.horizontal { width: 54rpx; height: 36rpx; }
.tile-lg.horizontal { width: 192rpx; height: 128rpx; }
/* 镜像通过模板交换上下半区渲染，无 transform，避免与 selected/horizontal 组合冲突 */

.half {
  flex: 1;
  /* min-*:auto（内容最小尺寸）会把小尺寸牌的半区撑到内容高溢出牌盒；置 0 后严格按 flex 均分 */
  min-height: 0;
  min-width: 0;
  display: grid;
  /* minmax(0,1fr) 强制轨道均分：裸 1fr 轨道有 min-content 最小尺寸，小尺寸牌的点会撑大轨道使点位偏移 */
  grid-template-rows: repeat(3, minmax(0, 1fr));
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

/* 皮肤主题：默认 classic（无附加类时即此样式）；以下按 skin-* 类覆盖材质/点色/牌背 */

/* ---- 暗夜墨玉：墨黑玉面、浅色分隔线、点色反转（红更亮、黑变玉白） ---- */
.tile.skin-night {
  background: linear-gradient(145deg, #2b2b33, #16161c);
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.65), inset 0 0 0 1rpx rgba(255, 255, 255, 0.14);
}
.skin-night .divider { background: #55505e; }
.skin-night .pip.red { background: #e35d4f; }
.skin-night .pip.black { background: #e8e4da; }
.skin-night .tile-back { background: linear-gradient(145deg, #4a4458, #2c2738); }

/* ---- 原木手作：木色牌面、深棕分隔、深棕点 ---- */
.tile.skin-wood {
  background: linear-gradient(145deg, #d9b98c, #b98f5a);
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.5), inset 0 0 0 1rpx rgba(120, 72, 24, 0.35);
}
.skin-wood .divider { background: #8a5a28; }
.skin-wood .pip.red { background: #b03020; }
.skin-wood .pip.black { background: #4a2c10; }
.skin-wood .tile-back { background: linear-gradient(145deg, #a06a30, #6e4518); }

/* ---- 青花瓷韵：青白瓷面、青花点、红点如釉里红 ---- */
.tile.skin-azure {
  background: linear-gradient(145deg, #eef4f6, #cfe0e6);
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.5), inset 0 0 0 1rpx rgba(58, 110, 140, 0.4);
}
.skin-azure .divider { background: #7fa8bc; }
.skin-azure .pip.red { background: #b53a4a; }
.skin-azure .pip.black { background: #2a5a7a; }
.skin-azure .tile-back { background: linear-gradient(145deg, #3a6e8c, #1e465c); }

/* ---- 糖果亮色：高饱和明快配色、加粗大点 ---- */
.tile.skin-candy {
  background: linear-gradient(145deg, #fffdf2, #ffe9b8);
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.45), inset 0 0 0 2rpx #ff9a3c;
}
.skin-candy .divider { background: #ff9a3c; }
/* 描边用 border-box 画在点的固定尺寸内（默认 content-box 会被边框撑大） */
.skin-candy .pip { box-sizing: border-box; border: 1rpx solid rgba(0, 0, 0, 0.25); }
.skin-candy .pip.red { background: #e6402a; }
.skin-candy .pip.black { background: #2244c8; }
.skin-candy .tile-back { background: linear-gradient(145deg, #ff9a3c, #e05a20); }

/* ---- 樱花物语：樱粉瓷面、玫瑰金分隔、绯粉点（红）与暖棕点（黑）；装饰只留在牌背 ---- */
.tile.skin-sakura {
  background: linear-gradient(145deg, #f8d0de, #ecafc6);
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.45), inset 0 0 0 1rpx rgba(190, 80, 120, 0.5);
}
.skin-sakura .divider { background: #c97d9b; }
.skin-sakura .pip.red { background: #cc4d75; }
.skin-sakura .pip.black { background: #7a4a58; }
.skin-sakura .tile-back { background: linear-gradient(145deg, #e07a9c, #a84466); }
/* 牌背居中小爱心：两块圆顶矩形绕内下角 ±45° 旋转拼成心形 */
.skin-sakura .tile-back::before,
.skin-sakura .tile-back::after {
  content: '';
  position: absolute;
  top: 60%;
  width: 14rpx;
  height: 22rpx;
  margin-top: -22rpx;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 14rpx 14rpx 0 0;
}
.skin-sakura .tile-back::before {
  left: 50%;
  transform: rotate(-45deg);
  transform-origin: 0 100%;
}
.skin-sakura .tile-back::after {
  left: 50%;
  margin-left: -14rpx;
  transform: rotate(45deg);
  transform-origin: 100% 100%;
}

/* ---- 经典骨牌（skin-classic）：默认样式即经典款，显式类名便于预览定位 ---- */
.tile.skin-classic { }

.tile-back {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, #1a5c2a, #0d3315);
  border-radius: inherit;
}
</style>
