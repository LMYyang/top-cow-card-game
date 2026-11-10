# 顶牛子 UI 优化设计：四家头像 + 桌面出牌时间线

**日期**: 2026-11-10
**状态**: 已确认（用户逐项批准）
**项目路径**: `D:\demo\top-cow-card-game`
**前置文档**: `2026-11-10-dingniuzi-game-design.md`（一期主设计，本文档为其 UI 增量）

---

## 1. 需求概述

| # | 需求 | 用户决策 |
|---|------|----------|
| 1 | 四家都要有默认头像（含"我"） | 人形剪影 + 四色区分（纯 CSS，无图片资源） |
| 2 | 桌面已出的牌全部展示、纵向排列 | 纵向牌列 + 自动换列（方案 A）；扣牌也显示；游戏中显示牌背，结算时翻开 |

## 2. 头像设计（PlayerAvatar）

### 2.1 新组件 `src/components/PlayerAvatar.vue`

纯 CSS 人形剪影：圆形头 + 肩部半圆，居中于圆底内。

**Props:**
- `seat: Number`（0-3，必填）——决定底色
- `size: String`（默认 `'md'`，可选 `'sm'`）——md 为 64rpx（对手区/我的手牌区），sm 为 40rpx（时间线色点用不到头像，sm 备用于结算行）

**座位色表（组件内导出常量 `SEAT_COLORS`，供时间线色点复用；Vue SFC 中从 `<script>` 块具名导出常量）：**

| seat | 标签 | 底色 | 语义 |
|------|------|------|------|
| 0 | 我 | `#c9a227` 金 | 主色 |
| 1 | 下家 | `#a04030` 红 | |
| 2 | 对家 | `#3a7a6a` 青 | |
| 3 | 上家 | `#6a4a7a` 紫 | |

剪影颜色为象牙白 `#f5f0e1`（与全局文字色一致）。非法 seat 回退灰色 `#5a4a32`（防御分支，实际不触发）。

### 2.2 接入点

1. **`OpponentZone.vue`**：现有文字头像（`label.slice(0,1)`）替换为 `<PlayerAvatar :seat="seat" />`；新增 prop `seat: Number`（必填），`game.vue` 三处调用分别传 `:seat="2" / 3 / 1`
2. **`HandArea.vue`**：手牌区左上角加"我"的金色头像——`hand-area` 顶部新增一行：左侧 PlayerAvatar(seat 0)，右侧现有内容。扣牌行上方、手牌上方皆可，取"手牌行上方左对齐"（与对手区头像位置视觉对称）
3. **结算覆盖层（`game.vue`）**：`settle-row` 行首加 `<PlayerAvatar :seat="r.seat" size="sm" />`，行布局改 flex 对齐

## 3. 桌面出牌时间线（TableTimeline）

### 3.1 新组件 `src/components/TableTimeline.vue`

**Props:**
- `history: Array` —— 即 `view.tableHistory`，条目两种形态：
  - 出牌：`{ seat, tiles: [tile, ...] }`（头牌双出红八时 2 张）
  - 扣牌：`{ seat, discarded: tile }`
- `revealed: Boolean` —— false=游戏中（扣牌显示牌背）；true=结算（扣牌翻开显示牌面）。由 `game.vue` 传 `view.state === 'SETTLE'`

**数据来源**: 纯展示组件，直接消费 `tableHistory`，**core 层零改动**。

### 3.2 布局

- 容器：`flex-flow: column wrap`，固定高度约 660rpx（容纳 6 张 sm 牌 + 间距），宽度随列数自适应，居中
- 时间顺序：**从上往下**，最早在上、最新在下；一列满 6 张后自动换右新列（`column wrap` 的自然填充顺序即满足）
- 每张牌用 `PlayingTile size="sm"`（64×96rpx）
- **最新一张牌金色描边**（box-shadow `0 0 0 3rpx #c9a227`），即全桌最后一条历史记录的最后一颗牌——它就是待接牌（扁平化后的最后一张；红八双出时为第二张红八）
- **扣牌**：`revealed=false` 时 `PlayingTile face-down`（绿色牌背，与手牌扣牌行一致）；`revealed=true` 时显示真实牌面（点数可见，对应"结算翻开"）
- **座位色点**：每张牌左上角 16rpx 圆点，颜色取 `SEAT_COLORS[entry.seat]`，标明出/扣牌者；同一历史条目多张牌（红八双出）并排渲染、共享同一色点（色点绝对定位于条目容器而非单张牌）

### 3.3 `game.vue` 中央区改动

- `PLAYING` 分支：现有"最新一张 tableTile"渲染替换为 `<TableTimeline :history="view.tableHistory" :revealed="false" />`；`tableHistory` 为空时显示现有"等待头牌出牌"占位（TableTimeline 内部处理空态）
- `SETTLE` 分支：中央区改为 `<TableTimeline :history="view.tableHistory" :revealed="true" />`（结算覆盖层出现前的过渡态，扣牌全部翻开）
- `turn-hint` 提示文字保留在时间线下方
- 中央区当前 `.table-tile { margin-bottom: 16rpx }` 样式随旧渲染一并移除，由 TableTimeline 自带样式接管

**注**：原设计需求"待接端点提示"（设计文档 4.2 的"待接：五"）一期未实现，本设计同样不实现，保持范围最小。

### 3.4 空间核算（极限 24 张牌）

- 一列 6 张 sm 牌 × 660rpx 列高；24 张 ≈ 4 列 ×（64+10）rpx ≈ 300rpx 宽——中央区（屏宽 750rpx 减左右上/下家区）可容纳，无需滚动
- 同屏至少能看到最新一列 + 上一列，最新牌（金描边）永远在可视区域

## 4. 不做的事（YAGNI）

- 不加图片头像资源（纯 CSS 剪影）
- 不加出牌飞行动画（本期需求外）
- 不做时间线滚动（自动换列已覆盖极限场景）
- 不改 core 层任何导出与逻辑

## 5. 测试策略

| 层 | 方式 |
|----|------|
| core | 零改动 → 现有 45 个单测必须保持全绿 |
| PlayerAvatar / TableTimeline | 纯展示组件，无新单测（与 PlayingTile 同策略） |
| H5 手动回归 | 掷骰 → 出牌时间线逐张增长且最新牌金描边 → 扣牌显示牌背+座位色点 → 打完一局 → 结算覆盖层四行带头像、中央扣牌翻开 → 再来一局时间线清空 |

## 6. 涉及文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/components/PlayerAvatar.vue` |
| 新建 | `src/components/TableTimeline.vue` |
| 修改 | `src/components/OpponentZone.vue`（avatar 替换 + seat prop） |
| 修改 | `src/components/HandArea.vue`（加"我"的头像） |
| 修改 | `src/pages/game/game.vue`（传 seat、中央区接 TableTimeline、结算行加头像） |
