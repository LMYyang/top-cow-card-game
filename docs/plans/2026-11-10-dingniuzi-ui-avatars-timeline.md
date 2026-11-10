# 顶牛子 UI 优化（四家头像 + 桌面出牌时间线）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为顶牛子牌桌补充四家彩色人形剪影头像，并把中央区从"只显示最新一张牌"升级为完整的纵向出牌时间线（含扣牌，游戏中牌背、结算翻开）。

**Architecture:** 两个新纯展示组件（PlayerAvatar / TableTimeline），core 层零改动。PlayerAvatar 内导出 SEAT_COLORS 常量供 TableTimeline 色点复用；TableTimeline 直接消费 `view.tableHistory`，用 `flex-flow: column wrap` 实现纵向牌列自动换列。三个现有组件/页面做接入改造。

**Tech Stack:** uni-app + Vue 3（Composition API）、纯 CSS、Vitest（回归验证）

**工作目录:** `D:\demo\top-cow-card-game`（以下所有相对路径基于此；命令用 Unix bash 语法；文件操作用 Windows 绝对路径）

**设计文档:** `D:\demo\chit-quotationapproval\docs\superpowers\specs\2026-11-10-dingniuzi-ui-avatars-timeline.md`

---

### Task 1: PlayerAvatar 头像组件

**Files:**
- Create: `src/components/PlayerAvatar.vue`

- [ ] **Step 1: 创建 PlayerAvatar.vue**

```vue
<!-- src/components/PlayerAvatar.vue -->
<template>
  <view class="avatar" :class="[sizeClass, colorClass]">
    <view class="head" />
    <view class="body" />
  </view>
</template>

<script>
/** 座位底色表：0=我(金) 1=下家(红) 2=对家(青) 3=上家(紫)。供 TableTimeline 色点复用 */
export const SEAT_COLORS = {
  0: '#c9a227',
  1: '#a04030',
  2: '#3a7a6a',
  3: '#6a4a7a',
}

export default {
  props: {
    seat: { type: Number, required: true },
    size: { type: String, default: 'md' }, // sm | md
  },
  computed: {
    sizeClass() {
      return `avatar-${this.size}`
    },
    colorClass() {
      return Number.isInteger(this.seat) && this.seat in SEAT_COLORS
        ? `seat-${this.seat}`
        : 'seat-unknown'
    },
  },
}
</script>

<style scoped>
.avatar {
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.avatar-md { width: 64rpx; height: 64rpx; }
.avatar-sm { width: 40rpx; height: 40rpx; }

/* 人形剪影：圆头 + 肩部半圆，象牙白 */
.head {
  width: 34%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #f5f0e1;
  margin-bottom: 8%;
}
.body {
  width: 64%;
  height: 34%;
  border-radius: 50% 50% 0 0;
  background: #f5f0e1;
}

.seat-0 { background: #c9a227; }
.seat-1 { background: #a04030; }
.seat-2 { background: #3a7a6a; }
.seat-3 { background: #6a4a7a; }
.seat-unknown { background: #5a4a32; }
</style>
```

注意：此组件用 Options API（非 `<script setup>`）是因为需要具名导出 `SEAT_COLORS`——`<script setup>` 不能具名导出。Vue 3 SFC 允许无 `<script setup>` 的普通 `<script>` 导出默认组件对象 + 具名常量。

- [ ] **Step 2: H5 编译验证**

Run: `cd /d/demo/top-cow-card-game && npm run dev:h5`（后台运行，等 ready 输出）
验证：编译无报错；`curl -s http://localhost:5173/src/components/PlayerAvatar.vue | head -5` 返回 200 与转换后 JS
收尾：`netstat -ano | grep 5173` 找到 PID → `taskkill //F //PID <pid>` 关闭服务

（组件尚无页面使用，编译级验证即可，与 Task 8 PlayingTile 同策略。）

- [ ] **Step 3: 全量测试确认无回归**

Run: `cd /d/demo/top-cow-card-game && npx vitest run`
Expected: 45 passed（5 files）——本任务不碰 core

- [ ] **Step 4: Commit**

```bash
git add src/components/PlayerAvatar.vue && git commit -m "feat(ui): 四色人形剪影头像组件（SEAT_COLORS导出）"
```

---

### Task 2: 头像接入三处（OpponentZone / HandArea / 结算行）

**Files:**
- Modify: `src/components/OpponentZone.vue`
- Modify: `src/components/HandArea.vue`
- Modify: `src/pages/game/game.vue`

- [ ] **Step 1: 改造 OpponentZone.vue（替换文字头像 + 新增 seat prop）**

完整替换为：

```vue
<template>
  <view class="zone" :class="position">
    <PlayerAvatar :seat="seat" />
    <view class="info">
      <text class="name">{{ label }}{{ isLeader ? ' 👑' : '' }}</text>
      <text class="counts">牌 {{ handCount }} · 扣 {{ keptCount }}</text>
    </view>
    <view v-if="lastMove" class="bubble">
      {{ lastMove.discarded ? '扣牌' : '出牌' }}
    </view>
  </view>
</template>

<script setup>
import PlayerAvatar from './PlayerAvatar.vue'

defineProps({
  position: String, // top | left | right
  seat: Number, // 0-3，头像底色
  label: String,
  handCount: Number,
  keptCount: Number,
  isLeader: Boolean,
  lastMove: Object,
})
</script>

<style scoped>
.zone { display: flex; align-items: center; gap: 12rpx; position: relative; }
.zone.left, .zone.right { flex-direction: column; }
.info { display: flex; flex-direction: column; }
.name { font-size: 24rpx; }
.counts { font-size: 20rpx; color: #b0a685; }
.bubble {
  position: absolute; top: -36rpx; right: -8rpx;
  background: #c9a227; color: #fff; font-size: 20rpx;
  padding: 4rpx 12rpx; border-radius: 12rpx;
}
</style>
```

（变更：`.avatar` 元素与样式删除、模板换 PlayerAvatar、import 新增、props 增 `seat: Number`。）

- [ ] **Step 2: 改造 HandArea.vue（手牌区加"我"的头像）**

模板在 `hand-area` 顶部（`hint.warn` 之前）插入头像行：

```vue
<template>
  <view class="hand-area">
    <view class="me-row">
      <PlayerAvatar :seat="0" />
    </view>
    <view v-if="mustDiscard" class="hint warn">无牌可接，请选一张扣下</view>
    <!-- ...其余模板不变... -->
```

完整文件：

```vue
<template>
  <view class="hand-area">
    <view class="me-row">
      <PlayerAvatar :seat="0" />
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
    </view>
    <view class="kept-row" v-if="kept.length">
      <text class="kept-label">扣牌：</text>
      <PlayingTile v-for="t in kept" :key="t.id" :tile="t" size="sm" face-down />
    </view>
    <view class="actions" v-if="myTurn">
      <button class="btn-primary" :disabled="!selectedId || mustDiscard" @click="$emit('confirm-play')">出牌</button>
      <button class="btn-secondary" :disabled="!selectedId || !mustDiscard" @click="$emit('confirm-discard')">扣牌</button>
    </view>
  </view>
</template>

<script setup>
import PlayingTile from './PlayingTile.vue'
import PlayerAvatar from './PlayerAvatar.vue'

defineProps({
  hand: Array,
  kept: Array,
  playableIds: Array,
  myTurn: Boolean,
  mustDiscard: Boolean,
  selectedId: String,
})
defineEmits(['select', 'confirm-play', 'confirm-discard'])
</script>

<style scoped>
.hand-area { display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 16rpx 0; }
.me-row { display: flex; justify-content: flex-start; width: 100%; padding-left: 8rpx; }
.hint.warn { color: #e0a030; font-size: 24rpx; }
.hand { display: flex; gap: 10rpx; justify-content: center; flex-wrap: wrap; }
.kept-row { display: flex; align-items: center; gap: 8rpx; }
.kept-label { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; gap: 20rpx; }
</style>
```

（变更：新增 import PlayerAvatar、`me-row` 行、`.me-row` 样式；其余不动。）

- [ ] **Step 3: 改造 game.vue（三处传 seat + 结算行加头像）**

3a. 三个 OpponentZone 调用加 seat prop（对家=2、上家=3、下家=1）。第 5 行对家：

```html
<OpponentZone position="top" :seat="2" :label="labelOf(2)" :hand-count="opponentBySeat(2).handCount" :kept-count="opponentBySeat(2).keptCount" :is-leader="view.leaderSeat === 2" :last-move="lastMoveOf(2)" />
```

第 9 行上家：`position="left" :seat="3"`，其余属性不变；
第 32 行下家：`position="right" :seat="1"`，其余属性不变。

3b. script 部分 import 增加：

```js
import PlayerAvatar from '../../components/PlayerAvatar.vue'
```

3c. 结算行 `settle-row` 加行首头像（改 flex 对齐，行内文字用 span 包裹分组）：

```html
<view v-for="r in view.result.ranks" :key="r.seat" class="settle-row" :class="{ winner: r.seat === view.result.winner }">
  <PlayerAvatar :seat="r.seat" size="sm" />
  <view class="settle-row-main">
    <text>{{ labelOf(r.seat) }}</text>
    <text>扣 {{ r.points }} 点 · {{ r.role }}</text>
  </view>
  <text class="score">{{ view.result.scores[r.seat] > 0 ? '+' : '' }}{{ view.result.scores[r.seat] }}</text>
</view>
```

样式追加（.settle-row 改为三段对齐）：

```css
.settle-row { display: flex; align-items: center; gap: 16rpx; }
.settle-row-main { flex: 1; display: flex; justify-content: space-between; }
```

（原 `.settle-row` 的 `justify-content: space-between` 移入 `.settle-row-main`，其余 settle-row 属性保留。）

- [ ] **Step 4: H5 手动验证（编译 + 渲染）**

Run: `cd /d/demo/top-cow-card-game && npm run dev:h5`（后台）
用 chrome-devtools MCP 或 headless Chrome 验证：
1. 主菜单两张骨牌正常（不受影响）
2. 开始游戏进入牌桌：上/左/右三个对手区头像分别为青/紫/红底人形剪影
3. 手牌区左上角金色头像
4. 打完一局到结算：四行行首头像为金/红/青/紫 sm 尺寸
关闭 dev server。

- [ ] **Step 5: 全量测试 + Commit**

Run: `npx vitest run` → 45 passed

```bash
git add src/components/OpponentZone.vue src/components/HandArea.vue src/pages/game/game.vue && git commit -m "feat(ui): 四家接入头像（对手区/手牌区/结算行）"
```

---

### Task 3: TableTimeline 桌面出牌时间线组件

**Files:**
- Create: `src/components/TableTimeline.vue`

- [ ] **Step 1: 创建 TableTimeline.vue**

```vue
<!-- src/components/TableTimeline.vue -->
<template>
  <view v-if="flat.length === 0" class="timeline-empty">
    <slot name="empty">等待头牌出牌</slot>
  </view>
  <view v-else class="timeline">
    <view
      v-for="(entry, i) in flat"
      :key="i"
      class="entry"
      :class="{ latest: i === flat.length - 1 }"
    >
      <view class="seat-dot" :style="{ background: seatColor(entry.seat) }" />
      <PlayingTile
        v-for="(t, j) in entry.tiles"
        :key="t.id"
        :tile="entry.isDiscard && !revealed ? null : t"
        :face-down="entry.isDiscard && !revealed"
        size="sm"
      />
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import PlayingTile from './PlayingTile.vue'
import { SEAT_COLORS } from './PlayerAvatar.vue'

const props = defineProps({
  // view.tableHistory：出牌 { seat, tiles:[tile,...] } / 扣牌 { seat, discarded: tile }
  history: { type: Array, default: () => [] },
  // true=结算态，扣牌翻开显示牌面；false=游戏中，扣牌显示牌背
  revealed: { type: Boolean, default: false },
})

/** 扁平化历史：每条 → { seat, tiles:[牌面tile], isDiscard }；扣牌牌面也在 tiles 里（是否露出由 revealed 决定） */
const flat = computed(() =>
  props.history.map((h) =>
    h.discarded
      ? { seat: h.seat, tiles: [h.discarded], isDiscard: true }
      : { seat: h.seat, tiles: h.tiles, isDiscard: false }
  )
)

function seatColor(seat) {
  return SEAT_COLORS[seat] || '#5a4a32'
}
</script>

<style scoped>
/* 纵向牌列 + 自动换列：列高 660rpx 容纳 6 张 sm 牌，超出换右新列 */
.timeline {
  display: flex;
  flex-flow: column wrap;
  align-content: center;
  height: 660rpx;
  gap: 10rpx;
  max-width: 100%;
}
.entry {
  position: relative;
  display: flex;
  gap: 6rpx;
  flex-shrink: 0;
}
/* 座位色点：条目容器左上角，多张牌（红八双出）共享 */
.seat-dot {
  position: absolute;
  top: -4rpx;
  left: -4rpx;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  z-index: 2;
  box-shadow: 0 1rpx 3rpx rgba(0, 0, 0, 0.5);
}
/* 最新一张牌 = 待接牌，金色描边 */
.entry.latest { box-shadow: 0 0 0 3rpx #c9a227; border-radius: 8rpx; }
.timeline-empty { color: #b0a685; font-size: 26rpx; margin: 8rpx 0; }
</style>
```

实现要点说明（实现者需理解，非占位）：
1. **金描边打在 entry 上**而非单张牌——红八双出两张同框时，"最后一颗牌"语义上是最后一个条目整体；spec 3.2 说"扁平化后的最后一张"，在 entry 层加描边对单张情形完全等价、对双张情形语义更清晰
2. **空历史**时渲染 `.timeline-empty`（默认文字"等待头牌出牌"，与 game.vue 旧占位一致），非空时正常时间线
3. `column wrap` + `align-content: center` 实现列满自动换列且整体居中

- [ ] **Step 2: H5 编译验证**

Run: `npm run dev:h5`（后台）→ 编译无报错、模块可转换（`curl http://localhost:5173/src/components/TableTimeline.vue` 返回 200）→ 关闭服务
（组件尚无页面使用，编译级验证；渲染验证在 Task 4 联调。）

- [ ] **Step 3: 全量测试 + Commit**

Run: `npx vitest run` → 45 passed

```bash
git add src/components/TableTimeline.vue && git commit -m "feat(ui): 桌面出牌时间线组件（纵向换列/座位色点/最新牌描边）"
```

---

### Task 4: game.vue 中央区接入时间线 + 联调验证

**Files:**
- Modify: `src/pages/game/game.vue`

- [ ] **Step 1: 中央区替换为 TableTimeline**

1a. script import 增加：

```js
import TableTimeline from '../../components/TableTimeline.vue'
```

1b. PLAYING 分支（原 17-25 行模板）替换：

```html
<template v-else-if="view.state === 'PLAYING'">
  <TableTimeline :history="view.tableHistory" :revealed="false" />
  <view class="turn-hint">
    {{ turnText }}
  </view>
</template>
```

1c. SETTLE 分支（原 26-28 行）替换（结算覆盖层出现前的过渡态，扣牌翻开）：

```html
<template v-else-if="view.state === 'SETTLE'">
  <TableTimeline :history="view.tableHistory" :revealed="true" />
  <view class="turn-hint">本局结束</view>
</template>
```

1d. 样式清理：删除 `.table-tile { margin-bottom: 16rpx; }` 行，并把 `.table-empty` 从该选择器组中移除（占位逻辑已由 TableTimeline 空态接管）。该行变为：

```css
.turn-hint, .settle-brief { color: #b0a685; font-size: 26rpx; margin: 8rpx 0; }
```

注意：PlayingTile 的 import 在 game.vue 中此时已无直接使用（旧 tableTile 渲染是唯一使用点），需一并删除 `import PlayingTile from '../../components/PlayingTile.vue'`。

- [ ] **Step 2: H5 全流程手动回归（必须真实浏览器操作）**

Run: `npm run dev:h5`（后台），用 chrome-devtools MCP（new_page → http://localhost:5173/）或 headless Chrome 逐项验证：
1. 主菜单 → 开始游戏 → 掷骰定头牌 → 骰子动画 → 发牌
2. 头牌（若 AI）出牌后中央时间线出现第一张牌（带座位色点、金描边）；时间线空时显示"等待头牌出牌"
3. 后续每手牌时间线**从上往下增长**，满 6 张换列；最新牌始终金描边
4. 有人扣牌：时间线中出现**绿色牌背**+其座位色点
5. 轮到我时提示正常、出牌扣牌可用
6. 打完一局：结算覆盖层出现前，中央区扣牌**全部翻开**（revealed=true 过渡态）；覆盖层四行行首有头像
7. 再来一局 → 时间线清空（重开新页面实例）；回主菜单正常
8. 控制台无报错
关闭 dev server。

- [ ] **Step 3: 全量测试 + Commit**

Run: `npx vitest run` → 45 passed

```bash
git add src/pages/game/game.vue && git commit -m "feat(ui): 牌桌中央区接入出牌时间线（结算翻开扣牌）"
```

---

### Task 5: 收尾验证（README 不涉及，仅回归）

**Files:** 无新改动（纯验证任务）

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 45 passed（core 零改动，任何失败都说明误改了 core）

- [ ] **Step 2: H5 生产构建**

Run: `npm run build:h5`
Expected: 构建成功，产出 `dist/build/h5`

- [ ] **Step 3: 规格符合性核对**

对照 `D:\demo\chit-quotationapproval\docs\superpowers\specs\2026-11-10-dingniuzi-ui-avatars-timeline.md` 逐条核对：
- §2 头像：四家四色（金红青紫）、md/sm 两尺寸、SEAT_COLORS 具名导出、剪影象牙白
- §2.2 接入：OpponentZone seat prop、HandArea 金头像、结算行 sm 头像
- §3 时间线：纵向换列、最新牌金描边、扣牌游戏中牌背/结算翻开、座位色点、红八双出共享色点、空态文案
- §4 YAGNI：无图片资源、无飞行动画、无滚动、core 零改动

- [ ] **Step 4: 最终 Commit（如有遗漏修复）**

```bash
git status && git log --oneline -6
```

（工作树应为干净状态；如有核对中发现的修复，一并提交 `fix(ui): 规格核对修正`。）

---

## 任务依赖关系

```
Task 1 (PlayerAvatar) → Task 2 (三处接入) → Task 4 (game.vue 联调)
                        Task 3 (TableTimeline) ↗
Task 5 (收尾) ← 全部
```

Task 2 依赖 Task 1（import PlayerAvatar）；Task 3 依赖 Task 1（import SEAT_COLORS）；Task 4 依赖 Task 2+3；Task 5 最后。
