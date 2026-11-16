// 端口统一读取：根目录 config.json 的 wsPort 是唯一配置源（前端 dev/build 与 ws 服务器共用）。
// server 侧（node）：sync 读；PORT 环境变量优先（部署临时改端口无需动文件）。
// 优先级：PORT 环境变量 > config.json > 3001（配置文件缺失/损坏时兜底）。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PORT = 3001

function readConfigFile() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
    const p = Number(cfg.wsPort)
    if (Number.isInteger(p) && p > 0 && p < 65536) return p
    console.error('[config] config.json 的 wsPort 非法，使用默认端口', DEFAULT_PORT)
  } catch (e) {
    console.error('[config] 读取 config.json 失败（' + e.message + '），使用默认端口', DEFAULT_PORT)
  }
  return DEFAULT_PORT
}

/** ws 服务器启动端口：PORT 环境变量 > config.json > 3001 */
export function readPort() {
  const env = Number(process.env.PORT)
  if (Number.isInteger(env) && env > 0 && env < 65536) return env
  return readConfigFile()
}
