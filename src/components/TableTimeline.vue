<template>
  <view v-if="chain.length" class="timeline">
    <template v-for="(col, ci) in layout" :key="ci">
      <!-- 拐弯箭头：标出链条拐进下一列的延伸方向 -->
      <view v-if="ci > 0" class="turn-arrow" :style="arrowStyle(layout[ci - 1])">{{ arrowGlyph(col) }}</view>
      <view class="col" :style="colStyle(col)">
        <view
          v-for="item in colItems(col)"
          :key="item.tile.id"
          class="entry"
          :class="{ latest: item.tile.id === latestId, hidden: latestHidden && item.tile.id === latestId }"
          :id="item.tile.id === latestId ? 'latest-entry-anchor' : null"
        >
          <view class="seat-dot" :style="{ background: dotColor(item.seat) }" />
          <PlayingTile
            :tile="item.tile"
            size="sm"
            :horizontal="item.tile.type === '横牌'"
            :mirrored="renderMirrored(item, col)"
          />
          <!-- 链端小图标：标出上端/下端开口位置 -->
          <view v-if="item.tile.id === topEndId" class="end-badge above">▲ 上端</view>
          <view v-if="item.tile.id === bottomEndId" class="end-badge" :class="bottomEndAbove ? 'above' : 'below'">
            {{ bottomEndAbove ? '▲ 下端' : '下端 ▼' }}
          </view>
        </view>      </view>
    </template>
  </view>
  <view v-else class="timeline-empty">等待头牌出牌</view>
</template>

<script setup>
import { computed } from 'vue'
import PlayingTile from './PlayingTile.vue'
import { SEAT_COLORS } from './PlayerAvatar.vue'

const props = defineProps({
  history: { type: Array, default: () => [] }, // [{ seat, tiles, side, mirrored }] | [{ seat, discarded }]
  // 竖牌固定高度；牌超出一列高度后像真实牌桌一样"拐弯"进下一列（蛇形多列）
  tileH: { type: Number, default: 96 },
  openEnds: { type: Object, default: null }, // 链两端待接点数；首出前 null
  latestHidden: { type: Boolean, default: false }, // 飞牌动画期间隐藏最新条目
})

/** 只取出牌条目（扣牌条目各自显示在自己区域旁） */
const playEntries = computed(() => props.history.filter((e) => e.tiles))

/**
 * 双端骨牌链（布局直接取 core 记录的放置信息）：
 * side==='top' 的牌 unshift 到链顶，其余按序追加链底；
 * mirrored 只是渲染时上下对调使点数对接，不改变 a/b 数据。
 */
const chain = computed(() => {
  const bottom = []
  const top = []

  for (const entry of playEntries.value) {
    const tiles = entry.tiles // 红八双出为 2 张
    for (const tile of tiles) {
      const item = { tile, seat: entry.seat, side: entry.side || 'bottom', mirrored: !!entry.mirrored }
      if (entry.side === 'top') top.unshift(item)
      else bottom.push(item)
    }
  }

  return [...top, ...bottom]
})

const VIEW_H = 720  // 单列可用高度（rpx），超出一列即拐弯
const BASE_GAP = 6  // 列内条目间距（rpx，与 .col 的 gap 一致）
const TILE_W = 64   // size="sm" 牌宽（rpx）

/** 条目视觉高度：横牌旋转 90° 后视觉高度 = 牌宽 */
function entryH(item) {
  return item.tile.type === '横牌' ? TILE_W : props.tileH
}

/**
 * 蛇形分列：第 0 列从顶向下排，排满后拐进第 1 列从底向上，交替往复。
 * 下一列首牌与上一列末牌并排衔接（视觉连续）。
 */
const layout = computed(() => {
  const cols = []
  let y = 0        // 当前拐点纵坐标（新列首牌的对齐基准）
  let dir = 'down' // 当前列延伸方向
  let cur = null
  for (const item of chain.value) {
    const th = entryH(item)
    if (cur) {
      const add = BASE_GAP + th
      const overflow = dir === 'down' ? y + cur.h + add > VIEW_H : y - cur.h - add < 0
      if (!overflow) {
        cur.items.push(item)
        cur.h += add
        continue
      }
      y = dir === 'down' ? y + cur.h : y - cur.h // 拐点 = 当前列末端边缘
      dir = dir === 'down' ? 'up' : 'down'
    }
    cur = { dir, yStart: y, items: [item], h: th }
    cols.push(cur)
  }
  return cols
})

/**
 * 最新出的牌 id（最后一条的末张，红八双出取第 2 张），金色描边标记。
 * 不能取 chain 末位：接在上端的新牌 unshift 后位于数组头部而非末尾。
 */
const latestId = computed(() => {
  const entries = playEntries.value
  if (!entries.length) return null
  const tiles = entries[entries.length - 1].tiles
  return tiles[tiles.length - 1].id
})

/**
 * 最终渲染镜像：core 的 mirrored 是"放置镜像"（语义基于向下延伸 = 上端朝上），
 * 拐进向上列后语义反转——up 列取反；头牌无放置镜像恒为 false。
 */
function renderMirrored(item, col) {
  if (col.dir === 'up') return !item.mirrored
  return item.mirrored
}

/** 列垂直定位：向上列内容悬挂在拐点上方 */
function colStyle(col) {
  return { marginTop: `${col.dir === 'down' ? col.yStart : col.yStart - col.h}rpx` }
}

/** 箭头对齐上一列末端边缘（拐点） */
function arrowStyle(prevCol) {
  const yEnd = prevCol.dir === 'down' ? prevCol.yStart + prevCol.h : prevCol.yStart - prevCol.h
  return { marginTop: `${yEnd}rpx` }
}

/** 拐弯箭头符号：向下 ↘ / 向上 ↗ */
function arrowGlyph(col) {
  return col.dir === 'down' ? '↘' : '↗'
}

/** 列内按视觉顺序渲染：向上列需反转 */
function colItems(col) {
  return col.dir === 'up' ? [...col.items].reverse() : col.items
}

/** 链端图标：上端挂链首牌上方；下端挂链尾牌，其所在列向上延伸时显示在牌上方 */
const topEndId = computed(() => (chain.value.length ? chain.value[0].tile.id : null))
const bottomEndId = computed(() => (chain.value.length ? chain.value[chain.value.length - 1].tile.id : null))

/** 下端图标是否显示在牌上方 */
const bottomEndAbove = computed(() => {
  if (!chain.value.length) return false
  const lastItem = chain.value[chain.value.length - 1]
  const col = layout.value.find((c) => c.items.some((i) => i.tile.id === lastItem.tile.id))
  return col ? col.dir === 'up' : false
})

function dotColor(seat) {
  return SEAT_COLORS[seat] || '#5a4a32'
}
</script>

<style scoped>
.timeline {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  max-height: 100%;
  /* 上下各预留链端小图标（悬出牌面 30rpx）的空间，避免被裁或被按钮盖住 */
  padding-top: 36rpx;
  padding-bottom: 36rpx;
}
.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  flex-shrink: 0; /* 列宽不压缩，牌面永不缩小 */
}
.entry {
  display: flex;
  align-items: center;
  gap: 6rpx;
  flex-shrink: 0;
  position: relative; /* 链端小图标的定位基准 */
}
/* 最新一张牌金色描边 */
.entry.latest {
  box-shadow: 0 0 0 3rpx #c9a227;
  border-radius: 8rpx;
}
/* 飞牌动画期间隐藏最新条目（visibility 保留占位，锚点坐标可测） */
.entry.latest.hidden {
  visibility: hidden;
}
/* 拐弯箭头 */
.turn-arrow {
  flex-shrink: 0;
  align-self: flex-start;
  color: #c9a227;
  font-size: 32rpx;
  font-weight: bold;
  line-height: 1;
  margin: 0 2rpx;
}
/* 座位色点：位于牌左侧 */
.seat-dot {
  flex-shrink: 0;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
}
/* 链端小图标：右偏 22rpx 抵消圆点+间隙使徽章与牌面水平居中 */
.end-badge {
  position: absolute;
  left: calc(50% + 11rpx);
  transform: translateX(-50%);
  bottom: -30rpx;
  background: #c9a227;
  color: #fff;
  font-size: 16rpx;
  line-height: 1;
  padding: 3rpx 8rpx;
  border-radius: 8rpx;
  white-space: nowrap;
  z-index: 1;
}
/* 上端图标：悬在牌面正上方 */
.end-badge.above {
  top: -30rpx;
  bottom: auto;
}
.timeline-empty { color: #b0a685; font-size: 26rpx; }
</style>
