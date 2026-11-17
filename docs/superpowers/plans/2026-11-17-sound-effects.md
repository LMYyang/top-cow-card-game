# 音效系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为顶牛子（uni-app H5）增加 9 个合成 wav 音效 + useSound composable + game.vue 接线 + 游戏页静音开关（持久化）。

**Architecture:** 零依赖 Node 脚本 `scripts/gen-sounds.mjs` 预生成 9 个 wav 到 `src/static/sounds/`（uni 构建自动拷贝到 dist）；运行时 `src/composables/useSound.js` 单例封装 `uni.createInnerAudioContext` 实例池、<50ms 防重入节流、muted 持久化（`dingniuzi_muted`）；game.vue 在现有 fx watcher/回调处加一行 `play()` 接线。服务器零改动。

**Tech Stack:** Node（脚本）、uni.createInnerAudioContext（运行时）、vitest（mock uni API 测节流与静音）。

**Spec:** `docs/superpowers/specs/2026-11-17-sound-effects-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/gen-sounds.mjs` | 新建 | 零依赖合成 9 个 wav（44B 头 + PCM16 单声道 22050Hz），运行一次产出提交仓库 |
| `src/static/sounds/*.wav` | 生成 | 9 个音效资产（dice-roll/dice-land/tile-play/tile-discard/account-slam/settle-win/settle-lose/settle-draw/reveal-flip） |
| `src/composables/useSound.js` | 新建 | 单例：实例池、play(name) 节流、muted ref + toggleMute 持久化、全 API try-catch |
| `tests/sound.test.js` | 新建 | mock 全局 uni，测节流/muted 持久化/静音短路 |
| `src/pages/game/game.vue` | 修改 | 引 useSound，7 个触发点各加一行；右上角 🔊/🔇 按钮 |
| `package.json` | 修改 | scripts 加 `gen:sounds` |

---

### Task 1: WAV 合成脚本 scripts/gen-sounds.mjs

**Files:**
- Create: `scripts/gen-sounds.mjs`
- Create（生成）: `src/static/sounds/`（9 个 wav）
- Modify: `package.json`（scripts 加 gen:sounds）

- [ ] **Step 1: 写脚本（完整代码如下）**

```js
// scripts/gen-sounds.mjs
// 音效合成器：零依赖，手写 WAV（44 字节头 + PCM 16bit 单声道 22050Hz）。
// 运行 node scripts/gen-sounds.mjs 产出 9 个 wav 到 src/static/sounds/（产物已提交仓库，
// 仅调整音色时手动重跑；package.json 有 gen:sounds 别名）。
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'static', 'sounds')
const SR = 22050 // 采样率

/** 线性数组 → wav Buffer（PCM16 单声道） */
function toWav(samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // fmt 块长
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // 单声道
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28) // 字节率
  buf.writeUInt16LE(2, 32) // 块对齐
  buf.writeUInt16LE(16, 34) // 位深
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  return buf
}

const sec = (s) => Math.round(s * SR)
// 简易可复现随机（mulberry32），骰子摇动脉冲间隔抖动用
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 时长 sec 秒的全 0 底 */
const silence = (sec) => new Float32Array(sec(sec))

/** 把 src 片段叠加到 dst 的 at 秒处 */
function mix(dst, src, at = 0) {
  const off = sec(at)
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i]
  return dst
}

/** 白噪声 burst：时长 dur，指数衰减 tau，幅度 amp（可加 simple lowpass） */
function noiseBurst(dur, tau, amp, lp = 1) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const w = (Math.random() * 2 - 1)
    prev = prev + lp * (w - prev) // 一阶低通，lp∈(0,1] 越小越闷
    out[i] = prev * amp * Math.exp(-i / SR / tau)
  }
  return out
}

/** 正弦敲击：频率 f0，指数衰减 tau，幅度 amp；f0 随时间滑向 f1（下坠感） */
function tone(f0, f1, dur, tau, amp) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = f0 + (f1 - f0) * (t / dur)
    phase += (2 * Math.PI * f) / SR
    out[i] = Math.sin(phase) * amp * Math.exp(-i / SR / tau)
  }
  return out
}

/** 琶音音符：频率 f，时长 dur，幅度 amp（快 attack + 指数尾） */
function note(f, dur, amp) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (2 * Math.PI * f) / SR
    const env = Math.min(1, t / 0.01) * Math.exp(-t / (dur / 3))
    out[i] = (Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.2) * amp * env
  }
  return out
}

const sounds = {}

// 1. dice-roll：一串密集短噪声脉冲（骰子在手中摇晃，~0.5s），脉冲间隔带随机抖动
{
  const out = silence(0.55)
  const r = rng(42)
  let at = 0
  while (at < 0.45) {
    mix(out, noiseBurst(0.045, 0.012, 0.7, 0.5), at)
    at += 0.03 + r() * 0.04
  }
  sounds['dice-roll'] = out
}
// 2. dice-land：低频闷响 + 短噪声（骰子落碗，~0.25s）
{
  const out = silence(0.3)
  mix(out, tone(150, 90, 0.22, 0.06, 0.9))
  mix(out, noiseBurst(0.08, 0.02, 0.5, 0.35))
  sounds['dice-land'] = out
}
// 3. tile-play：中频"啪"——白噪声 burst + 低频敲击叠加（~0.15s）
{
  const out = silence(0.18)
  mix(out, noiseBurst(0.05, 0.008, 0.95, 0.7))
  mix(out, tone(320, 180, 0.12, 0.03, 0.8))
  sounds['tile-play'] = out
}
// 4. tile-discard：较轻更闷的翻扣声（~0.12s）
{
  const out = silence(0.14)
  mix(out, noiseBurst(0.05, 0.01, 0.6, 0.22))
  mix(out, tone(220, 140, 0.09, 0.025, 0.55))
  sounds['tile-discard'] = out
}
// 5. account-slam：重低音 slam + 尾震（拍桌宣告，~0.4s）
{
  const out = silence(0.45)
  mix(out, tone(120, 55, 0.35, 0.1, 1.0))
  mix(out, noiseBurst(0.1, 0.03, 0.7, 0.4))
  mix(out, tone(60, 50, 0.3, 0.18, 0.5), 0.05) // 尾震
  sounds['account-slam'] = out
}
// 6. settle-win：上扬三音阶琶音 C5-E5-G5（~0.6s）
{
  const out = silence(0.7)
  mix(out, note(523.25, 0.25, 0.7), 0)
  mix(out, note(659.25, 0.25, 0.7), 0.15)
  mix(out, note(783.99, 0.4, 0.8), 0.3)
  sounds['settle-win'] = out
}
// 7. settle-lose：下坠双音（~0.5s）
{
  const out = silence(0.55)
  mix(out, note(392, 0.22, 0.7), 0) // G4
  mix(out, note(311.13, 0.35, 0.7), 0.18) // Eb4
  sounds['settle-lose'] = out
}
// 8. settle-draw：中性单音（~0.3s）
{
  const out = silence(0.35)
  mix(out, note(440, 0.3, 0.6), 0) // A4
  sounds['settle-draw'] = out
}
// 9. reveal-flip：高频短"唰"（亮牌翻牌，~0.1s）
{
  const out = silence(0.12)
  mix(out, noiseBurst(0.06, 0.012, 0.5, 0.9))
  sounds['reveal-flip'] = out
}

mkdirSync(OUT, { recursive: true })
for (const [name, samples] of Object.entries(sounds)) {
  const p = join(OUT, `${name}.wav`)
  writeFileSync(p, toWav(samples))
  console.log(`[gen-sounds] ${p} (${(samples.length / SR).toFixed(2)}s)`)
}
console.log(`[gen-sounds] 完成：${Object.keys(sounds).length} 个文件`)
```

- [ ] **Step 2: package.json scripts 加条目**

在 `package.json` 的 `"scripts"` 中（`"build:server"` 行后）加：

```json
"gen:sounds": "node scripts/gen-sounds.mjs",
```

- [ ] **Step 3: 运行并验证产物**

Run: `npm run gen:sounds`
Expected: 输出 9 行 `[gen-sounds] ...wav (时长s)` + `完成：9 个文件`；`ls src/static/sounds/` 可见 9 个 .wav。

- [ ] **Step 4: 抽查 wav 头合法**

Run: `node -e "const b=require('fs').readFileSync('src/static/sounds/dice-roll.wav'); console.log(b.slice(0,4).toString(), b.readUInt32LE(24), b.readUInt16LE(34), b.length)"`
Expected: `RIFF 22050 16 <字节数>`（头格式正确、位深 16）。

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-sounds.mjs package.json src/static/sounds
git commit -m "feat: 音效合成脚本，产出 9 个 wav 到 static/sounds"
```

---

### Task 2: useSound composable + 单测（TDD）

**Files:**
- Create: `src/composables/useSound.js`
- Test: `tests/sound.test.js`

- [ ] **Step 1: 先写失败测试**

```js
// tests/sound.test.js
// uni 全局 mock：createInnerAudioContext 返回可断言的假实例；storage 用 vi.fn
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctxFactory = () => ({
  src: '',
  play: vi.fn(),
  stop: vi.fn(),
  onError: vi.fn(),
})
const ctxs = {}
globalThis.uni = {
  createInnerAudioContext: vi.fn(() => {
    const c = ctxFactory()
    ctxs[c.src] = c
    return c
  }),
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
}

import { useSound, _resetForTest } from '../src/composables/useSound.js'

describe('useSound', () => {
  beforeEach(() => {
    _resetForTest()
    vi.clearAllMocks()
    globalThis.uni.getStorageSync.mockImplementation(() => '')
  })

  it('play 创建实例并播放，同名复用同一实例', () => {
    const s = useSound()
    s.play('tile-play')
    s.play('tile-play')
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
    const ctx = Object.values(ctxs)[0]
    expect(ctx.src).toContain('/static/sounds/tile-play.wav')
    expect(ctx.play).toHaveBeenCalledTimes(2)
  })

  it('防重入：同名 50ms 内重复调用被忽略', () => {
    vi.useFakeTimers()
    const s = useSound()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    s.play('reveal-flip')
    now.mockReturnValue(1049) // 49ms 内
    s.play('reveal-flip')
    expect(Object.values(ctxs)[0].play).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1051) // 51ms，放行
    s.play('reveal-flip')
    expect(Object.values(ctxs)[0].play).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
    now.mockRestore()
  })

  it('静音：play 短路不创建实例、不播放', () => {
    const s = useSound()
    s.toggleMute()
    expect(s.muted.value).toBe(true)
    expect(uni.setStorageSync).toHaveBeenCalledWith('dingniuzi_muted', true)
    s.play('dice-roll')
    expect(uni.createInnerAudioContext).not.toHaveBeenCalled()
  })

  it('静音持久化：storage 已存 true 时初始化即静音', () => {
    globalThis.uni.getStorageSync.mockImplementation((k) => (k === 'dingniuzi_muted' ? true : ''))
    const s = useSound()
    expect(s.muted.value).toBe(true)
  })

  it('音频 API 异常被吞掉，不影响 play 返回', () => {
    const s = useSound()
    uni.createInnerAudioContext.mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => s.play('tile-play')).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/sound.test.js`
Expected: FAIL（`Cannot find module '../src/composables/useSound.js'`）。

- [ ] **Step 3: 写实现**

```js
// src/composables/useSound.js
// 游戏音效单例：实例池（懒创建常驻复用）+ <50ms 防重入节流 + 静音持久化。
// 所有 uni 音频 API 包 try-catch：音频失败静默，绝不影响游戏逻辑。
import { ref } from 'vue'

// 单例状态放模块级：多处 useSound() 共享同一 muted/池/时间戳
let ctxPool = null // { [name]: InnerAudioContext }
let lastPlayAt = {} // { [name]: ms }
let muted = null // ref，懒初始化（_resetForTest 后重读 storage）

export function _resetForTest() {
  ctxPool = null
  lastPlayAt = {}
  muted = null
}

const NAMES = [
  'dice-roll', 'dice-land', 'tile-play', 'tile-discard', 'account-slam',
  'settle-win', 'settle-lose', 'settle-draw', 'reveal-flip',
]

function getCtx(name) {
  if (!ctxPool) ctxPool = {}
  if (!ctxPool[name]) {
    const ctx = uni.createInnerAudioContext()
    ctx.src = `/static/sounds/${name}.wav` // H5 相对根路径，与 favicon 引用一致
    ctx.onError?.(() => {}) // 吞错误：音频失败静默
    ctxPool[name] = ctx
  }
  return ctxPool[name]
}

export function useSound() {
  if (muted === null) {
    muted = ref(uni.getStorageSync('dingniuzi_muted') === true)
  }

  /** 播放音效。name ∈ NAMES；<50ms 同名重复忽略；muted 短路；异常静默 */
  function play(name) {
    if (muted.value || !NAMES.includes(name)) return
    const now = Date.now()
    if (lastPlayAt[name] && now - lastPlayAt[name] < 50) return
    lastPlayAt[name] = now
    try {
      const ctx = getCtx(name)
      ctx.stop?.()
      ctx.play()
    } catch { /* 音频不可用：静默 */ }
  }

  /** 切换静音并持久化 */
  function toggleMute() {
    muted.value = !muted.value
    try { uni.setStorageSync('dingniuzi_muted', muted.value) } catch { /* 存储不可用：忽略 */ }
  }

  return { play, muted, toggleMute }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/sound.test.js`
Expected: 5 passed。

- [ ] **Step 5: 跑全量确认无回归**

Run: `npx vitest run tests/sound.test.js tests/client-useGame.test.js tests/game.test.js`
Expected: 全过（既有用例不受影响）。

- [ ] **Step 6: Commit**

```bash
git add src/composables/useSound.js tests/sound.test.js
git commit -m "feat: useSound composable（实例池+节流+静音持久化）与单测"
```

---

### Task 3: game.vue 接线（触发点 + 静音按钮）

**Files:**
- Modify: `src/pages/game/game.vue`

锚点行号为当前版本参考值，以注释文字定位为准。

- [ ] **Step 1: 引入 useSound**

在 `<script setup>` import 区（`import { useNetGame } ...` 行后）加：

```js
import { useSound } from '../../composables/useSound.js'
const { play, muted, toggleMute } = useSound()
```

- [ ] **Step 2: 掷骰按钮播 dice-roll**

找到模板掷骰按钮（`@click="roll()"`，~L29）：

```html
<button v-else-if="diceRollerSeat === mySeatVal && !fx.dice" class="btn-primary" :disabled="fx.diceRolling" @click="play('dice-roll'); roll()">…</button>
```

- [ ] **Step 3: 骰子落定播 dice-land**

在 `fx.diceRolling` watcher 的落定分支（`if (!fx.value.dice) return` 之后、`diceLanded.value = false` 前，~L352）加：

```js
play('dice-land')
```

- [ ] **Step 4: 飞牌落定播 tile-play**

在 `playFly` 的落地 setTimeout 内（`flyLanded.value = true` 行旁，~L667）加：

```js
play('tile-play')
```

- [ ] **Step 5: 扣牌成功播 tile-discard**

在 `myDiscard` 成功分支（`if (res?.ok) selectedId.value = null`，~L250）加：

```js
if (res?.ok) { selectedId.value = null; play('tile-discard') }
```

- [ ] **Step 6: 宣告拍桌播 account-slam**

在 `accountSlammed` watcher（`if (!v) return` 后，~L533）加：

```js
play('account-slam')
```

- [ ] **Step 7: 结算播 win/lose/draw**

`paceSettle`（~L675）改为：

```js
function paceSettle() {
  clearTimeout(settlePaceTimer)
  settleBrief.value = true
  const r = view.value.result
  const s = r?.scores?.[mySeatVal.value] || 0
  play(r?.winner === undefined || r?.winner === null ? 'settle-draw' : s > 0 ? 'settle-win' : 'settle-lose')
  settlePaceTimer = setTimeout(() => { fx.value.revealKept = true }, 1000)
}
```

（ winner 缺失（无宣告成功、纯扣牌分胜负时 winner 仍存在）——按积分正负定输赢音更贴近体感：正=win、负=lose、0=draw，且平局时 winner 是最小扣点者非"我赢"，故以 `s>0` 为主判据、winner 仅在缺失时落 draw。）

- [ ] **Step 8: 亮牌播 reveal-flip**

`paceSettle` 的 1s 定时器回调（`fx.value.revealKept = true` 处）改为：

```js
settlePaceTimer = setTimeout(() => { fx.value.revealKept = true; play('reveal-flip') }, 1000)
```

- [ ] **Step 9: 静音按钮**

模板 `btn-home` 按钮（~L7）后加同款按钮：

```html
<button class="btn-home btn-mute" @click.stop="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
```

`.btn-home` 是 `position: fixed; top: 16rpx; right: 16rpx`（~L789）。`.btn-mute` 样式加在 `.btn-home` 规则后：

```css
/* 静音开关：与主菜单按钮并排（主菜单 fixed right:16rpx，本按钮在其左侧 108rpx 处） */
.btn-mute {
  position: fixed; top: 16rpx; right: 128rpx; z-index: 50;
  font-size: 24rpx; line-height: 1.4; padding: 10rpx 18rpx; margin: 0;
  background: rgba(58, 44, 20, 0.85); color: #b0a685;
  border: 2rpx solid #5a4a32; border-radius: 999rpx;
}
```

（`.btn-mute` 直接复用 `.btn-home` 的视觉类名 `class="btn-home btn-mute"`，上面规则只覆盖 `right` 定位——`right: 128rpx` 在主菜单按钮左侧并排，不遮牌面。）

- [ ] **Step 10: 人工验证（UI 层无 vitest）**

Run: `npm run dev:h5`，浏览器打开游戏页：
1. 点掷骰→ 摇骰声 → 落定闷响
2. 出牌飞牌落桌"啪"、扣牌轻响
3. （单机 AI 局打完）结算琶音、亮牌"唰"
4. 点 🔇→ 声音全停、刷新页面后仍静音；再点恢复

- [ ] **Step 11: Commit**

```bash
git add src/pages/game/game.vue
git commit -m "feat: game.vue 接入音效触发点与静音开关"
```

---

### Task 4: 构建验证与收尾

**Files:**
- 无源码改动（只验证 + 必要时修正）

- [ ] **Step 1: 全量单测**

Run: `npm test`（后台跑，~2 分钟）
Expected: 13 files / 233 tests 全过（228 既有 + 5 新增）。

- [ ] **Step 2: 构建 h5 并确认 wav 进产物**

Run: `npm run build:h5 && ls dist/build/h5/static/sounds/`
Expected: 9 个 .wav 存在。

- [ ] **Step 3: 产物页面实测**

Run: `npm run build:h5` 后用 `npx serve dist/build/h5`（或本地 `node server/index.js` 配 dist）打开，重复 Task 3 Step 10 的四项人工验证（走构建产物路径，确认 `/static/sounds/*.wav` 200）。

- [ ] **Step 4: 收尾提交（若有零星修正）**

```bash
git status
git add -A
git commit -m "chore: 音效系统构建验证收尾"
```

（无改动则跳过。）

---

## 部署提醒（计划外，实施完成后）

- `npm run build:h5` 产物含新 wav；服务器只需覆盖 `dist\`（server bundle 零改动，`pm2 restart` 可选）
