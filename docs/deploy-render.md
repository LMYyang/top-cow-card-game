# Render 部署指南（单服务：H5 前端 + WebSocket 同端口）

## 架构

Render 上部署**一个 Web Service**（Node），同一个端口同时托管：

- HTTP 静态页：`dist/build/h5`（`npm run build:h5` 产物，server/index.js 内置静态托管）
- WebSocket：同端口的 ws 服务（Render 平台自动做 TLS，客户端用 `wss://`）

浏览器访问 `https://xxx.onrender.com` 即玩，ws 连 `wss://xxx.onrender.com`（同主机，无需配置）。

## 需要的代码改动（已完成）

1. `server/index.js`：HTTP 回调从「一律 426」改为托管 `dist/build/h5` 静态文件（含 SPA 回退与目录穿越防护；目录不存在时退回 426，本地纯后端行为不变）
2. `src/utils/config.js`：ws 地址自适应——https 页面自动用 `wss://同主机`；本地 http 开发仍连 `ws://主机:3001`
3. `server/package.json`：`postinstall` 钩子在 Render 构建时顺带装根目录依赖（构建 H5 需要）

## Render 操作步骤

1. **推到 GitHub**（当前仓库还没有 remote）：
   ```bash
   git remote add origin https://github.com/<你的用户名>/top-cow-card-game.git
   git push -u origin master
   ```

2. **Render 控制台** → New + → **Web Service** → 连接该 GitHub 仓库

3. **填写配置**：
   | 项 | 值 |
   |---|---|
   | Name | `dingniuzi`（随意） |
   | Region | Singapore（离国内最近） |
   | Branch | `master` |
   | Root Directory | 留空（用仓库根目录） |
   | Runtime | Node |
   | **Build Command** | `npm install && npm run build:h5` |
   | **Start Command** | `node server/index.js` |
   | Instance Type | Free |

4. **环境变量**（Environment 标签）加一条：
   - `NODE_VERSION` = `22`（Render 默认 Node 版本较旧，建议显式指定）
   - `STATIC_DIR` 不用填（默认就指向 `../dist/build/h5`，相对 server 目录）

5. **Create Web Service**，等构建完成。

6. **验证**：打开 `https://<服务名>.onrender.com` → 应直接进游戏主菜单 → 创建房间能拿到房间号。手机浏览器打开同地址可加入（同一公网地址，不再依赖局域网）。

## 注意事项

- **Free 实例 15 分钟无流量会休眠**：下次访问冷启动约 30s+（牌局房间状态会丢失，休眠即房间销毁）。付费实例不休眠。
- **`ws://` 与 `wss://`**：https 页面里禁止连不加密的 `ws://`，所以配置里 https 页面强制 `wss`。Render 的 `*.onrender.com` 域名自带 TLS，无需手动配证书。
- **后续更新**：`git push` 后 Render 自动重新构建部署（默认开启 Auto-Deploy）。
- **本地验证单服务模式**（部署前可先自测）：
  ```bash
  npm run build:h5
  PORT=3999 node server/index.js   # Windows: set PORT=3999 && node server/index.js
  # 浏览器打开 http://localhost:3999 应能完整玩（含联网建房）
  ```
