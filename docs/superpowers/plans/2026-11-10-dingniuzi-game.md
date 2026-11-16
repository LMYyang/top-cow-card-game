# 顶牛子单机版实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `D:\demo\top-cow-card-game` 创建 uni-app + Vue 3 单机版顶牛子游戏：1 名真人玩家 + 3 个 AI，完整实现牌张数据、打骰定头牌、跟牌/扣牌、头牌限制、结算记分和三页面 UI。

**Architecture:** 游戏逻辑全部放在 `src/core/`（纯 JS、平台无关、可 Vitest 单测），Vue 层（`src/composables/useGame.js` + 页面组件）只做响应式绑定和渲染。状态机驱动：DEALING → PLAYING → SETTLE。

**Tech Stack:** uni-app (Vue 3 + Vite)、JavaScript (JSDoc)、Vitest、纯 CSS 牌面绘制。

**设计文档:** `D:\demo\chit-quotationapproval\docs\superpowers\specs\2026-11-10-dingniuzi-game-design.md`（规则以该文档 2.1-2.7 节为准）

**注意:** 本计划所有新文件都在 `D:\demo\top-cow-card-game`（新项目、新 git 仓库）。工作目录用绝对 Windows 路径。

---

## 文件结构总览

```
D:\demo\top-cow-card-game\
├── package.json                  # 根 package：uni-app 项目 + vitest devDep
├── vite.config.js                # uni-app vite 配置
├── index.html                    # H5 入口
├── src/
│   ├── main.js                   # uni-app 入口
│   ├── App.vue                   # 全局样式（深色牌桌主题）
│   ├── manifest.json             # 应用配置（appid、名称"顶牛子"）
│   ├── pages.json                # 路由：pages/index/index, pages/game/game
│   ├── core/
│   │   ├── tiles.js              # 24 张牌数据 + 点阵布局定义
│   │   ├── deck.js               # 洗牌、分四组
│   │   ├── rules.js              # 跟牌判定、扣牌限制、头牌限制、结算、庄位
│   │   ├── ai.js                 # 中等 AI 策略
│   │   └── game.js               # 状态机
│   ├── composables/
│   │   └── useGame.js            # Vue 响应式桥接 + AI 回合调度
│   ├── pages/
│   │   ├── index/index.vue       # 主菜单
│   │   └── game/game.vue         # 牌桌 + 结算覆盖层
│   └── components/
│       ├── PlayingTile.vue       # CSS 牌面
│       ├── OpponentZone.vue      # AI 玩家区（上/左/右）
│       ├── CenterArea.vue        # 桌面最新牌 + 待接提示 + 骰子动画
│       └── HandArea.vue          # 手牌 + 出牌/扣牌按钮
├── static/                       # （空目录占位，音效二期）
└── tests/
    ├── tiles.test.js
    ├── deck.test.js
    ├── rules.test.js
    ├── ai.test.js
    └── game.test.js
```

**UI 简化决策（相比设计文档）:** 结算不单独建 result 页面，改为 game 页内的全屏覆盖层（数据传递简单、动画连贯）；音效文件本期不做（YAGNI，UI 留静音开关位）。

---

### Task 1: 初始化 uni-app 项目

**Files:**
- Create: `D:\demo\top-cow-card-game\`（整目录）

- [ ] **Step 1: 用 degit 拉取 uni-app Vue3 模板**

```bash
cd /d/demo && npx degit dcloudio/uni-preset-vue#vite top-cow-card-game
```

Expected: 目录创建，含 package.json、src/、index.html。

- [ ] **Step 2: 安装依赖并验证 H5 编译**

```bash
cd /d/demo/top-cow-card-game && npm install && npm run dev:h5
```

Expected: vite 启动，浏览器打开 http://localhost:5173 显示 hello uni-app 页面。确认后 Ctrl+C 退出。

- [ ] **Step 3: 安装 vitest**

```bash
cd /d/demo/top-cow-card-game && npm install -D vitest
```

- [ ] **Step 4: 在 package.json 中加入 test script**

将 `scripts` 中加入一行：

```json
"test": "vitest run"
```

- [ ] **Step 5: 初始化 git 仓库并首次提交**

```bash
cd /d/demo/top-cow-card-game && git init && git add -A && git commit -m "chore: init uni-app vue3 project"
```

---

### Task 2: 牌张数据 tiles.js（TDD）

**Files:**
- Create: `src/core/tiles.js`
- Test: `tests/tiles.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/tiles.test.js
import { describe, it, expect } from 'vitest'
import { TILES, CATALOG } from '../src/core/tiles.js'

describe('牌张数据完整性', () => {
  it('恰好 24 张牌', () => {
    expect(TILES).toHaveLength(24)
  })

  it('恰好 13 种牌型，12 种 2 张、2 种 1 张（三六、二六各 1 张）', () => {
    expect(CATALOG).toHaveLength(13)
    const doubleTypes = CATALOG.filter(c => c.count === 2)
    const singleTypes = CATALOG.filter(c => c.count === 1)
    expect(doubleTypes).toHaveLength(11)
    expect(singleTypes.map(c => c.name).sort()).toEqual(['二六', '三六'])
  })

  it('全部牌总点数为 177', () => {
    const total = TILES.reduce((s, t) => s + t.a + t.b, 0)
    expect(total).toBe(177)
  })

  it('没有 ID 重复', () => {
    const ids = new Set(TILES.map(t => t.id))
    expect(ids.size).toBe(24)
  })

  it('横牌两端相同，竖牌两端不同（共 6 种横牌 12 张、7 种竖牌 12 张）', () => {
    for (const c of CATALOG) {
      if (c.type === '横牌') expect(c.a).toBe(c.b)
      else expect(c.a).not.toBe(c.b)
    }
    const hengTiles = TILES.filter(t => t.type === '横牌')
    const shuTiles = TILES.filter(t => t.type === '竖牌')
    expect(hengTiles).toHaveLength(12)
    expect(shuTiles).toHaveLength(12)
  })

  it('红牌只有红八、红十（点色标记正确）', () => {
    const red = CATALOG.filter(c => c.red)
    expect(red.map(c => c.name).sort()).toEqual(['红八', '红十'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /d/demo/top-cow-card-game && npx vitest run tests/tiles.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 tiles.js**

```js
// src/core/tiles.js
/**
 * 顶牛子 24 张牌数据。
 * 牌型定义 { name, aka, a, b(两端点数 1-6), type: '横牌'|'竖牌', red: 是否红牌, count }
 * 实例牌 { id, name, a, b, type, red } —— id 全局唯一（如 't1-1'）。
 */

const CATALOG_DEF = [
  { name: '大天', aka: '长六、天牌', a: 6, b: 6, type: '横牌', red: false, count: 2 },
  { name: '虎头', aka: '斧头',     a: 5, b: 6, type: '竖牌', red: false, count: 2 },
  { name: '大五', aka: '长五、梅花', a: 5, b: 5, type: '横牌', red: false, count: 2 },
  { name: '红十', aka: '金屏、四六', a: 4, b: 6, type: '竖牌', red: true,  count: 2 },
  { name: '红八', aka: '大红、人牌', a: 4, b: 4, type: '横牌', red: true,  count: 2 },
  { name: '长三', aka: '大三、长衫', a: 3, b: 3, type: '竖牌', red: false, count: 2 },
  { name: '一六', aka: '幺六、高脚七', a: 1, b: 6, type: '竖牌', red: false, count: 2 },
  { name: '一五', aka: '幺五、铜棰', a: 1, b: 5, type: '竖牌', red: false, count: 2 },
  { name: '一三', aka: '幺三、幺鹅', a: 1, b: 3, type: '竖牌', red: false, count: 2 },
  { name: '二板', aka: '长二、板凳', a: 2, b: 2, type: '横牌', red: false, count: 2 },
  { name: '地幺', aka: '长一、地牌', a: 1, b: 1, type: '横牌', red: false, count: 2 },
  { name: '三六', aka: '杂九、黑九', a: 3, b: 6, type: '竖牌', red: false, count: 1 },
  { name: '二六', aka: '杂八、平八', a: 2, b: 6, type: '竖牌', red: false, count: 1 },
]

/** 13 种牌型定义 */
export const CATALOG = CATALOG_DEF.map((c, i) => ({ ...c, code: `t${i + 1}` }))

/** 24 张实例牌 */
export const TILES = CATALOG.flatMap((c) =>
  Array.from({ length: c.count }, (_, k) => ({
    id: `${c.code}-${k + 1}`,
    name: c.name,
    a: c.a,
    b: c.b,
    type: c.type,
    red: c.red,
  }))
)

/** 牌总点数 = 两端之和 */
export const tilePoints = (tile) => tile.a + tile.b
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tiles.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/tiles.js tests/tiles.test.js && git commit -m "feat(core): 24张牌张数据与13种牌型定义"
```

---

### Task 3: 洗牌发牌 deck.js（TDD）

**Files:**
- Create: `src/core/deck.js`
- Test: `tests/deck.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/deck.test.js
import { describe, it, expect } from 'vitest'
import { shuffle, dealGroups, mulberry32 } from '../src/core/deck.js'
import { TILES } from '../src/core/tiles.js'

describe('mulberry32 可复现随机', () => {
  it('同种子产生同序列', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('shuffle 洗牌', () => {
  it('返回新数组且不修改原数组', () => {
    const original = [...TILES]
    const shuffled = shuffle(TILES, mulberry32(1))
    expect(shuffled).not.toBe(TILES)
    expect(TILES).toEqual(original)
  })
  it('同种子洗牌结果一致，不同种子大概率不同', () => {
    expect(shuffle(TILES, mulberry32(7))).toEqual(shuffle(TILES, mulberry32(7)))
    expect(shuffle(TILES, mulberry32(7))).not.toEqual(shuffle(TILES, mulberry32(8)))
  })
  it('洗牌后仍是同样的 24 张牌', () => {
    const sorted = (ts) => ts.map(t => t.id).sort()
    expect(sorted(shuffle(TILES, mulberry32(9)))).toEqual(sorted(TILES))
  })
})

describe('dealGroups 分四组', () => {
  it('四组各 6 张，合计 24 张不重复', () => {
    const groups = dealGroups(mulberry32(3))
    expect(groups).toHaveLength(4)
    const ids = groups.flat().map(t => t.id)
    expect(ids).toHaveLength(24)
    expect(new Set(ids).size).toBe(24)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/deck.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 deck.js**

```js
// src/core/deck.js
import { TILES } from './tiles.js'

/** mulberry32 种子随机数生成器，返回 () => [0,1) */
export function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates 洗牌，返回新数组。rng 可注入以便测试复现 */
export function shuffle(tiles, rng = Math.random) {
  const arr = [...tiles]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 洗牌并分四组，每组 6 张。返回 [组0, 组1, 组2, 组3] */
export function dealGroups(rng = Math.random) {
  const shuffled = shuffle(TILES, rng)
  return [0, 1, 2, 3].map((i) => shuffled.slice(i * 6, i * 6 + 6))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/deck.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/deck.js tests/deck.test.js && git commit -m "feat(core): 种子随机洗牌与四组分牌"
```

---

### Task 4: 规则引擎 rules.js（TDD）

**Files:**
- Create: `src/core/rules.js`
- Test: `tests/rules.test.js`

**说明:** 座位序用 0-3 表示（0=掷骰者/玩家视角的"自己"参照位，1=下家，2=对家，3=上家，逆时针方向即 0→1→2→3）。头牌是其中一个座位。每个玩家状态：`{ seat, hand: [tile], kept: [tile] }`（kept = 扣牌）。

- [ ] **Step 1: 写失败测试**

```js
// tests/rules.test.js
import { describe, it, expect } from 'vitest'
import {
  canFollow, playableTiles, playableForLead,
  settle, diceToSeatOffset, seatName,
} from '../src/core/rules.js'
import { tile } from './helpers.js'

// 用 helpers.tile('t1-1') 快速取牌

describe('canFollow 跟牌判定', () => {
  it('任一端点与桌面牌任一端点相同即可接', () => {
    const table = tile('t1-1') // 大天 6/6
    expect(canFollow(tile('t4-1'), table)).toBe(true)  // 红十 4/6
    expect(canFollow(tile('t7-1'), table)).toBe(true)  // 一六 1/6
    expect(canFollow(tile('t9-1'), table)).toBe(false) // 一三 1/3
  })
  it('桌面最新牌是唯一参照', () => {
    const table = tile('t12-1') // 三六 3/6
    expect(canFollow(tile('t6-1'), table)).toBe(true)  // 长三 3/3
  })
})

describe('playableTiles 跟牌可出列表', () => {
  it('只列出能接的牌', () => {
    const table = tile('t10-1') // 二板 2/2
    const hand = [tile('t13-1'), tile('t1-1'), tile('t9-1')] // 二六(2/6)、大天(6/6)、一三(1/3)
    const result = playableTiles(hand, table)
    expect(result.map(t => t.id)).toEqual(['t13-1'])
  })
})

describe('不能扣活牌', () => {
  it('有牌可接时 mustDiscard 为 false', () => {
    const table = tile('t10-1') // 2/2
    const hand = [tile('t13-1')] // 二六 2/6 可接
    expect(mustDiscard(hand, table)).toBe(false)
  })
  it('无牌可接时必须扣牌', () => {
    const table = tile('t10-1') // 2/2
    const hand = [tile('t9-1')] // 一三 1/3
    expect(mustDiscard(hand, table)).toBe(true)
  })
})

describe('playableForLead 头牌不拉三家', () => {
  it('其余三家任一家手里有能接的端点，这张牌可出', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三(3/3)、一三(1/3)
    const others = [
      [tile('t12-1')], // 对家 大天 6/6
      [tile('t7-1')],  // 下家 一六 1/6 —— 有 1 端，一三可接
      [tile('t11-1')], // 上家 地幺 1/1
    ]
    const result = playableForLead(hand, others)
    // 一三(1/3)：1 端被别人持有 → 可出；长三(3/3)：无人有 3 端 → 不可出
    expect(result.map(t => t.id)).toEqual(['t9-1'])
  })
  it('头牌自己持有的端点不算数（比较的是其余三家）', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三、一三 —— 1/3 端都在自己手里
    const others = [[tile('t12-1')], [tile('t11-1')], [tile('t11-2')]] // 6/6、1/1、1/1
    // 一三有 1 端，上家地幺也有 1 端 → 一三可出
    const result = playableForLead(hand, others)
    expect(result.map(t => t.id)).toEqual(['t9-1'])
  })
})

describe('diceToSeatOffset 骰点映射', () => {
  it('1/5→掷骰者自己, 2/6→下家, 3→对家, 4→上家', () => {
    expect(diceToSeatOffset(1)).toBe(0)
    expect(diceToSeatOffset(5)).toBe(0)
    expect(diceToSeatOffset(2)).toBe(1)
    expect(diceToSeatOffset(6)).toBe(1)
    expect(diceToSeatOffset(3)).toBe(2)
    expect(diceToSeatOffset(4)).toBe(3)
  })
  it('非法点数抛错', () => {
    expect(() => diceToSeatOffset(0)).toThrow()
    expect(() => diceToSeatOffset(7)).toThrow()
  })
})

describe('seatName 座位名', () => {
  it('0=掷骰者(自己) 1=下家 2=对家 3=上家', () => {
    expect(seatName(0)).toBe('自己')
    expect(seatName(1)).toBe('下家')
    expect(seatName(2)).toBe('对家')
    expect(seatName(3)).toBe('上家')
  })
})

describe('settle 结算', () => {
  // 玩家状态用 kept 点数构造：tile('t1-1')=大天12点
  it('扣牌最少者赢，最多者大庄', () => {
    const players = [
      { seat: 0, hand: [], kept: [tile('t9-1')] },  // 一三 4点 → 赢
      { seat: 1, hand: [], kept: [tile('t1-1')] },  // 大天 12点 → 大庄
      { seat: 2, hand: [], kept: [tile('t13-1')] }, // 二六 8点 → 二庄
      { seat: 3, hand: [], kept: [tile('t8-1')] },  // 一五 6点 → 小庄
    ]
    const result = settle(players, 0) // 头牌是 seat 0
    expect(result.winner).toBe(0)
    expect(result.ranks.map(r => r.seat)).toEqual([0, 3, 2, 1]) // 按扣点升序
    expect(result.ranks.find(r => r.seat === 1).role).toBe('大庄')
    expect(result.scores[0]).toBe(6)
    expect(result.scores[1]).toBe(-3)
    expect(result.scores[2]).toBe(-2)
    expect(result.scores[3]).toBe(-1)
  })

  it('点数相同：赢时离头牌近者赢', () => {
    const players = [
      { seat: 0, hand: [], kept: [] },            // 头牌净手 0点
      { seat: 1, hand: [], kept: [tile('t9-1')] }, // 4点
      { seat: 2, hand: [], kept: [tile('t10-1')] }, // 二板 4点
      { seat: 3, hand: [], kept: [tile('t8-1')] },  // 6点
    ]
    const result = settle(players, 0)
    expect(result.winner).toBe(0) // 0点最少赢
    // seat1 与 seat2 同为4点争二庄/小庄：离头牌近的庄大 → seat1=二庄, seat2=小庄
    expect(result.ranks.map(r => r.seat)).toEqual([0, 3, 1, 2])
  })

  it('四家净手：头牌赢，其余按出牌次序大庄二庄小庄', () => {
    const players = [
      { seat: 0, hand: [], kept: [] },
      { seat: 1, hand: [], kept: [] },
      { seat: 2, hand: [], kept: [] },
      { seat: 3, hand: [], kept: [] },
    ]
    const result = settle(players, 0)
    expect(result.winner).toBe(0)
    expect(result.ranks.map(r => r.seat)).toEqual([0, 1, 2, 3])
    expect(result.ranks.find(r => r.seat === 1).role).toBe('大庄')
  })

  it('积分总和为 0（零和）', () => {
    const players = [
      { seat: 0, hand: [], kept: [tile('t1-1')] },
      { seat: 1, hand: [], kept: [tile('t9-1')] },
      { seat: 2, hand: [], kept: [] },
      { seat: 3, hand: [], kept: [tile('t8-1'), tile('t10-1')] },
    ]
    const result = settle(players, 0)
    const sum = Object.values(result.scores).reduce((a, b) => a + b, 0)
    expect(sum).toBe(0)
  })
})
```

注意：上面测试里 `mustDiscard` 需要加入 rules.js 的导出清单（第 1 步 import 中也要带上）：

```js
import {
  canFollow, playableTiles, mustDiscard, playableForLead,
  settle, diceToSeatOffset, seatName,
} from '../src/core/rules.js'
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/rules.test.js`
Expected: FAIL

- [ ] **Step 3: 创建测试辅助文件**

```js
// tests/helpers.js
import { TILES } from '../src/core/tiles.js'

/** 按 id 取实例牌，如 tile('t1-1') */
export function tile(id) {
  const t = TILES.find(t => t.id === id)
  if (!t) throw new Error(`unknown tile id: ${id}`)
  return t
}
```

（牌型 code 对照：t1 大天, t2 虎头, t3 大五, t4 红十, t5 红八, t6 长三, t7 一六, t8 一五, t9 一三, t10 二板, t11 地幺, t12 三六, t13 二六 —— 与 tiles.js 中 CATALOG_DEF 顺序一致。）

- [ ] **Step 4: 实现 rules.js**

```js
// src/core/rules.js
import { tilePoints } from './tiles.js'

/**
 * 座位约定：0=掷骰者, 1=下家, 2=对家, 3=上家；逆时针 0→1→2→3。
 * 玩家状态：{ seat, hand: Tile[], kept: Tile[] }
 */

/** 跟牌判定：candidate 任一端 === 桌面牌任一端 */
export function canFollow(candidate, tableTile) {
  return candidate.a === tableTile.a || candidate.a === tableTile.b ||
         candidate.b === tableTile.a || candidate.b === tableTile.b
}

/** 手牌中所有可跟的牌 */
export function playableTiles(hand, tableTile) {
  return hand.filter((t) => canFollow(t, tableTile))
}

/** 是否必须扣牌：手里没有任何可跟的牌 */
export function mustDiscard(hand, tableTile) {
  return playableTiles(hand, tableTile).length === 0
}

/** 头牌首出可出的牌：不能"拉"三家——其余三家任一家持有该牌任一端点才可出 */
export function playableForLead(hand, otherHands) {
  const otherEnds = new Set()
  for (const handOfOther of otherHands) {
    for (const t of handOfOther) {
      otherEnds.add(t.a)
      otherEnds.add(t.b)
    }
  }
  return hand.filter((t) => otherEnds.has(t.a) || otherEnds.has(t.b))
}

/** 骰点 → 相对掷骰者的座位偏移（1/5 自己, 2/6 下家, 3 对家, 4 上家） */
export function diceToSeatOffset(dice) {
  const map = { 1: 0, 5: 0, 2: 1, 6: 1, 3: 2, 4: 3 }
  if (!(dice in map)) throw new Error(`非法骰点: ${dice}`)
  return map[dice]
}

/** 相对座位名（以掷骰者为参照） */
export function seatName(offset) {
  return ['自己', '下家', '对家', '上家'][offset]
}

/**
 * 结算。
 * @param players 四个 { seat, hand, kept }
 * @param leaderSeat 头牌座位
 * @returns {{ winner: number, ranks: [{seat, points, role}], scores: {seat: number} }}
 * role: '赢家'|'大庄'|'二庄'|'小庄'
 */
export function settle(players, leaderSeat) {
  const info = players.map((p) => ({
    seat: p.seat,
    points: p.kept.reduce((s, t) => s + tilePoints(t), 0),
  }))

  const allClean = info.every((i) => i.points === 0)

  // 排序：点数升序；同点数按"离头牌的出牌距离"升序（离头牌近者排前）
  const leadDist = (seat) => (seat - leaderSeat + 4) % 4
  const sorted = [...info].sort((a, b) =>
    a.points !== b.points ? a.points - b.points : leadDist(a.seat) - leadDist(b.seat)
  )

  const roles = ['赢家', '大庄', '二庄', '小庄']
  const rankScores = [6, -3, -2, -1]

  // 四家净手特例：头牌赢，其余按出牌次序（头牌下家开始）大庄、二庄、小庄
  let ordered
  if (allClean) {
    ordered = [leaderSeat, 1, 2, 3].map((k) => (leaderSeat + k) % 4)
      .map((seat) => info.find((i) => i.seat === seat))
  } else {
    ordered = sorted
  }

  const ranks = ordered.map((p, idx) => ({ ...p, role: roles[idx] }))
  const scores = {}
  for (const r of ranks) {
    scores[r.seat] = allClean && r.role === '赢家' ? 6 : rankScores[roles.indexOf(r.role)]
  }

  return {
    winner: ordered[0].seat,
    ranks,
    scores,
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/rules.test.js`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/rules.js tests/rules.test.js tests/helpers.js && git commit -m "feat(core): 跟牌/扣牌/头牌限制/打骰映射/结算规则引擎"
```

---

### Task 5: 游戏状态机 game.js（TDD）

**Files:**
- Create: `src/core/game.js`
- Test: `tests/game.test.js`

**状态机设计:**

```
状态: 'ROLLING'（打骰）→ 'PLAYING'（回合轮转）→ 'SETTLE'（结算）
（发牌动画由 UI 层驱动；逻辑上 rollDice 掷骰后立即完成发牌，无独立 DEALING 状态。）
PLAYING 中的"回合"由 currentSeat + tableTile 描述（tableTile=null 表示头牌尚未首出）。
动作: rollDice(g, dice) → 确定头牌并发牌
      play(g, seat, tileIds) → 跟牌/头牌首出
      discard(g, seat, tileId) → 扣牌
所有动作先验合法性，非法返回 { ok: false, reason }，不改变状态。
头牌双张红八: play 允许 tileIds 为长度 2 的数组（仅限头牌首出两张红八）。
```

- [ ] **Step 1: 写失败测试**

```js
// tests/game.test.js
import { describe, it, expect } from 'vitest'
import { createGame, rollDice, play, discard, viewOf } from '../src/core/game.js'
import { mulberry32 } from '../src/core/deck.js'

/** 工具：推进到指定座位出牌（AI 无关，直接操纵状态机） */
function startGame(seed = 42, dice = 3) {
  const g = createGame(mulberry32(seed))
  const res = rollDice(g, dice)
  return { g, res }
}

describe('createGame / rollDice', () => {
  it('初始状态 ROLLING，掷骰后进入 PLAYING 且确定头牌', () => {
    const g = createGame(mulberry32(42))
    expect(g.state).toBe('ROLLING')
    expect(g.rollerSeat).toBe(0) // 第一局默认 seat 0 掷骰
    rollDice(g, 3) // 3 → 对家 = seat 2 头牌
    expect(g.state).toBe('PLAYING')
    expect(g.leaderSeat).toBe(2)
    expect(g.currentSeat).toBe(2)
    expect(g.players.every(p => p.hand.length === 6)).toBe(true)
    expect(g.players.every(p => p.kept.length === 0)).toBe(true)
  })
  it('非法骰点被拒绝', () => {
    const g = createGame(mulberry32(42))
    const res = rollDice(g, 9)
    expect(res.ok).toBe(false)
    expect(g.state).toBe('ROLLING')
  })
})

describe('play 出牌', () => {
  it('头牌可以出"不拉三家"的牌', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    const res = play(g, g.leaderSeat, [legal.id])
    expect(res.ok).toBe(true)
    expect(g.tableTile.id).toBe(legal.id)
    expect(g.players[g.leaderSeat].hand.length).toBe(5)
    expect(g.currentSeat).toBe((g.leaderSeat + 1) % 4)
  })
  it('非当前座位出牌被拒', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    const wrongSeat = (g.leaderSeat + 1) % 4
    const res = play(g, wrongSeat, [legal.id])
    expect(res.ok).toBe(false)
  })
  it('跟牌必须端点匹配，不匹配被拒', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const matching = hand.find(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (matching) {
      const res = play(g, follower, [matching.id])
      expect(res.ok).toBe(true)
    } else {
      // 手里没牌可接，出任何牌都应被拒
      const res = play(g, follower, [hand[0].id])
      expect(res.ok).toBe(false)
    }
  })
})

describe('discard 扣牌', () => {
  it('有牌可接时扣牌被拒（不能扣活牌）', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const canFollow = hand.some(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (canFollow) {
      const res = discard(g, follower, hand[0].id)
      expect(res.ok).toBe(false)
    }
  })
  it('无牌可接时扣牌成功，扣牌进入 kept', () => {
    const { g } = startGame(42, 3)
    const legal = require_legal_lead_tile(g)
    play(g, g.leaderSeat, [legal.id])
    const follower = g.currentSeat
    const hand = g.players[follower].hand
    const canFollow = hand.some(t => t.a === g.tableTile.a || t.a === g.tableTile.b || t.b === g.tableTile.a || t.b === g.tableTile.b)
    if (!canFollow) {
      const tileId = hand[0].id
      const res = discard(g, follower, tileId)
      expect(res.ok).toBe(true)
      expect(g.players[follower].kept.map(t => t.id)).toContain(tileId)
      expect(g.players[follower].hand.length).toBe(5)
    }
  })
})

describe('整局流程', () => {
  it('固定种子下完整打完一局进入 SETTLE，每人处理完 6 张', () => {
    const { g } = startGame(42, 3)
    let guard = 0
    while (g.state === 'PLAYING' && guard < 100) {
      guard++
      const seat = g.currentSeat
      const hand = g.players[seat].hand
      const table = g.tableTile
      const isLeadFirst = table === null
      let move = null
      if (isLeadFirst) {
        // 头牌首出：取合法牌
        const others = g.players.filter(p => p.seat !== seat).map(p => p.hand)
        const othersEnds = new Set(others.flat().flatMap(t => [t.a, t.b]))
        move = hand.find(t => othersEnds.has(t.a) || othersEnds.has(t.b))
        if (!move) move = hand[0] // 理论上不发生
        expect(play(g, seat, [move.id]).ok).toBe(true)
      } else {
        const matching = hand.filter(t => t.a === table.a || t.a === table.b || t.b === table.a || t.b === table.b)
        if (matching.length > 0) {
          move = matching[0]
          expect(play(g, seat, [move.id]).ok).toBe(true)
        } else {
          expect(discard(g, seat, hand[0].id).ok).toBe(true)
        }
      }
    }
    expect(guard).toBeLessThan(100)
    expect(g.state).toBe('SETTLE')
    for (const p of g.players) {
      expect(p.hand.length + p.kept.length).toBe(6)
    }
    expect(g.result.winner).toBeGreaterThanOrEqual(0)
    expect(Object.keys(g.result.scores)).toHaveLength(4)
  })
})

/** 取头牌当前合法首出牌（不拉三家约束下） */
function require_legal_lead_tile(g) {
  const leader = g.players[g.leaderSeat]
  const others = g.players.filter(p => p.seat !== g.leaderSeat).map(p => p.hand)
  const ends = new Set(others.flat().flatMap(t => [t.a, t.b]))
  return leader.hand.find(t => ends.has(t.a) || ends.has(t.b))
}
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/game.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 game.js**

```js
// src/core/game.js
import { dealGroups } from './deck.js'
import { tilePoints } from './tiles.js'
import { canFollow, mustDiscard, playableForLead, diceToSeatOffset, settle } from './rules.js'

/**
 * 游戏状态机（纯 JS、平台无关、可变状态对象）。
 * state: 'ROLLING' | 'PLAYING' | 'SETTLE'
 * 动作函数都返回 { ok: boolean, reason?: string }，非法动作不改状态。
 */

export function createGame(rng = Math.random, rollerSeat = 0) {
  return {
    rng,
    state: 'ROLLING',
    roundNo: 1,
    rollerSeat, // 第一局默认 0；连续局传入上一局赢家
    leaderSeat: null,
    tableTile: null, // 桌面最新牌（PLAYING 且有人出过牌后非空）
    tableHistory: [], // [{ seat, tiles: [tile] }] 出牌历史（双张红八为 2 张）
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [], kept: [] })),
    currentSeat: null,
    result: null, // settle 结果
  }
}

function isRedEightPair(tiles) {
  return tiles.length === 2 &&
    tiles.every((t) => t.a === 4 && t.b === 4)
}

/** 掷骰定头牌并直接完成发牌 */
export function rollDice(g, dice) {
  if (g.state !== 'ROLLING') return { ok: false, reason: '当前不可掷骰' }
  let offset
  try {
    offset = diceToSeatOffset(dice)
  } catch (e) {
    return { ok: false, reason: e.message }
  }
  const leaderSeat = (g.rollerSeat + offset) % 4
  const groups = dealGroups(g.rng)
  // 简化：头牌取 group[0]，其余按逆时针取后续组
  for (let i = 0; i < 4; i++) {
    const seat = (leaderSeat + i) % 4
    g.players[seat].hand = groups[i]
  }
  g.leaderSeat = leaderSeat
  g.currentSeat = leaderSeat
  g.tableTile = null
  g.state = 'PLAYING'
  return { ok: true, leaderSeat }
}

function advanceTurn(g) {
  // 一局结束判定：所有人手牌为空
  if (g.players.every((p) => p.hand.length === 0)) {
    g.result = settle(g.players, g.leaderSeat)
    g.state = 'SETTLE'
    return
  }
  g.currentSeat = (g.currentSeat + 1) % 4
  // 注意：下一人若手里有牌则正常轮转。
  // 若下一人手牌已空但其他人还有（不可能：手牌空者要么出完要么扣完6张，一局中所有6张都在手/扣）。
  // 所以手牌为空仅可能发生在全员结束时。此处无需跳过。
}

/** 出牌。tileIds: [id] 或 [id, id]（仅头牌双张红八） */
export function play(g, seat, tileIds) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '非出牌阶段' }
  if (seat !== g.currentSeat) return { ok: false, reason: '没轮到该座位' }
  const player = g.players[seat]
  const tiles = tileIds.map((id) => player.hand.find((t) => t.id === id))
  if (tiles.some((t) => !t)) return { ok: false, reason: '手牌中不存在该牌' }

  if (tileIds.length === 2) {
    if (seat !== g.leaderSeat || g.tableTile !== null || !isRedEightPair(tiles)) {
      return { ok: false, reason: '只有头牌首出可双出两张红八' }
    }
  } else if (tileIds.length !== 1) {
    return { ok: false, reason: '出牌数量非法' }
  }

  if (g.tableTile === null) {
    // 头牌首出（或双出红八）
    if (seat !== g.leaderSeat) return { ok: false, reason: '首出必须是头牌' }
    if (tiles.length === 1) {
      const legal = playableForLead(player.hand, g.players.filter((p) => p.seat !== seat).map((p) => p.hand))
      if (!legal.some((t) => t.id === tiles[0].id)) {
        return { ok: false, reason: '头牌不能拉三家：其余三家无人能接这张牌' }
      }
    }
  } else {
    // 跟牌
    if (tiles.length !== 1) return { ok: false, reason: '跟牌只能出一张' }
    if (!canFollow(tiles[0], g.tableTile)) {
      return { ok: false, reason: '这张牌接不上桌面牌' }
    }
  }

  // 提交
  player.hand = player.hand.filter((t) => !tileIds.includes(t.id))
  g.tableTile = tiles[tiles.length - 1]
  g.tableHistory.push({ seat, tiles })
  advanceTurn(g)
  return { ok: true }
}

/** 扣牌 */
export function discard(g, seat, tileId) {
  if (g.state !== 'PLAYING') return { ok: false, reason: '非出牌阶段' }
  if (seat !== g.currentSeat) return { ok: false, reason: '没轮到该座位' }
  const player = g.players[seat]
  const tile = player.hand.find((t) => t.id === tileId)
  if (!tile) return { ok: false, reason: '手牌中不存在该牌' }
  if (g.tableTile === null) {
    // 头牌首出前不存在"接不上"——头牌必须出牌
    return { ok: false, reason: '头牌首出不能扣牌' }
  }
  if (!mustDiscard(player.hand, g.tableTile)) {
    return { ok: false, reason: '不能扣活牌：手中有可接的牌' }
  }
  player.hand = player.hand.filter((t) => t.id !== tileId)
  player.kept.push(tile)
  g.tableHistory.push({ seat, discarded: tile })
  advanceTurn(g)
  return { ok: true }
}

/** 为 UI 准备的只读视图（可选：过滤他人手牌详情） */
export function viewOf(g, viewerSeat) {
  return {
    state: g.state,
    leaderSeat: g.leaderSeat,
    rollerSeat: g.rollerSeat,
    currentSeat: g.currentSeat,
    tableTile: g.tableTile,
    myHand: g.players[viewerSeat].hand,
    myKept: g.players[viewerSeat].kept,
    opponents: g.players
      .filter((p) => p.seat !== viewerSeat)
      .map((p) => ({ seat: p.seat, handCount: p.hand.length, keptCount: p.kept.length })),
    result: g.result,
    tableHistory: g.tableHistory,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/game.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/game.js tests/game.test.js && git commit -m "feat(core): 游戏状态机（掷骰/出牌/扣牌/整局推进/结算）"
```

---

### Task 6: 中等 AI ai.js（TDD）

**Files:**
- Create: `src/core/ai.js`
- Test: `tests/ai.test.js`

**策略（设计文档 3.4）:**
- 跟牌：可接时优先出**点数最高**的牌（高牌早出手，减少被扣损失）
- 扣牌：扣**点数最低**的牌（扣牌按点数算输分，先扣掉最小的；手里的高牌保留，若之后能接出去就不计分）
- 头牌首出：在"不拉三家"的合法牌中，出**点数最高**的；双张红八双出是玩家特权动作，AI 不使用（单出红八即可，仍受不拉三家约束）

- [ ] **Step 1: 写失败测试**

```js
// tests/ai.test.js
import { describe, it, expect } from 'vitest'
import { aiChoosePlay, aiChooseDiscard } from '../src/core/ai.js'
import { tile } from './helpers.js'

describe('aiChoosePlay 跟牌', () => {
  it('多张可接时出点数最高的', () => {
    const table = tile('t1-1') // 大天 6/6
    const hand = [tile('t9-1'), tile('t4-1'), tile('t7-1')] // 一三4点、红十10点、一六7点
    const choice = aiChoosePlay(hand, table, { isLeadFirst: false })
    expect(choice.action).toBe('play')
    expect(choice.tileIds).toEqual(['t4-1']) // 红十 10 点最高
  })
})

describe('aiChoosePlay 头牌首出', () => {
  it('在合法（不拉三家）牌中出点数最高的', () => {
    // 手：长三(6)、一三(4)；其余三家有 1 端（一三可出）、有 6 端（长三可出）
    // 两张都合法 → 出长三（6点 > 4点）
    const hand = [tile('t6-1'), tile('t9-1')]
    const others = [[tile('t11-1')], [tile('t12-1')], [tile('t8-1')]] // 地幺1/1、大天6/6、一五1/5
    const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: others })
    expect(choice.tileIds).toEqual(['t6-1'])
  })
  it('合法牌中排除会拉三家的牌', () => {
    const hand = [tile('t6-1'), tile('t9-1')] // 长三3/3、一三1/3
    const others = [[tile('t11-1')], [tile('t11-2')], [tile('t12-1')]] // 只有1端和6端，无3端
    const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: others })
    expect(choice.tileIds).toEqual(['t9-1']) // 长三拉三家被排除
  })
})

describe('aiChooseDiscard 扣牌', () => {
  it('扣点数最低的牌', () => {
    const table = tile('t1-1') // 6/6，手里这些都接不上
    const hand = [tile('t9-1'), tile('t10-1'), tile('t8-1')] // 4点、4点、6点
    const choice = aiChooseDiscard(hand, table)
    expect(choice.action).toBe('discard')
    expect(['t9-1', 't10-1']).toContain(choice.tileId)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ai.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 ai.js**

```js
// src/core/ai.js
import { tilePoints, } from './tiles.js'
import { canFollow, playableTiles, playableForLead } from './rules.js'

/**
 * 中等 AI：
 * - 跟牌：出可接牌中点数最高者
 * - 头牌首出：合法牌中出点数最高者
 * - 扣牌：扣点数最低者
 * 返回 { action: 'play'|'discard', tileIds } 或 { action: 'play', tileIds, tileId }
 */

/** 跟牌/首出选择。tableTile 为 null 表示头牌首出 */
export function aiChoosePlay(hand, tableTile, { isLeadFirst = false, otherHands = [] } = {}) {
  if (isLeadFirst) {
    const legal = playableForLead(hand, otherHands)
    const pool = legal.length > 0 ? legal : hand // 极端情况（理论不发生）：兜底出第一张
    const best = pool.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
    return { action: 'play', tileIds: [best.id] }
  }
  const playable = playableTiles(hand, tableTile)
  if (playable.length === 0) return null // 应转扣牌
  const best = playable.reduce((a, b) => (tilePoints(a) >= tilePoints(b) ? a : b))
  return { action: 'play', tileIds: [best.id] }
}

/** 扣牌选择：扣点数最低的牌 */
export function aiChooseDiscard(hand, tableTile) {
  if (playableTiles(hand, tableTile).length > 0) return null // 不能扣活牌
  const best = hand.reduce((a, b) => (tilePoints(a) <= tilePoints(b) ? a : b))
  return { action: 'discard', tileId: best.id }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ai.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/ai.js tests/ai.test.js && git commit -m "feat(core): 中等AI策略（高点先出、低点先扣、头牌不拉三家）"
```

---

### Task 7: 全局主题样式 App.vue 与入口清理

**Files:**
- Modify: `src/App.vue`
- Modify: `src/main.js`（确认默认模板无多余引用）
- Delete: `src/components/` 下模板自带的演示组件（若有）、`pages/index/index.vue` 模板内容稍后 Task 9 重写

- [ ] **Step 1: 清理模板演示内容**

删除 `src/` 中模板自带的演示组件/页面内容（保留 main.js、App.vue、manifest.json、pages.json 的骨架）。检查 `uni.scss` 是否存在，不存在则创建空文件。

- [ ] **Step 2: 写 App.vue 全局样式**

```vue
<!-- src/App.vue -->
<script>
export default {
  onLaunch() {},
}
</script>

<style>
/* 全局牌桌主题：深色木纹色系 + 象牙牌面 */
page,
body {
  background-color: #3a2410;
  color: #f5f0e1;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 通用按钮 */
.btn-primary {
  background: linear-gradient(180deg, #c9a227, #a5821a);
  color: #fff;
  border-radius: 24rpx;
  font-size: 32rpx;
  padding: 18rpx 64rpx;
  border: none;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.4);
}
.btn-primary[disabled] {
  opacity: 0.5;
}
.btn-secondary {
  background: #5a4a32;
  color: #f5f0e1;
  border-radius: 24rpx;
  font-size: 32rpx;
  padding: 18rpx 64rpx;
  border: none;
}
</style>
```

- [ ] **Step 3: 手动验证 H5 编译**

Run: `npm run dev:h5`
Expected: 页面空白但无编译报错。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): 全局牌桌主题样式"
```

---

### Task 8: 牌面组件 PlayingTile.vue（纯 CSS 点阵）

**Files:**
- Create: `src/components/PlayingTile.vue`
- Create: `src/core/pips.js`（点阵坐标数据，供组件使用）

**设计:** 骨牌竖放，上半排显示 `b` 端点数、下半排显示 `a` 端点数（保持牌定义中 a=下端 b=上端的语义）。点阵用 6×? 网格经典骨牌布局。1/4 点为红色（骨牌惯例：幺点与四点是红色，其余黑色）。

- [ ] **Step 1: 写点阵坐标数据 pips.js**

```js
// src/core/pips.js
/** 骨牌一端点阵：n 点在 3x3 网格中的位置（0-8，按行） */
export const PIP_LAYOUTS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/** 点的颜色：1 和 4 为红，其余黑（骨牌传统） */
export const pipColor = (n) => (n === 1 || n === 4 ? 'red' : 'black')
```

- [ ] **Step 2: 写 PlayingTile.vue**

```vue
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
```

- [ ] **Step 3: 验证组件可被 H5 编译（联调放在 Task 11）**

（组件纯展示，逻辑已由 core 测试覆盖；本任务只确认 `npm run dev:h5` 无编译报错。）

- [ ] **Step 4: Commit**

```bash
git add src/core/pips.js src/components/PlayingTile.vue && git commit -m "feat(ui): 纯CSS骨牌组件（点阵/红黑点/选中置灰/牌背）"
```

---

### Task 9: 配置路由 pages.json 与主菜单页

**Files:**
- Modify: `src/pages.json`
- Modify: `src/manifest.json`（应用名"顶牛子"）
- Modify: `src/pages/index/index.vue`（重写为主菜单）

- [ ] **Step 1: 写 pages.json**

```json
{
  "pages": [
    {
      "path": "pages/index/index",
      "style": { "navigationBarTitleText": "顶牛子", "navigationStyle": "custom" }
    },
    {
      "path": "pages/game/game",
      "style": { "navigationBarTitleText": "顶牛子", "navigationStyle": "custom", "disableScroll": true }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "white",
    "navigationBarBackgroundColor": "#3a2410",
    "backgroundColor": "#3a2410"
  }
}
```

- [ ] **Step 2: manifest.json 应用名**

将 `name` 改为 `"顶牛子"`（H5 节点 `title` 同步）。

- [ ] **Step 3: 写主菜单页**

```vue
<!-- src/pages/index/index.vue -->
<template>
  <view class="menu">
    <view class="logo-area">
      <view class="logo-tiles">
        <PlayingTile :tile="demoTile1" size="lg" />
        <PlayingTile :tile="demoTile2" size="lg" />
      </view>
      <text class="title">顶牛子</text>
      <text class="subtitle">民间骨牌 · 24张 · 四人对局</text>
    </view>
    <view class="menu-buttons">
      <button class="btn-primary" @click="startGame">开始游戏</button>
      <button class="btn-secondary" @click="showStats">战绩</button>
      <view v-if="statsVisible" class="stats-panel">
        <text>对局 {{ stats.rounds }} 局 · 总积分 {{ stats.totalScore }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import PlayingTile from '../../components/PlayingTile.vue'

const demoTile1 = { id: 'd1', name: '大天', a: 6, b: 6 }
const demoTile2 = { id: 'd2', name: '地幺', a: 1, b: 1 }

const statsRaw = ref(uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 })
const statsVisible = ref(false)
const stats = computed(() => statsRaw.value)

function startGame() {
  uni.navigateTo({ url: '/pages/game/game' })
}
function showStats() {
  statsVisible.value = !statsVisible.value
}
</script>

<style scoped>
.menu {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  padding: 120rpx 60rpx;
  box-sizing: border-box;
}
.logo-area { display: flex; flex-direction: column; align-items: center; }
.logo-tiles { display: flex; gap: 24rpx; margin-bottom: 40rpx; }
.logo-tiles > :last-child { transform: rotate(8deg) translateY(12rpx); }
.logo-tiles > :first-child { transform: rotate(-8deg); }
.logo { font-size: 72rpx; font-weight: bold; letter-spacing: 8rpx; color: #f5f0e1; }
.subtitle { font-size: 26rpx; color: #b0a685; margin-top: 12rpx; }
.menu-buttons { display: flex; flex-direction: column; gap: 28rpx; width: 100%; align-items: center; }
.stats-panel { color: #b0a685; font-size: 26rpx; }
</style>
```

注意：模板中标题用的 class 是 `title`，而上面样式表里写的是 `.logo`——执行时统一改为 `.title`（样式行替换为 `.title { font-size: 72rpx; font-weight: bold; letter-spacing: 8rpx; color: #f5f0e1; }`）。

- [ ] **Step 4: 验证**

Run: `npm run dev:h5`
Expected: 主菜单显示两张骨牌 + 三个元素；点"开始游戏"会跳转（game 页还没建，暂 404，Task 11 完成）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): 主菜单页与路由配置"
```

---

### Task 10: useGame 响应式桥接 + AI 调度

**Files:**
- Create: `src/composables/useGame.js`

**设计:** `useGame()` 返回响应式状态 + 动作方法。真人永远是 seat 0（UI 视角），掷骰者首局为 seat 0。AI 回合用 `setTimeout` 延时 600-1000ms 调度，动画状态（骰子、出牌动画）用 `fx` 对象描述，由 UI 层读取播放。

```js
// src/composables/useGame.js
import { reactive, computed } from 'vue'
import { createGame, rollDice, play, discard, viewOf, leadLegalTileIds } from '../core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../core/ai.js'

/**
 * 单机局管理。真人固定 seat 0。
 * fx: { dice: number|null, diceRolling: boolean, lastMove: {seat, tileIds}|null, settleShow: boolean }
 */
export function useGame() {
  // 连续局：读取上一局赢家作为本局掷骰者（redirectTo 重开时生效；首局无记录默认 0）
  const lastWinner = uni.getStorageSync('dingniuzi_last_winner')
  const roller = typeof lastWinner === 'number' ? lastWinner : 0
  const g = createGame(Math.random, roller)
  const fx = reactive({
    dice: null,
    diceRolling: false,
    lastMove: null, // { seat, tileIds }
    settleShow: false,
  })

  const view = reactive(viewOf(g, 0))

  function syncView() {
    Object.assign(view, viewOf(g, 0))
  }

  /** UI 视角座位名：0=我 1=下家 2=对家 3=上家 */
  const seatLabels = ['我', '下家', '对家', '上家']
  const labelOf = (seat) => seatLabels[seat]

  /** 我是否可行动 */
  const myTurn = computed(
    () => view.state === 'PLAYING' && view.currentSeat === 0
  )

  /** 我必须扣牌（无牌可接且桌面有牌） */
  const mustDiscard = computed(
    () => myTurn.value && view.tableTile !== null &&
      view.myHand.every((t) => !(t.a === view.tableTile.a || t.a === view.tableTile.b || t.b === view.tableTile.a || t.b === view.tableTile.b))
  )

  /** 当前可跟的牌 id 集合（供高亮） */
  const playableIds = computed(() => {
    if (!myTurn.value) return []
    if (view.tableTile === null) {
      // 头牌首出：合法牌 = 不拉三家的牌（委托 core，见下方 leadLegalTilesFor）
      return leadLegalTileIds(g, 0)
    }
    return view.myHand
      .filter((t) => t.a === view.tableTile.a || t.a === view.tableTile.b || t.b === view.tableTile.a || t.b === view.tableTile.b)
      .map((t) => t.id)
  })

  /** 开局掷骰（点击"掷骰子"按钮触发） */
  function roll(dice) {
    if (view.state !== 'ROLLING') return
    fx.diceRolling = true
    const finalDice = dice ?? 1 + Math.floor(Math.random() * 6)
    setTimeout(() => {
      fx.dice = finalDice
      fx.diceRolling = false
      const res = rollDice(g, finalDice)
      if (res.ok) {
        syncView()
        scheduleAiIfNeeded()
      }
    }, 1200)
  }

  /** 我出牌 */
  function myPlay(tileId) {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = play(g, 0, [tileId])
    if (res.ok) {
      fx.lastMove = { seat: 0, tileIds: [tileId] }
      syncView()
      scheduleAiIfNeeded()
    }
    return res
  }

  /** 我扣牌 */
  function myDiscard(tileId) {
    if (!myTurn.value || view.state !== 'PLAYING') return { ok: false }
    const res = discard(g, 0, tileId)
    if (res.ok) {
      fx.lastMove = { seat: 0, tileIds: [tileId] }
      syncView()
      scheduleAiIfNeeded()
    }
    return res
  }

  /** AI 回合调度：当前座位是 AI 时延时出牌 */
  function scheduleAiIfNeeded() {
    if (view.state !== 'PLAYING') {
      if (view.state === 'SETTLE') fx.settleShow = true
      return
    }
    if (view.currentSeat === 0) return
    const seat = view.currentSeat
    const delay = 600 + Math.floor(Math.random() * 400)
    setTimeout(() => {
      if (g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const hand = g.players[seat].hand
      const table = g.tableTile
      if (table === null) {
        // AI 头牌首出：先取"不拉三家"的合法牌，再交 AI 策略从中选点数最高者
        const legalTiles = leadLegalTilesFor(seat).map((id) => g.players[seat].hand.find((t) => t.id === id))
        const choice = aiChoosePlay(legalTiles, null, { isLeadFirst: true, otherHands: g.players.filter(p => p.seat !== seat).map(p => p.hand) })
        if (choice) play(g, seat, choice.tileIds)
      } else {
        const choice = aiChoosePlay(hand, table, { isLeadFirst: false })
        if (choice) {
          play(g, seat, choice.tileIds)
        } else {
          const d = aiChooseDiscard(hand, table)
          if (d) discard(g, seat, d.tileId)
        }
      }
      fx.lastMove = { seat, tileIds: [tileId] } // UI 依据 view.tableHistory 渲染
      syncView()
      scheduleAiIfNeeded()
    }, delay)
  }

  /** 头牌首出时的合法牌（不拉三家）：委托 core 的 leadLegalTileIds */
  function leadLegalTilesFor(seat) {
    return leadLegalTileIds(g, seat)
  }

  return {
    view, fx, myTurn, mustDiscard, playableIds, labelOf,
    roll, myPlay, myDiscard,
  }
}
```

**重要修正说明（执行时注意）:** `playableIds` 的"头牌首出"分支调用 `leadLegalTileIds(g, 0)`，该函数是 Task 10 Step 1 在 `src/core/game.js` 中补充导出的（viewOf 不暴露他人手牌，无法在 UI 层计算"不拉三家"）。执行时先完成 Step 1 再写本文件，确保 import 包含 `leadLegalTileIds`。

- [ ] **Step 1: 在 core/game.js 追加导出**

```js
/** 在 src/core/game.js 末尾追加 */
import { playableForLead } from './rules.js' // 与已有 import 合并

/** 某座位头牌首出的合法牌 id 数组（不拉三家约束） */
export function leadLegalTileIds(g, seat) {
  const others = g.players.filter((p) => p.seat !== seat).map((p) => p.hand)
  return playableForLead(g.players[seat].hand, others).map((t) => t.id)
}
```

（注意 rules.js 导出名是 `playableForLead`，与 rules.test.js 中 `playableForLead` 一致——执行时以实际文件为准，命名统一为 `playableForLead`。）

- [ ] **Step 2: 按上述说明修正 useGame.js 中 playableIds 的首出分支**

```js
const playableIds = computed(() => {
  if (!myTurn.value) return []
  if (view.tableTile === null) {
    return leadLegalTilesFor(0) // core 导出的合法首出
  }
  return view.myHand
    .filter((t) => t.a === view.tableTile.a || t.a === view.tableTile.b || t.b === view.tableTile.a || t.b === view.tableTile.b)
    .map((t) => t.id)
})
```

- [ ] **Step 3: 补一个 game.test.js 用例验证 leadLegalTileIds**

在 `tests/game.test.js` 增加：

```js
import { leadLegalTileIds } from '../src/core/game.js'

describe('leadLegalTileIds 头牌首出约束', () => {
  it('返回的每张牌都至少有一个端点存在于其余三家之一', () => {
    const g = createGame(mulberry32(42))
    rollDice(g, 3)
    const legal = leadLegalTileIds(g, g.leaderSeat)
    const otherEnds = new Set(
      g.players.filter(p => p.seat !== g.leaderSeat).flatMap(p => p.hand.flatMap(t => [t.a, t.b]))
    )
    for (const id of legal) {
      const t = g.players[g.leaderSeat].hand.find(t => t.id === id)
      expect(otherEnds.has(t.a) || otherEnds.has(t.b)).toBe(true)
    }
  })
})
```

（该用例验证后，Task 5 的 game.test.js 原有用例仍然全部有效——leadLegalTileIds 是纯新增导出，不改变已有行为。）

- [ ] **Step 4: 运行全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): useGame响应式桥接与AI回合调度"
```

---

### Task 11: 牌桌页面 game.vue（三区布局 + 骰子动画 + 结算覆盖层）

**Files:**
- Create: `src/pages/game/game.vue`

**布局（设计文档 4.1）:** 上=对家、左=上家、右=下家、下=我的手牌；中央=桌面最新牌 + "待接: X" + 掷骰按钮/骰子；SETTLE 时显示全屏结算覆盖层。

- [ ] **Step 1: 写 game.vue**

```vue
<!-- src/pages/game/game.vue -->
<template>
  <view class="table">
    <!-- 对家（上） -->
    <OpponentZone position="top" :label="labelOf(2)" :hand-count="opponentBySeat(2).handCount" :kept-count="opponentBySeat(2).keptCount" :is-leader="view.leaderSeat === 2" :last-move="lastMoveOf(2)" />

    <view class="middle-row">
      <!-- 上家（左） -->
      <OpponentZone position="left" :label="labelOf(3)" :hand-count="opponentBySeat(3).handCount" :kept-count="opponentBySeat(3).keptCount" :is-leader="view.leaderSeat === 3" :last-move="lastMoveOf(3)" />

      <!-- 中央 -->
      <CenterArea>
        <template v-if="view.state === 'ROLLING'">
          <view class="dice" :class="{ rolling: fx.diceRolling }">{{ diceFace }}</view>
          <button class="btn-primary" :disabled="fx.diceRolling" @click="roll()">掷骰定头牌</button>
        </template>
        <template v-else-if="view.state === 'PLAYING'">
          <view v-if="view.tableTile" class="table-tile">
            <PlayingTile :tile="view.tableTile" size="lg" />
          </view>
          <view v-else class="table-empty">等待头牌出牌</view>
          <view class="turn-hint">
            {{ turnText }}
          </view>
        </template>
        <template v-else-if="view.state === 'SETTLE'">
          <view class="settle-brief">本局结束</view>
        </template>
      </CenterArea>

      <!-- 下家（右） -->
      <OpponentZone position="right" :label="labelOf(1)" :hand-count="opponentBySeat(1).handCount" :kept-count="opponentBySeat(1).keptCount" :is-leader="view.leaderSeat === 1" :last-move="lastMoveOf(1)" />
    </view>

    <!-- 我的手牌 -->
    <HandArea
      :hand="view.myHand"
      :kept="view.myKept"
      :playable-ids="playableIds"
      :my-turn="myTurn"
      :must-discard="mustDiscard"
      :selected-id="selectedId"
      @select="selectedId = $event"
      @confirm-play="onConfirmPlay"
      @confirm-discard="onConfirmDiscard"
    />

    <!-- 结算覆盖层 -->
    <view v-if="fx.settleShow && view.result" class="settle-overlay">
      <view class="settle-card">
        <text class="settle-title">本局结算</text>
        <view v-for="r in view.result.ranks" :key="r.seat" class="settle-row" :class="{ winner: r.seat === view.result.winner }">
          <text>{{ labelOf(r.seat) }}</text>
          <text>扣 {{ r.points }} 点 · {{ r.role }}</text>
          <text class="score">{{ view.result.scores[r.seat] > 0 ? '+' : '' }}{{ view.result.scores[r.seat] }}</text>
        </view>
        <view class="settle-actions">
          <button class="btn-primary" @click="restart">再来一局</button>
          <button class="btn-secondary" @click="goHome">回主菜单</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import PlayingTile from '../../components/PlayingTile.vue'
import OpponentZone from '../../components/OpponentZone.vue'
import CenterArea from '../../components/CenterArea.vue'
import HandArea from '../../components/HandArea.vue'
import { useGame } from '../../composables/useGame.js'

const {
  view, fx, myTurn, mustDiscard, playableIds, labelOf,
  roll, myPlay, myDiscard,
} = useGame()

const selectedId = ref(null)

const DICE_FACES = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' }
const diceFace = computed(() => (fx.dice ? DICE_FACES[fx.dice] : '⚀'))

const turnText = computed(() => {
  if (view.state !== 'PLAYING') return ''
  if (view.currentSeat === 0) {
    if (view.tableTile === null) return '你是头牌，请出第一张牌'
    return mustDiscard.value ? '无牌可接，请扣牌' : '轮到你出牌'
  }
  return `等待 ${labelOf(view.currentSeat)} 行动…`
})

function opponentBySeat(seat) {
  return view.opponents.find((o) => o.seat === seat) || { handCount: 0, keptCount: 0 }
}
function lastMoveOf(seat) {
  const history = view.tableHistory
  if (!history || history.length === 0) return null
  const last = history[history.length - 1]
  return last.seat === seat ? last : null
}

function onConfirmPlay() {
  if (!selectedId.value) return
  const res = myPlay(selectedId.value)
  if (res.ok) selectedId.value = null
}
function onConfirmDiscard() {
  if (!selectedId.value) return
  const res = myDiscard(selectedId.value)
  if (res.ok) selectedId.value = null
}

function restart() {
  // 本期简化：redirectTo 重开页面 = 全新一局（第一局随机掷骰者）。
  // "上一局赢家掷骰"的连续局记忆放 Task 12 的 storage 中实现：redirectTo 前
  // 把 result.winner 写入 storage('dingniuzi_last_winner')，useGame 初始化时读取作为 rollerSeat。
  const winner = view.result?.winner
  if (winner !== undefined && winner !== null) {
    uni.setStorageSync('dingniuzi_last_winner', winner)
  }
  fx.settleShow = false
  fx.dice = null
  fx.lastMove = null
  uni.redirectTo({ url: '/pages/game/game' })
}
function goHome() {
  uni.navigateBack()
}
</script>

<style scoped>
.table {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 20rpx;
  box-sizing: border-box;
}
.middle-row { flex: 1; display: flex; min-height: 0; }
.dice { font-size: 96rpx; line-height: 1; margin-bottom: 24rpx; }
.dice.rolling { animation: shake 0.3s infinite; }
@keyframes shake {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-15deg) translateY(-8rpx); }
  75% { transform: rotate(15deg) translateY(8rpx); }
}
.table-tile { margin-bottom: 16rpx; }
.table-empty, .turn-hint, .settle-brief { color: #b0a685; font-size: 26rpx; margin: 8rpx 0; }

.settle-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
}
.settle-card {
  background: #4a3418;
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  width: 620rpx;
  display: flex; flex-direction: column; gap: 20rpx;
}
.settle-title { font-size: 40rpx; font-weight: bold; text-align: center; color: #c9a227; }
.settle-row {
  display: flex; justify-content: space-between;
  background: rgba(0,0,0,0.25); border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx;
}
.settle-row.winner { border: 2rpx solid #c9a227; }
.settle-row .score { font-weight: bold; }
.settle-actions { display: flex; flex-direction: column; gap: 16rpx; margin-top: 12rpx; }
</style>
```

- [ ] **Step 2: 创建 OpponentZone.vue / CenterArea.vue / HandArea.vue 三个子组件**

```vue
<!-- src/components/OpponentZone.vue -->
<template>
  <view class="zone" :class="position">
    <view class="avatar">{{ label.slice(0, 1) }}</view>
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
defineProps({
  position: String, // top | left | right
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
.avatar {
  width: 64rpx; height: 64rpx; border-radius: 50%;
  background: #5a4a32; color: #f5f0e1;
  display: flex; align-items: center; justify-content: center; font-size: 28rpx;
}
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

```vue
<!-- src/components/CenterArea.vue -->
<template>
  <view class="center">
    <slot />
  </view>
</template>

<style scoped>
.center {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  min-width: 0;
}
</style>
```

```vue
<!-- src/components/HandArea.vue -->
<template>
  <view class="hand-area">
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
.hint.warn { color: #e0a030; font-size: 24rpx; }
.hand { display: flex; gap: 10rpx; justify-content: center; flex-wrap: wrap; }
.kept-row { display: flex; align-items: center; gap: 8rpx; }
.kept-label { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; gap: 20rpx; }
</style>
```

注意：HandArea 中 props 名 `selectedId` 用 kebab-case `:selected-id` 传入（上面 game.vue 已是 selected-id）。game.vue 的 script 里 `selectedId` 是 `ref`，模板中直接 `selectedId` 自动解包，传给子组件 OK。

- [ ] **Step 3: 手动全流程验证（H5）**

Run: `npm run dev:h5`
Chrome 手机模拟器验证清单：
1. 主菜单 → 开始游戏 → 牌桌显示"掷骰定头牌"
2. 点击掷骰 → 骰子动画 1.2s → 发牌每人 6 张 → 头牌（若 AI）延时出牌
3. 轮到我时手牌上浮，可接牌金边高亮、不可接置灰；无牌可接时提示扣牌
4. 出牌/扣牌后中央桌面牌更新、AI 依次行动
5. 一局结束弹出结算覆盖层，显示四家扣点、庄位、得分，"再来一局"可重开

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): 牌桌页面（三区布局/骰子动画/结算覆盖层）"
```

---

### Task 12: 战绩持久化 + 结算接入存储

**Files:**
- Modify: `src/composables/useGame.js`（结算时写 storage）
- Modify: `src/pages/index/index.vue`（已读 storage，无需改）

- [ ] **Step 1: useGame.js 中 settle 时写入战绩**

在 `scheduleAiIfNeeded` 中 `if (view.state === 'SETTLE') fx.settleShow = true` 分支前加：

```js
if (view.state === 'SETTLE') {
  // 持久化战绩
  const prev = uni.getStorageSync('dingniuzi_stats') || { rounds: 0, totalScore: 0 }
  const my = view.result.scores[0] || 0
  uni.setStorageSync('dingniuzi_stats', {
    rounds: prev.rounds + 1,
    totalScore: prev.totalScore + my,
  })
  fx.settleShow = true
  return
}
```

- [ ] **Step 2: 手动验证**

打完一局回主菜单，点"战绩"应显示 1 局与我的得分。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): 战绩本地持久化"
```

---

### Task 13: 收尾——README、测试全绿、H5 构建验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

```markdown
# 顶牛子（Top Cow Card Game）

华北民间骨牌游戏"顶牛子"的 uni-app 单机版：1 名真人 + 3 个 AI。

## 玩法
- 24 张骨牌（13 种牌型），四人各 6 张
- 上一局赢家掷一颗骰子定头牌（1/5 自己、2/6 下家、3 对家、4 上家）
- 头牌首出，之后逆时针跟牌：必须与桌面最新一张牌任一端点数相同
- 接不上必须扣牌；手中有可接的牌时不能扣（不能扣活牌）
- 全部 6 张出完/扣完后结算：扣牌点数最少者赢（+6），最多者大庄（-3）、二庄（-2）、小庄（-1）

## 开发
\`\`\`bash
npm install
npm run dev:h5     # H5 开发
npm run test       # Vitest 单元测试（core 逻辑）
npm run build:h5   # H5 构建
\`\`\`

## 二期规划
- 微信小程序 / 安卓 / iOS 发布
- 联网对战、算帐（六种）与包庄
- 音效
```

- [ ] **Step 2: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: H5 生产构建验证**

Run: `npm run build:h5`
Expected: 构建成功，产出 `dist/build/h5`。

- [ ] **Step 4: 手动回归清单**

按 Task 11 Step 3 的五点清单再跑一遍。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A && git commit -m "docs: README 与收尾验证"
```

---

## 任务依赖关系

```
Task 1 (初始化) → Task 2 (tiles) → Task 3 (deck) → Task 4 (rules) → Task 5 (game) → Task 6 (ai)
                                                        ↓
Task 7 (主题) → Task 8 (牌面组件) → Task 9 (路由+主菜单) → Task 10 (useGame) → Task 11 (牌桌) → Task 12 (持久化) → Task 13 (收尾)
```

- Task 2-6 为 core 层链路（可连续执行）
- Task 7-11 为 UI 层链路（依赖 core 完成）
- Task 10 Step 1 的 `leadLegalTileIds` 是 useGame/UI 与 AI 首出合法性的共同依赖，必须在该任务内完成
- "上一局赢家掷骰"通过 `dingniuzi_last_winner` storage（Task 11 restart 写入 + Task 10 useGame 初始化读取）实现连续局
