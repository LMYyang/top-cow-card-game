# 算账（封账）与游戏设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现顶牛子「算账」功能：设置页（总开关 + 红/幺/三二/五账种勾选）、出牌选端宣告判定、成功翻倍/失败包庄结算、全端「算账」拍桌特效。

**Architecture:** spec 见 `docs/superpowers/specs/2026-11-16-account-settlement-design.md`。核心是 rules.js 新增纯函数 `declarationFor`（三处共用：单机 UI 高亮、联网 UI 按钮、服务端/核心复核），game.js 的 `play` 增加 `declare` 参数，`settle` 接收 account 按成功翻倍/失败包庄记分。设置页双模式：单机读本地存储，联网走 `room.setSettings` 动作随 `room.state` 广播。

**Tech Stack:** Vue 3 + uni-app (H5)，Vitest（纯 JS core 测试，node 环境），ws 服务器。

**牌 id 速查**（`src/core/tiles.js`，测试用）：
`大天 t1-1/2 (6/6)`、`虎头 t2-1/2 (5/6)`、`大五 t3-1/2 (5/5)`、`红十 t4-1/2 (4/6)`、`红八 t5-1/2 (4/4)`、`长三 t6-1/2 (3/3)`、`幺六 t7-1/2 (1/6)`、`幺五 t8-1/2 (1/5)`、`幺三 t9-1/2 (1/3)`、`二板 t10-1/2 (2/2)`、`地幺 t11-1/2 (1/1)`、`三六 t12-1 (3/6)`、`二六 t13-1 (2/6)`。竖牌：虎头/红十/幺六/幺五/幺三/三六/二六；横牌：大天/大五/红八/长三/二板/地幺。

**账种触发速查**（spec 2.1）：

| 账种 | 冻结后端点 | 触发牌 | 二三账额外条件 |
|---|---|---|---|
| 红账 | 4,4 | 红十 t4-x | — |
| 幺账 | 1,1 | 幺三/幺五/幺六 | — |
| 五账 | 5,5 | 虎头/幺五 | — |
| 二三账 | 2,3 | 幺三/三六/二六 | 手里还有其他可接牌 |

**注意：所有文件路径一律用 Windows 绝对路径（带盘符反斜杠），如 `D:\demo\top-cow-card-game\src\core\rules.js`。**

---

### Task 1: settings.js 配置模块

**Files:**
- Create: `D:\demo\top-cow-card-game\src\core\settings.js`
- Test: `D:\demo\top-cow-card-game\tests\settings.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/settings.test.js
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js'

describe('normalizeSettings 设置规整', () => {
  it('空值回默认：关闭 + 四账种全选', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
  it('DEFAULT_SETTINGS：enabled=false，四账种 true', () => {
    expect(DEFAULT_SETTINGS).toEqual({ enabled: false, red: true, yao: true, erSan: true, wu: true })
  })
  it('合法对象原样保留', () => {
    const s = { enabled: true, red: true, yao: false, erSan: true, wu: false }
    expect(normalizeSettings(s)).toEqual(s)
  })
  it('缺字段补默认、非法类型回退', () => {
    expect(normalizeSettings({ enabled: true })).toEqual({ enabled: true, red: true, yao: true, erSan: true, wu: true })
    expect(normalizeSettings({ enabled: 'yes', red: 1, yao: null, erSan: undefined, wu: false })).toEqual({
      enabled: false, red: true, yao: true, erSan: true, wu: false,
    })
  })
  it('多余字段被剥离', () => {
    const s = normalizeSettings({ enabled: true, wu: true, hack: 1 })
    expect(s).toEqual({ enabled: true, red: true, yao: true, erSan: true, wu: true })
    expect('hack' in s).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/settings.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 settings.js**

```js
// src/core/settings.js
/** 算账设置（单机本地存储与联网房间共用形态）。
 *  enabled: 算账总开关；red/yao/erSan/wu: 红/幺/三二/五账种分别勾选 */

export const DEFAULT_SETTINGS = { enabled: false, red: true, yao: true, erSan: true, wu: true }

/** 规整任意输入为合法 settings：缺省补齐、非布尔回退默认、多余字段剥离 */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pick = (v, dflt) => (typeof v === 'boolean' ? v : dflt)
  return {
    enabled: pick(src.enabled, DEFAULT_SETTINGS.enabled),
    red: pick(src.red, DEFAULT_SETTINGS.red),
    yao: pick(src.yao, DEFAULT_SETTINGS.yao),
    erSan: pick(src.erSan, DEFAULT_SETTINGS.erSan),
    wu: pick(src.wu, DEFAULT_SETTINGS.wu),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/settings.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/core/settings.js tests/settings.test.js && git commit -m "feat(core): 算账设置数据结构与 normalizeSettings"
```

---

### Task 2: declarationFor 宣告判定纯函数

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\core\rules.js`（文件末尾追加）
- Test: `D:\demo\top-cow-card-game\tests\rules.test.js`（文件末尾追加 describe）

- [ ] **Step 1: 写失败测试**

```js
// tests/rules.test.js 追加（import 行补 declarationFor）
// import { ..., declarationFor } from '../src/core/rules.js'

const FULL_ON = { enabled: true, red: true, yao: true, erSan: true, wu: true }

describe('declarationFor 算账宣告判定', () => {
  // ---- 红账：链上已有红十 t4-1，我持红十 t4-2，两端 4 和 6，接 6 端 → 两端皆 4，只剩红八能接
  const redEnds = { top: 6, bottom: 4 }
  const redChain = [tile('t4-1')] // 链上已有另一张红十
  it('红账正例：红十接 6 端（bottom）返回红账', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '红账', side: 'bottom' }])
  })
  it('红账反例：红十接 4 端不算账', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    // { top: 6, bottom: 4 } 接 top（暴露 6）→ 端 6,4：6 端不冻结（一六/幺六等可接）
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, FULL_ON)
    expect(opts.some(o => o.side === 'top')).toBe(false)
  })
  it('红账反例：链上没有另一张红十（4 端不冻结）', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const chain = [tile('t2-1')] // 链上只有二板，没有红十
    const opts = declarationFor(tile('t4-2'), { top: 6, bottom: 4 }, chain, hand, FULL_ON)
    expect(opts).toEqual([])
  })
  it('红账反例：红八（横牌）不触发', () => {
    const hand = [tile('t5-1'), tile('t5-2')]
    const opts = declarationFor(tile('t5-1'), { top: 4, bottom: 4 }, [tile('t4-1')], hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 幺账：链上已有 5 张带 1 竖牌（幺三×2 幺五×2 幺六×1），我持幺六 t7-2，两端 1 和 6，接 6 端
  const yaoChain = [tile('t9-1'), tile('t9-2'), tile('t8-1'), tile('t8-2'), tile('t7-1')]
  it('幺账正例：幺六接 6 端返回幺账', () => {
    const hand = [tile('t7-2'), tile('t11-1')]
    const opts = declarationFor(tile('t7-2'), { top: 6, bottom: 1 }, yaoChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '幺账', side: 'bottom' }])
  })
  it('幺账反例：链上缺一张带 1 竖牌', () => {
    const hand = [tile('t7-2'), tile('t11-1')]
    const opts = declarationFor(tile('t7-2'), { top: 6, bottom: 1 }, yaoChain.slice(0, 4), hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 五账：链上已有 3 张带 5 竖牌（虎头×2 + 幺五×1），我持幺五 t8-2（唯一 5 端另一张已用），
  //      两端 5 和 1，接 1 端 → 两端皆 5，只剩大五能接
  const wuChain = [tile('t2-1'), tile('t2-2'), tile('t8-1')]
  it('五账正例：幺五接 1 端返回五账', () => {
    const hand = [tile('t8-2'), tile('t11-1')]
    const opts = declarationFor(tile('t8-2'), { top: 5, bottom: 1 }, wuChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '五账', side: 'bottom' }])
  })
  it('五账反例：虎头接 5 端（接的正是封点那端）不算账', () => {
    // 我持虎头 t2-1？不可能（t2-1 在链上）。构造：链上有 3 张带 5 竖牌，我持另一张虎头
    const chain = [tile('t2-1'), tile('t8-1'), tile('t8-2')] // 虎头×1 + 幺五×2
    const hand = [tile('t2-2'), tile('t11-1')]
    // 两端 5 和 6：虎头接 6 端暴露 5 → 冻结；接 5 端暴露 6 → 不冻结
    const opts = declarationFor(tile('t2-2'), { top: 6, bottom: 5 }, chain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '五账', side: 'bottom' }])
  })

  // ---- 二三账：链上有幺三×1 + 三六 + 二六（4 张中的 3 张），我持幺三 t9-2，两端 1 和 2，
  //      接 1 端暴露 3 → 端 2,3 冻结（幺三×2/三六/二六全上链）
  const esChain = [tile('t9-1'), tile('t12-1'), tile('t13-1')]
  it('二三账正例：手里有其他可接牌时选这张返回二三账', () => {
    const hand = [tile('t9-2'), tile('t11-1'), tile('t1-1')]
    // t11-1 地幺 1/1 可接 1 端（=其他可接牌）
    const opts = declarationFor(tile('t9-2'), { top: 2, bottom: 1 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([{ type: '二三账', side: 'bottom' }])
  })
  it('二三账反例：手里没有其他可接牌时不弹算账', () => {
    const hand = [tile('t9-2'), tile('t3-1')] // 长三 3/3 接不上 1/2 端
    const opts = declarationFor(tile('t9-2'), { top: 2, bottom: 1 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([])
  })
  it('二三账反例：这张牌接不了任何一端', () => {
    const hand = [tile('t9-2'), tile('t11-1')]
    const opts = declarationFor(tile('t9-2'), { top: 5, bottom: 4 }, esChain, hand, FULL_ON)
    expect(opts).toEqual([])
  })

  // ---- 开关与账种过滤
  it('总开关关闭恒空', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, { ...FULL_ON, enabled: false })
    expect(opts).toEqual([])
  })
  it('账种未勾选不返回', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), redEnds, redChain, hand, { ...FULL_ON, red: false })
    expect(opts).toEqual([])
  })
  it('头牌首出场景（openEnds=null）恒空', () => {
    const hand = [tile('t4-2'), tile('t5-1')]
    const opts = declarationFor(tile('t4-2'), null, [], hand, FULL_ON)
    expect(opts).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/rules.test.js`
Expected: FAIL（declarationFor is not a function / not exported）

- [ ] **Step 3: 实现 declarationFor**

在 `D:\demo\top-cow-card-game\src\core\rules.js` 顶部 import 处追加 `TILES`（来自 `./tiles.js`，已有 `tilePoints`），并在文件末尾追加：

```js
// ---------- 算账（封账）宣告 ----------

/** 账种定义：冻结端组合 → 账种名。key = 排序后的两端点数字串 */
const ACCOUNT_TYPES = {
  '4,4': '红账',
  '1,1': '幺账',
  '5,5': '五账',
  '2,3': '二三账',
}

/** 账种 → settings 布尔字段 */
const ACCOUNT_KEY = { 红账: 'red', 幺账: 'yao', 二三账: 'erSan', 五账: 'wu' }

/**
 * 端点 P 是否被冻结：所有含 P 的竖牌（非对子）都已在链上。
 * afterChain：模拟接牌后的链上全部牌（含刚出的这张）；P 为冻结端点。
 */
function endFrozen(p, afterChain) {
  return !TILES.some(
    (t) => t.type === '竖牌' && (t.a === p || t.b === p) &&
      !afterChain.some((c) => c.id === t.id)
  )
}

/**
 * 判定「这张牌接某端」是否构成算账宣告项。
 * @param tile 手里要出的牌
 * @param openEnds 当前链两端 { top, bottom }；null（头牌首出）恒无宣告
 * @param chainTiles 链上全部已出的牌（tableHistory 的 tiles 展开）
 * @param hand 我当前手牌（含 tile；用于二三账「还有其他可接牌」判定）
 * @param settings 算账设置
 * @returns {{ type: string, side: 'bottom'|'top' }[]} 可宣告项
 */
export function declarationFor(tile, openEnds, chainTiles, hand, settings) {
  if (!settings || !settings.enabled || !openEnds) return []
  const sides = placeSides(tile, openEnds)
  if (sides.length === 0) return []
  const afterChain = [...chainTiles, tile]
  const opts = []
  for (const { side, mirrored } of sides) {
    // 复用 play 的新端计算：bottom 接后 bottom = mirrored ? tile.b : tile.a；top 对称
    const newEnds = side === 'bottom'
      ? { top: openEnds.top, bottom: mirrored ? tile.b : tile.a }
      : { top: mirrored ? tile.a : tile.b, bottom: openEnds.bottom }
    const key = [newEnds.top, newEnds.bottom].sort((a, b) => a - b).join(',')
    const type = ACCOUNT_TYPES[key]
    if (!type) continue
    if (!endFrozen(newEnds.top, afterChain) || !endFrozen(newEnds.bottom, afterChain)) continue
    if (!settings[ACCOUNT_KEY[type]]) continue
    if (type === '二三账') {
      // 特殊条件：手里除这张牌外还有其他可接牌（故意不出别的偏选这张）
      const others = hand.filter((t) => t.id !== tile.id)
      if (!playableTilesEnds(others, openEnds).length) continue
    }
    opts.push({ type, side })
  }
  return opts
}
```

注意：`placeSides` 已在 rules.js 内定义（同文件），`TILES` 需在文件顶部把 `import { tilePoints } from './tiles.js'` 改为 `import { tilePoints, TILES } from './tiles.js'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/rules.test.js`
Expected: PASS（全部含旧用例）

- [ ] **Step 5: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/core/rules.js tests/rules.test.js && git commit -m "feat(core): declarationFor 四种算账宣告判定纯函数"
```

---

### Task 3: game.js 注入 settings / declare 复核 / account 字段

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\core\game.js`
- Test: `D:\demo\top-cow-card-game\tests\game.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

```js
// tests/game.test.js 末尾追加
// import 行补 declarationFor 不需要；需要 DEFAULT_SETTINGS
// import { DEFAULT_SETTINGS } from '../src/core/settings.js'

const ACC_ON = { enabled: true, red: true, yao: true, erSan: true, wu: true }

/** 构造红账宣告场景：强制 g.players 手牌（dice=3 → 头牌 seat2） */
function setupRedAccount(seed = 42) {
  const g = createGame(mulberry32(seed), 0, ACC_ON)
  rollDice(g, 3) // 头牌 = seat 2
  // 头牌 seat2 手牌：先出一张牌建链。给 seat2 与 seat1 布置红账场景：
  // seat2（头牌）出红十 t4-1 建链（两端 4,6）；seat1 持另一张红十 t4-2 + 一张能接的过渡牌
  g.players[2].hand = [byId('t4-1'), byId('t1-1'), byId('t3-1'), byId('t5-1'), byId('t6-1'), byId('t10-1')]
  g.players[1].hand = [byId('t4-2'), byId('t2-1'), byId('t11-1'), byId('t12-1'), byId('t13-1'), byId('t8-1')]
  const lead = play(g, 2, ['t4-1'])
  expect(lead.ok).toBe(true) // 红十首出（其余各家持 4/6 端牌，不拉三家成立——测试内断言防御）
  return { g }
}

describe('play declare 算账宣告', () => {
  it('declare=true 且构成宣告：account 记录座位与账种', () => {
    const { g } = setupRedAccount()
    // 轮到 seat3：随便过一手后到 seat1？不——直接构造：seat1 在头牌后第二个行动。
    // 先让 seat3、seat0 依次扣/接（真实流程），再 seat1 接 6 端宣告。
    // 简化：直接把 currentSeat 拨到 seat1（测试直接操作状态机内部可接受）
    g.currentSeat = 1
    const res = play(g, 1, ['t4-2'], 'bottom', true) // 底端 4? 注意首出后 openEnds={top:6,bottom:4}
    // 红十 4/6 接 bottom(4) 需镜像 → mirrored，新 bottom = tile.b = 6
    expect(res.ok).toBe(false) // 接 4 端暴露 6，不构成宣告
    const res2 = play(g, 1, ['t4-2'], 'top', true) // 顶端 6：暴露 4 → 两端 4,4 冻结 → 红账
    expect(res2.ok).toBe(true)
    expect(g.account).toEqual({ seat: 1, type: '红账' })
  })
  it('declare=false 同样的牌只是普通出牌，不记 account', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    const res = play(g, 1, ['t4-2'], 'top')
    expect(res.ok).toBe(true)
    expect(g.account).toBe(null)
  })
  it('declare=true 但不构成宣告被拒', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    const res = play(g, 1, ['t4-2'], 'bottom', true) // 暴露 6 端非冻结
    expect(res.ok).toBe(false)
    expect(g.account).toBe(null)
    expect(g.players[1].hand.some(t => t.id === 't4-2')).toBe(true) // 牌仍在手
  })
  it('settings 关闭时 declare 被拒', () => {
    const g = createGame(mulberry32(42), 0, { ...ACC_ON, enabled: false })
    rollDice(g, 3)
    g.players[2].hand = [byId('t4-1'), byId('t1-1'), byId('t3-1'), byId('t5-1'), byId('t6-1'), byId('t10-1')]
    g.players[1].hand = [byId('t4-2'), byId('t2-1'), byId('t11-1'), byId('t12-1'), byId('t13-1'), byId('t8-1')]
    expect(play(g, 2, ['t4-1']).ok).toBe(true)
    g.currentSeat = 1
    expect(play(g, 1, ['t4-2'], 'top', true).ok).toBe(false)
  })
  it('已有人宣告后再宣告被拒', () => {
    const { g } = setupRedAccount()
    g.currentSeat = 1
    expect(play(g, 1, ['t4-2'], 'top', true).ok).toBe(true)
    // 宣告后链冻结为 4,4：给 seat1 换上红八 t5-1（4/4 可接 4 端），再次 declare 应被
    // 「本局已有人宣告算账」拒绝（红八本身也非竖牌触发牌，双保险）
    g.currentSeat = 1
    g.players[1].hand = [byId('t5-1'), byId('t5-2')]
    const res2 = play(g, 1, ['t5-1'], 'bottom', true)
    expect(res2.ok).toBe(false)
  })
})

describe('settle 算账结算', () => {
  it('宣告者扣点严格最小：全体翻倍 +12/-6/-4/-2', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] },               // 2 点 最小
      { seat: 1, hand: [], kept: [byId('t11-1'), byId('t11-2')] },// 4 点
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] }, // 8 点
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] }, // 8 点
    ]
    const result = settle(players, 0, { seat: 0, type: '红账' })
    expect(result.scores).toEqual({ 0: 12, 1: -6, 2: -4, 3: -2 })
    expect(result.account).toEqual({ seat: 0, type: '红账', success: true })
  })
  it('宣告者与别人平点：算失败，包庄 -12', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] }, // 2 点
      { seat: 1, hand: [], kept: [byId('t11-1')] }, // 2 点 平点
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2')] },
      { seat: 3, hand: [], kept: [] },
    ]
    // 注意：seat3 扣 0 点比宣告者小 → 也是失败。平点用例需让宣告者平的是最大？不——平点即失败即可。
    const result = settle(players, 0, { seat: 0, type: '幺账' })
    // seat3 扣 0 更小；无论如何宣告者非严格最小 → 失败
    expect(result.account).toEqual({ seat: 0, type: '幺账', success: false })
    expect(result.scores[0]).toBe(-12)
    expect(result.winner).toBe(3)
    expect(result.scores[3]).toBe(12)
    expect(result.scores[1]).toBe(0)
    expect(result.scores[2]).toBe(0)
  })
  it('宣告者非最小：失败包庄 -12 赢家 +12 其余 0', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1'), byId('t11-2')] },        // 4 点 宣告者
      { seat: 1, hand: [], kept: [byId('t11-1')] },                       // 2 点 赢家
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] }, // 8
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] }, // 8
    ]
    const result = settle(players, 0, { seat: 0, type: '二三账' })
    expect(result.winner).toBe(1)
    expect(result.scores).toEqual({ 0: -12, 1: 12, 2: 0, 3: 0 })
    expect(result.account).toEqual({ seat: 0, type: '二三账', success: false })
  })
  it('无宣告（account=null）结算与旧版一致', () => {
    const players = [
      { seat: 0, hand: [], kept: [byId('t11-1')] },
      { seat: 1, hand: [], kept: [byId('t11-1'), byId('t11-2')] },
      { seat: 2, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-1')] },
      { seat: 3, hand: [], kept: [byId('t11-1'), byId('t11-2'), byId('t10-2')] },
    ]
    const result = settle(players, 0)
    expect(result.scores).toEqual({ 0: 6, 1: -3, 2: -2, 3: -1 })
    expect(result.account).toBe(null)
  })
})
```

注意：测试文件顶部需要 `const byId = (id) => TILES.find(t => t.id === id)` 并 `import { TILES } from '../src/core/tiles.js'`（若尚未引入）；`settle`/`createGame` 等已 import。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/game.test.js`
Expected: FAIL（play 第 5 参数不存在 / createGame 第 3 参不存在 / settle account 为 undefined）

- [ ] **Step 3: 实现 game.js 改动**

`D:\demo\top-cow-card-game\src\core\game.js`：

1) import 行改为：

```js
import { dealGroups } from './deck.js'
import { playableForLead, canFollowEnds, mustDiscardEnds, placeSides, diceToSeatOffset, settle, canRedeal, declarationFor } from './rules.js'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js'
```

2) `createGame` 签名与字段：

```js
export function createGame(rng = Math.random, rollerSeat = 0, settings = DEFAULT_SETTINGS) {
  return {
    rng,
    state: 'ROLLING',
    roundNo: 1,
    rollerSeat,
    leaderSeat: null,
    tableTile: null,
    openEnds: null,
    tableHistory: [],
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [], kept: [] })),
    currentSeat: null,
    result: null,
    redealUsed: new Set(),
    settings: normalizeSettings(settings),
    account: null, // { seat, type } 本局宣告（一局最多一次）
  }
}
```

3) `play` 增加 `declare = false` 第 5 参数，在首出校验之后、跟牌 placement 校验通过后（`placement = chosen` 之后）插入宣告复核；同时新增 chainTiles 收集。play 的成功路径在 `g.tableHistory.push(...)` 前加：

```js
export function play(g, seat, tileIds, side = 'bottom', declare = false) {
  // ……（既有校验不变，placement 确定后）：

  // 算账宣告复核：仅单张跟牌可宣告；declare=true 时该端必须构成宣告
  let declared = null
  if (declare) {
    if (g.openEnds === null || tiles.length !== 1) {
      return { ok: false, reason: '只有跟牌可以宣告算账' }
    }
    if (g.account) return { ok: false, reason: '本局已有人宣告算账' }
    const chainTiles = g.tableHistory.flatMap((e) => e.tiles || [])
    const opts = declarationFor(tiles[0], g.openEnds, chainTiles, player.hand, g.settings)
    const hit = opts.find((o) => o.side === (placement.side))
    if (!hit) return { ok: false, reason: '这手牌不构成算账宣告' }
    declared = { seat, type: hit.type }
  }

  const tile = tiles[tiles.length - 1]
  player.hand = player.hand.filter((t) => !tileIds.includes(t.id))
  g.tableTile = tile

  // ……（openEnds 更新逻辑不变）

  if (declared) g.account = declared
  g.tableHistory.push({ seat, tiles, side: placement.side, mirrored: placement.mirrored })
  advanceTurn(g)
  return { ok: true }
}
```

（以上是 diff 描述：实际编辑时保留原函数体其余部分原样。）

4) `settle` 增加第 3 参 `account = null`，整体替换为：

```js
export function settle(players, leaderSeat, account = null) {
  const info = players.map((p) => ({
    seat: p.seat,
    points: p.kept.reduce((s, t) => s + tilePoints(t), 0),
  }))

  const allClean = info.every((i) => i.points === 0)
  const leadDist = (seat) => (seat - leaderSeat + 4) % 4

  const winnerInfo = [...info].sort(
    (a, b) => a.points - b.points || leadDist(a.seat) - leadDist(b.seat)
  )[0]

  let ordered
  if (allClean) {
    ordered = [0, 1, 2, 3].map((k) => (leaderSeat + k) % 4)
      .map((seat) => info.find((i) => i.seat === seat))
  } else {
    const losers = info
      .filter((i) => i.seat !== winnerInfo.seat)
      .sort((a, b) => b.points - a.points || leadDist(a.seat) - leadDist(b.seat))
    ordered = [winnerInfo, ...losers]
  }

  const roles = ['赢家', '大庄', '二庄', '小庄']
  const ranks = ordered.map((p, idx) => ({ ...p, role: roles[idx] }))
  const scores = {}

  if (account) {
    // 成功 = 宣告者扣点严格小于其余三家的最小扣点（平点即失败）
    const accInfo = info.find((i) => i.seat === account.seat)
    const otherMin = Math.min(...info.filter((i) => i.seat !== account.seat).map((i) => i.points))
    const success = !!accInfo && accInfo.points < otherMin
    if (success) {
      const rankScores = [12, -6, -4, -2] // 翻倍
      for (const r of ranks) scores[r.seat] = rankScores[roles.indexOf(r.role)]
    } else {
      // 失败：宣告者包庄 -12，赢家 +12，另两输家 0（庄位排序照常，仅分数覆盖）
      for (const r of ranks) {
        if (r.seat === account.seat) scores[r.seat] = -12
        else if (r.seat === winnerInfo.seat) scores[r.seat] = 12
        else scores[r.seat] = 0
      }
    }
    return {
      winner: ordered[0].seat,
      ranks,
      scores,
      account: { ...account, success },
    }
  }

  for (const r of ranks) scores[r.seat] = [6, -3, -2, -1][roles.indexOf(r.role)]

  return {
    winner: ordered[0].seat,
    ranks,
    scores,
    account: null,
  }
}
```

5) `advanceTurn` 里 settle 调用传 account：

```js
g.result = settle(g.players, g.leaderSeat, g.account)
```

6) `viewOf` 输出追加：

```js
account: g.account,
settings: { ...g.settings },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/game.test.js`
Expected: PASS（旧用例不回归；新 describe 全过）

- [ ] **Step 5: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/core/game.js tests/game.test.js && git commit -m "feat(core): play 宣告复核 + settle 算账记分 + settings 注入"
```

---

### Task 4: 单机 useGame 接入（读取设置、透传 declare、accountSplash）

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\composables\useGame.js`
- Test: 无自动化（uni 依赖），手测清单见 Task 8

- [ ] **Step 1: 修改 useGame.js**

1) import 追加：

```js
import { normalizeSettings } from '../core/settings.js'
```

2) `useGame()` 开头读取设置并注入：

```js
const settings = normalizeSettings(uni.getStorageSync('dingniuzi_settings'))
const g = createGame(Math.random, roller, settings)
```

3) `fx` 增加字段：

```js
const fx = reactive({
  dice: null,
  diceRolling: false,
  lastMove: null,
  settleShow: false,
  revealKept: false,
  accountSplash: null, // { seat, type } 宣告特效（播一次）
})
```

4) `myPlay` 透传 declare：

```js
function myPlay(tileId, side = 'bottom', declare = false) {
  if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
  const res = play(g, 0, [tileId], side, declare)
  if (res.ok) {
    fx.lastMove = { seat: 0, tileIds: [tileId] }
    syncView()
    scheduleAiIfNeeded()
  }
  return res
}
```

5) `syncView()` 末尾追加特效触发（宣告由任何座位发生都要播）：

```js
function syncView() {
  const v = viewOf(g, 0)
  v.myKept = [...v.myKept]
  v.tableHistory = [...v.tableHistory]
  Object.assign(view, v)
  if (g.account && (!fx.accountSplash || fx.accountSplash.seat !== g.account.seat || fx.accountSplash.type !== g.account.type)) {
    fx.accountSplash = { seat: g.account.seat, type: g.account.type }
  }
}
```

- [ ] **Step 2: 语法检查**

Run: `cd "D:\demo\top-cow-card-game" && node --input-type=module -e "import('./src/composables/useGame.js').then(() => console.log('OK')).catch(e => { console.error(e.message); process.exit(1) })" 2>&1 | tail -3`
Expected: 输出 OK，或仅 uni 全局运行时错误（`uni is not defined` 可接受——语法错误会报 SyntaxError 并 exit 1）

- [ ] **Step 3: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/composables/useGame.js && git commit -m "feat(solo): useGame 注入算账设置、透传宣告、accountSplash 触发"
```

---

### Task 5: 联网服务端 rooms.js（房间设置 + declare 透传）

**Files:**
- Modify: `D:\demo\top-cow-card-game\server\rooms.js`
- Modify: `D:\demo\top-cow-card-game\server\index.js`（路由表加 room.setSettings）
- Test: `D:\demo\top-cow-card-game\tests\server-rooms.test.js`（末尾追加）

- [ ] **Step 1: 写失败测试**

```js
// tests/server-rooms.test.js 末尾追加
// import 行补：import { DEFAULT_SETTINGS } from '../src/core/settings.js'

describe('房间算账设置', () => {
  it('房主 WAITING 阶段可改设置并随 room.state 广播', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    c1.sent.length = 0
    const res = mgr.setRoomSettings(token, room.roomId, { enabled: true, red: true, yao: false, erSan: true, wu: true })
    expect(res.error).toBeUndefined()
    expect(room.settings.enabled).toBe(true)
    expect(room.settings.yao).toBe(false)
    expect(c1.sent.some(m => m.type === 'room.state' && m.payload.room.settings?.enabled === true)).toBe(true)
  })
  it('非房主改设置被拒', () => {
    const { room, token: t1 } = mgr.createRoom(conn('甲'), '甲')
    const { token: t2 } = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const res = mgr.setRoomSettings(t2, room.roomId, { enabled: true })
    expect(res.error).toMatchObject({ code: 'NOT_HOST' })
  })
  it('对局中改设置被拒', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.startGame(token, room.roomId)
    const res = mgr.setRoomSettings(token, room.roomId, { enabled: true })
    expect(res.error).toMatchObject({ code: 'ROOM_STARTED' })
  })
  it('beginRound 注入房间设置', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.setRoomSettings(token, room.roomId, { enabled: true, red: true, yao: true, erSan: true, wu: true })
    mgr.startGame(token, room.roomId)
    expect(room.game.settings.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/server-rooms.test.js`
Expected: FAIL（setRoomSettings is not a function）

- [ ] **Step 3: 实现 rooms.js 改动**

1) import 追加：

```js
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings.js'
```

2) `createRoom` 的 room 字面量加 `settings: { ...DEFAULT_SETTINGS }`（在 `lastWinnerToken: undefined` 后）。

3) `roomState()` 返回对象加一行（`settling` 之后）：

```js
settings: { ...room.settings },
```

4) 新增方法（放在 `setReady` 之后）：

```js
/** 房主修改算账设置（仅 WAITING 阶段），成功后随 room.state 广播 */
setRoomSettings(token, roomId, raw) {
  const room = this.rooms.get(roomId)
  if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
  if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能修改设置' } }
  const me = this.memberByToken(room, token)
  if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
  if (!me.isHost) return { error: { code: 'NOT_HOST', message: '只有房主能修改设置' } }
  room.settings = normalizeSettings(raw)
  room.lastActiveAt = this.now()
  this.pushRoomState(room)
  return { ok: true }
}
```

5) `beginRound` 的 `createGame` 调用改为：

```js
room.game = createGame(Math.random, rollerSeat, room.settings)
```

6) `gameAction` 的 `game.play` 分支把 declare 透传给 core：

```js
const res = play(g, me.seat, tileIds, payload.side === 'top' ? 'top' : 'bottom', !!payload.declare)
```

- [ ] **Step 4: server/index.js 路由**

`case 'game.roll'...` 的 switch 前加：

```js
case 'room.setSettings': {
  const room = mgr.roomOf(conn.token)
  if (!room) return replyError('NOT_IN_ROOM', '不在此房间')
  const res = mgr.setRoomSettings(conn.token, room.roomId, payload.settings)
  if (res.error) return replyError(res.error.code, res.error.message)
  return reply('room.setSettings.ok', {})
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd "D:\demo\top-cow-card-game" && npx vitest run tests/server-rooms.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add server/rooms.js server/index.js tests/server-rooms.test.js && git commit -m "feat(server): 房间算账设置（room.setSettings）+ play declare 透传"
```

---

### Task 6: 联网客户端 useNetGame（setRoomSettings / accountSplash / settings 只读）

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\composables\useNetGame.js`

- [ ] **Step 1: 修改 useNetGame.js**

1) `view` reactive 初始加 `account: null, settings: null`（注意：`settings` 不放 view 初始也行——`game.state` 处理器的 `Object.keys(v)` 逐键覆盖，服务器下发后自然存在；此处初始加入保证空态可读）。

2) 模块顶部加 import（`normalizeSettings` 其实客户端不直接用——view.settings 由服务器下发已是规整形态；**无需此 import**，跳过本步）。

3) `fx` 初始加 `accountSplash: null`；`game.state` 处理器内追加特效触发（防重放）：

```js
const offState = net.on('game.state', ({ view: v, fx: f, roomId: rid, yourSeat, names: n }) => {
  Object.keys(v).forEach((k) => { view[k] = v[k] })
  Object.assign(fx, { dice: null, diceRolling: false, revealKept: false, settleShow: false, lastMove: null }, f)
  if (rid !== undefined) roomId.value = rid
  if (yourSeat !== undefined) mySeat.value = yourSeat
  if (n) Object.assign(names, n)
  // 宣告特效：account 首次出现（或值变化）时点亮；重连快照重放同一值不重播
  if (v.account && (!fx.accountSplash || fx.accountSplash.seat !== v.account.seat || fx.accountSplash.type !== v.account.type)) {
    fx.accountSplash = { seat: v.account.seat, type: v.account.type }
  }
})
```

4) `myPlay` 透传 declare：

```js
async function myPlay(tileId, side = 'bottom', declare = false) {
  if (!myTurn.value) return { ok: false, reason: '没轮到你' }
  return call('game.play', { tileIds: [tileId], side, declare: !!declare })
}
```

5) 新增房间设置动作（`redeal` 后）：

```js
/** 修改房间算账设置（房主、WAITING 阶段），失败 toast */
async function setRoomSettings(settings) {
  const res = await call('room.setSettings', { settings })
  if (!res.ok) uni.showToast({ title: res.reason, icon: 'none' })
  return res
}
```

6) return 对象追加 `setRoomSettings`。

- [ ] **Step 2: 语法检查**

Run: `cd "D:\demo\top-cow-card-game" && node --check src/composables/useNetGame.js && echo OK`
Expected: OK

- [ ] **Step 3: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/composables/useNetGame.js && git commit -m "feat(net-client): useNetGame 房间设置动作 + 宣告特效触发 + declare 透传"
```

---

### Task 7: 设置页 + 主菜单/房间页入口

**Files:**
- Create: `D:\demo\top-cow-card-game\src\pages\settings\settings.vue`
- Modify: `D:\demo\top-cow-card-game\src\pages.json`（注册页面）
- Modify: `D:\demo\top-cow-card-game\src\pages\index\index.vue`（加按钮）
- Modify: `D:\demo\top-cow-card-game\src\pages\room\room.vue`（房主入口 + 只读摘要）

- [ ] **Step 1: 注册页面**

`src/pages.json` 的 `pages` 数组加：

```json
{
  "path": "pages/settings/settings",
  "style": { "navigationBarTitleText": "顶牛子", "navigationStyle": "custom" }
}
```

- [ ] **Step 2: 创建设置页**

```vue
<!-- src/pages/settings/settings.vue -->
<template>
  <view class="settings">
    <text class="title">游戏设置</text>
    <view class="card">
      <view class="row switch-row" @click="toggleEnabled">
        <view class="row-main">
          <text class="row-title">算账（封账）</text>
          <text class="row-sub">封住三家后按扣点判定：成功翻倍，失败包庄</text>
        </view>
        <view class="switch" :class="{ on: draft.enabled, disabled: readonly }">
          <view class="knob" />
        </view>
      </view>
      <template v-if="draft.enabled">
        <view v-for="acc in ACCOUNTS" :key="acc.key" class="row" @click="toggleAcc(acc.key)">
          <view class="row-main">
            <text class="row-title">{{ acc.label }}</text>
            <text class="row-sub">{{ acc.desc }}</text>
          </view>
          <view class="checkbox" :class="{ on: draft[acc.key] }">✓</view>
        </view>
      </template>
    </view>
    <view class="actions">
      <button v-if="!readonly" class="btn-primary" @click="save">保存</button>
      <button class="btn-secondary" @click="back">返回</button>
    </view>
    <text v-if="readonly" class="readonly-hint">对局设置由房主修改</text>
  </view>
</template>

<script setup>
import { reactive, ref, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../core/settings.js'
import { sharedNet } from '../../utils/net.js'

const ACCOUNTS = [
  { key: 'red', label: '红账', desc: '红十封住 4 点（链上已有另一张红十）' },
  { key: 'yao', label: '幺账', desc: '带 1 竖牌封住 1 点（其余 5 张带 1 竖牌已上链）' },
  { key: 'erSan', label: '二三账', desc: '幺三/三六/二六封住 2、3 点（其余 3 张已上链）' },
  { key: 'wu', label: '五账', desc: '带 5 竖牌封住 5 点（其余 3 张带 5 竖牌已上链）' },
]

const isNet = ref(false)
const readonly = ref(false) // 联网非房主：只读（room.vue 跳转时 host=1/0 决定）
const draft = reactive({ ...DEFAULT_SETTINGS })
let offRoomState = null

onLoad((query) => {
  isNet.value = query.mode === 'net'
  if (isNet.value) {
    readonly.value = query.host !== '1'
    const net = sharedNet()
    offRoomState = net.on('room.state', ({ room }) => {
      if (room) Object.assign(draft, normalizeSettings(room.settings))
    })
  } else {
    Object.assign(draft, normalizeSettings(uni.getStorageSync('dingniuzi_settings')))
  }
})
onUnmounted(() => offRoomState?.())

function toggleEnabled() {
  if (readonly.value) return
  draft.enabled = !draft.enabled
  if (draft.enabled) {
    // 首次打开默认四项全选（关闭再打开保留用户上次的账种勾选）
    if (!draft.red && !draft.yao && !draft.erSan && !draft.wu) {
      draft.red = draft.yao = draft.erSan = draft.wu = true
    }
  }
}
function toggleAcc(key) {
  if (readonly.value) return
  draft[key] = !draft[key]
}

async function save() {
  if (isNet.value) {
    const net = sharedNet()
    try {
      const res = await net.request('room.setSettings', { settings: { ...draft } })
      if (res.type === 'error') {
        uni.showToast({ title: res.payload?.message || '保存失败', icon: 'none' })
        return
      }
    } catch {
      uni.showToast({ title: '网络异常，保存失败', icon: 'none' })
      return
    }
  } else {
    uni.setStorageSync('dingniuzi_settings', { ...draft })
  }
  uni.showToast({ title: '已保存', icon: 'none' })
  back()
}
function back() {
  uni.navigateBack()
}
</script>

<style scoped>
.settings { min-height: 100vh; padding: 80rpx 40rpx 60rpx; box-sizing: border-box; display: flex; flex-direction: column; gap: 32rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #f5f0e1; text-align: center; }
.card { background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32; border-radius: 16rpx; padding: 8rpx 24rpx; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 24rpx 8rpx; border-bottom: 1rpx solid #4a3c22; }
.row:last-child { border-bottom: none; }
.row-main { display: flex; flex-direction: column; gap: 6rpx; flex: 1; }
.row-title { font-size: 30rpx; color: #f5f0e1; }
.row-sub { font-size: 22rpx; color: #b0a685; line-height: 1.4; }
.switch { width: 84rpx; height: 44rpx; border-radius: 999rpx; background: #3a2c14; border: 2rpx solid #5a4a32; position: relative; transition: background 0.2s; flex: none; }
.switch.on { background: #c9a227; border-color: #c9a227; }
.switch .knob { position: absolute; top: 2rpx; left: 2rpx; width: 36rpx; height: 36rpx; border-radius: 50%; background: #f5f0e1; transition: left 0.2s; }
.switch.on .knob { left: 42rpx; }
.checkbox { width: 44rpx; height: 44rpx; border-radius: 8rpx; border: 2rpx solid #8a7040; color: transparent; display: flex; align-items: center; justify-content: center; font-size: 28rpx; flex: none; box-sizing: border-box; }
.checkbox.on { background: #c9a227; border-color: #c9a227; color: #fff; }
.actions { display: flex; flex-direction: column; gap: 20rpx; margin-top: 16rpx; }
.readonly-hint { text-align: center; font-size: 22rpx; color: #b0a685; }
</style>
```

**设计说明**：联网模式的只读判定用 room.vue 跳转 query（`?mode=net&host=1/0`），设置页直接读 `query.host`，免额外协议；当前设置值通过监听 `room.state` 推送同步到 draft（服务器 roomState() 已带 settings 字段，Task 5 实现）。

- [ ] **Step 3: 主菜单入口**

`src/pages/index/index.vue` 按钮区（`<button class="btn-secondary" @click="startOnline">联网对战</button>` 之后）加：

```html
<button class="btn-secondary" @click="openSettings">游戏设置</button>
```

script 加：

```js
function openSettings() {
  uni.navigateTo({ url: '/pages/settings/settings' })
}
```

- [ ] **Step 4: 房间页入口**

`src/pages/room/room.vue`：`<view class="actions">` 内开始按钮之前加：

```html
<!-- 对局设置：房主可改（net 设置页），非房主只读查看；显示当前算账摘要 -->
<button class="btn-secondary" @click="openSettings">对局设置：{{ settingsSummary }}</button>
```

script 加（computed 已 import，无需新增）：

```js
const settingsSummary = computed(() => {
  const s = room.value?.settings
  if (!s || !s.enabled) return '不玩算账'
  const on = [s.red && '红', s.yao && '幺', s.erSan && '三二', s.wu && '五'].filter(Boolean)
  return `算账：${on.join('/') || '无账种'}`
})
function openSettings() {
  uni.navigateTo({ url: `/pages/settings/settings?mode=net&host=${isHost.value ? 1 : 0}` })
}
```

- [ ] **Step 5: 构建验证**

Run: `cd "D:\demo\top-cow-card-game" && npm run build:h5 2>&1 | tail -5`
Expected: 构建成功（无编译错误）

- [ ] **Step 6: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/pages/settings/settings.vue src/pages.json src/pages/index/index.vue src/pages/room/room.vue && git commit -m "feat(ui): 游戏设置页（单机本地/联网房间双模式）+ 主菜单与房间页入口"
```

---

### Task 8: 牌桌 UI——宣告按钮、拍桌特效、结算展示

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\components\HandArea.vue`
- Modify: `D:\demo\top-cow-card-game\src\pages\game\game.vue`

- [ ] **Step 1: HandArea 宣告按钮**

1) props 增加：

```js
declarations: { type: Array, default: [] }, // [{ type, side }] 选中牌的可宣告项
```

2) emits 增加 `'declare'`。

3) `side-float` 区域改为三态（替换模板中现有 side-float 块）：

```html
<!-- 选中牌的悬浮按钮：可宣告时显示「算账/不算账」，否则显示「上端/下端」 -->
<view v-if="t.id === selectedId && myTurn && !mustDiscard" class="side-float">
  <template v-if="declarations.length">
    <button
      v-for="d in declarations" :key="d.type"
      class="btn-side btn-declare"
      @click="$emit('declare', { id: t.id, side: d.side, type: d.type })"
    >算{{ d.type.replace('账', '') }}账</button>
    <button class="btn-side" @click="$emit('no-declare', { id: t.id })">不算账</button>
  </template>
  <template v-else-if="bothEnds">
    <button class="btn-side" @click="$emit('side-pick', { id: t.id, side: 'top' })">上端</button>
    <button class="btn-side" @click="$emit('side-pick', { id: t.id, side: 'bottom' })">下端</button>
  </template>
</view>
```

4) 样式追加：

```css
.btn-declare { background: #a04030; border-color: #c9a227; color: #f5f0e1; }
```

5) script 增加 `no-declare` 语义：**不算账 = 红账/幺账/五账接另一端出；二三账收回重选**。此逻辑放 game.vue（知道上下文），HandArea 只透传事件：emits 改为 `['select', 'confirm-play', 'confirm-discard', 'choose-side', 'side-pick', 'declare', 'no-declare']`。

6) 双击快速出牌守卫：可宣告时不触发双击直出（`bothEnds.value || declarations.length` 时禁用）——修改 `onTileTap`：

```js
if (isDoubleTap && props.myTurn && !props.mustDiscard && !bothEnds.value && !props.declarations.length) {
  emit('confirm-play')
}
```

- [ ] **Step 2: game.vue 接线**

1) 计算选中牌的宣告项（ HandArea 的 declarations prop）：

```js
// 算账宣告：核心判定 declarationFor；需要链上牌（tableHistory 展开）与设置
import { declarationFor, placeSides, diceToSeatOffset } from '../../core/rules.js'

const myDeclarations = computed(() => {
  if (!myTurn.value || view.value.openEnds === null || !selectedId.value) return []
  const t = view.value.myHand.find((x) => x.id === selectedId.value)
  if (!t) return []
  const chainTiles = (view.value.tableHistory || []).flatMap((e) => e.tiles || [])
  return declarationFor(t, view.value.openEnds, chainTiles, view.value.myHand, view.value.settings || null)
})
```

2) HandArea 标签加两个事件绑定与 prop：

```html
:declarations="myDeclarations"
@declare="onDeclare"
@no-declare="onNoDeclare"
```

3) 处理函数（script）：

```js
/** 宣告出牌：按宣告端出牌并 declare=true */
async function onDeclare({ id, side }) {
  const res = await gameApi.value?.myPlay(id, side, true)
  if (res?.ok) {
    selectedId.value = null
    mySide.value = 'bottom'
  } else {
    uni.showToast({ title: res?.reason || '宣告失败', icon: 'none' })
  }
}

/** 不算账：红/幺/五账 = 接另一端照常出；二三账 = 收回重选 */
async function onNoDeclare({ id }) {
  const t = view.value.myHand.find((x) => x.id === id)
  if (!t) return
  const decl = myDeclarations.value
  if (decl.length && decl[0].type === '二三账') {
    selectedId.value = null // 收回重选
    uni.showToast({ title: '已收回，请选择其他牌', icon: 'none' })
    return
  }
  // 接另一端（declarations 只含封账端，另一端 = placeSides 里非封账侧；两端点数相同时视为不区分直接出）
  const options = placeSides(t, view.value.openEnds)
  const declSides = new Set(decl.map((d) => d.side))
  const normal = options.find((o) => !declSides.has(o.side))
  if (!normal) {
    // 两端皆宣告项（如双冻结只差端）：视为普通出第一端
    const res = await gameApi.value?.myPlay(id, options[0]?.side || 'bottom')
    if (res?.ok) { selectedId.value = null; mySide.value = 'bottom' }
    else uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
    return
  }
  const res = await gameApi.value?.myPlay(id, normal.side)
  if (res?.ok) { selectedId.value = null; mySide.value = 'bottom' }
  else uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
}
```

4) 拍桌特效：模板 `<view class="table">` 末尾（fly-layer 之后）加：

```html
<!-- 算账宣告特效：大字由大到小飞入拍桌，落定震动+闪光后消散；不挡操作 -->
<view v-if="accountSplashShow" class="account-splash-layer">
  <view class="account-splash" :class="{ slammed: accountSlammed }">
    <text class="splash-text">算账</text>
    <text class="splash-sub">{{ accountSplashSub }}</text>
  </view>
  <view v-if="accountSlammed" class="splash-flash" />
</view>
```

5) script（特效编排）：

```js
// ---------- 算账宣告特效 ----------
const accountSplashShow = ref(false)
const accountSlammed = ref(false)
let splashTimer1 = null
let splashTimer2 = null
const accountSplashSub = computed(() => {
  const a = fx.value.accountSplash
  if (!a) return ''
  const rel = (a.seat - mySeatVal.value + 4) % 4
  const NAMES = ['我', '下家', '对家', '上家']
  return `${a.type} · ${NAMES[rel]}`
})
watch(
  () => fx.value.accountSplash,
  (a) => {
    if (!a) return
    accountSplashShow.value = true
    accountSlammed.value = false
    clearTimeout(splashTimer1)
    clearTimeout(splashTimer2)
    splashTimer1 = setTimeout(() => { accountSlammed.value = true }, 450) // 飞入 0.45s 后拍桌
    splashTimer2 = setTimeout(() => { accountSplashShow.value = false }, 1800) // 1.8s 后整体消散
  }
)
onUnmounted(() => { clearTimeout(splashTimer1); clearTimeout(splashTimer2) })
```

6) 特效样式（追加到 game.vue style）：

```css
/* 算账拍桌特效层：fixed 全屏，pointer-events 穿透 */
.account-splash-layer { position: fixed; inset: 0; z-index: 95; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.account-splash { display: flex; flex-direction: column; align-items: center; animation: splash-fly 0.45s cubic-bezier(0.5, 0, 0.75, 0.4) both; }
.account-splash.slammed { animation: splash-slam 0.18s ease-out both; }
.splash-text { font-size: 200rpx; font-weight: 900; color: #c9a227; text-shadow: 0 0 40rpx rgba(201, 162, 39, 0.9), 0 12rpx 24rpx rgba(0, 0, 0, 0.6); letter-spacing: 24rpx; }
.splash-sub { margin-top: 12rpx; font-size: 30rpx; color: #f5f0e1; background: rgba(58, 44, 20, 0.85); padding: 8rpx 28rpx; border-radius: 999rpx; }
@keyframes splash-fly {
  0% { transform: scale(8); opacity: 0; }
  60% { transform: scale(1.6); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes splash-slam {
  0% { transform: scale(1); }
  40% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
/* 拍桌瞬间金色冲击闪光（铺满特效层）；牌桌震动走 .table.shake（见下方 script 绑定） */
.splash-flash { position: absolute; inset: 0; background: radial-gradient(circle, rgba(201, 162, 39, 0.35), transparent 70%); animation: flash-out 0.5s ease-out both; }
@keyframes flash-out { 0% { opacity: 1; } 100% { opacity: 0; } }
.table.shake { animation: table-shake 0.3s ease-out; }
@keyframes table-shake {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-8rpx, 4rpx); }
  50% { transform: translate(6rpx, -4rpx); }
  75% { transform: translate(-4rpx, 2rpx); }
}
```

牌桌震动绑定：`<view class="table" :class="{ revealing: fx.revealKept, shake: tableShake }">`，script 加：

```js
const tableShake = ref(false)
watch(accountSlammed, (v) => {
  if (!v) return
  tableShake.value = false
  requestAnimationFrame(() => { tableShake.value = true })
  setTimeout(() => { tableShake.value = false }, 400)
})
```

7) 结算卡展示：`settle-row` 内（`<text>扣 {{ r.points }} 点 · {{ r.role }}</text>` 之后）加：

```html
<text v-if="accountTag(r.seat)" class="account-tag" :class="{ fail: !view.result.account.success }">{{ accountTag(r.seat) }}</text>
```

script：

```js
const ACCOUNT_LABEL = { 红账: '红账', 幺账: '幺账', 二三账: '二三账', 五账: '五账' }
function accountTag(seat) {
  const a = view.value.result?.account
  if (!a || a.seat !== seat) return ''
  return `${ACCOUNT_LABEL[a.type] || a.type}${a.success ? ' ✓×2' : ' ✗包庄'}`
}
```

样式：

```css
.account-tag { font-size: 22rpx; color: #c9a227; }
.account-tag.fail { color: #a04030; }
```

- [ ] **Step 3: 构建验证**

Run: `cd "D:\demo\top-cow-card-game" && npm run build:h5 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 4: 手测（npm run dev:h5 + 浏览器）**

1. 主菜单 → 游戏设置：开关关闭 → 保存；再开 → 四项默认全选 → 保存
2. 开始游戏（单机）：打几局确认无宣告按钮时行为不变
3. 构造红账：AI 出红十后我持另一张红十接 6 端 → 弹「算红账/不算账」→ 点算账 → 特效播放 → 结算卡显示「红账 ✓×2」或「✗包庄」
4. 二三账「不算账」→ 牌收回
5. 房间页：房主改设置 → 开局 → 牌桌宣告正常；非房主只读

- [ ] **Step 5: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/components/HandArea.vue src/pages/game/game.vue && git commit -m "feat(ui): 算账宣告按钮替换选端 + 拍桌特效 + 结算卡账目展示"
```

---

### Task 9: 收尾——全量测试 + 历史记录账目展示 + README

**Files:**
- Modify: `D:\demo\top-cow-card-game\src\composables\useGame.js`（历史条目加 account）
- Modify: `D:\demo\top-cow-card-game\src\composables\useNetGame.js`（同上）
- Modify: `D:\demo\top-cow-card-game\src\pages\index\index.vue`（历史展开行展示）
- Modify: `D:\demo\top-cow-card-game\README.md`

- [ ] **Step 1: 单机历史条目加 account**

`useGame.js` 的 `scheduleAiIfNeeded` SETTLE 分支里，`const entry = {...}` 中 `points` 行之后加：

```js
account: view.result.account || null, // { seat, type, success } | null
```

- [ ] **Step 2: 联网历史条目加 account**

`useNetGame.js` 的 `saveNetHistory` 里 `points` 行之后加：

```js
account: result.account || null,
```

- [ ] **Step 3: 历史弹框展示**

`src/pages/index/index.vue` 的 `item-detail` 内 `detail-row` 中（`d-points` 之后）加：

```html
<text v-if="h.account && h.account.seat === seat" class="d-account" :class="{ fail: !h.account.success }">
  {{ h.account.type }}{{ h.account.success ? ' ✓' : ' ✗包庄' }}
</text>
```

样式加：

```css
.d-account { font-size: 22rpx; color: #c9a227; width: 110rpx; text-align: right; }
.d-account.fail { color: #a04030; }
```

- [ ] **Step 4: 全量测试**

Run: `cd "D:\demo\top-cow-card-game" && npm run test`
Expected: 全部 PASS（含既有 rules/game/server-rooms/client-* 用例）

- [ ] **Step 5: README 更新**

`## 玩法` 列表末尾追加一行：

```markdown
- 算账（封账）：设置中开启并勾选账种（红/幺/三二/五），出封账牌宣告算账——成功扣点翻倍（+12/-6/-4/-2），失败包庄（-12/+12/0/0）
```

- [ ] **Step 6: 提交**

```bash
cd "D:\demo\top-cow-card-game" && git add src/composables/useGame.js src/composables/useNetGame.js src/pages/index/index.vue README.md && git commit -m "feat: 历史记录算账结果展示 + README 玩法说明"
```
