# turn.wav 轮次提示音实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第 10 个音效 turn.wav（轮到你出牌），watch myTurn 翻转触发，进局首响吞掉。

**Architecture:** 纯前端三层小改：合成脚本加一个音效定义（复用 pluck 原语）→ useSound NAMES 注册 → game.vue 加一个 watcher。无服务器/核心规则改动。

**Tech Stack:** Node 脚本手写 WAV（mulberry32 种子 rng + pluck 拨弦）、Vue3 watch、vitest。

**设计文档:** `docs/superpowers/specs/2026-11-17-turn-sound-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/gen-sounds.mjs` | 修改 | 音效定义追加 turn（第 10 个） |
| `src/static/sounds/turn.wav` | 生成 | 合成产物 |
| `src/composables/useSound.js` | 修改 | NAMES 注册 'turn' |
| `src/pages/game/game.vue` | 修改 | 回合 watcher + armed 吞首响 |
| `tests/sound.test.js` | 修改 | turn 可播用例 |

---

### Task 1: 合成 turn 音效

**Files:**
- Modify: `scripts/gen-sounds.mjs`（bgm 定义块之后、`mkdirSync` 之前）
- Create: `src/static/sounds/turn.wav`（脚本生成）

- [ ] **Step 1: 在 gen-sounds.mjs 追加 turn 定义**

在 `// 9. bgm：...` 代码块结束后、`mkdirSync(OUT, { recursive: true })` 之前插入：

```js
// 10. turn：轮到你出牌——木质双音"叩叩"（D5+A5 拨弦，温和提醒，比 click 温和比 suanzhang 轻）
{
  const out = silence(0.5)
  mix(out, pluck(587.33, 0.16, 0.55, rng(51))) // D5
  mix(out, pluck(880, 0.28, 0.5, rng(52)), 0.08) // A5 高五度，错开 80ms
  sounds.turn = out
}
```

- [ ] **Step 2: 运行脚本生成产物**

Run: `node scripts/gen-sounds.mjs`
Expected: 输出含 `[gen-sounds] ...\src\static\sounds\turn.wav (0.50s)`，共 10 个文件；git status 中除 turn.wav 外其他 wav 无 diff（种子 rng 可复现）。

- [ ] **Step 3: 削波检查**

Run: `node -e "const fs=require('fs');const b=fs.readFileSync('src/static/sounds/turn.wav');let peak=0,clip=0;for(let i=44;i<b.length;i+=2){const v=Math.abs(b.readInt16LE(i));if(v>peak)peak=v;if(v>32760)clip++}console.log('peak',peak/32767,'clipped',clip)"`
Expected: `peak <= 0.56, clipped 0`（两音错开不相加，峰值≈0.55）。

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-sounds.mjs src/static/sounds/turn.wav
git commit -m "feat: gen-sounds 新增 turn 木质双音（轮次提示，D5+A5 拨弦）"
```

---

### Task 2: useSound 注册 turn + 单测

**Files:**
- Modify: `src/composables/useSound.js:19-22`（NAMES 数组）
- Modify: `tests/sound.test.js`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/sound.test.js` 的 `'play 不接受未知音效名（防御拼写错误）'` 用例之后追加：

```js
  it('turn 音效已注册且可播', () => {
    const s = useSound()
    s.play('turn')
    expect(uni.createInnerAudioContext).toHaveBeenCalledTimes(1)
    expect(lastCtx.src).toContain('/static/sounds/turn.wav')
  })
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/sound.test.js`
Expected: FAIL，新用例断言 `createInnerAudioContext` 被调用 1 次实为 0（NAMES 未含 turn，play 短路）。

- [ ] **Step 3: NAMES 注册**

`src/composables/useSound.js` 的 NAMES 数组改为：

```js
const NAMES = [
  'click', 'shuffle', 'play_card', 'other_play', 'pass',
  'suanzhang', 'win', 'lose', 'bgm', 'turn',
]
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run tests/sound.test.js`
Expected: PASS（9/9）。

- [ ] **Step 5: Commit**

```bash
git add src/composables/useSound.js tests/sound.test.js
git commit -m "feat: useSound 注册 turn 音效（+单测）"
```

---

### Task 3: game.vue 回合 watcher

**Files:**
- Modify: `src/pages/game/game.vue`（accountSlammed watcher 区域附近，~L544）

- [ ] **Step 1: 加 watcher（armed 吞首响）**

在 `watch(accountSlammed, ...)` 块之前插入：

```js
// 轮到我出牌提示音：myTurn false→true 且 PLAYING 才响（掷骰/结算/亮牌不响，扣牌回合不响）。
// armed 吞首响：进局/重连瞬间本来正轮到我（首次翻转是初始局面而非轮转）不响，
// 之后每次真轮转都响。restart 走 redirectTo 重开页面，setup 重跑 armed 自然复位。
const turnSoundArmed = ref(false)
watch(myTurn, (v, ov) => {
  if (!v || ov || view.value.state !== 'PLAYING') return
  if (!turnSoundArmed.value) { turnSoundArmed.value = true; return }
  play('turn')
})
```

- [ ] **Step 2: 构建验证**

Run: `npm run build:h5`
Expected: `DONE Build complete.` 无编译错误。

- [ ] **Step 3: 全量测试**

Run: `npm test`
Expected: 14 文件 237 用例全过。

- [ ] **Step 4: dist 产物确认**

Run: `ls dist/build/h5/static/sounds`
Expected: 含 turn.wav 共 10 个 wav。

- [ ] **Step 5: Commit**

```bash
git add src/pages/game/game.vue
git commit -m "feat: 轮到我出牌时播 turn 提示音（armed 吞进局首响）"
```

---

### Task 4: 人工验收（用户）

- [ ] solo 打一局：AI 出完牌轮到我 → 响"叩叩"；开局恰好我先行 → 不响
- [ ] 静音开关：开静音后轮到我 → 无声
- [ ] 音色不满意报"turn 调音"，改 gen-sounds.mjs 参数重生成
