/** 桌布（桌面背景）定义与本地存储。
 *  桌布只换牌桌背景外观，不改变牌面与规则；纯本地偏好，存 dingniuzi_cloth，不进算账 settings。
 *  图案全部由 CSS 渐变/重复背景绘制，不依赖外部图片资源。 */

export const CLOTH_STORAGE_KEY = 'dingniuzi_cloth'

/** 桌布清单：id 唯一，css 为牌桌根节点附加的主题类（cloth-{id}），
 *  preview 供设置页缩略预览取色/取图案 */
export const TABLE_CLOTHS = [
  {
    id: 'classic',
    name: '深棕绒面',
    desc: '素面深棕 · 传统牌桌底色',
    css: 'cloth-classic',
  },
  {
    id: 'felt-green',
    name: '墨绿呢绒',
    desc: '经典赌场绿 · 细织呢纹',
    css: 'cloth-felt-green',
  },
  {
    id: 'diamond',
    name: '菱格织锦',
    desc: '暗金菱格 · 中式织锦纹样',
    css: 'cloth-diamond',
  },
  {
    id: 'cloud',
    name: '祥云卷草',
    desc: '米金祥云 · 清雅国风底纹',
    css: 'cloth-cloud',
  },
  {
    id: 'plaid',
    name: '酒红格纹',
    desc: '酒红底 · 交错金线格纹',
    css: 'cloth-plaid',
  },
  {
    id: 'night',
    name: '午夜星空',
    desc: '深蓝夜幕 · 细碎星点微光',
    css: 'cloth-night',
  },
]

export const DEFAULT_CLOTH = 'classic'

/** 读取本地桌布设置：非法值回退 classic */
export function loadCloth() {
  const v = uni.getStorageSync(CLOTH_STORAGE_KEY)
  return TABLE_CLOTHS.some((c) => c.id === v) ? v : DEFAULT_CLOTH
}

/** 持久化桌布设置 */
export function saveCloth(id) {
  uni.setStorageSync(CLOTH_STORAGE_KEY, id)
}

/** 桌布 id → 主题 CSS 类（非法回退 classic 的类） */
export function clothClass(id) {
  const c = TABLE_CLOTHS.find((x) => x.id === id)
  return c ? c.css : 'cloth-classic'
}
