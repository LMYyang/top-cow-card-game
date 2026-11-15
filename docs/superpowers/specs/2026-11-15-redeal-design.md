# 顶牛子「申请重新发牌」— 设计文档

日期：2026-11-15
状态：已与用户确认（触发条件、申请即重发无需他人同意、申请人打骰）

## 1. 背景与目标

按顶牛子传统规则，摸起牌后若手牌满足特定牌型，玩家可申请重新摸牌，且**由申请人打骰**重新定头牌摸牌。本设计为单机（useGame）与联网（rooms.js + useNetGame）双模式同时实现该功能。

成功标准：

1. 手牌满足条件时，玩家在出牌前可申请重新发牌，重发后由申请人掷骰定头牌
2. 不满足条件的申请被拒绝（core 拒绝 + UI 隐藏按钮）
3. 首张牌落桌后申请窗口关闭
4. 单机 AI 与联网托管/AI 座位同样遵守规则
5. 现有结算、历史记录、断线重连行为不受影响

## 2. 规则定义

### 2.1 触发条件（canRedeal）

满足其一即可申请：

- **两红八无红十**：手牌恰好包含两张红八（4|4），且不含任何红十（4|6）
- **六张横牌**：手牌 6 张全部为横牌（两端点数相同）

### 2.2 申请窗口

- 状态为 `PLAYING` 且 `tableHistory.length === 0`（发牌完成、头牌首出前）
- 每人每局限申请 1 次（`redealUsed` 记录，重发后新牌仍满足条件时可再次申请——由"每局每人 1 次"约束防死循环）

### 2.3 重发语义

1. 四家手牌、扣牌区清空（`kept` 同步清空——本局尚未开始出牌，不应有扣牌，防御性清理），桌面链、历史清空
2. `rollerSeat` 改为申请人座位（申请人打骰）
3. 状态回 `ROLLING`，走既有掷骰编排（真人点击掷骰 / AI 自动掷）重新定头牌、重新发牌
4. 广播重发事实（申请人座位），各端提示「X 申请重新发牌」

## 3. 各层改动

### 3.1 core（src/core/rules.js + src/core/game.js）

**rules.js** 新增：

```js
/** 是否满足「申请重新发牌」牌型：两红八无红十，或六张全是横牌 */
export function canRedeal(hand)
```

**game.js**：

- `createGame` 增加 `redealUsed: new Set()` 字段
- 新增动作：

```js
/** 申请重新发牌。校验状态/窗口/牌型/每人一次；通过则重置牌局并由申请人掷骰 */
export function redeal(g, seat)  // → { ok, reason? }
```

- `viewOf` 输出增加 `redealUsed: [...g.redealUsed]`（客户端判断按钮显隐与禁用）

### 3.2 单机（src/composables/useGame.js）

- 新增导出 `canRedealNow`（computed：我满足牌型、窗口内、未用过）与 `redeal()` 动作
- **AI 自动申请**：发牌完成（`rollDice` 成功）后检查四家 AI 手牌；若某 AI 满足条件且**我不满足**，延时 1.2s 该 AI 自动申请（我满足时优先让给我，避免抢走我的一次机会后 UI 困惑）。toast 提示「X 申请重新发牌」
- **重发后自动掷骰**：抽公共函数 `maybeAutoRoll()`（roller 为 AI 时 1s 后自动掷），原首局 AI 掷骰逻辑与重发后共用
- AI 头牌首出延时由 600–1000ms 放宽为 2000–2800ms（仅头牌首出，即 `openEnds === null` 时），给真人留出看牌与申请的时间窗；跟牌/扣牌节奏不变

### 3.3 联网服务端（server/rooms.js）

- `gameAction` 协议层新增 `game.redeal`：校验身份（真人 token、非托管）后委托 core `redeal(g, me.seat)`；失败按既有 `{ error: { code, message } }` 回执
- 成功后：`pushRoomState` + `pushGameState`（各端状态回 ROLLING）+ 广播 `game.redealt { seat }`（客户端 toast）
- **AI/托管座位自动申请**：`beginRound` 完成发牌与 `scheduleDice` 落定进 PLAYING 后，检查 AI/托管座位手牌；满足条件且无真人满足时，1.2s 后代为申请（复用 `gameAction` 内部路径，非真人 token 旁路身份校验）；真人座位满足条件时不动，等玩家自己点
- **AI 首出延时**：`scheduleAiTurn` 中 `openEnds === null` 分支延时改为 2000–2800ms，与单机一致
- 重发后 `maybeAutoRoll` 既有逻辑已覆盖「roller 为 AI/托管时自动掷」，无需改动

### 3.4 联网客户端（src/composables/useNetGame.js）

- 订阅 `game.redealt`：toast「{labelOf(seat)} 申请重新发牌」
- 新增导出 `canRedealNow`（computed，依据 `view`）与 `redeal()`（发 `game.redeal` 请求，失败 toast）
- `view.redealUsed` 随 `game.state` 推送自然更新（服务器 viewOf 已带）

### 3.5 牌桌 UI（src/pages/game/game.vue）

- **按钮显隐**：`view.state === 'PLAYING' && view.tableHistory.length === 0 && canRedealNow` 时，中央回合提示下方显示「申请重新发牌」按钮（复用 `btn-primary` 风格，加防双击）
- **重发复位**：既有 `rollerSeat` watch 在重发场景下可能不触发（新 roller === 旧 roller），补一个 `state → 'ROLLING'` 的复位 watch：清 `leaderRevealed`/`diceLanded`/终局节奏状态，防止界面卡死或残留文案
- 重发后进入 ROLLING，界面复用现有掷骰流程，无新视觉元素

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| 窗口外申请（已出牌/非 PLAYING） | core 返回 `{ ok: false, reason: '已开始出牌，不能再申请重新发牌' }`；UI 按钮不显示 |
| 牌型不满足 | core 返回 `{ ok: false, reason: '手牌不满足重新发牌条件' }`；UI 按钮不显示 |
| 每人重复申请 | core 返回 `{ ok: false, reason: '本局已申请过重新发牌' }` |
| 联网断线时点申请 | 走既有请求失败路径，toast 提示 |
| 重发瞬间有人出牌（联网竞态） | 服务器动作串行处理，`redeal` 校验 `tableHistory.length === 0`，出牌先到则重发被拒 |

## 5. 测试策略

- **core 单测**（tests/game.test.js / rules.test.js）：
  - `canRedeal` 全枚举：两红八无红十 ✅ / 两红八有红十 ❌ / 六横牌 ✅ / 含竖牌 ❌ / 五张横牌+一竖 ❌
  - `redeal`：窗口内成功（手牌清空、roller 移交、状态回 ROLLING、redealUsed 记录）；窗口外拒绝；不满足牌型拒绝；同一座位重复申请拒绝；不同座位各自可申请一次；重发后再掷骰可正常开局
- **服务端集成测试**（tests/server-rooms.test.js）：`game.redeal` 动作成功/失败路径、AI 座位自动申请、重发后 `game.state` 推送
- **单机手测清单**：AI 申请 toast、重发后掷骰按钮归属、连续局正常

## 6. 明确不做（YAGNI）

- 申请需他人同意的投票机制（按规则原文「可以申请」为满足条件的权利）
- 重发次数上限超过每人每局 1 次
- 单机模式的重发动画（直接复用掷骰阶段界面）
