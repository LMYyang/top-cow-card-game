// 服务器地址：VITE_WS_URL 构建注入优先（前后端分开部署）；https 页面用 wss+同主机；
// 本地开发（http）用同主机 + config.json 的 wsPort（与 server 共用）
import wsPort from '../../config.json'

const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1'
const httpsPage = typeof location !== 'undefined' && location.protocol === 'https:'
export const SERVER_WS_URL = import.meta.env?.VITE_WS_URL || (httpsPage ? `wss://${host}` : `ws://${host}:${wsPort.wsPort}`)
