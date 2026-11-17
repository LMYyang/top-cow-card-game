# 音效系统设计（顶牛子）

日期：2026-11-17
状态：已确认（brainstorming 四节逐节确认通过）

## 目标

为顶牛子（uni-app H5 卡牌游戏，单机 + 联网对战）增加游戏事件音效：掷骰、出牌、扣牌、宣告、结算、亮牌共 8 类事件、9 个音效文件，带游戏页静音开关（本地持久化）。

## 方案（已选定）

**预生成 wav 文件 + `uni.createInnerAudioContext`。**

- 音效素材由零依赖 Node 脚本 `scripts/gen-sounds.mjs` 合成（手写 WAV 编码：44 字节头 + PCM 16bit 单声道 22050Hz），产物提交进仓库
- 否决的备选：运行时 Web Audio 合成（仅 H5 支持，iOS 手势解锁坑多，与项目"H5 为主留多端"方向冲突）；混合方案（复杂度翻倍，收益仅"仓库干净"）
- 服务器零改动：音效全部由客户端 fx 状态驱动，单机/联网共用同一套触发逻辑

## 音效清单

| 文件 | 事件 | 合成思路 | 时长 |
|---|---|---|---|
| `dice-roll.wav` | 掷骰点击 | 密集短噪声脉冲（骰子摇晃） | ~0.5s |
| `dice-land.wav` | 骰子落定 | 低频闷响 + 短衰减 | ~0.25s |
| `tile-play.wav` | 飞牌落桌 | 中频"啪"（白噪声 burst + 低频敲击） | ~0.15s |
| `tile-discard.wav` | 扣牌 | 较轻更闷的翻扣声 | ~0.12s |
| `account-slam.wav` | 宣告算账拍桌 | 重低音 slam + 尾震 | ~0.4s |
| `settle-win.wav` | 结算-我赢 | 上扬三音阶琶音（C-E-G） | ~0.6s |
| `settle-lose.wav` | 结算-我输 | 下坠双音 | ~0.5s |
| `settle-draw.wav` | 结算-平局/无输赢 | 中性单音 | ~0.3s |
| `reveal-flip.wav` | 亮牌翻牌 | 高频短"唰" | ~0.1s |

产物路径：`src/static/sounds/`（uni 构建自动拷贝到 `dist/build/h5/static/sounds/`，与 favicon.svg 同链路，无需额外配置）。

## useSound composable

新文件 `src/composables/useSound.js`，单例模式（多处调用共享同一状态）：

```js
export function useSound() // → { play, muted, toggleMute }
```

- **音频实例池**：每个音效名一个 `uni.createInnerAudioContext({ src: '/static/sounds/xxx.wav' })`，懒创建、常驻复用；重播时 `stop() + play()` 从头放
- **防重入**：`play(name)` 记录时间戳，同名间隔 <50ms 忽略（亮牌连锁 watcher、双触发节流）
- **静音**：`muted` ref，初值读 `uni.getStorageSync('dingniuzi_muted')`；`toggleMute()` 切换并持久化；muted 时 `play()` 直接 return
- **路径**：`src` 用 `/static/sounds/...`（部署在根路径，与 favicon 引用一致）
- **容错**：所有 uni 音频 API try-catch 包裹，音频失败静默、不影响游戏逻辑

## game.vue 触发点接线

引入 `useSound()`，加一两行/处，不动现有逻辑：

| 触发时机 | 锚点（现有代码） | 音效 |
|---|---|---|
| 点掷骰按钮 `roll()` | 按钮点击处 | `dice-roll` |
| 骰子落定 | fx.diceRolling→false 的 watcher（~L340） | `dice-land` |
| 飞牌落定 | `flyLanded=true` 分支（~L554） | `tile-play` |
| 扣牌成功 | myDiscard 成功回调 | `tile-discard` |
| 宣告拍桌 | accountSplash watcher（~L516） | `account-slam` |
| 本局结束 | settleBrief 置 true 时（settle 时 result 已就绪） | `settle-win`（winner===我）/ `settle-lose`（有 winner 非）/ `settle-draw`（无 winner） |
| 亮牌 | revealKept 点亮瞬间 | `reveal-flip` 播 1 次 |

**双响规避**：结算音只在 settleBrief 出现时播一次，结算弹窗（settleShow/confetti）静默；亮牌音在 revealKept 点亮时播一次（不逐张挂，渲染是瞬间整体出现）。

**静音按钮**：`btn-home` 旁同款式小按钮（🔊/🔇），`@click.stop` 避免触发亮牌点击。

**不接音效**：重新发牌（有 toast 即可）、轮到你提示（可吵）、结算弹窗（已播过）。

## 测试

- 新增 `tests/sound.test.js`：mock `uni.createInnerAudioContext` / `getStorageSync` / `setStorageSync`，覆盖防重入节流（<50ms 同名忽略）与 muted 开关持久化（切换 + 重读初值）
- 合成脚本不进单测（产物确定性靠生成后 diff 抽查）
- 现有 228 用例不受影响（useSound 不被 core 依赖，接线属 UI 层）

## 构建与部署

- `package.json` 加 `"gen:sounds": "node scripts/gen-sounds.mjs"`（wav 已提交，脚本仅调音效时手动跑）
- `npm run build:h5` 后确认 `dist/build/h5/static/sounds/*.wav` 9 个文件存在
- server bundle 无需重建（服务器零改动）
- 部署：覆盖服务器 `dist\` 即可（静态资源变更；保险起见 `pm2 restart dingniuzi` 亦可）

## 不做的事（YAGNI）

背景音乐、音量分档（仅静音/开两态）、服务器下发音效配置、多语言语音、重新发牌音、轮到你提示音。
