<!-- src/components/PlayingTile.vue -->
<template>
  <view class="tile" :class="[sizeClass, { selected, dimmed, faceDown }]" @click="$emit('tap')">
    <template v-if="!faceDown">
      <view class="half">
        <view
          v-for="pos in layoutB"
          :key="'b' + pos"
          class="pip"
          :class="colorB"
          :style="pipStyle(pos)"
        />
      </view>
      <view class="divider" />
      <view class="half">
        <view
          v-for="pos in layoutA"
          :key="'a' + pos"
          class="pip"
          :class="colorA"
          :style="pipStyle(pos)"
        />
      </view>
    </template>
    <view v-else class="tile-back" />
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { PIP_LAYOUTS, pipColor } from '../core/pips.js'

const props = defineProps({
  tile: { type: Object, default: null }, // { a, b, name, ... }，faceDown 时可为 null
  faceDown: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // sm | md | lg
})

const sizeClass = computed(() => `tile-${props.size}`)
const layoutA = computed(() => (props.tile ? PIP_LAYOUTS[props.tile.a] : []))
const layoutB = computed(() => (props.tile ? PIP_LAYOUTS[props.tile.b] : []))
const colorA = computed(() => (props.tile ? pipColor(props.tile.a) : ''))
const colorB = computed(() => (props.tile ? pipColor(props.tile.b) : ''))

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
.tile-lg { width: 128rpx; height: 192rpx; }

.tile.selected {
  transform: translateY(-16rpx);
  box-shadow: 0 8rpx 16rpx rgba(0, 0, 0, 0.6), 0 0 0 4rpx #c9a227;
}
.tile.dimmed { opacity: 0.35; }

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
