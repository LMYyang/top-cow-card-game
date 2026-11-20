/** 算账设置（单机本地存储与联网房间共用形态）。
 *  enabled: 算账总开关；red/yao/erSan/wu: 红/幺/二三/五账种分别勾选 */

export const DEFAULT_SETTINGS = { enabled: false, red: true, yao: true, erSan: true, wu: true }

/** 规整任意输入为合法 settings：缺省补齐、非布尔回退默认、多余字段剥离 */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pick = (v, dflt) => (typeof v === 'boolean' ? v : dflt)
  return {
    enabled: pick(src.enabled, DEFAULT_SETTINGS.enabled),
    red: pick(src.red, DEFAULT_SETTINGS.red),
    yao: pick(src.yao, DEFAULT_SETTINGS.yao),
    erSan: pick(src.erSan, DEFAULT_SETTINGS.erSan),
    wu: pick(src.wu, DEFAULT_SETTINGS.wu),
  }
}
