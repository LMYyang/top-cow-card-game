/** 牌面样式（皮肤）定义与本地存储。
 *  皮肤只换外观，不改变牌面点阵渲染；纯本地偏好，存 dingniuzi_skin，不进算账 settings。 */

export const STORAGE_KEY = 'dingniuzi_skin'

/** 皮肤清单：id 唯一，css 为 PlayingTile 根节点附加的主题类（skin-{id}） */
export const TILE_SKINS = [
  {
    id: 'classic',
    name: '经典骨牌',
    desc: '米白牙面 · 民间传统配色',
    css: 'skin-classic',
  },
  {
    id: 'night',
    name: '暗夜墨玉',
    desc: '墨黑玉面 · 高对比护眼',
    css: 'skin-night',
  },
  {
    id: 'wood',
    name: '原木手作',
    desc: '原木纹理 · 温润亲切',
    css: 'skin-wood',
  },
  {
    id: 'azure',
    name: '青花瓷韵',
    desc: '青白瓷面 · 清雅国风',
    css: 'skin-azure',
  },
  {
    id: 'candy',
    name: '糖果亮色',
    desc: '明快彩色 · 适老醒目',
    css: 'skin-candy',
  },
  {
    id: 'sakura',
    name: '樱花物语',
    desc: '樱粉瓷面 · 温柔甜暖',
    css: 'skin-sakura',
  },
]

export const DEFAULT_SKIN = 'classic'

/** 读取本地皮肤设置：非法值回退 classic */
export function loadSkin() {
  const v = uni.getStorageSync(STORAGE_KEY)
  return TILE_SKINS.some((s) => s.id === v) ? v : DEFAULT_SKIN
}

/** 持久化皮肤设置 */
export function saveSkin(id) {
  uni.setStorageSync(STORAGE_KEY, id)
}

/** 皮肤 id → 主题 CSS 类（非法回退 classic 的类） */
export function skinClass(id) {
  const s = TILE_SKINS.find((x) => x.id === id)
  return s ? s.css : 'skin-classic'
}
