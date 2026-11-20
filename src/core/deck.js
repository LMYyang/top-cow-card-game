import { TILES } from './tiles.js'

/** mulberry32 种子随机数生成器，返回 () => [0,1) */
export function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates 洗牌，返回新数组 */
export function shuffle(tiles, rng = Math.random) {
  const arr = [...tiles]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 洗牌并分四组，每组 6 张。返回 [组0, 组1, 组2, 组3] */
export function dealGroups(rng = Math.random) {
  const shuffled = shuffle(TILES, rng)
  return [0, 1, 2, 3].map((i) => shuffled.slice(i * 6, i * 6 + 6))
}
