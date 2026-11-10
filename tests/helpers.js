import { TILES } from '../src/core/tiles.js'

/** 按 id 取实例牌，如 tile('t1-1') */
export function tile(id) {
  const t = TILES.find(t => t.id === id)
  if (!t) throw new Error(`unknown tile id: ${id}`)
  return t
}
