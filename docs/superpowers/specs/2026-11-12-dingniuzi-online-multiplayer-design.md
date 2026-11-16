# 顶牛子联网多人对战 — 设计文档

日期：2026-11-12
状态：已与用户确认方案 A（服务器权威 + WebSocket 推送）

## 1. 背景与目标

一期为单机版（1 真人 + 3 AI），`src/core/` 已实现平台无关的游戏逻辑（状态机、规则、发牌、AI），并有 55 个单元测试。二期目标：**联网多人对战**（房间、快速匹配、断线重连），同时保留单机模式双入口共存。

成功标准：

1. 4 名玩家（H5 浏览器多开）可通过创建房间/快速匹配进入同一牌局，完整对局至结算
2. 任一玩家断线后 60 秒内重连可恢复牌局；宽限期内由 AI 托管代打
3. 现有单机模式不受影响
4. `src/core/` 代码零修改即可在服务端运行

## 2. 需求确认结论

| 问题 | 结论 |
|---|---|
| 部署环境 | 自建 Node 服务器（`ws` 库），与前端同仓 |
| 进入方式 | 创建房间（房间号分享）+ 快速匹配 |
| 断线策略 | 保留重连（60s 宽限）+ AI 托管 |
| 与单机关系 | 双入口共存，共用 core 与牌桌 UI |

## 3. 总体架构

```
┌──────────┐  WebSocket(JSON)  ┌──────────────────┐
│ uni-app  │ ◄───────────────► │ Node 服务端        │
│ 客户端    │                   │ ws + node:http    │
│          │                   │ 房间/会话(内存态)    │
│ useNetGame│                   │ ┌──────────────┐ │
│ (视图订阅) │                   │ │ src/core/*   │ │ ← 直接 import，零修改
└──────────┘                   │ └──────────────┘ │
                               └──────────────────┘
```

- **服务器权威**：牌局状态（`game.js` 状态机）只存在于服务端内存，客户端永远只持有 `viewOf(g, mySeat)` 过滤后的视图快照。手牌信息不下发给他家，天然防作弊。
- **core 跨目录引用**：`server/*.js` 直接 `import { createGame, ... } from '../src/core/game.js'`。core 为纯 ESM 零依赖，Node 22 原生运行。不引入 monorepo/构建/复制。
- **服务端目录**：`server/`，独立 `package.json`（依赖仅 `ws`），独立部署单元，`node server/index.js` 启动，默认端口 3001。
- **单进程内存态**：`Map<roomId, Room>`，不持久化。服务器重启清空全部房间（演示规模可接受）。

### 3.1 目录结构

```
top-cow-card-game/
├── src/
│   ├── composables/
│   │   ├── useGame.js          # 单机（不动）
│   │   └── useNetGame.js       # 新：联网 composable，导出接口与 useGame 一致
│   ├── utils/
│   │   ├── net.js              # 新：WS 客户端封装（连接/自动重连/请求-响应关联/推送分发）
│   │   └── config.js           # 新：服务器地址配置
│   └── pages/
│       ├── index/index.vue     # 加「联网对战」入口
│       ├── lobby/lobby.vue     # 新：大厅（创建房间/快速匹配/房间号加入）
│       ├── room/room.vue       # 新：房间（座位列表/准备/开始）
│       └── game/game.vue       # 牌桌：按模式挂 useGame 或 useNetGame（UI 组件零改动）
├── server/
│   ├── package.json            # { "ws": "^8" }，type: module
│   ├── index.js                # 入口：http + WebSocketServer，消息路由
│   ├── rooms.js                # Room 类 + RoomManager（创建/匹配/加入/离开/超时清理）
│   └── tests/                  # 服务端集成测试（vitest，复用根 vitest）
└── docs/specs/                 # 本文档
```

### 3.2 座位与玩家标识

- 沿用 core 的座位模型：0/1/2/3，逆时针。0 = 房主（创建者）。
- **playerToken**：加入成功时服务端签发的随机字符串（UUID），客户端存 `uni.setStorageSync('dingniuzi_player_token')`。断线重连凭 token 恢复座位与身份，不依赖连接本身。
- **昵称**：客户端生成默认昵称（`玩家+四位随机`）随 join 上报，服务端存 Room 内成员表。

## 4. 通信协议（JSON over WebSocket）

消息统一格式：

```js
// 客户端 → 服务端（请求）
{ type: string, payload: object }
// 服务端 → 客户端（响应/推送）
{ type: string, payload: object, requestId?: string }  // 带 requestId 的是对请求的响应
```

### 4.1 客户端 → 服务端

| type | payload | 说明 |
|---|---|---|
| `room.create` | `{ name }` | 创建房间。返回 roomId + token + 房间快照 |
| `room.join` | `{ name, roomId }` | 按房间号加入。返回 token + 房间快照 |
| `room.quickMatch` | `{ name }` | 快速匹配：加入第一个未满、未开局房间；无则创建 |
| `room.leave` | `{}` | 主动离开房间 |
| `room.seat` | `{ seat }` | 换座位（仅未开局时，目标座位无人或为托管 AI） |
| `room.ready` | `{ ready }` | 准备/取消准备 |
| `game.start` | `{}` | 房主开始游戏（须 4 人且全部准备） |
| `game.roll` | `{ dice? }` | 掷骰（轮到我掷骰时） |
| `game.play` | `{ tileIds, side }` | 出牌（双出红八时 tileIds 两张） |
| `game.discard` | `{ tileId }` | 扣牌 |
| `game.settleContinue` | `{}` | 结算点击继续（连续局：赢家掷骰下一局） |
| `reconnect` | `{ token }` | 断线重连：恢复身份，返回房间/牌局完整状态 |

### 4.2 服务端 → 客户端

| type | payload | 说明 |
|---|---|---|
| `room.state` | `{ room }` | 房间快照变化（成员/座位/准备/阶段）广播 |
| `game.state` | `{ view }` | 牌局视图快照（`viewOf(g, seat)` 按座位私有下发）+ `dice`、`revealKept` 等 fx 信号 |
| `game.over` | `{ result }` | 一局结束（含结算 ranks/scores） |
| `error` | `{ code, message, requestId? }` | 动作非法/异常（reason 直接来自 core 的 `{ ok:false, reason }`） |
| `kicked` | `{ reason }` | 被移出房间（超时未重连/房主解散） |

### 4.3 关键语义

- **fx 与视图合并**：`game.state` 的 payload 为 `{ view, fx: { dice, diceRolling, revealKept, discardTook } }`。掷骰动画节奏由服务端时间线驱动（见 §6.2），客户端只做动画呈现。
- **私有视图**：每局每座位收到的 `view.myHand` 只含该座位手牌；`opponents` 仅有牌数（`viewOf` 现有行为）。
- **请求-响应**：net.js 维护 `requestId → { resolve, reject, timeout }` 表；超时 8s 报错。房间/牌局状态变化不靠响应，靠广播推送。

## 5. 房间与匹配

### 5.1 房间生命周期

```
Lobby ──create/join/quickMatch──► Room(WAITING: 选座/准备)
                                     │ 房主 start（4人全备）
                                     ▼
                                  Room(PLAYING: 一局或多局连打)
                                     │ 每局 settle → 展示结算 → setteeContinue
                                     ▼
                                  Room(PLAYING 下一局) 或 全员 leave → 房间销毁
```

- **roomId**：6 位数字（100000-999999），展示给玩家分享。
- **Room 成员**：`members: [{ seat, token, name, connected, ready, isHost }]`，座位与 core 的 seat 对应。AI 托管座位 `token = null, connected = true, isAI = true`。
- **销毁**：所有人离开、或最后一个真人离开且无观战价值（未开局）时销毁；开局状态下真人全部掉线超时才销毁。

### 5.2 快速匹配

`room.quickMatch`：遍历房间表找 `WAITING` 且有空位的房间加入（按创建时间序）；找不到则创建新房间。首版不做段位/积分匹配。

### 5.3 准备与开始

- `WAITING` 阶段每个真人可换座位（含接管 AI 托管位）、切换准备状态。
- 房主 `game.start` 要求：4 个座位全部有人（真人为 prepared，AI 位视为已准备）。首版不做「添加 AI 补位」按钮；不足 4 人时开始被拒绝，提示「邀请 3 位好友或使用快速匹配」。空位补 AI 列入三期。

## 6. 对局流程（服务端）

### 6.1 状态机复用

服务端每局持有 `g = createGame(rng, rollerSeat)`，全部动作走 core 函数：`rollDice / play / discard`，非法动作把 `{ ok: false, reason }` 透传给客户端 `error`。服务端不重复实现规则。

### 6.2 掷骰与 fx 时间线（服务端驱动）

为保证四端动画节奏一致且不信任客户端，掷骰由服务端编排：

1. 收到 `game.roll` → 校验轮次 → 立即广播 `game.state { fx: { diceRolling: true } }`
2. 1.2s 后定骰 → 广播 `{ fx: { diceRolling: false, dice } }`
3. 再 2.4s 后执行 `rollDice(g, dice)` → 广播 `game.state`（进入 PLAYING）→ 如轮到 AI/托管座位继续调度

AI 托管座位掷骰由服务端定时器自动触发，真人座位等待 `game.roll`。

### 6.3 AI 托管（断线宽限期内）

- 座位掉线进入宽限期（60s）后，该座位行动由服务端 `ai.js` 决策（`aiChoosePlay / aiChooseDiscard`，与单机同一套代码），延时 600-1000ms 模拟思考。
- 真人重连立即收回控制权（删除托管定时器）。
- 掉线座位若为当前行动座位，宽限期结束仍未回则按 AI 继续打完（不判负，保持简单）。

### 6.4 连续局与结算

- 每局 `settle` 后广播 `game.over`；客户端亮牌 → 点击 → 弹结算（复用现有 fx 流程）。
- 结算页「再来一局」发 `game.settleContinue`；全员已继续（或 5s 超时自动继续）后服务端开下一局，`rollerSeat = 上一局赢家`，广播新 `game.state`。中途加入不可能（房间开局后封闭）。

### 6.5 断线重连

```
连接关闭(非主动 leave) → seat.connected=false → 启动 60s 宽限计时器 + AI 托管
        ▲                                  │
        │ reconnect(token) 成功             │ 60s 到期仍未连
        │                                  ▼
收回托管，广播 room.state          保持 AI 托管至本局结束；广播 kicked(reason='超时未重连')
                                   （若房间仅剩 AI → 销毁）
```

- 重连请求带 token：找到房间与座位 → 建立连接映射 → 立即下发 `room.state` + `game.state`（完整快照，客户端整体替换本地状态）→ 广播他人 `room.state`。
- token 无效/房间已销毁：返回 `error { code: 'ROOM_GONE' }`，客户端回大厅。
- 同一 token 重复连接（旧连接未死）：服务端踢掉旧连接，以新连接为准。

## 7. 客户端设计

### 7.1 net.js（WS 客户端封装）

职责：连接管理、心跳（30s ping/pong 探活）、断线自动重连（指数退避 1s→2s→4s→8s，上限 5 次）、请求-响应关联（requestId）、推送订阅（`on(type, handler)`）。页面级组件不直接触碰 WebSocket 实例。

### 7.2 useNetGame.js（与 useGame 同接口）

导出与 `useGame()` 完全一致的签名：

```js
const { view, fx, myTurn, mustDiscard, playableIds, labelOf,
        diceRollerSeat, roll, myPlay, myDiscard } = useNetGame()
```

差异（内部实现）：

- `view/fx` 不再由本地 core 推导，而是 `game.state` 推送的整体替换 + `reactive` 包装
- `roll/myPlay/myDiscard` 变为发协议消息，本地乐观更新仅做「动作已受理」标记，最终状态以服务器推送为准；`{ ok:false }` 时 toast 显示服务器 reason
- 新增导出：`connection: { status, reconnecting }`（页面展示连接状态条）与 `restart()`（发 `settleContinue`）
- `playableIds` 在客户端可由 `view.myHand` + `view.openEnds` 本地计算（只读规则，无作弊面），保持现有高亮逻辑零改动；头牌首出「不拉三家」校验由服务端裁决，客户端不做（避免泄露他家手牌信息）

### 7.3 页面改动

- **index.vue**：主菜单加「联网对战」按钮 → `navigateTo('/pages/lobby/lobby')`
- **lobby.vue（新）**：昵称输入（默认自动生成，存 storage）；三个操作：创建房间 / 快速匹配 / 房间号输入加入。进入成功跳 room 页。
- **room.vue（新）**：座位卡片（0-3，显示昵称/准备状态/断线标记）；房主显示「开始游戏」；非房主显示「准备/取消准备」「换座位」（点空位/托管位）。`WAITING` 才可操作。
- **game.vue（现有）**：改动收敛为——
  1. 通过路由参数 `mode=solo|net` 决定 `useGame` 还是 `useNetGame`（其余模板与组件零改动，因为接口一致）
  2. 对家/上家/下家 `labelOf` 改为显示真实昵称（net 模式下 labelOf 返回成员表昵称）
  3. 断线/重连中显示连接状态条
  4. 结算「再来一局」走 `restart()`（net 模式发 settleContinue）

### 7.4 错误与提示

- 动作被拒（`error` 带 reason）：`uni.showToast` 展示 reason（与单机一致）
- 连接断开：顶部状态条「连接已断开，重连中…」；牌局进行中断线不影响其他三家（托管兜底）
- 房间被销毁/被踢：toast + `reLaunch` 回大厅

## 8. 服务端实现要点

- `index.js`：`http.createServer` + `WebSocketServer({ port: 3001 })`。连接级 `token→conn` 映射；消息路由到 RoomManager。
- `rooms.js`：
  - `RoomManager`：`Map<roomId, Room>`；`createRoom/join/quickMatch/leave/reclaim(token)`；定时器每 30s 清理空房
  - `Room`：成员表 + `game`（core 状态机）+ 每座位推送函数 `broadcast(exceptSeat?, msg)`；托管定时器、宽限计时器管理
- 安全：仅同源部署场景，暂不做鉴权加密；入参校验（roomId 数字、tileIds 数组长度 ≤2、side 枚举）防止畸形消息；单房间人数硬上限 4。
- 日志：动作级别 console.log（roomId/seat/type），便于演示排查。

## 9. 测试策略

- **core 不动**：现有 55 测试保证规则正确性
- **server 测试**（新增 `server/tests/rooms.test.js`，用根目录 vitest 运行）：
  - 房间创建/加入/匹配/换座/准备流程
  - mock 客户端连接跑完整一局（4 个 mock 客户端按协议交互至 settle）
  - 断线：掉线 → 托管代打 → 重连恢复 → 控制权收回
  - 重连超时：kicked 与房间销毁
  - 非法动作：错误座位出牌/未准备开始等 → error 响应
- **客户端**：net.js 请求-响应关联与重连退避用 vitest 单测；页面以手动多窗口联调为主

## 10. 明确不做（本期范围外）

- 观战、聊天、表情
- 积分排行/账号系统（昵称仅本地随机生成）
- 房间持久化与服务器重启恢复
- 添加 AI 补位按钮（三期）
- 算帐/包庄等传统玩法（原 §2.8 二期预留其余条目不变）
- 小程序端适配（uni WebSocket API 与 H5 略有差异，多端发布时再接）

## 11. 部署与运行

```bash
# 服务端
cd server && npm install
node index.js            # 默认 ws://0.0.0.0:3001

# 客户端（H5）
npm run build:h5         # dist/build/h5
npx http-server dist/build/h5 -p 3000   # 现有静态服务

# 测试（根目录）
npx vitest run           # 含新增 server/tests
```

客户端服务器地址：`src/utils/config.js` 导出 `SERVER_WS_URL`，默认 `ws://<当前域名主机>:3001`（开发期写死局域网 IP 亦可），多端发布时再换环境注入。
