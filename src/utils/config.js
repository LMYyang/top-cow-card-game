// 服务器地址配置：
// - 构建注入优先（前端与 ws 分开部署时用）：环境变量 VITE_WS_URL，如 wss://dingniuzi-ws.onrender.com
// - https 页面（Render 单服务部署）：wss + 同主机，经平台 TLS 反代连到同端口的 ws 服务
// - 本地开发（http）：同主机 3001（npm run dev:h5 页面 + node server/index.js）
const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1'
const httpsPage = typeof location !== 'undefined' && location.protocol === 'https:'
export const SERVER_WS_URL = import.meta.env?.VITE_WS_URL || (httpsPage ? `wss://${host}` : `ws://${host}:3001`)
