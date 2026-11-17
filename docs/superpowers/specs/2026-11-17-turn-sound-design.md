# turn.wav 轮到你出牌提示音 — 设计文档

日期：2026-11-17
状态：已确认（用户选定 1A 仅出牌回合 + 2A 木质双音）

## 背景

对标欢乐麻将音效体系后发现的最大缺口：**轮次提醒音**。玩家（尤其联机）不在
牌桌前时，需要靠声音知道"轮到我了"。当前 9 音效体系（click/shuffle/
play_card/other_play/pass/suanzhang/win/lose/bgm）无此音。

## 需求（用户确认）

- **触发时机（1A）**：仅出牌回合轮到我时响。`myTurn` false→true 且
  `view.state === 'PLAYING'`。掷骰/结算/亮牌阶段不触发；进局瞬间/重连时
  本来正轮到我，不响（skip 首响）。
- **音色（2A）**：木质双音"叩叩"——两个 pluck（D5 587.33Hz + A5 880Hz，
  间隔 0.08s），比 click 温和、比 suanzhang 轻，同属现有拨弦音色体系。
- 不做扣牌回合提示（mustDiscard 不响）。

## 方案（已选）

**watch `myTurn` 布尔翻转**（方案一）：

- solo（useGame）与 net（useNetGame）均导出 myTurn computed，同一 watcher
  通吃双模式，零侵入 composable。
- 排除方案二（watch currentSeat：solo/net 初始值语义不同、还需再查
  mustDiscard，判定链长）；排除方案三（composable 内 emit 事件：侵入面大
  无收益）。

## 实现

### 1. 合成（scripts/gen-sounds.mjs）

新增第 10 个音效 `turn`：

```js
// 10. turn：轮到你出牌——木质双音叩叩（D5+A5 拨弦，温和提醒）
{
  const out = silence(0.5)
  mix(out, pluck(587.33, 0.16, 0.55, rng(51)))        // D5
  mix(out, pluck(880, 0.28, 0.5, rng(52)), 0.08)      // A5 高五度
  sounds.turn = out
}
```

产物 `src/static/sounds/turn.wav`（~0.5s，种子 rng 可复现）。

### 2. useSound（src/composables/useSound.js）

NAMES 数组加 `'turn'`（一行）。节流/静音/bgm 逻辑全部不动——50ms 同名节流
对 turn 无影响（回合间隔远大于 50ms）。

### 3. game.vue 接线

在 fx watcher 区域新增：

```js
// 轮到我出牌提示音：myTurn false→true 且 PLAYING 才响（掷骰/结算/亮牌不响）。
// armed 吞首响：进局/重连瞬间本来正轮到我（首翻转为初始局面而非轮转）不响，
// 之后每次真轮转都响。restart 重开页面自然重新 setup 复位 armed。
const turnSoundArmed = ref(false)
watch(myTurn, (v, ov) => {
  if (!v || ov || view.value.state !== 'PLAYING') return
  if (!turnSoundArmed.value) { turnSoundArmed.value = true; return }
  play('turn')
})
```

### 4. 测试（tests/sound.test.js）

最小新增：turn 在 NAMES 内可播（`s.play('turn')` 创建实例且 src 含
turn.wav）。game.vue 的 watcher 属页面集成层，无组件测试体系，人工验收。

## 验收

1. `npm test` 全量过（236+1）
2. `npm run build:h5` 成功，dist 出现 turn.wav
3. 人工：solo 打一局，AI 出牌后轮到我响"叩叩"；开局我先行不响；联机重连
   轮到我不响；静音开关对 turn 生效
