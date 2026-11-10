/**
 * 顶牛子 24 张牌数据。
 * 牌型定义 { name, aka, a, b(两端点数 1-6), type: '横牌'|'竖牌', red: 是否红牌, count }
 * 实例牌 { id, name, a, b, type, red } —— id 全局唯一（如 't1-1'）。
 */

const CATALOG_DEF = [
  { name: '大天', aka: '长六、天牌', a: 6, b: 6, type: '横牌', red: false, count: 2 },
  { name: '虎头', aka: '斧头',     a: 5, b: 6, type: '竖牌', red: false, count: 2 },
  { name: '大五', aka: '长五、梅花', a: 5, b: 5, type: '横牌', red: false, count: 2 },
  { name: '红十', aka: '金屏、四六', a: 4, b: 6, type: '竖牌', red: true,  count: 2 },
  { name: '红八', aka: '大红、人牌', a: 4, b: 4, type: '横牌', red: true,  count: 2 },
  { name: '长三', aka: '大三、长衫', a: 3, b: 3, type: '横牌', red: false, count: 2 },
  { name: '一六', aka: '幺六、高脚七', a: 1, b: 6, type: '竖牌', red: false, count: 2 },
  { name: '一五', aka: '幺五、铜棰', a: 1, b: 5, type: '竖牌', red: false, count: 2 },
  { name: '一三', aka: '幺三、幺鹅', a: 1, b: 3, type: '竖牌', red: false, count: 2 },
  { name: '二板', aka: '长二、板凳', a: 2, b: 2, type: '横牌', red: false, count: 2 },
  { name: '地幺', aka: '长一、地牌', a: 1, b: 1, type: '横牌', red: false, count: 2 },
  { name: '三六', aka: '杂九、黑九', a: 3, b: 6, type: '竖牌', red: false, count: 1 },
  { name: '二六', aka: '杂八、平八', a: 2, b: 6, type: '竖牌', red: false, count: 1 },
]

/** 13 种牌型定义（code 按 CATALOG_DEF 顺序 t1..t13） */
export const CATALOG = CATALOG_DEF.map((c, i) => ({ ...c, code: `t${i + 1}` }))

/** 24 张实例牌 */
export const TILES = CATALOG.flatMap((c) =>
  Array.from({ length: c.count }, (_, k) => ({
    id: `${c.code}-${k + 1}`,
    name: c.name,
    a: c.a,
    b: c.b,
    type: c.type,
    red: c.red,
  }))
)

/** 牌总点数 = 两端之和 */
export const tilePoints = (tile) => tile.a + tile.b
