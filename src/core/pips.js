// src/core/pips.js
/** 骨牌一端点阵：n 点在 3x3 网格中的位置（0-8，按行）
 *  注：幺点（1）、二点（2）传统上贴半区外边缘——竖牌上半贴顶（*_TOP）、下半贴底（*_BOTTOM），不居中放 */
export const PIP_LAYOUTS = {
  1: [1],
  '1_TOP': [1],
  '1_BOTTOM': [7],
  2: [0, 2],
  '2_TOP': [0, 2],
  '2_BOTTOM': [6, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/** 点阵 90° 逆时针旋转映射：(r,c)→(2-c,r)，竖牌上半转到横牌左半。
 *  横牌按"竖牌旋转 90°"渲染点阵：二点变上下排（1、7）、六点变两行三列、对角线换向 */
const PIP_ROTATE_CCW = [6, 3, 0, 7, 4, 1, 8, 5, 2]
export const rotatePipsCCW = (layout) => layout.map((p) => PIP_ROTATE_CCW[p])

/** 单个点的颜色（按未旋转的基准位置）：1、4 点全红；大天（6|6）b 端左列（0、3、6）红、
 *  a 端右列（2、5、8）红——竖牌上半左列红、下半右列红，横放时呈 S 形红带；其余全黑（民间骨牌传统） */
export function pipColorAt(name, n, face, basePos) {
  if (n === 1 || n === 4) return 'red'
  if (name === '大天' && n === 6) {
    if (face === 'b' && (basePos === 0 || basePos === 3 || basePos === 6)) return 'red'
    if (face === 'a' && (basePos === 2 || basePos === 5 || basePos === 8)) return 'red'
  }
  return 'black'
}
