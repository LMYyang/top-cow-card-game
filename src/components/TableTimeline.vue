<!-- src/components/TableTimeline.vue -->
<template>
  <view v-if="chain.length" class="timeline">
    <template v-for="(col, ci) in layout" :key="ci">
      <!-- 拐弯箭头：链条排满一列拐进下一列时，在拐角处标出延伸方向（↗ 拐上去 / ↘ 拐下来） -->
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
          <!-- 链端小图标：标出上端/下端开口位置，玩家一眼可辨该往哪头接牌 -->
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
  history: { type: Array, default: () => [] }, // [{ seat, tiles, side, mirrored }] | [{ seat, discarded }]（discarded 扣牌不进时间线）
  // 竖牌固定高度（rpx，对应 PlayingTile size="sm"）；牌多了不缩小、不折叠、不换行，
  // 超出一列高度后像真实牌桌一样"拐弯"进入下一列（蛇形多列），所有牌全尺寸完整可见
  tileH: { type: Number, default: 96 },
  openEnds: { type: Object, default: null }, // { top, bottom } 链两端待接点数；首出前 null
  latestHidden: { type: Boolean, default: false }, // 飞牌动画期间隐藏最新条目（克隆牌落地瞬间才显现）
})

/** 只取出牌条目（扣牌条目不进时间线，各自显示在自己区域旁） */
const playEntries = computed(() => props.history.filter((e) => e.tiles))

/**
 * 双端骨牌链（布局直接取 core 记录的放置信息）：
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
      // side/mirrored 为 core 记录的放置信息（mirrored 是"放置镜像"，非最终渲染镜像）
      const item = { tile, seat: entry.seat, side: entry.side || 'bottom', mirrored: !!entry.mirrored }
      if (entry.side === 'top') top.unshift(item)
      else bottom.push(item)
    }
  }

  return [...top, ...bottom]
})

const VIEW_H = 720  // 单列可用高度约值（rpx），超出一列即拐弯进下一列
const BASE_GAP = 6  // 列内条目间距（rpx，与 .col 的 CSS gap 保持一致）
const TILE_W = 64   // size="sm" 牌宽（rpx）；横牌旋转 90° 后视觉高度 = 牌宽

/** 条目视觉高度：竖牌 = tileH；横牌旋转 90° 后视觉高度 = 牌宽（CSS 已用负 margin 抵消布局盒差值） */
function entryH(item) {
  return item.tile.type === '横牌' ? TILE_W : props.tileH
}

/**
 * 蛇形分列：第 0 列从顶向下排，排满后拐弯进第 1 列从底向上，再拐弯进第 2 列从顶向下……
 * 拐点纵坐标 = 当前列末端边缘，下一列首牌与拐点对齐（与上一列末牌并排衔接，视觉连续）。
 * 每列输出 { dir, yStart, items, h }：dir 延伸方向（down/up）；yStart 为首牌外边缘纵坐标
 * （向下列 = 顶边，向上列 = 底边）；h 为列内容总高（含列内间距）。横竖牌混排按各自视觉高度累计。
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
 * 最新出的牌 id（按出牌历史取最后一条的末张，红八双出取第 2 张），金色描边标记。
 * 不能取 chain 末位：chain 排序为 [...top, ...bottom]，接在上端的新牌 unshift 后
 * 位于数组头部而非末尾，取末位会导致黄圈只出现在下端牌上。
 */
const latestId = computed(() => {
  const entries = playEntries.value
  if (!entries.length) return null
  const tiles = entries[entries.length - 1].tiles
  return tiles[tiles.length - 1].id
})

/**
 * 最终渲染镜像：core 的 mirrored 是"放置镜像"（描述牌以未翻转姿态放不下、需掉头放置），
 * 语义基于"向下延伸 = 上端朝上"。拐进向上列后该语义反转——放置镜像要按列方向取反：
 * down 列：renderMirrored = mirrored；up 列：renderMirrored = !mirrored（头牌/首张除外，
 * 头牌无放置镜像恒为 false）。
 */
function renderMirrored(item, col) {
  if (col.dir === 'up') return !item.mirrored
  return item.mirrored
}

/** 列垂直定位：向下列顶边 = yStart；向上列顶边 = yStart - h（内容悬挂在拐点上方） */
function colStyle(col) {
  return { marginTop: `${col.dir === 'down' ? col.yStart : col.yStart - col.h}rpx` }
}

/** 箭头垂直位置：对齐上一列的末端边缘（拐点），与上一列末牌并排衔接 */
function arrowStyle(prevCol) {
  const yEnd = prevCol.dir === 'down' ? prevCol.yStart + prevCol.h : prevCol.yStart - prevCol.h
  return { marginTop: `${yEnd}rpx` }
}

/** 拐弯箭头符号：新一列向下延伸 ↘（链条拐下来了），向上延伸 ↗（链条拐上去了） */
function arrowGlyph(col) {
  return col.dir === 'down' ? '↘' : '↗'
}

/** 列内按视觉顺序（从上到下）渲染：向上列的链条顺序自底向上，需反转 */
function colItems(col) {
  return col.dir === 'up' ? [...col.items].reverse() : col.items
}

/**
 * 链端小图标定位：
 * - 上端图标挂在链首牌（chain[0]）上：链条正常向下延伸时在其上方（▲）；
 *   链首所在列向上延伸（首牌在列底）时同样显示在其上方，箭头方向始终指离牌面。
 * - 下端图标挂在链尾牌（chain 末位）上：其所在列向下延伸时显示在牌下方（▼），
 *   所在列向上延伸（拐弯后链尾在列顶）时显示在牌上方（▲）。
 */
const topEndId = computed(() => (chain.value.length ? chain.value[0].tile.id : null))
const bottomEndId = computed(() => (chain.value.length ? chain.value[chain.value.length - 1].tile.id : null))

/** 下端图标是否显示在牌上方：链尾牌所在列向上延伸时为 true */
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
  flex-direction: row;     /* 蛇形多列横向铺开 */
  justify-content: center; /* 列组整体水平居中 */
  align-items: flex-start; /* 每列纵向位置由 colStyle 的 margin-top 精确控制 */
  max-height: 100%;
  /* 顶部/底部各预留链端"▲ 上端"/"下端 ▼"小图标（绝对定位悬出牌面 30rpx）的空间：
     上端图标挂在链首牌顶部，若列内容顶到容器边，图标会被裁或被按钮盖住 */
  padding-top: 36rpx;
  padding-bottom: 36rpx;
}
.col {
  display: flex;
  flex-direction: column;
  align-items: center; /* 条目（色点+牌）在列内水平居中：色点+间隙宽度恒定，牌面中心对齐同一条垂直中线，横牌不再与竖牌左对齐 */
  gap: 6rpx;      /* 列内条目间距，与 BASE_GAP 一致 */
  flex-shrink: 0; /* 列宽不压缩，牌面永不缩小 */
}
.entry {
  display: flex;
  align-items: center; /* 色点与牌垂直居中同行，不占上下空间 */
  gap: 6rpx;
  flex-shrink: 0;
  position: relative; /* 作为链端小图标（绝对定位）的基准 */
}
/* 最新一张牌（链底端最后一张）金色描边 */
.entry.latest {
  box-shadow: 0 0 0 3rpx #c9a227;
  border-radius: 8rpx;
}
/* 飞牌动画期间隐藏最新条目：克隆牌飞抵后才显现（visibility 保留占位，锚点坐标可测） */
.entry.latest.hidden {
  visibility: hidden;
}
/* 拐弯箭头：位于两列之间，对齐拐点处，指示链条蛇形延伸方向 */
.turn-arrow {
  flex-shrink: 0;
  align-self: flex-start;
  color: #c9a227;
  font-size: 32rpx;
  font-weight: bold;
  line-height: 1;
  margin: 0 2rpx;
}
/* 座位色点：流内位于牌左侧（不绝对定位，不遮挡牌面、不占纵向空间） */
.seat-dot {
  flex-shrink: 0;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
}
/* 链端小图标：标出上端/下端开口位置。完全悬在牌面外侧、水平居中，不遮挡牌面点数 */
.end-badge {
  position: absolute;
  left: 50%;
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
/* 上端图标：悬在牌面正上方外侧 */
.end-badge.above {
  top: -30rpx;
  bottom: auto;
}
/* 横牌已改为盒子横放（宽高互换），无旋转溢出，天然与竖牌垂直居中 */
.timeline-empty { color: #b0a685; font-size: 26rpx; }
</style>
