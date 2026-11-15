# 云服务器部署指南（Windows Server 2022）

## 架构

部署到一台云服务器（Windows Server 2022），同一个 Node 进程同时托管：

- HTTP 静态页：`dist/build/h5`（`npm run build:h5` 产物，server/index.js 内置静态托管）
- WebSocket：同端口 3001 的 ws 服务

玩家浏览器访问 `http://112.126.93.238:3001` 即玩，ws 连 `ws://112.126.93.238:3001`（同主机同端口，前端已自适应，无需配置）。

> 为什么用 IP + 3001：IP 直连不需要域名备案；`src/utils/config.js` 的逻辑是 http 页面固定连 `ws://主机:3001`，所以**保持默认 3001 端口、不要设 PORT 环境变量**，前端零改动。

## 服务器信息

- IP：`112.126.93.238`
- 系统：Windows Server 2022 数据中心版 64 位（中文）
- 代码仓库：https://github.com/LMYyang/top-cow-card-game（master 分支）

## 第 1 步：远程登录 + 安装 Node

1. 本机按 `Win+R` 输入 `mstsc`，用云控制台给的账号密码远程登录服务器
2. 以下 PowerShell 全部**右键 → 以管理员身份运行**
3. 服务器里用浏览器打开 https://nodejs.org/zh-cn 下载 **LTS 22.x 的 Windows 安装包（.msi）64 位**，一路下一步
4. 重开一个 PowerShell 验证：

```powershell
node -v   # 应显示 v22.x
```

## 第 2 步：拿代码到服务器

在服务器 PowerShell 里：

```powershell
mkdir C:\dingniuzi
cd C:\dingniuzi
git clone https://github.com/LMYyang/top-cow-card-game.git code
cd code
```

**备选（GitHub 克隆慢/失败时）**：不装 git，直接用 RDP 拷贝——

1. mstsc 连接时点「显示选项 → 本地资源 → 详细信息 → 勾选驱动器」
2. 登录后服务器里打开 `\\tsclient\D\demo\`，把 `top-cow-card-game` 整个复制到 `C:\dingniuzi\code`
3. **必须跳过 `node_modules` 文件夹**（本地二进制依赖与服务器环境不同）

## 第 3 步：安装依赖 + 构建

```powershell
npm config set registry https://registry.npmmirror.com   # 国内镜像，快很多
cd C:\dingniuzi\code
npm install
npm run build:h5
```

构建完确认存在 `dist\build\h5\index.html`。

## 第 4 步：放行端口（两层都要）

**云控制台安全组**：

- 找到这台服务器的「防火墙 / 安全组」规则
- 添加入站规则：**TCP 3001，来源 0.0.0.0/0**

**Windows 防火墙**（管理员 PowerShell）：

```powershell
New-NetFirewallRule -DisplayName "dingniuzi-3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

## 第 5 步：启动服务（先手动跑通）

```powershell
cd C:\dingniuzi\code
node server/index.js
```

> **不要设 PORT 环境变量**，保持默认 3001（见开头说明）。

验证：服务器本机浏览器打开 `http://localhost:3001`，应能进游戏主菜单。

## 第 6 步：pm2 常驻运行（防关窗口/重启后服务消失）

新开一个 PowerShell：

```powershell
npm i -g pm2 pm2-windows-startup
pm2-startup install          # 注册开机自启
cd C:\dingniuzi\code
pm2 start server/index.js --name dingniuzi
pm2 save                     # 保存当前进程列表
```

常用命令：

```powershell
pm2 status        # 查看运行状态
pm2 logs dingniuzi  # 看日志
pm2 restart dingniuzi
pm2 stop dingniuzi
```

## 以后更新游戏

本地改完代码推 GitHub 后，服务器上执行：

```powershell
cd C:\dingniuzi\code
git pull
npm install
npm run build:h5
pm2 restart dingniuzi
```

（用 RDP 拷贝方式的，把本地最新代码重新覆盖到 `C:\dingniuzi\code` 再执行后三步。）

## 验证清单

- [ ] 服务器本机：`http://localhost:3001` 进游戏主菜单
- [ ] 本机浏览器：`http://112.126.93.238:3001` 进游戏主菜单（验证安全组）
- [ ] 手机浏览器（同 WiFi 或流量）：同地址进游戏，创建房间拿到房间号
- [ ] 第二台设备：加入房间，能联网对战

## 注意事项

- **http 明文**：IP 访问没有 https，ws 也是明文 `ws://`。对游戏可用性无影响；以后绑域名时建议加 nginx + TLS 证书（https 页面会自动改用 `wss://`，前端 config.js 已适配）
- **备案**：纯 IP 访问不需要 ICP 备案；以后要绑域名走 80/443 才涉及备案
- **不要改端口**：前端 http 场景写死 `ws://主机:3001`，除非同时改 `src/utils/config.js` 并重新构建
- **服务器重启后**：pm2-startup 已注册自启，正常无需手动操作；若服务没起来，登录后跑 `pm2 status` 检查
