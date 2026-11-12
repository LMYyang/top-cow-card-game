// 服务器地址配置。H5 开发/演示：与页面同主机的 3001 端口。
// 多端发布时可改为构建注入或远端地址。
const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1'
export const SERVER_WS_URL = `ws://${host}:3001`
