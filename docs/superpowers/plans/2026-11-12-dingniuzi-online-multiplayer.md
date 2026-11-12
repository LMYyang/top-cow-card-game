# 顶牛子联网多人对战 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单机版顶牛子增加联网多人对战：Node WebSocket 服务器（权威状态）、房间/快速匹配、断线重连 + AI 托管，客户端新增 useNetGame/lobby/room，单机模式保持不变。

**Architecture:** 服务器权威 + WebSocket 推送（设计文档 docs/specs/2026-11-12-dingniuzi-online-multiplayer-design.md）。服务端直接 import `src/core/*.js` 跑游戏状态机；客户端只发动作、收 `viewOf` 视图快照。牌桌 UI 组件零改动，game.vue 按路由参数切换 useGame/useNetGame。

**Tech Stack:** Node 22 原生 ESM + `ws` 8.x（服务端）；uni-app Vue 3（客户端，原生 WebSocket）；vitest（测试，根目录既有配置）。

**约定（全计划通用）：**
- Windows 环境，bash shell；npm 调用写法：`"/d/Program Files/nodejs/npm.cmd" ...`；node 直接可用
- 测试命令统一 `"/d/Program Files/nodejs/npm.cmd" test 2>&1`（根目录 vitest，include `tests/**/*.test.js`；server 测试放 `server/tests/` 会跑不到 → **每任务的 server 测试文件直接放 `tests/server-<name>.test.js`**，import 路径 `../server/...`）
- vitest 环境为 node，无 uni 全局——客户端代码（net.js/useNetGame）测试时须 mock `uni` 全局或避免依赖 uni API 的分支
- commit 一律在 `D:\demo\top-cow-card-game` 仓库根执行
- 所有新增文件使用 ESM（`import/export`）；server/package.json 声明 `"type": "module"`

**文件总览（创建/修改）：**

| 文件 | 动作 | 职责 |
|---|---|---|
| `server/package.json` | 新建 | ws 依赖、`node index.js` 启动脚本 |
| `server/rooms.js` | 新建 | Room + RoomManager：成员表、牌局驱动、托管/宽限定时器 |
| `server/index.js` | 新建 | http+ws 入口、消息路由、token↔连接映射 |
| `src/utils/config.js` | 新建 | 服务器 WS 地址 |
| `src/utils/net.js` | 新建 | WS 客户端封装（连接/心跳/重连/requestId/订阅） |
| `src/composables/useNetGame.js` | 新建 | 与 useGame 同接口的联网 composable |
| `src/pages/lobby/lobby.vue` | 新建 | 大厅：创建/匹配/房间号加入 |
| `src/pages/room/room.vue` | 新建 | 房间：座位/准备/开始 |
| `src/pages.json` | 修改 | 注册 lobby/room 页面 |
| `src/pages/index/index.vue` | 修改 | 加「联网对战」入口 |
| `src/pages/game/game.vue` | 修改 | 按 mode 参数切换 composable；net 模式昵称/重连条/再来一局 |
| `tests/server-rooms.test.js` | 新建 | 服务端房间/牌局/断线集成测试（内存直调，不起真端口） |
| `tests/server-index.test.js` | 新建 | ws 消息路由集成测试（随机端口起真服务器） |

---

### Task 1: server 骨架与 RoomManager（创建/加入/匹配/换座/准备）

**Files:**
- Create: `server/package.json`
- Create: `server/rooms.js`
- Test: `tests/server-rooms.test.js`

- [ ] **Step 1: 创建 server/package.json 并安装 ws**

`server/package.json` 全部内容：

```json
{
  "name": "dingniuzi-server",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

Run: `cd "D:\demo\top-cow-card-game\server" && "/d/Program Files/nodejs/npm.cmd" install 2>&1`
Expected: 输出 `added 1 package`（或类似），生成 server/node_modules、package-lock.json

- [ ] **Step 2: 写失败的房间管理测试**

`tests/server-rooms.test.js` 全部内容（本任务先覆盖创建/加入/匹配/换座/准备；后续任务追加牌局与断线用例）：

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { RoomManager } from '../server/rooms.js'

let mgr
beforeEach(() => {
  mgr = new RoomManager()
  mgr.now = () => 1000 // 固定时间便于超时测试
})

function conn(name) {
  // 假连接：记录发送的消息，便于断言
  const sent = []
  return {
    sent,
    name,
    send(msg) { sent.push(msg) },
    close() {},
  }
}

describe('RoomManager 房间流程', () => {
  it('创建房间：房主落座 0，房间号 6 位', () => {
    const c = conn('甲')
    const { room, token, error } = mgr.createRoom(c, '甲')
    expect(error).toBeUndefined()
    expect(room.roomId).toBeGreaterThanOrEqual(100000)
    expect(room.roomId).toBeLessThanOrEqual(999999)
    expect(token).toBeTruthy()
    expect(room.members).toHaveLength(1)
    expect(room.members[0]).toMatchObject({ seat: 0, name: '甲', isHost: true, connected: true, ready: false })
  })

  it('按房间号加入：空位自动分配座位', () => {
    const c1 = conn('甲')
    const { room, token: t1 } = mgr.createRoom(c1, '甲')
    const c2 = conn('乙')
    const res = mgr.joinRoom(c2, '乙', room.roomId)
    expect(res.error).toBeUndefined()
    expect(res.room.members).toHaveLength(2)
    expect(res.room.members.map(m => m.seat).sort()).toEqual([0, 1])
    expect(res.token).not.toBe(t1)
  })

  it('加入满员房间被拒', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    for (const n of ['乙', '丙', '丁']) mgr.joinRoom(conn(n), n, room.roomId)
    const res = mgr.joinRoom(conn('戊'), '戊', room.roomId)
    expect(res.error).toMatchObject({ code: 'ROOM_FULL' })
  })

  it('加入不存在房间返回 ROOM_GONE', () => {
    const res = mgr.joinRoom(conn('甲'), '甲', 123456)
    expect(res.error).toMatchObject({ code: 'ROOM_GONE' })
  })

  it('快速匹配：优先加入未满未开局房间，否则创建', () => {
    const first = mgr.createRoom(conn('甲'), '甲').room
    const m1 = mgr.quickMatch(conn('乙'), '乙')
    expect(m1.room.roomId).toBe(first.roomId) // 加入已有房间
    const m2 = mgr.quickMatch(conn('丙'), '丙')
    expect(m2.room.roomId).toBe(first.roomId)
    const m3 = mgr.quickMatch(conn('丁'), '丁')
    expect(m3.room.roomId).toBe(first.roomId) // 第 4 人，房间满
    const m4 = mgr.quickMatch(conn('戊'), '戊')
    expect(m4.room.roomId).not.toBe(first.roomId) // 满了 → 新房
  })

  it('换座位：WAITING 阶段可换到空位', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const res = mgr.moveSeat(token, room.roomId, 3)
    expect(res.error).toBeUndefined()
    const me = room.members.find(m => m.token === token)
    expect(me.seat).toBe(3)
  })

  it('换座位：目标座位有人被拒', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const res = mgr.moveSeat(token, room.roomId, 1)
    expect(res.error).toBeDefined()
  })

  it('准备/取消准备；广播 room.state 给所有已连成员', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    const c2 = conn('乙')
    mgr.joinRoom(c2, '乙', room.roomId)
    c1.sent.length = 0
    const res = mgr.setReady(token, room.roomId, true)
    expect(res.error).toBeUndefined()
    expect(room.members.find(m => m.token === token).ready).toBe(true)
    // 两个连接都收到 room.state 推送
    expect(c1.sent.some(m => m.type === 'room.state')).toBe(true)
    expect(c2.sent.some(m => m.type === 'room.state')).toBe(true)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: FAIL —— `Cannot find module '../server/rooms.js'`（原有 55 个测试仍 PASS）

- [ ] **Step 4: 实现 rooms.js（房间管理部分）**

`server/rooms.js` 全部内容：

```js
import { createGame, rollDice, play, discard, viewOf } from '../src/core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../src/core/ai.js'

/**
 * 房间与成员管理（服务器权威）。
 * Room: { roomId, members, state: 'WAITING'|'PLAYING'|'SETTLE', game, hostToken, createdAt }
 * 成员: { seat, token, name, connected, ready, isHost, isAI, conn, graceTimer, aiTimer }
 * token 是玩家身份凭证（重连用）；conn 是当前 WebSocket 连接（可变）。
 */

const GRACE_MS = 60_000 // 断线宽限：超时未重连则踢出
const AI_THINK_MIN = 600
const AI_THINK_RAND = 400

let tokenSeq = 0
function makeToken() {
  tokenSeq += 1
  return `t${Date.now().toString(36)}-${tokenSeq}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export class RoomManager {
  constructor() {
    this.rooms = new Map() // roomId -> Room
    this.tokens = new Map() // token -> Room（重连索引）
    this.now = () => Date.now()
  }

  /** 房间快照（下发给客户端的 members 形态，剥离连接与定时器等内部字段） */
  roomState(room) {
    return {
      roomId: room.roomId,
      state: room.state,
      members: room.members.map((m) => ({
        seat: m.seat, name: m.name, connected: m.connected,
        ready: m.ready, isHost: m.isHost, isAI: m.isAI,
      })),
    }
  }

  broadcast(room, type, payload, exceptToken = null) {
    for (const m of room.members) {
      if (m.token === exceptToken || !m.conn) continue
      m.conn.send({ type, payload })
    }
  }

  pushRoomState(room, exceptToken = null) {
    this.broadcast(room, 'room.state', { room: this.roomState(room) }, exceptToken)
  }

  /** 按座位序找第一个空位；满返回 -1 */
  firstVacantSeat(room) {
    const used = new Set(room.members.map((m) => m.seat))
    for (let s = 0; s < 4; s++) if (!used.has(s)) return s
    return -1
  }

  createRoom(conn, name) {
    const roomId = this.newRoomId()
    const room = { roomId, members: [], state: 'WAITING', game: null, hostToken: null, createdAt: this.now() }
    this.rooms.set(roomId, room)
    return this.joinRoom(conn, name, roomId)
  }

  newRoomId() {
    for (;;) {
      const id = 100000 + Math.floor(Math.random() * 900000)
      if (!this.rooms.has(id)) return id
    }
  }

  joinRoom(conn, name, roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在或已解散' } }
    if (room.state !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局已开始，无法加入' } }
    const seat = this.firstVacantSeat(room)
    if (seat === -1) return { error: { code: 'ROOM_FULL', message: '房间已满' } }
    const token = makeToken()
    const member = { seat, token, name, connected: true, ready: false, isHost: room.members.length === 0, isAI: false, conn, graceTimer: null, aiTimer: null }
    room.members.push(member)
    this.tokens.set(token, room)
    this.pushRoomState(room) // 新成员也会收到（其 conn 已在 members 中）
    return { room, token, seat }
  }

  quickMatch(conn, name) {
    const candidates = [...this.rooms.values()]
      .filter((r) => r.state === 'WAITING' && this.firstVacantSeat(r) !== -1)
      .sort((a, b) => a.createdAt - b.createdAt)
    if (candidates.length > 0) return this.joinRoom(conn, name, candidates[0].roomId)
    return this.createRoom(conn, name)
  }

  roomOf(token) {
    return this.tokens.get(token) || null
  }

  memberByToken(room, token) {
    return room.members.find((m) => m.token === token) || null
  }

  moveSeat(token, roomId, seat) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (room.state !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能换座位' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    if (seat === me.seat) return { ok: true }
    const target = room.members.find((m) => m.seat === seat)
    if (target) return { error: { code: 'SEAT_TAKEN', message: '该座位已有人' } }
    me.seat = seat
    this.pushRoomState(room)
    return { ok: true }
  }

  setReady(token, roomId, ready) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    me.ready = !!ready
    this.pushRoomState(room)
    return { ok: true }
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 旧 + 8 新）

- [ ] **Step 6: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add server tests/server-rooms.test.js && git commit -m "feat(server): 房间管理——创建/加入/匹配/换座/准备"
```

---

### Task 2: 房间开始对局、core 动作路由、AI 托管调度

**Files:**
- Modify: `server/rooms.js`（追加 game 相关方法）
- Test: `tests/server-rooms.test.js`（追加用例）

- [ ] **Step 1: 追加失败测试（开始/动作/托管）**

在 `tests/server-rooms.test.js` 末尾追加：

```js
import { viewOf } from '../src/core/game.js'

/** 4 人满员已准备的房间 */
function fullRoom() {
  const c1 = conn('甲')
  const { room, token } = mgr.createRoom(c1, '甲')
  const tokens = [token]
  for (const n of ['乙', '丙', '丁']) {
    const r = mgr.joinRoom(conn(n), n, room.roomId)
    tokens.push(r.token)
    mgr.setReady(r.token, room.roomId, true)
  }
  mgr.setReady(token, room.roomId, true)
  return { room, tokens }
}

describe('开始对局与动作路由', () => {
  it('未满员开始被拒；满员全准备开始成功并广播 game.state', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const early = mgr.startGame(token, room.roomId)
    expect(early.error).toBeDefined()
    const { tokens } = fullRoom()
    c1.sent.length = 0
    const res = mgr.startGame(tokens[0], room.roomId)
    expect(res.error).toBeUndefined()
    expect(room.state).toBe('PLAYING')
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true)
    expect(c1.sent.some(m => m.type === 'game.state')).toBe(true)
  })

  it('非房主开始被拒；未准备开始被拒', () => {
    const { room, tokens } = fullRoom()
    const r1 = mgr.startGame(tokens[1], room.roomId) // 乙非房主
    expect(r1.error).toBeDefined()
  })

  it('动作路由：非本座位出牌被拒并回 error 给发送者', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const wrongSeat = room.game.currentSeat
    const notTurnToken = tokens.find((t, i) => i !== wrongSeat)
    const c = conn('路人')
    // 把非当前座位成员的连接换掉以便捕获 error
    room.members.find(m => m.token === notTurnToken).conn = c
    const res = mgr.gameAction(notTurnToken, 'game.play', { tileIds: ['t1-1'], side: 'bottom' })
    expect(res.error).toBeDefined()
    expect(c.sent.some(m => m.type === 'error')).toBe(true)
  })

  it('掷骰由服务端编排：立即 rolling，1.2s 定骰，2.4s 后进 PLAYING', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const rollerSeat = room.game.rollerSeat
    const rollerToken = tokens[rollerSeat]
    const c = room.members.find(m => m.token === rollerToken).conn
    c.sent.length = 0
    mgr.gameAction(rollerToken, 'game.roll', {})
    expect(room.state).toBe('ROLLING')
    expect(c.sent.some(m => m.type === 'game.state' && m.payload.fx.diceRolling === true)).toBe(true)
    vi.advanceTimersByTime(1200)
    expect(c.sent.some(m => m.type === 'game.state' && m.payload.fx.dice === room.game.pendingDice)).toBe(true)
    vi.advanceTimersByTime(2400)
    expect(room.state).toBe('PLAYING')
    vi.useRealTimers()
  })

  it('完整对局：AI 托管/真人混合可打到 SETTLE（托管代打全部座位）', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    // 全员视为掉线 → 全 AI 托管，牌局应能自行推进到 SETTLE
    vi.useFakeTimers()
    for (const m of room.members) mgr.onDisconnect(m.token)
    for (let i = 0; i < 2000 && room.game.state !== 'SETTLE'; i++) vi.advanceTimersByTime(100)
    expect(room.game.state).toBe('SETTLE')
    expect(room.game.result).toBeTruthy()
    vi.useRealTimers()
  })
})
```

注意：测试文件顶部 import 需补 `vi`：

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
```

且 `mgr` 需要可注入定时器时间由 fake timers 驱动——实现里所有 setTimeout 用全局 setTimeout 即可（vi.useFakeTimers 会替换全局）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 新用例 FAIL（`mgr.startGame is not a function` 等），旧用例 PASS

- [ ] **Step 3: 在 rooms.js 实现 game 方法（追加到 class 内）**

在 `RoomManager` 类内追加（`setReady` 之后）：

```js
  // ---------- 对局 ----------

  canStart(room) {
    if (room.members.length !== 4) return { ok: false, message: '需要 4 名玩家' }
    if (!room.members.every((m) => m.ready || m.isAI)) return { ok: false, message: '所有玩家须先准备' }
    return { ok: true }
  }

  startGame(token, roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    const me = this.memberByToken(room, token)
    if (!me || !me.isHost) return { error: { code: 'NOT_HOST', message: '只有房主能开始' } }
    const check = this.canStart(room)
    if (!check.ok) return { error: { code: 'CANNOT_START', message: check.message } }
    this.beginRound(room, room.members.findIndex((m) => m.isHost)) // 首局掷骰者=房主座位
    return { ok: true }
  }

  /** 开一局（首局或连续局）。rollerSeat：本局掷骰者座位 */
  beginRound(room, rollerSeat) {
    room.game = createGame(Math.random, rollerSeat)
    room.state = 'PLAYING'
    room.settleAck = new Set() // 已点继续的座位
    this.pushRoomState(room)
    this.pushGameState(room)
    // 掷骰权在 AI/托管座位时服务端自动掷
    this.maybeAutoRoll(room)
    // 掷骰权在真人时也启动超时托管（60s 未掷则托管掷）——首版从简：真人掷骰无超时托管，
    // 仅在断线宽限内由 onDisconnect 触发的 aiTurn 覆盖
  }

  /** 下发某座位的私有视图 */
  pushGameState(room, onlySeat = null) {
    for (const m of room.members) {
      if (!m.conn) continue
      if (onlySeat !== null && m.seat !== onlySeat) continue
      m.conn.send({ type: 'game.state', payload: this.gameView(room, m.seat) })
    }
  }

  /** 组装某座位的游戏视图（core viewOf + fx） */
  gameView(room, seat) {
    const g = room.game
    const fx = { dice: room.fx?.dice ?? null, diceRolling: room.fx?.diceRolling ?? false, revealKept: room.fx?.revealKept ?? false }
    return { view: viewOf(g, seat), fx, roomId: room.roomId, yourSeat: seat }
  }

  /** 通用动作入口：roll/play/discard。校验身份与轮次后委托 core */
  gameAction(token, type, payload) {
    const room = this.roomOf(token)
    if (!room) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    const g = room.game
    if (!g) return { error: { code: 'NO_GAME', message: '对局未开始' } }

    if (type === 'game.roll') {
      if (g.state !== 'ROLLING') return { error: { code: 'BAD_STATE', message: '当前不可掷骰' } }
      if (g.rollerSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '不是你的掷骰权' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } } // 托管座位不允许手动
      const dice = 1 + Math.floor(Math.random() * 6)
      this.scheduleDice(room, dice)
      return { ok: true }
    }
    if (type === 'game.play') {
      if (g.state !== 'PLAYING') return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      if (g.currentSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      const res = play(g, me.seat, payload.tileIds || [], payload.side === 'top' ? 'top' : 'bottom')
      if (!res.ok) return { error: { code: 'ILLEGAL', message: res.reason } }
      this.afterAction(room)
      return { ok: true }
    }
    if (type === 'game.discard') {
      if (g.state !== 'PLAYING') return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      if (g.currentSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      const res = discard(g, me.seat, payload.tileId)
      if (!res.ok) return { error: { code: 'ILLEGAL', message: res.reason } }
      this.afterAction(room)
      return { ok: true }
    }
    return { error: { code: 'UNKNOWN_ACTION', message: '未知动作' } }
  }

  /** 掷骰服务端时间线：立即 rolling → 1.2s 定骰 → 再 2.4s 执行 rollDice */
  scheduleDice(room, dice) {
    const g = room.game
    room.fx = { dice: null, diceRolling: true, revealKept: false }
    g.pendingDice = dice
    this.pushGameState(room)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice, diceRolling: false, revealKept: false }
      this.pushGameState(room)
    }, 1200)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice: null, diceRolling: false, revealKept: false }
      const res = rollDice(g, dice)
      if (res.ok) {
        this.pushRoomState(room) // state 变为 PLAYING
        this.pushGameState(room)
        this.afterAction(room) // 若轮到托管座位则调度 AI
      }
    }, 1200 + 2400)
  }

  maybeAutoRoll(room) {
    const g = room.game
    if (!g || g.state !== 'ROLLING') return
    const roller = room.members.find((m) => m.seat === g.rollerSeat)
    if (!roller) return
    if (roller.isAI || roller.aiTimer) {
      // 托管/AI 掷骰：走与真人相同的编排（不带 1.2s 前置）
      setTimeout(() => {
        if (room.game === g && g.state === 'ROLLING') this.scheduleDice(room, 1 + Math.floor(Math.random() * 6))
      }, 1000)
    }
  }

  /** 每次动作后：检测终局 / 调度下一位（托管） */
  afterAction(room) {
    const g = room.game
    if (g.state === 'SETTLE') {
      room.fx = { dice: null, diceRolling: false, revealKept: true }
      room.state = 'SETTLE'
      for (const m of room.members) {
        if (m.conn) m.conn.send({ type: 'game.over', payload: { result: g.result, view: viewOf(g, m.seat), fx: room.fx } })
      }
      return
    }
    room.fx = { dice: null, diceRolling: false, revealKept: false }
    this.pushGameState(room)
    this.scheduleAiTurn(room)
  }

  /** 轮到 AI/托管座位时延时代打 */
  scheduleAiTurn(room) {
    const g = room.game
    if (!g || g.state !== 'PLAYING') return
    const seat = g.currentSeat
    const member = room.members.find((m) => m.seat === seat)
    if (!member || (!member.isAI && !member.aiTimer)) return // 真人在位，等待其动作
    const delay = AI_THINK_MIN + Math.floor(Math.random() * AI_THINK_RAND)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const m2 = room.members.find((x) => x.seat === seat)
      if (!m2 || (!m2.isAI && !m2.aiTimer)) return // 已重连，取消
      const hand = g.players[seat].hand
      if (g.openEnds === null) {
        const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: g.players.filter((p) => p.seat !== seat).map((p) => p.hand) })
        if (choice) play(g, seat, choice.tileIds, choice.side)
      } else {
        const choice = aiChoosePlay(hand, g.openEnds, { isLeadFirst: false })
        if (choice) play(g, seat, choice.tileIds, choice.side)
        else {
          const d = aiChooseDiscard(hand, g.openEnds)
          if (d) discard(g, seat, d.tileId)
        }
      }
      this.afterAction(room)
    }, delay)
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 + 13）

- [ ] **Step 5: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add server tests/server-rooms.test.js && git commit -m "feat(server): 开始对局、core 动作路由、AI 托管调度"
```

---

### Task 3: 断线宽限、重连、结算继续、房间销毁

**Files:**
- Modify: `server/rooms.js`
- Test: `tests/server-rooms.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/server-rooms.test.js` 追加：

```js
describe('断线重连与结算', () => {
  it('掉线进入托管（aiTimer 置位）；重连后收回托管并收到完整快照', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const c2 = room.members.find(m => m.token === tokens[1]).conn
    mgr.onDisconnect(tokens[1])
    const m2 = room.members.find(m => m.token === tokens[1])
    expect(m2.connected).toBe(false)
    expect(m2.aiTimer).toBeTruthy() // 托管已启动
    // 重连
    const c2b = conn('乙')
    const res = mgr.reconnect(c2b, tokens[1])
    expect(res.error).toBeUndefined()
    expect(m2.connected).toBe(true)
    expect(m2.aiTimer).toBeNull()
    expect(res.gameState).toBeTruthy() // 收到 game.state 快照
    expect(c2b.sent.some(x => x.type === 'game.state')).toBe(true)
    vi.useRealTimers()
  })

  it('宽限期 60s 未重连：踢出（kicked），座位空出', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const c2 = room.members.find(m => m.token === tokens[1]).conn
    mgr.onDisconnect(tokens[1])
    vi.advanceTimersByTime(60_000)
    expect(c2.sent.some(x => x.type === 'kicked')).toBe(true)
    const m2 = room.members.find(m => m.token === tokens[1])
    expect(m2.gone).toBe(true) // 标记移除
    vi.useRealTimers()
  })

  it('WAITING 阶段主动离开：成员移除；房主离开转移房主或销毁房间', () => {
    const { room, tokens } = fullRoom()
    // 全员准备后未开局，甲（房主）离开 → 房间销毁（WAITING 且空房无意义）
    const res = mgr.leave(tokens[0])
    expect(res.ok).toBe(true)
    expect(mgr.rooms.has(room.roomId)).toBe(false)
  })

  it('settleContinue：全员确认（或 5s 超时）后开下一局，掷骰者=上局赢家', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    for (let i = 0; i < 2000 && room.game.state !== 'SETTLE'; i++) vi.advanceTimersByTime(100)
    expect(room.game.state).toBe('SETTLE')
    const winner = room.game.result.winner
    const prevRound = room.game.roundNo
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    mgr.gameAction(tokens[1], 'game.settleContinue', {})
    mgr.gameAction(tokens[2], 'game.settleContinue', {})
    mgr.gameAction(tokens[3], 'game.settleContinue', {})
    expect(room.game.state).toBe('ROLLING')
    expect(room.game.roundNo).toBe(prevRound + 1)
    expect(room.game.rollerSeat).toBe(winner)
    vi.useRealTimers()
  })

  it('settleContinue 5s 超时自动继续', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    for (let i = 0; i < 2000 && room.game.state !== 'SETTLE'; i++) vi.advanceTimersByTime(100)
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    vi.advanceTimersByTime(5000)
    expect(room.game.state).toBe('ROLLING')
    vi.useRealTimers()
  })

  it('token 索引在房间销毁后清空', () => {
    const { room, tokens } = fullRoom()
    for (const t of tokens) mgr.leave(t)
    expect(mgr.tokens.size).toBe(0)
    expect(mgr.rooms.size).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 新增 6 用例 FAIL（`mgr.onDisconnect is not a function`）

- [ ] **Step 3: 实现（rooms.js 类内追加）**

```js
  // ---------- 断线/重连/离开/销毁 ----------

  /** 连接断开（非主动离开）。启动宽限计时 + AI 托管 */
  onDisconnect(token) {
    const room = this.roomOf(token)
    if (!room) return
    const me = this.memberByToken(room, token)
    if (!me) return
    me.connected = false
    me.conn = null
    if (me.graceTimer) clearTimeout(me.graceTimer)
    me.graceTimer = setTimeout(() => {
      // 宽限到期仍未连：标记移除并广播 kicked
      if (me.connected) return
      me.gone = true
      this.tokens.delete(token)
      if (me.conn) me.conn.close()
      if (room.state === 'WAITING') {
        room.members = room.members.filter((m) => !m.gone)
        if (room.members.length === 0) { this.destroyRoom(room.roomId); return }
        if (me.isHost) this.promoteHost(room)
        this.pushRoomState(room)
      } else {
        // 对局中：座位空缺由托管继续；仅通知其余真人
        this.pushRoomState(room)
      }
      if (me.conn) me.conn.send({ type: 'kicked', payload: { reason: '超时未重连' } })
    }, GRACE_MS)
    // 启动托管（若轮到该座位立即调度；后续轮转由 scheduleAiTurn 覆盖）
    this.enableAiControl(room, me)
    this.pushRoomState(room)
  }

  enableAiControl(room, member) {
    if (member.isAI) return
    member.aiTimer = true // 标记托管态（真实定时器在 scheduleAiTurn 中）
    // 若当前正轮到该座位且无 pending 定时器，主动调度一次
    const g = room.game
    if (g && g.state === 'PLAYING' && g.currentSeat === member.seat) this.scheduleAiTurn(room)
    if (g && g.state === 'ROLLING' && g.rollerSeat === member.seat) this.maybeAutoRoll(room)
  }

  disableAiControl(room, member) {
    member.aiTimer = null
  }

  /** 断线重连：恢复身份，下发完整快照 */
  reconnect(conn, token) {
    const room = this.roomOf(token)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间已解散' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'ROOM_GONE', message: '房间已解散' } }
    if (me.conn && me.conn !== conn) { try { me.conn.close() } catch { /* 旧连接已死 */ } }
    me.conn = conn
    me.connected = true
    me.gone = false
    if (me.graceTimer) { clearTimeout(me.graceTimer); me.graceTimer = null }
    this.disableAiControl(room, me)
    conn.send({ type: 'room.state', payload: { room: this.roomState(room) } })
    if (room.game) conn.send({ type: 'game.state', payload: this.gameView(room, me.seat) })
    this.pushRoomState(room, token) // 通知他人
    return { room, seat: me.seat, gameState: room.game ? this.gameView(room, me.seat) : null }
  }

  /** 主动离开。WAITING 移除成员（房主离开则转移或销毁）；对局中按掉线处理 */
  leave(token) {
    const room = this.roomOf(token)
    if (!room) return { ok: true }
    const me = this.memberByToken(room, token)
    if (!me) return { ok: true }
    if (room.state === 'WAITING') {
      room.members = room.members.filter((m) => m !== me)
      this.tokens.delete(token)
      if (me.conn) { try { me.conn.send({ type: 'kicked', payload: { reason: '已离开房间' } }) } catch { /* noop */ } }
      if (room.members.length === 0) { this.destroyRoom(room.roomId); return { ok: true } }
      if (me.isHost) this.promoteHost(room)
      this.pushRoomState(room)
      return { ok: true }
    }
    // 对局中视为断线（走宽限+托管，无法真正退赛）
    if (me.conn) { try { me.conn.close() } catch { /* noop */ } }
    this.onDisconnect(token)
    return { ok: true }
  }

  promoteHost(room) {
    const next = room.members.find((m) => !m.gone)
    if (next) { next.isHost = true; room.hostToken = next.token }
  }

  destroyRoom(roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const m of room.members) {
      this.tokens.delete(m.token)
      if (m.graceTimer) clearTimeout(m.graceTimer)
      m.conn = null
    }
    this.rooms.delete(roomId)
  }

  /** 定时清理：WAITING 且全员断线的僵尸房 */
  sweep() {
    for (const room of [...this.rooms.values()]) {
      const alive = room.members.some((m) => m.connected && !m.gone)
      if (room.state === 'WAITING' && !alive) this.destroyRoom(room.roomId)
    }
  }

  // ---------- 结算继续 ----------

  /** 在 gameAction 内分流：settleContinue */
  settleContinue(token) {
    const room = this.roomOf(token)
    if (!room || !room.game || room.game.state !== 'SETTLE') return { error: { code: 'BAD_STATE', message: '非结算阶段' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    room.settleAck.add(me.seat)
    if (room.settleAck.size >= room.members.filter((m) => !m.gone).length) {
      this.startNextRound(room)
    } else if (!room.settleTimer) {
      room.settleTimer = setTimeout(() => this.startNextRound(room), 5000)
    }
    return { ok: true }
  }

  startNextRound(room) {
    if (room.settleTimer) { clearTimeout(room.settleTimer); room.settleTimer = null }
    if (room.game?.state !== 'SETTLE') return
    const winner = room.game.result.winner
    this.beginRound(room, winner)
  }
```

并在 `gameAction` 的动作分发链末尾（`return { error: { code: 'UNKNOWN_ACTION' ... } }` 之前）加入：

```js
    if (type === 'game.settleContinue') return this.settleContinue(token)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 + 19）

- [ ] **Step 5: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add server tests/server-rooms.test.js && git commit -m "feat(server): 断线宽限/重连/结算继续/房间销毁"
```

---

### Task 4: server/index.js——WebSocket 入口与消息路由

**Files:**
- Create: `server/index.js`
- Test: `tests/server-index.test.js`

- [ ] **Step 1: 写失败的集成测试（随机端口起真服务器）**

`tests/server-index.test.js` 全部内容：

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { createServerApp } from '../server/index.js'

let app // { httpServer, wss, port }
beforeAll(async () => {
  app = createServerApp(0) // 端口 0 = 随机
  await new Promise((r) => app.httpServer.listen(app.port, r))
  await new Promise((r) => app.httpServer.once('listening', r))
})
afterAll(async () => {
  await new Promise((r) => app.httpServer.close(r))
})

function wsUrl() { return `ws://127.0.0.1:${app.port}` }

/** 测试用客户端：收集推送，支持请求 */
function client() {
  const ws = new WebSocket(wsUrl())
  const inbox = []
  const waiters = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    inbox.push(msg)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1) }
    }
  })
  const opened = new Promise((r) => ws.on('open', r))
  const request = (type, payload) => {
    const id = `req-${Math.random().toString(36).slice(2)}`
    return new Promise((resolve) => {
      waiters.push({ pred: (m) => m.requestId === id, resolve })
      ws.send(JSON.stringify({ type, payload, requestId: id }))
    })
  }
  const waitFor = (pred, timeoutMs = 3000) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(pred)
      if (hit) return resolve(hit)
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs)
      waiters.push({ pred: (m) => { if (pred(m)) { clearTimeout(t); return true } return false }, resolve })
    })
  return { ws, inbox, opened, request, waitFor }
}

describe('server/index.js 消息路由', () => {
  it('创建房间 → 快速匹配加入 → 准备 → 开始 → 收到 game.state', async () => {
    const host = client()
    await host.opened
    const createRes = await host.request('room.create', { name: '甲' })
    expect(createRes.type).toBe('room.created')
    const roomId = createRes.payload.room.roomId

    const guest = client()
    await guest.opened
    const joinRes = await guest.request('room.quickMatch', { name: '乙' })
    expect(joinRes.type).toBe('room.joined')
    expect(joinRes.payload.room.roomId).toBe(roomId)

    // 凑 4 人
    const others = []
    for (const n of ['丙', '丁']) {
      const c = client()
      await c.opened
      const r = await c.request('room.join', { name: n, roomId })
      expect(r.type).toBe('room.joined')
      others.push(c)
    }
    // 全员准备（含房主）
    await host.request('room.ready', { ready: true })
    for (const c of others) await c.request('room.ready', { ready: true })
    await guest.request('room.ready', { ready: true })
    // 房主开始
    const startRes = await host.request('game.start', {})
    expect(startRes.type).toBe('game.started')
    // 每个客户端应收到 game.state（ROLLING 阶段）
    const st = await guest.waitFor((m) => m.type === 'game.state')
    expect(st.payload.view.state).toBe('ROLLING')
  })

  it('非法动作返回 error（requestId 关联）', async () => {
    const c = client()
    await c.opened
    const res = await c.request('game.play', { tileIds: ['t1-1'] })
    expect(res.type).toBe('error')
    expect(res.payload.message).toBeTruthy()
  })

  it('reconnect：未知 token 返回 ROOM_GONE error', async () => {
    const c = client()
    await c.opened
    const res = await c.request('reconnect', { token: 'bogus' })
    expect(res.type).toBe('error')
    expect(res.payload.code).toBe('ROOM_GONE')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: FAIL `Cannot find module '../server/index.js'`

- [ ] **Step 3: 实现 server/index.js**

```js
import { WebSocketServer } from 'ws'
import { RoomManager } from './rooms.js'

/**
 * 顶牛子联网对战服务器。
 * createServerApp(port) 返回 { httpServer, wss, port }，便于测试用随机端口。
 * node index.js 直接启动（默认 3001）。
 */

export function createServerApp(port = 3001) {
  const mgr = new RoomManager()
  const httpServer = createHttpServer()
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (socket) => {
    // 连接级包装：send 支持 obj 并自动 JSON；close 幂等
    const conn = {
      raw: socket,
      send(obj) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj)) },
      close() { try { socket.close() } catch { /* noop */ } },
    }
    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { conn.send({ type: 'error', payload: { code: 'BAD_JSON', message: '消息格式错误' } }); return }
      handle(mgr, conn, msg)
    })
    socket.on('close', () => {
      mgr.onConnClose(conn)
    })
  })

  const sweepTimer = setInterval(() => mgr.sweep(), 30_000)
  sweepTimer.unref?.()

  return { httpServer, wss, port, mgr }
}

/** 消息路由：type → RoomManager 方法。响应带 requestId 回执 */
function handle(mgr, conn, msg) {
  const { type, payload = {}, requestId } = msg
  const reply = (type2, payload2) => conn.send({ type: type2, payload: payload2, ...(requestId ? { requestId } : {}) })
  const replyError = (code, message) => reply('error', { code, message })

  switch (type) {
    case 'room.create': {
      const { room, token, error } = mgr.createRoom(conn, String(payload.name || '玩家'))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.created', { room: mgr.roomState(room), token, yourSeat: 0 })
    }
    case 'room.join': {
      const roomId = Number(payload.roomId)
      const { room, token, seat, error } = mgr.joinRoom(conn, String(payload.name || '玩家'), roomId)
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.joined', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.quickMatch': {
      const { room, token, seat, error } = mgr.quickMatch(conn, String(payload.name || '玩家'))
      if (error) return replyError(error.code, error.message)
      conn.token = token
      return reply('room.joined', { room: mgr.roomState(room), token, yourSeat: seat })
    }
    case 'room.seat': {
      const res = mgr.moveSeat(conn.token, Number(payload.roomId), Number(payload.seat))
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.seat.ok', {})
    }
    case 'room.ready': {
      const res = mgr.setReady(conn.token, Number(payload.roomId), !!payload.ready)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('room.ready.ok', {})
    }
    case 'room.leave': {
      mgr.leave(conn.token)
      conn.token = null
      return reply('room.left', {})
    }
    case 'game.start': {
      const room = mgr.roomOf(conn.token)
      const res = mgr.startGame(conn.token, room ? room.roomId : NaN)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('game.started', {})
    }
    case 'game.roll':
    case 'game.play':
    case 'game.discard':
    case 'game.settleContinue': {
      const res = mgr.gameAction(conn.token, type, payload)
      if (res.error) return replyError(res.error.code, res.error.message)
      return reply('action.ok', {})
    }
    case 'reconnect': {
      const res = mgr.reconnect(conn, String(payload.token || ''))
      if (res.error) return replyError(res.error.code, res.error.message)
      conn.token = String(payload.token)
      return reply('reconnected', { room: mgr.roomState(res.room), yourSeat: res.seat })
    }
    default:
      return replyError('UNKNOWN_TYPE', `未知消息类型: ${type}`)
  }
}

import { createServer as createHttpServer } from 'node:http'

// 服务级：连接关闭时按 conn.token 找成员触发断线流程
RoomManager.prototype.onConnClose = function (conn) {
  if (!conn.token) return
  this.onDisconnect(conn.token)
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const app = createServerApp(Number(process.env.PORT || 3001))
  app.httpServer.listen(app.port, () => console.log(`[dingniuzi] ws server listening on :${app.port}`))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 + 22）

- [ ] **Step 5: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add server tests/server-index.test.js && git commit -m "feat(server): WebSocket 入口与消息路由（createServerApp）"
```

---

### Task 5: 客户端 net.js——WS 封装（连接/心跳/重连/请求关联）

**Files:**
- Create: `src/utils/config.js`
- Create: `src/utils/net.js`
- Test: `tests/client-net.test.js`

- [ ] **Step 1: 写失败的单测（mock 全局 WebSocket 与 uni）**

`tests/client-net.test.js` 全部内容：

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

// uni 全局 mock（net.js 存储用）
globalThis.uni = { setStorageSync: vi.fn(), getStorageSync: () => '' }

// 最小 WebSocket mock：实例可控触发 open/message/close
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  constructor(url) {
    FakeWebSocket.last = this
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.sent = []
    this.onopen = null; this.onmessage = null; this.onclose = null
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { if (this.readyState !== FakeWebSocket.CLOSED) { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({}) } }
  __open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  __recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}
globalThis.WebSocket = FakeWebSocket

import { createNet } from '../src/utils/net.js'
import { SERVER_WS_URL } from '../src/utils/config.js'

describe('net.js', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('connect 建立 WebSocket 到配置地址并 resolve', async () => {
    const net = createNet()
    const p = net.connect()
    FakeWebSocket.last.__open()
    await p
    expect(FakeWebSocket.last.url).toBe(SERVER_WS_URL)
  })

  it('request 发送带 requestId 的消息并关联响应', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const req = net.request('room.create', { name: '甲' })
    const sent = FakeWebSocket.last.sent[0]
    expect(sent.requestId).toBeTruthy()
    FakeWebSocket.last.__recv({ type: 'room.created', payload: { ok: 1 }, requestId: sent.requestId })
    const res = await req
    expect(res.type).toBe('room.created')
  })

  it('推送分发给 on 订阅者', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const got = []
    net.on('game.state', (pl) => got.push(pl))
    FakeWebSocket.last.__recv({ type: 'game.state', payload: { view: {} } })
    expect(got).toEqual([{ view: {} }])
  })

  it('断线后自动重连（1s 退避）并重新订阅', async () => {
    const net = createNet()
    const p = net.connect(); FakeWebSocket.last.__open(); await p
    const got = []
    net.on('room.state', (pl) => got.push(pl))
    FakeWebSocket.last.__close() // 触发断线
    expect(net.status.value).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    FakeWebSocket.last.__open() // 新连接建立
    FakeWebSocket.last.__recv({ type: 'room.state', payload: { n: 1 } })
    expect(got).toEqual([{ n: 1 }]) // 订阅在新连接上依然生效
  })

  it('status 状态流转：connecting → open → closed', async () => {
    const net = createNet()
    const p = net.connect()
    expect(net.status.value).toBe('connecting')
    FakeWebSocket.last.__open(); await p
    expect(net.status.value).toBe('open')
    FakeWebSocket.last.__close()
    vi.advanceTimersByTime(1000)
    FakeWebSocket.last.__open()
    expect(net.status.value).toBe('open')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: FAIL `Cannot find module '../src/utils/net.js'`

- [ ] **Step 3: 实现 config.js 与 net.js**

`src/utils/config.js`：

```js
// 服务器地址配置。H5 开发/演示：与页面同主机的 3001 端口。
// 多端发布时可改为构建注入或远端地址。
const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1'
export const SERVER_WS_URL = `ws://${host}:3001`
```

`src/utils/net.js`：

```js
// src/utils/net.js
import { ref } from 'vue'
import { SERVER_WS_URL } from './config.js'

/**
 * WebSocket 客户端封装：
 * - connect(): 建连（含自动重连，指数退避 1s→2s→4s→8s，最多 5 次）
 * - request(type, payload): Promise<{ type, payload }>，8s 超时
 * - on(type, handler): 推送订阅（重连后依然生效）
 * - status: ref<'connecting'|'open'|'reconnecting'|'closed'>
 */

const REQUEST_TIMEOUT = 8000
const MAX_RETRIES = 5

export function createNet() {
  let ws = null
  let reqSeq = 0
  const pending = new Map() // requestId -> { resolve, reject, timer }
  const listeners = new Map() // type -> Set<handler>
  const status = ref('connecting')
  let retries = 0
  let closedByUser = false
  let manuallyClosed = false

  function rawConnect() {
    status.value = retries === 0 ? 'connecting' : 'reconnecting'
    ws = new WebSocket(SERVER_WS_URL)
    ws.onopen = () => { retries = 0; status.value = 'open' }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.requestId && pending.has(msg.requestId)) {
        const { resolve, timer } = pending.get(msg.requestId)
        clearTimeout(timer)
        pending.delete(msg.requestId)
        resolve(msg)
        return
      }
      const set = listeners.get(msg.type)
      if (set) for (const h of set) h(msg.payload, msg)
    }
    ws.onclose = () => {
      if (manuallyClosed) { status.value = 'closed'; return }
      status.value = 'reconnecting'
      if (retries >= MAX_RETRIES) { status.value = 'closed'; return }
      const delay = Math.min(1000 * 2 ** retries, 8000)
      retries += 1
      setTimeout(() => { if (!manuallyClosed) rawConnect() }, delay)
    }
  }

  function connect() {
    manuallyClosed = false
    return new Promise((resolve, reject) => {
      ws = new WebSocket(SERVER_WS_URL)
      ws.onopen = () => { retries = 0; status.value = 'open'; resolve() }
      ws.onerror = () => reject(new Error('连接服务器失败'))
      ws.onclose = () => { if (manuallyClosed) { status.value = 'closed' } else { retries = 0; rawConnect() } }
      ws.onmessage = dispatch
    })
  }

  function dispatch(ev) {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.requestId && pending.has(msg.requestId)) {
      const { resolve, timer } = pending.get(msg.requestId)
      clearTimeout(timer)
      pending.delete(msg.requestId)
      resolve(msg)
      return
    }
    const set = listeners.get(msg.type)
    if (set) for (const h of set) h(msg.payload, msg)
  }

  function request(type, payload = {}) {
    const requestId = `r${Date.now().toString(36)}-${reqSeq += 1}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('请求超时'))
      }, REQUEST_TIMEOUT)
      pending.set(requestId, { resolve, reject, timer })
      ws.send(JSON.stringify({ type, payload, requestId }))
    })
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(handler)
    return () => listeners.get(type)?.delete(handler)
  }

  function close() {
    manuallyClosed = true
    if (ws) ws.close()
    status.value = 'closed'
  }

  return { connect, request, on, close, status }
}

// 页面级共享单例（lobby/room/game 共用一条连接）
let shared = null
export function sharedNet() {
  if (!shared) shared = createNet()
  return shared
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 + 27）

- [ ] **Step 5: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add src/utils tests/client-net.test.js && git commit -m "feat(client): net.js WebSocket 封装（重连/requestId/订阅）"
```

---

### Task 6: useNetGame composable

**Files:**
- Create: `src/composables/useNetGame.js`
- Test: `tests/client-useNetGame.test.js`

- [ ] **Step 1: 写失败的测试（mock net 与规则只读计算）**

`tests/client-useNetGame.test.js` 全部内容：

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

globalThis.uni = {
  setStorageSync: vi.fn(),
  getStorageSync: (k) => ({ dingniuzi_player_name: '测试甲' }[k] ?? ''),
  showToast: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
}

// 可控的假 net
function fakeNet() {
  const handlers = new Map()
  return {
    status: { value: 'open' },
    sent: [],
    on(type, h) { (handlers.get(type) || handlers.set(type, []).get(type)).add(h); return () => {} },
    async request(type, payload) { this.sent.push({ type, payload }); return { type: 'action.ok', payload: {} } },
    /** 测试注入推送 */
    __push(type, payload) { for (const h of handlers.get(type) || []) h(payload) },
  }
}

import { useNetGame } from '../src/composables/useNetGame.js'

describe('useNetGame', () => {
  it('收到 game.state 后 view/fx 整体更新；myTurn/mustDiscard/playableIds 正确', () => {
    const net = fakeNet()
    const { view, fx, myTurn, mustDiscard, playableIds, labelOf } = useNetGame(net)
    expect(view.state).toBe('') // 初始空视图
    net.__push('game.state', {
      view: {
        state: 'PLAYING', leaderSeat: 1, rollerSeat: 1, currentSeat: 0,
        tableTile: null, openEnds: { top: 6, bottom: 3 },
        myHand: [{ id: 't5-1', name: '大五', a: 5, b: 5 }, { id: 't11-1', name: '地幺', a: 1, b: 1 }],
        myKept: [], opponents: [{ seat: 1, handCount: 5, keptCount: 0 }, { seat: 2, handCount: 6, keptCount: 0 }, { seat: 3, handCount: 6, keptCount: 0 }],
        result: null, tableHistory: [],
      },
      fx: { dice: null, diceRolling: false, revealKept: false },
      yourSeat: 0,
      names: { 0: '测试甲', 1: '乙', 2: '丙', 3: '丁' },
    })
    expect(view.state).toBe('PLAYING')
    expect(view.myHand).toHaveLength(2)
    expect(myTurn.value).toBe(true)
    expect(mustDiscard.value).toBe(false)
    // openEnds {6,3}：大五(5,5)接不上；无 6/3 端 → 须扣牌？地幺(1,1)也接不上 → mustDiscard true
    expect(mustDiscard.value).toBe(true)
    expect(playableIds.value).toEqual([])
    expect(labelOf(0)).toBe('我')
    expect(labelOf(1)).toBe('乙')
  })

  it('动作：myPlay/myDiscard/roll 转发 request；失败返回 {ok:false, reason}', async () => {
    const net = fakeNet()
    net.request = async (type, payload) => {
      if (type === 'game.play') return { type: 'error', payload: { code: 'ILLEGAL', message: '这张牌接不上底端' } }
      return { type: 'action.ok', payload: {} }
    }
    const { view, myPlay, roll } = useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: { top: 6, bottom: 3 }, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: {},
    })
    const bad = await myPlay('t5-1', 'bottom')
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('这张牌接不上底端')
    await roll()
    expect(net.sent.some(s => s.type === 'game.roll')).toBe(true)
  })

  it('game.over：result 写入 view，revealKept 置位', () => {
    const net = fakeNet()
    const { view, fx } = useNetGame(net)
    net.__push('game.over', { result: { winner: 2, ranks: [], scores: { 0: -1, 1: -2, 2: 6, 3: -3 } }, fx: { revealKept: true } })
    expect(view.result.winner).toBe(2)
    expect(fx.revealKept).toBe(true)
  })

  it('restart 发 settleContinue', async () => {
    const net = fakeNet()
    const { restart } = useNetGame(net)
    await restart()
    expect(net.sent.some(s => s.type === 'game.settleContinue')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: FAIL `Cannot find module '../src/composables/useNetGame.js'`

- [ ] **Step 3: 实现 useNetGame.js**

```js
// src/composables/useNetGame.js
import { reactive, computed, ref } from 'vue'
import { sharedNet } from '../utils/net.js'
import { mustDiscardEnds as coreMustDiscardEnds, playableTilesEnds as corePlayableTilesEnds } from '../core/rules.js'

/**
 * 联网局管理：接口与 useGame 一致，数据源为服务器推送。
 * view/fx 整体替换自 game.state 推送；动作为网络请求，结果以服务器推送为准。
 * 额外导出：connection（连接状态 ref）、restart()（发 settleContinue）、roomId、mySeat。
 */
export function useNetGame(net = sharedNet()) {
  const view = reactive({
    state: '', leaderSeat: null, rollerSeat: null, currentSeat: null,
    tableTile: null, openEnds: null, myHand: [], myKept: [],
    opponents: [], result: null, tableHistory: [],
  })
  const fx = reactive({ dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null })
  const connection = net.status
  const roomId = ref(null)
  const mySeat = ref(0)
  const names = reactive({ 0: '我', 1: '下家', 2: '对家', 3: '上家' })

  const offState = net.on('game.state', ({ view: v, fx: f, roomId: rid, yourSeat, names: n }) => {
    Object.keys(v).forEach((k) => { view[k] = v[k] })
    Object.assign(fx, { dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null }, f)
    if (rid !== undefined) roomId.value = rid
    if (yourSeat !== undefined) mySeat.value = yourSeat
    if (n) Object.assign(names, n)
  })
  const offOver = net.on('game.over', ({ result, fx: f }) => {
    view.result = result
    Object.assign(fx, { dice: null, diceRolling: false }, f)
  })

  /** UI 视角座位名：自己=「我」，其余显示成员昵称 */
  const labelOf = (seat) => (seat === mySeat.value ? '我' : names[seat] || `座位${seat}`)

  const myTurn = computed(() => view.state === 'PLAYING' && view.currentSeat === mySeat.value)
  const mustDiscard = computed(
    () => myTurn.value && view.openEnds !== null && coreMustDiscardEnds(view.myHand, view.openEnds)
  )
  // 客户端只读计算高亮（无作弊面）；头牌首出「不拉三家」由服务端裁决，客户端不预过滤
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.openEnds === null) return view.myHand.map((t) => t.id)
    return corePlayableTilesEnds(view.myHand, view.openEnds).map((t) => t.id)
  })

  /** 真人掷骰（动画节奏由服务端 fx 驱动，这里仅发请求） */
  async function roll() {
    try { await net.request('game.roll', {}) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
  }

  async function myPlay(tileId, side = 'bottom') {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    try {
      await net.request('game.play', { tileIds: [tileId], side })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }

  async function myDiscard(tileId) {
    if (!myTurn.value) return { ok: false, reason: '没轮到你' }
    try {
      await net.request('game.discard', { tileId })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }

  async function restart() {
    try { await net.request('game.settleContinue', {}) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
  }

  /** 掷骰权座位：以服务器 view.rollerSeat 为准；未开局时回退自己座位（单机语义为 0） */
  const diceRollerSeat = computed(() => view.rollerSeat ?? mySeat.value)

  return { view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat, roll, myPlay, myDiscard, restart, connection, roomId, mySeat }
}
```

注意：`diceRollerSeat` 在 useGame 中是普通值（永远 0）；useNetGame 中为 computed（跟随服务器 view.rollerSeat）。game.vue 中 `diceRollerSeat === 0` 的"是否轮到我掷骰"判断在 net 模式下须改为 `diceRollerSeat === mySeat`（Task 8 处理）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 + 31）

- [ ] **Step 5: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add src/composables/useNetGame.js tests/client-useNetGame.test.js && git commit -m "feat(client): useNetGame 联网 composable（与 useGame 同接口）"
```

---

### Task 7: 大厅页、房间页、路由注册、主菜单入口

**Files:**
- Create: `src/pages/lobby/lobby.vue`
- Create: `src/pages/room/room.vue`
- Modify: `src/pages.json`
- Modify: `src/pages/index/index.vue`

- [ ] **Step 1: 注册页面路由**

`src/pages.json` 的 `pages` 数组在 game 之后追加：

```json
{
  "path": "pages/lobby/lobby",
  "style": { "navigationBarTitleText": "顶牛子", "navigationStyle": "custom" }
},
{
  "path": "pages/room/room",
  "style": { "navigationBarTitleText": "顶牛子", "navigationStyle": "custom" }
}
```

- [ ] **Step 2: 实现 lobby.vue**

`src/pages/lobby/lobby.vue` 完整内容：

```vue
<!-- src/pages/lobby/lobby.vue -->
<template>
  <view class="lobby">
    <text class="title">联网对战</text>
    <view class="form">
      <input class="name-input" v-model="name" placeholder="你的昵称" maxlength="12" />
      <button class="btn-primary" :disabled="busy" @click="quickMatch">快速匹配</button>
      <button class="btn-secondary" :disabled="busy" @click="createRoom">创建房间</button>
      <view class="join-row">
        <input class="room-input" v-model="joinId" type="number" placeholder="房间号" maxlength="6" />
        <button class="btn-secondary" :disabled="busy || joinId.length !== 6" @click="join">加入</button>
      </view>
    </view>
    <button class="btn-back" @click="goHome">返回主菜单</button>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const name = ref(uni.getStorageSync('dingniuzi_player_name') || `玩家${Math.floor(1000 + Math.random() * 9000)}`)
const joinId = ref('')
const busy = ref(false)

async function enter(requestFn, payload) {
  busy.value = true
  try {
    if (net.status.value !== 'open') await net.connect()
    uni.setStorageSync('dingniuzi_player_name', name.value)
    const res = await net.request(requestFn, { name: name.value, ...payload })
    if (res.type === 'error') {
      uni.showToast({ title: res.payload.message, icon: 'none' })
      return
    }
    uni.setStorageSync('dingniuzi_player_token', res.payload.token)
    uni.redirectTo({ url: `/pages/room/room?roomId=${res.payload.room.roomId}` })
  } catch (e) {
    uni.showToast({ title: e.message || '连接失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}
const quickMatch = () => enter('room.quickMatch', {})
const createRoom = () => enter('room.create', {})
const join = () => enter('room.join', { roomId: Number(joinId.value) })
const goHome = () => uni.reLaunch({ url: '/pages/index/index' })
</script>

<style scoped>
.lobby { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40rpx; padding: 60rpx; box-sizing: border-box; }
.title { font-size: 56rpx; font-weight: bold; color: #f5f0e1; letter-spacing: 6rpx; }
.form { display: flex; flex-direction: column; gap: 24rpx; width: 100%; max-width: 560rpx; }
.name-input, .room-input { background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32; border-radius: 12rpx; padding: 20rpx 24rpx; color: #f5f0e1; font-size: 28rpx; }
.join-row { display: flex; gap: 16rpx; }
.join-row .room-input { flex: 1; }
.btn-back { margin-top: 20rpx; background: transparent; color: #b0a685; border: none; font-size: 26rpx; }
</style>
```

- [ ] **Step 3: 实现 room.vue**

`src/pages/room/room.vue` 完整内容：

```vue
<!-- src/pages/room/room.vue -->
<template>
  <view class="room">
    <view class="head">
      <text class="room-id">房间号 {{ roomId }}</text>
      <text class="hint">把房间号告诉朋友，或让他们用「快速匹配」加入</text>
    </view>
    <view class="seats">
      <view v-for="seat in [0, 1, 2, 3]" :key="seat" class="seat" :class="{ me: seat === mySeat, taken: memberOf(seat) }" @click="tapSeat(seat)">
        <text class="seat-no">{{ seatName(seat) }}</text>
        <text class="seat-name">{{ memberOf(seat)?.name || '空位' }}</text>
        <text v-if="memberOf(seat)" class="seat-status">
          {{ memberOf(seat).isHost ? '房主 · ' : '' }}{{ memberOf(seat).ready ? '已准备' : '未准备' }}{{ memberOf(seat).connected ? '' : ' · 掉线' }}
        </text>
        <text v-else class="seat-status">点击入座</text>
      </view>
    </view>
    <view class="actions">
      <template v-if="isHost">
        <button class="btn-primary" :disabled="!canStart" @click="start">{{ startHint }}</button>
      </template>
      <button v-if="memberOf(mySeat) && !memberOf(mySeat).ready" class="btn-secondary" @click="setReady(true)">准备</button>
      <button v-else-if="memberOf(mySeat)" class="btn-secondary" @click="setReady(false)">取消准备</button>
      <button class="btn-leave" @click="leave">离开房间</button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { sharedNet } from '../../utils/net.js'

const net = sharedNet()
const roomId = ref(null)
const room = ref(null)
const token = uni.getStorageSync('dingniuzi_player_token')
const mySeat = ref(0)
const SEAT_NAMES = ['自己', '下家', '对家', '上家']

const offRoom = net.on('room.state', ({ room: r }) => {
  room.value = r
  roomId.value = r.roomId
  const me = r.members.find((m) => m.name === myName()) // 兜底：以 token 对应座位为准（见下 reconnect 快照）
})
const offStart = net.on('game.state', () => {
  // 服务器开始对局后客户端收到 game.state → 跳牌桌（net 模式）
  uni.redirectTo({ url: '/pages/game/game?mode=net' })
})
const offKicked = net.on('kicked', ({ reason }) => {
  uni.showToast({ title: reason, icon: 'none' })
  uni.reLaunch({ url: '/pages/lobby/lobby' })
})

function myName() { return uni.getStorageSync('dingniuzi_player_name') }
function memberOf(seat) { return room.value?.members.find((m) => m.seat === seat) || null }
const isHost = computed(() => memberOf(mySeat.value)?.isHost || false)
const canStart = computed(() => {
  if (!room.value) return false
  return room.value.members.length === 4 && room.value.members.every((m) => m.ready)
})
const startHint = computed(() => (canStart.value ? '开始游戏' : `还差 ${4 - (room.value?.members.length || 0)} 人 / 待准备`))
const seatName = (seat) => `${seat + 1}号位 · ${SEAT_NAMES[seat]}`

async function tapSeat(seat) {
  if (seat === mySeat.value || !memberOf) return
  if (memberOf(seat)) return
  const res = await net.request('room.seat', { roomId: roomId.value, seat })
  if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
  else mySeat.value = seat
}
async function setReady(ready) {
  const res = await net.request('room.ready', { roomId: roomId.value, ready })
  if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
}
async function start() {
  const res = await net.request('game.start', {})
  if (res.type === 'error') uni.showToast({ title: res.payload.message, icon: 'none' })
}
async function leave() {
  await net.request('room.leave', {})
  uni.reLaunch({ url: '/pages/lobby/lobby' })
}

onLoad(async (query) => {
  roomId.value = Number(query.roomId)
  // 恢复会话：用 token 重连拿房间快照（页面刷新/redirectTo 后状态不丢）
  try {
    if (net.status.value !== 'open') await net.connect()
    const res = await net.request('reconnect', { token })
    if (res.type === 'error') { uni.reLaunch({ url: '/pages/lobby/lobby' }); return }
    room.value = res.payload.room
    mySeat.value = res.payload.yourSeat
    roomId.value = res.payload.room.roomId
  } catch (e) {
    uni.showToast({ title: '连接失败', icon: 'none' })
  }
})
onUnmounted(() => { offRoom?.(); offStart?.(); offKicked?.() })
</script>

<style scoped>
.room { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx 60rpx; gap: 40rpx; box-sizing: border-box; }
.head { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.room-id { font-size: 56rpx; font-weight: bold; color: #c9a227; letter-spacing: 8rpx; }
.hint { font-size: 24rpx; color: #b0a685; }
.seats { display: flex; flex-wrap: wrap; gap: 20rpx; justify-content: center; }
.seat { width: 300rpx; padding: 28rpx 24rpx; border-radius: 16rpx; background: rgba(58, 44, 20, 0.5); border: 2rpx solid #5a4a32; display: flex; flex-direction: column; gap: 8rpx; }
.seat.me { border-color: #c9a227; }
.seat.taken { background: rgba(74, 52, 24, 0.7); }
.seat-no { font-size: 22rpx; color: #b0a685; }
.seat-name { font-size: 32rpx; color: #f5f0e1; }
.seat-status { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; flex-direction: column; gap: 20rpx; width: 100%; max-width: 560rpx; margin-top: 20rpx; }
.btn-leave { background: transparent; color: #b0a685; border: 2rpx solid #5a4a32; }
</style>
```

- [ ] **Step 4: 主菜单加联网入口**

`src/pages/index/index.vue` 的 `menu-buttons` 中「开始游戏」按钮之后插入：

```html
<button class="btn-secondary" @click="startOnline">联网对战</button>
```

script 中追加：

```js
function startOnline() {
  uni.navigateTo({ url: '/pages/lobby/lobby' })
}
```

- [ ] **Step 5: 构建验证**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" run build:h5 2>&1`
Expected: 构建成功，产出 dist/build/h5（lobby/room 页面进入构建产物）

- [ ] **Step 6: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add src/pages.json src/pages/lobby src/pages/room src/pages/index/index.vue && git commit -m "feat(client): 大厅与房间页、路由注册、主菜单联网入口"
```

---

### Task 8: game.vue 接入双模式（solo/net）

**Files:**
- Modify: `src/pages/game/game.vue`（script 部分 + 模板少量绑定）

- [ ] **Step 1: 改造 game.vue 的 composable 选择与 net 差异点**

对 `src/pages/game/game.vue` 做以下修改（保持模板组件零改动）：

1. script 中替换 useGame 导入与调用：

```js
// 原来：
// import { useGame } from '../../composables/useGame.js'
// const { view, fx, myTurn, ... } = useGame()
// 改为：
import { useGame } from '../../composables/useGame.js'
import { useNetGame } from '../../composables/useNetGame.js'
import { computed as _computed } from 'vue'

const isNet = ref(false)
const gameApi = ref(null)

// onLoad 决定模式（uni-app 页面级生命周期）
import { onLoad } from '@dcloudio/uni-app'
onLoad((query) => {
  isNet.value = query.mode === 'net'
  gameApi.value = isNet.value ? useNetGame() : useGame()
})
```

2. 由于 `gameApi` 在 onLoad 后才有值，把解构改为 computed 代理（在 script setup 顶层）：

```js
const view = computed(() => gameApi.value?.view ?? emptyView())
const fx = computed(() => gameApi.value?.fx ?? emptyFx())
const myTurn = computed(() => gameApi.value?.myTurn.value ?? false)
const mustDiscard = computed(() => gameApi.value?.mustDiscard.value ?? false)
const playableIds = computed(() => gameApi.value?.playableIds.value ?? [])
const diceRollerSeat = computed(() => (isNet.value ? gameApi.value?.mySeat.value ?? 0 : 0))
const mySeatVal = computed(() => gameApi.value?.mySeat?.value ?? 0)

function emptyView() { return { state: '', myHand: [], myKept: [], opponents: [], tableHistory: [], openEnds: null, leaderSeat: null, currentSeat: null, rollerSeat: null, result: null } }
function emptyFx() { return { dice: null, diceRolling: false, settleShow: false, revealKept: false, lastMove: null } }
```

3. 模板中的调用点适配（仅改 3 处 + labelOf）：
   - 模板里 `view.state` / `view.myHand` 等因为 view 已是 computed，Vue 模板自动解包 ref/computed，**模板代码不用改**
   - script 内所有 `view.state === ...` 判断改为 `view.value.state === ...`（共 5 处：onRevealTap、watch fx.diceRolling 里的 fx、turnText、opponentBySeat、lastMoveOf、discardEntries、selectedForcedSide、onConfirmPlay、onSidePick、onConfirmDiscard、restart）
   - `labelOf` 改为代理：

```js
const labelOf = (seat) => gameApi.value?.labelOf(seat) ?? String(seat)
```

4. 动作调用代理：

```js
const roll = (...a) => gameApi.value?.roll(...a)
async function myPlay(tileId, side) {
  const res = await gameApi.value?.myPlay(tileId, side)
  if (res?.ok) { selectedId.value = null; mySide.value = 'bottom' }
  else uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
}
async function myDiscard(tileId) {
  const res = await gameApi.value?.myDiscard(tileId)
  if (res?.ok) selectedId.value = null
  else uni.showToast({ title: res?.reason || '扣牌失败', icon: 'none' })
}
```

   （原 onConfirmPlay/onSidePick 中的 `myPlay(...)` 返回值判断逻辑并入上述代理，两个调用点简化为直接调用。）

5. restart 分流：

```js
async function restart() {
  if (isNet.value) {
    await gameApi.value?.restart()
    fx.value.settleShow = false
    return
  }
  const winner = view.value.result?.winner
  if (winner !== undefined && winner !== null) uni.setStorageSync('dingniuzi_last_winner', winner)
  fx.value.settleShow = false
  fx.value.dice = null
  fx.value.lastMove = null
  uni.redirectTo({ url: '/pages/game/game' })
}
```

6. 模板加连接状态条（net 模式）：

```html
<view v-if="isNet && connection !== 'open'" class="net-bar">连接断开，重连中…</view>
```

script 顶部补充：

```js
const connection = computed(() => gameApi.value?.connection?.value ?? 'open')
```

`.net-bar` 样式：

```css
.net-bar { position: fixed; top: 0; left: 0; right: 0; background: #a04030; color: #fff; font-size: 24rpx; text-align: center; padding: 8rpx 0; z-index: 999; }
```

- [ ] **Step 2: 构建验证**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" run build:h5 2>&1`
Expected: 构建成功无错误

- [ ] **Step 3: 单机回归（手工）**

Run: 启动静态服务 `npx http-server dist/build/h5 -p 3000`，浏览器打开 `http://localhost:3000`
Expected: 单机模式完整可玩（掷骰→出牌→扣牌→结算），与改造前行为一致

- [ ] **Step 4: Commit**

```bash
cd "D:\demo\top-cow-card-game" && git add src/pages/game/game.vue && git commit -m "feat(client): game.vue 双模式接入（solo/net）与连接状态条"
```

---

### Task 9: 全链路联调（多窗口真实对局）

**Files:** 无新文件（验证任务）

- [ ] **Step 1: 启动服务器**

Run: `cd "D:\demo\top-cow-card-game\server" && node index.js`（后台运行）
Expected: 控制台输出 `[dingniuzi] ws server listening on :3001`

- [ ] **Step 2: 构建并起静态服务**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" run build:h5 2>&1 && npx http-server dist/build/h5 -p 3000`（后台）
Expected: http://localhost:3000 可访问

- [ ] **Step 3: 四窗口对局验证**

打开 4 个浏览器窗口访问 http://localhost:3000：
1. 窗口 1：联网对战 → 创建房间，记下房间号
2. 窗口 2/3/4：联网对战 → 输入房间号加入（或快速匹配）
3. 窗口 1 点开始 → 4 窗口都跳到牌桌，各自看到 6 张手牌且互不相同
4. 完整打一局：掷骰动画、头牌首出、跟牌/扣牌、亮牌、结算弹窗、再来一局
5. 断线测试：关闭窗口 2 再快速重开（token 仍在 storage）→ 走 reconnect 恢复；期间其座位由托管代打

Expected: 全流程无 JS 报错；各窗口 view 一致；断线窗口恢复后手牌正确

- [ ] **Step 4: 全量测试**

Run: `cd "D:\demo\top-cow-card-game" && "/d/Program Files/nodejs/npm.cmd" test 2>&1`
Expected: 全部 PASS（55 单机 + 服务端/客户端新增）

- [ ] **Step 5: Commit（如有联调修正）**

```bash
cd "D:\demo\top-cow-card-game" && git add -A && git commit -m "fix: 联网对战联调修正"
```

---

## 任务依赖

```
Task 1 (房间管理) → Task 2 (对局路由) → Task 3 (断线/结算) → Task 4 (ws 入口)
                                                                    ↓
Task 5 (net.js) → Task 6 (useNetGame) → Task 7 (lobby/room) → Task 8 (game.vue 双模式) → Task 9 (联调)
```

服务端链（1-4）与客户端基础（5-6）可并行；Task 7 依赖 4+6；Task 8 依赖 6；Task 9 依赖全部。
