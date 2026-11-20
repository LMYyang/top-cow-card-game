/** 历史记录存储：单机与联网共用的条目构造与读写。
 *  条目统一带 mode 字段（'solo'/'net'），主页历史列表据此区分展示。 */

const KEY = 'dingniuzi_history'
const MAX = 50
const STATS_KEY = 'dingniuzi_stats'
const BACKFILL_KEY = 'dingniuzi_stats_net_backfill' // 一次性迁移标记

/** 读取全部历史（最新在前） */
export function loadHistory() {
  return uni.getStorageSync(KEY) || []
}

/**
 * 一次性迁移：修复早期「联网局只写历史、统计只记单机」版本造成的 dingniuzi_stats 缺口。
 * 跑过一次后不再执行。返回纯单机口径的统计（已扣除迁移时从历史里并进来的联网部分）。
 */
export function backfillNetStats() {
  if (uni.getStorageSync(BACKFILL_KEY)) return uni.getStorageSync(STATS_KEY) || { rounds: 0, totalScore: 0 }
  const netEntries = loadHistory().filter((h) => h.mode === 'net')
  const prev = uni.getStorageSync(STATS_KEY) || { rounds: 0, totalScore: 0 }
  // 修复前 stats 混含联网局：从历史数出联网部分并剔除，得到纯单机口径
  const stats = {
    rounds: Math.max(0, prev.rounds - netEntries.length),
    totalScore: prev.totalScore - netEntries.reduce((s, h) => s + (h.scores?.[0] || 0), 0),
  }
  uni.setStorageSync(STATS_KEY, stats)
  uni.setStorageSync(BACKFILL_KEY, true)
  return stats
}

/**
 * 追加一局并持久化（最新在前，最多留 50 局）。
 * entry 必备：time / scores / roles / points；totalsAfter 可省略（联网局不参与单机累计链）。
 */
export function appendHistory(entry) {
  const prev = loadHistory()
  const full = { totalsAfter: {}, ...entry }
  uni.setStorageSync(KEY, [full, ...prev].slice(0, MAX))
}
