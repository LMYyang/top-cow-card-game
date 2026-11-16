# 顶牛子「算账（封账）」与游戏设置页 — 设计文档

日期：2026-11-16
状态：已与用户确认（四种账触发条件、结算口径、交互细节、特效、AI 不宣告、拦账本期不做）

## 1. 背景与目标

按河北/京津民间顶牛子玩法，增加「算账」功能与游戏设置页：

1. 新增设置页：算账总开关 + 四种账种（红账/幺账/三二账/五账）分别勾选；勾上的账种在对局中可宣告、可结算
2. 算账是**出牌选端动作本身**：出一张竖牌把链端封死到某点数，使对手无牌可接只能扣牌
3. 结算：算账成功分数翻倍；算账失败宣告者包庄
4. 任何人宣告时全端播放「算账」大字拍桌特效
5. 单机（useGame）与联网（rooms.js + useNetGame）双模式实现

成功标准：

1. 设置页可开启/关闭算账、勾选账种，单机本地生效、联网房主设置全房生效
2. 四种账按规则触发：触发牌出对端时 UI 弹「算账/不算账」按钮
3. 宣告经 core/服务端复核，客户端无法伪造非法宣告
4. 结算按成功翻倍/失败包庄记分，结算卡与历史记录展示算账结果
5. 不开启算账时游戏行为与现状完全一致

## 2. 规则定义（用户口述确认）

### 2.1 统一封账模型

四种账共享同一结构：**出一张竖牌后，链的两个新端点都被冻结**——某端点 P 冻结指「所有含 P 的竖牌都已在链上」，此后只有 P 的对子（横牌）能接且对子不改变端点，链条死锁，各家只能扣牌 drain。

| 账种 | 冻结后端点 | 触发牌（全为竖牌） | 说明 |
|---|---|---|---|
| 红账 | 4, 4 | 红十(4\|6) ×2 | 链上已有另一张红十、两端为 4 和 6 时，接 6 端（暴露 4）即封账；接 4 端不算账 |
| 幺账 | 1, 1 | 幺三(1\|3)、幺五(1\|5)、幺六(1\|6) 共 6 张 | 其余 5 张带 1 竖牌已在链上、两端为 1 和 P 时，接 P 端（暴露 1）；接 1 端不算账 |
| 五账 | 5, 5 | 虎头(5\|6)、幺五(1\|5) 共 4 张 | 其余 3 张带 5 竖牌已在链上、两端为 5 和 P 时，接 P 端（暴露 5）；接 5 端不算账 |
| 三二账 | 2, 3（或 1, 2） | 幺三(1\|3)、三六(3\|6)、二六(2\|6) 共 4 张 | 其余 3 张已在链上；与前三账不同：一端已堵死，手里**有其他可接牌却选这张**出出去即算账（选端为几何强制唯一解，无选择权） |

推论（由模型自动保证）：

- 横牌（红八/地幺/大五/二板/长三/大天/红十以外的对子）永不触发算账——算账只能由竖牌触发
- 红八（4|4）不是红账触发牌（用户明确纠正）
- 头牌首出（链未开）不可能宣告
- 一局最多一次宣告（冻结后其他账种的竖牌再也接不上链）
- 「桌面上已存在 N 张」的前提被冻结条件自动蕴含，无需单独枚举

### 2.2 宣告交互

- 选中手牌后，若按 2.1 判定存在宣告项：
  - **红账/幺账/五账**：「上端/下端」按钮**替换为**「算账」「不算账」——算账 = 接封账端；不算账 = 接另一端照常出牌
  - **三二账**：手里还有其他可接牌时，弹「算账」「不算账」——算账 = 出这张；不算账 = **收回这张牌重新选**（1A）
  - 双冻结特例（如手里幺五、同时满足幺账与五账前提）：显示「幺账」「五账」「不算账」三个按钮
- 宣告成功后 `view.account = { seat, type }`，全端播特效

### 2.3 结算（用户确认口径）

宣告者 = 算账座位，结算时比较扣点：

- **成功**：宣告者扣点**严格**全场最小（平点即失败）→ 全体翻倍：赢家 +12，大庄 -6，二庄 -4，小庄 -2
- **失败**：有人扣点 ≤ 宣告者 → 宣告者包庄：宣告者 **-12**，赢家 **+12**，另两输家 0（宣告者一人承担双倍输分赔给赢家）
- 连续局掷骰者 = 上局赢家（既有规则），与账无关

### 2.4 AI

- AI **不宣告**算账（用户确认）：AI 出牌不传 declare，其无意打出的封账牌只是普通出牌
- AI 被动遵守冻结后的接牌规则（接不上只能扣，对子可接仍可接），无额外逻辑

### 2.5 拦账（本期不做）

用户明确：不允许活扣牌（现有「不能扣活牌」规则不变），拦账逻辑等四种账实现后再考虑。本设计不含拦账。

## 3. 各层改动

### 3.1 配置数据结构

```js
// src/core/settings.js（新）
export const DEFAULT_SETTINGS = { enabled: false, red: true, yao: true, erSan: true, wu: true }
export function normalizeSettings(raw) // 缺省补齐 + 类型纠正（非法值回退默认）
```

### 3.2 core（src/core/rules.js + src/core/game.js）

**rules.js** 新增纯函数（单机 UI、联网 UI、服务端校验三处共用）：

```js
/**
 * 判定「这张牌接某端」是否构成算账宣告项。
 * @param chainTiles 链上全部已出的牌（tableHistory 中 tiles 展开即可）
 * @returns {{ type: '红账'|'幺账'|'五账'|'三二账', side: 'bottom'|'top' }[]} 可宣告项（0-2 个）
 */
export function declarationFor(tile, openEnds, chainTiles, hand, settings)
```

判定逻辑：对每个可接端模拟新 openEnds → 检查两端是否都被冻结（该端点 P 的所有竖牌已在链上）→ 映射冻结端组合到账种 → 过滤 settings 未勾选/未启用的账种。三二账追加条件：`hand` 中除该牌外还有其他可接牌（playableTilesEnds 非空）。

**game.js**：

- `createGame(rng, rollerSeat, settings = DEFAULT_SETTINGS)`：注入配置，`g.settings`、`g.account = null`
- `play(g, seat, tileIds, side, declare = false)`：`declare=true` 时用 `declarationFor` 复核（tile/side 匹配、账种启用、g.account 为空），不构成宣告返回 `{ ok: false, reason }`；通过则 `g.account = { seat, type }`
- `viewOf` 输出增加 `account`、`settings`（settings 仅暴露 enabled/四账种布尔）
- `settle(players, leaderSeat, account)`：按 2.3 记分，result 增加 `account: { seat, type, success } | null`

### 3.3 单机（src/composables/useGame.js）

- `useGame()` 读取 `uni.getStorageSync('dingniuzi_settings')`（normalizeSettings）注入 `createGame`
- `myPlay(tileId, side, declare)` 透传 declare
- 宣告成功后（`view.account` 出现且 fx 未播过）点亮 `fx.accountSplash = { seat, type }`，game.vue 据此播特效

### 3.4 联网服务端（server/rooms.js）

- 房间设置：`Room.settings`（normalizeSettings 默认）；新增动作 `room.setSettings { settings }`——仅房主、仅 WAITING 阶段可改，成功后随 `pushRoomState` 广播（`roomState()` 输出带 `settings`）；`beginRound` 把 `room.settings` 注入 `createGame`
- `gameAction` 的 `game.play` 分支：payload 增加 `declare`，透传给 core `play`（core 复核失败按既有 ILLEGAL 回执）
- 宣告随 `game.state` 的 `view.account` 自然下发，无新消息类型

### 3.5 联网客户端（src/composables/useNetGame.js）

- 新增 `setRoomSettings(settings)`：发 `room.setSettings`，失败 toast
- `view.account` 变化驱动 `fx.accountSplash`（同 3.3）；重连快照重放同一 account 时用「上次已播值」比较防重放
- `room.state` 的 `settings` 存入本地 state 供房间页只读展示

### 3.6 设置页（新页面 src/pages/settings/settings.vue）

- 注册进 `src/pages.json`
- 内容：算账总开关 + 四个账种复选框（红账/幺账/三二账/五账），各带一句触发说明；总开关关闭时复选框禁用置灰；首次打开（enabled=false→true）默认四项全选
- mode 区分（onLoad query）：
  - `mode=solo`（缺省）：主菜单「游戏设置」进入；读写 `dingniuzi_settings`，保存即生效（下一局注入）
  - `mode=net`：房间页房主「对局设置」进入；进入拉当前 `room.settings`，保存发 `room.setSettings`；非房主进入为只读（按钮隐藏，开关禁用）
- 风格：深木色卡片 + 金色标题，与历史弹框/结算弹窗一致

### 3.7 UI（src/pages + src/components）

- **主菜单 index.vue**：按钮区加「游戏设置」（btn-secondary），跳 `/pages/settings/settings`
- **房间页 room.vue**：房主在开始按钮上方显示「对局设置」（WAITING 阶段）；进入设置页 net 模式；非房主显示当前设置只读摘要（如「算账：红/幺/三二/五」或「不玩算账」）
- **HandArea.vue**：选牌确认区新增宣告按钮组（`declarationOptions` prop 驱动），替换上端/下端按钮；「不算账」按 2.2 语义（红/幺/五 = 接另一端出；三二 = 回收重选）
- **game.vue**：
  - 「算账」拍桌特效：`fx.accountSplash` 触发，屏幕中央大字「算账」（金色，约 8 倍 → 1 倍加速飞入），落定瞬间牌桌 shake + 金色冲击闪光，约 1s 消散；副标题「红账 · 下家」（账种 + 宣告者相对称呼）；pointer-events 穿透不挡操作
  - 结算卡：宣告行展示「红账 · 算账成功 ×2」/「三二账 · 算账失败（包庄）」
  - turnText：宣告后可加一行提示「下家宣告了红账」（增强项，可随实现取舍）

### 3.8 历史记录

- 单机/联网历史条目增加 `account: { seat, type, success }`（随 result 落 storage），展开行显示在角色旁（如「红账 ✓」/「红账 ✗ 包庄」）

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| declare=true 但不构成宣告（端不对/账种未启用/已有人宣告） | core 返回 `{ ok: false, reason: '...' }`；联网按 ILLEGAL 回执 toast |
| 设置页保存非法值 | normalizeSettings 兜底回退 |
| 非房主/对局中改房间设置 | 服务端返回 `{ error: { code: 'NOT_HOST' / 'ROOM_STARTED' } }` |
| 重连快照重放旧 account | 客户端比较已播值防重放，不重播特效 |
| 未开启算账的对局 | declarationFor 恒空、UI 不出宣告按钮、结算与现状一致 |

## 5. 测试策略

- **rules.test.js**：`declarationFor` 全枚举——四账种正例；反向端不算账；前提不满足（缺一张链上牌）不算账；横牌不触发；未勾选账种不返回；三二账手里无可接牌时不返回；双冻结（幺五）返回两项
- **game.test.js**：declare 复核（非法宣告拒绝、重复宣告拒绝）；结算三口径（成功翻倍 +12/-6/-4/-2、失败 -12/+12/0/0、平点算失败）；未宣告对局结算与旧版一致
- **server-rooms.test.js**：room.setSettings 房主成功/非房主拒绝/对局中拒绝；settings 随 room.state 广播；beginRound 注入；game.play 带 declare 服务端复核
- **UI 手测**：红账弹按钮替换、三二账收回重选、特效播放、结算卡展示、设置页双模式读写

## 6. 明确不做（YAGNI）

- 拦账（等四种账稳定后单独立项）
- AI 宣告算账
- 对局中途改设置（仅 WAITING 可改，单机下一局生效）
- 每账种单独分值配置
- 多个宣告并存（模型上不可能：一局最多一次宣告）
