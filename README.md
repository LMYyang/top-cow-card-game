# 顶牛子（Top Cow Card Game）

华北民间骨牌游戏「顶牛子」的 uni-app 实现：单机 1 真人 + 3 AI，联机 2–4 人房间对战。

## 玩法

- 24 张骨牌（13 种牌型），四人各 6 张
- 上一局赢家掷一颗骰子定头牌（1/5 自己、2/6 下家、3 对家、4 上家）
- 头牌首出，之后逆时针跟牌：必须与桌面最新一张牌任一端点数相同
- 接不上必须扣牌；手中有可接的牌时不能扣（不能扣活牌）
- 全部 6 张出完/扣完后结算：扣牌点数最少者赢（+6），最多者大庄（-3）、二庄（-2）、小庄（-1）
- 算账（封账）：设置中开启并勾选账种（红/幺/二三/五），出封账牌宣告算账——成功扣点翻倍（+12/-6/-4/-2），失败包庄（-12/+12/0/0）

## 功能

- **单机对局**：真人坐 0 位，3 个 AI 补足；AI 按规则推理跟牌/扣牌/算账
- **联网对战**：大厅创建 / 快速匹配 / 房间号加入，2–4 人，空位 AI 补位，掉线 60s 宽限 + AI 托管代打，重连恢复；支持连续多局（结算后全员 `settleContinue` 重置回准备状态），同房多局按 `roomId` 归成「场次积分」
- **战绩统计**：单机/联网分页签；联网分「场次积分」（对账）与「逐局记录」；逐局展开可看四人角色、扣点与算账徽章（成功 ✓ / 包庄 ✗）
- **骨牌皮肤**：经典骨牌 / 暗夜墨玉 / 原木手作 / 青花瓷韵 / 糖果亮色 / 樱花物语，纯本地偏好
- **音效**：Web Audio 合成（无音频文件），静音持久化
- **设置**：算账总开关与四账种分别勾选（`src/core/settings.js`）

## 开发

```bash
npm run dev:h5        # H5 开发（vite 热更新）
npm test              # vitest 全部用例（core 逻辑 + server 房间 + 客户端接线）
npm run build:h5      # → dist/build/h5
npm run build:server  # → server/server.bundle.mjs（esbuild 自包含单文件）
node server/server.bundle.mjs   # 一个进程：页面 + WebSocket，端口 3001
```

> 依赖集中在工作区根 `node_modules`，项目目录内无需 `npm install`。

## 端口与部署

端口唯一来源是根目录 `config.json` 的 `wsPort`（默认 3001），`PORT` 环境变量优先级更高。

部署：拷 `dist/build/h5/` + `server/`（bundle + `config.json`），`node server/server.bundle.mjs` 即可——同端口托管 H5 静态页与 WebSocket，无需 nginx、无需 `npm install`。完整流程见 `docs/deploy-windows-server.md`。

## 目录

```
src/core/        纯 JS 规则引擎（tiles/deck/rules/game/ai/settings/tileSkins），不依赖 Vue 与 uni API
src/composables/ useGame（单机）/ useNetGame（联机）/ useSound / history（战绩持久化）
src/pages/       index 菜单+战绩 / game 对局 / lobby 大厅 / room 房间 / roomlist 房间列表 / settings 设置
src/utils/       net.js（ws 封装：requestId + 重连 + 平台 socket 适配）、config.js、storage.js
server/          index.js（HTTP+WS+静态托管）/ rooms.js（房间、AI 补位与托管、断线宽限、连续局）/ port.js
tests/           vitest：rules / deck / game / ai / settings / tiles / server-rooms / net-scenarios / client-*
docs/            部署指南、游戏说明
```

## 架构约定

- core 状态机纯函数：动作返回 `{ ok, reason? }`，非法操作不改状态；RNG 可注入复现
- 服务端权威：`server/rooms.js` 直接复用 `src/core`；推给客户端的视图经 `viewOf` 脱敏，不泄露他人手牌
- `vitest.config.js` 不加载 uni 插件，核心测试跑在 node 环境
