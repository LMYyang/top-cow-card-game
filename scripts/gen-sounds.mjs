// 音效合成器：零依赖，手写 WAV（44 字节头 + PCM 16bit 单声道 22050Hz）。
// 运行 node scripts/gen-sounds.mjs 产出音效到 src/static/sounds/（产物已提交仓库，
// 仅调整音色时手动重跑；package.json 有 gen:sounds 别名）。
// 噪声源全部用种子 rng（mulberry32）：产物逐字节可复现，重跑不产生 git diff、调音可 A/B。
//
// 音效清单（用户定稿表）：
//   click      按钮点击（所有按钮）        轻脆短 ui 滴声
//   shuffle    开局洗牌发牌                骨牌哗啦、木牌洗牌声
//   play_card  自己出牌（顶牌）链条接上    木质骨牌"咔哒"（灵魂音）
//   other_play 别家出牌                    与 play_card 接近、音量略小
//   pass       无牌可接扣牌                低沉闷一声，不刺耳
//   suanzhang  触发算账（封三家）          高亮提示音，比出牌醒目
//   win        本局你赢                    轻快喜庆短音
//   lose       本局你输                    低沉柔和，不闹心
//   bgm        局内背景音乐（循环）        舒缓国风轻音乐，音量压低
//   turn       轮到你出牌                  木质双音"叩叩"（温和提醒）
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'static', 'sounds')
const SR = 22050 // 采样率

/** 线性数组 → wav Buffer（PCM16 单声道） */
function toWav(samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // fmt 块长
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // 单声道
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28) // 字节率
  buf.writeUInt16LE(2, 32) // 块对齐
  buf.writeUInt16LE(16, 34) // 位深
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  return buf
}

const sec = (s) => Math.round(s * SR)
/** 种子随机（mulberry32），产物可复现 */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 时长 s 秒的全 0 底 */
const silence = (s) => new Float32Array(sec(s))

/** 把 src 片段叠加到 dst 的 at 秒处 */
function mix(dst, src, at = 0) {
  const off = sec(at)
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i]
  return dst
}

/** 白噪声 burst：时长 dur，指数衰减 tau，幅度 amp；lp∈(0,1] 一阶低通（越小越闷），rnd 必传 */
function noiseBurst(dur, tau, amp, lp, rnd) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1
    prev = prev + lp * (w - prev)
    out[i] = prev * amp * Math.exp(-i / SR / tau)
  }
  return out
}

/** 正弦敲击：频率 f0→f1 滑频，指数衰减 tau，幅度 amp */
function tone(f0, f1, dur, tau, amp) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = f0 + (f1 - f0) * (t / dur)
    phase += (2 * Math.PI * f) / SR
    out[i] = Math.sin(phase) * amp * Math.exp(-i / SR / tau)
  }
  return out
}

/** 琶音音符：频率 f，时长 dur，幅度 amp（快 attack + 指数尾，八度泛音） */
function note(f, dur, amp) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (2 * Math.PI * f) / SR
    const env = Math.min(1, t / 0.01) * Math.exp(-t / (dur / 3))
    out[i] = (Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.2) * amp * env
  }
  return out
}

/**
 * 拨弦/古筝质感音符：基频 + 二三次谐波，快 attack、指数衰减、相位随机微偏。
 */
function pluck(f, dur, amp, rnd) {
  const n = sec(dur)
  const out = new Float32Array(n)
  const p2 = rnd() * Math.PI * 2
  const p3 = rnd() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const ph = 2 * Math.PI * f * t
    const env = Math.min(1, t / 0.008) * Math.exp(-t / (dur / 4))
    out[i] =
      (Math.sin(ph) * 0.7 +
        Math.sin(2 * ph + p2) * 0.22 +
        Math.sin(3 * ph + p3) * 0.1) *
      amp * env
  }
  return out
}

/** 五声音阶（宫商角徵羽，D 调）频率表，bgm 旋律/和弦取音用 */
const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88] // D4 E4 F#4 A4 B4

const sounds = {}

// 1. click：轻脆短 ui 滴声——高频短正弦 + 极短瞬态（~0.07s）
{
  const out = silence(0.09)
  mix(out, tone(1250, 900, 0.06, 0.02, 0.5))
  mix(out, pluck(1875, 0.06, 0.18, rng(7)))
  sounds.click = out
}
// 2. shuffle：骨牌哗啦——多粒错落木质碰撞（噪声+短音），首尾渐弱（~1.4s）
{
  const out = silence(1.5)
  const r = rng(11)
  // 32 粒碰撞：前密后疏 + 幅度包络（中部最响），每粒 = 闷噪 + 短木音（频率随机）
  for (let k = 0; k < 32; k++) {
    const at = 0.05 + (k / 31) * 1.15 + r() * 0.03
    const env = Math.sin(Math.PI * (k / 31)) * 0.55 + 0.25 // 中间响两头轻
    mix(out, noiseBurst(0.035, 0.008, env * 0.55, 0.3 + r() * 0.3, r), at)
    mix(out, tone(700 + r() * 500, 300 + r() * 200, 0.05, 0.012, env * 0.4), at)
  }
  sounds.shuffle = out
}
// 3. play_card：木质骨牌"咔哒"——清脆高频敲击 + 木质中频体腔共鸣（~0.16s）
{
  const out = silence(0.2)
  const r = rng(21)
  mix(out, noiseBurst(0.012, 0.003, 0.8, 0.95, r)) // 极短高频瞬态（"咔"）
  mix(out, tone(1900, 1500, 0.03, 0.008, 0.45)) // 高频主干
  mix(out, tone(420, 300, 0.1, 0.035, 0.55)) // 木质体腔（"哒"的木头感）
  mix(out, tone(880, 700, 0.05, 0.02, 0.22), 0.004) // 中频泛音
  sounds.play_card = out
}
// 4. other_play：与 play_card 同构，整体幅度 ×0.65（音量略小区分自己/别人）
{
  const r = rng(21) // 同种子同碰撞波形，只差幅度
  const out = silence(0.2)
  mix(out, noiseBurst(0.012, 0.003, 0.8 * 0.65, 0.95, r))
  mix(out, tone(1900, 1500, 0.03, 0.008, 0.45 * 0.65))
  mix(out, tone(420, 300, 0.1, 0.035, 0.55 * 0.65))
  mix(out, tone(880, 700, 0.05, 0.02, 0.22 * 0.65), 0.004)
  sounds.other_play = out
}
// 5. pass：低沉闷一声——低通很重的敲击，不刺耳（~0.18s）
{
  const out = silence(0.16)
  const r = rng(31)
  mix(out, tone(180, 110, 0.12, 0.05, 0.65))
  mix(out, noiseBurst(0.04, 0.015, 0.28, 0.12, r)) // 很闷的噪声
  sounds.pass = out
}
// 6. suanzhang：高亮提示音——明亮双音上行 + 高频闪光（~0.5s，比出牌醒目）
{
  const out = silence(0.55)
  mix(out, pluck(587.33, 0.18, 0.85, rng(31))) // D5
  mix(out, pluck(880, 0.35, 0.75, rng(32)), 0.12) // A5（高八度五度）
  mix(out, tone(2200, 2600, 0.12, 0.05, 0.12), 0.1) // 高频闪光泛音
  sounds.suanzhang = out
}
// 7. win：轻快喜庆短音——宫调式上行琶音（D5-F#5-A5-D6）+ 尾音双八度（~0.8s）
{
  const out = silence(0.85)
  mix(out, pluck(587.33, 0.18, 0.6, rng(41)), 0)
  mix(out, pluck(739.99, 0.18, 0.6, rng(42)), 0.1)
  mix(out, pluck(880, 0.18, 0.65, rng(43)), 0.2)
  mix(out, pluck(1174.66, 0.4, 0.7, rng(44)), 0.2) // 尾音与 A5 叠出双八度感
  sounds.win = out
}
// 8. lose：低沉柔和——下行纯五度（A4→D4），音色柔（低通正弦，无高频泛音）（~0.7s）
{
  const out = silence(0.75)
  mix(out, tone(440, 420, 0.25, 0.1, 0.4))
  mix(out, tone(293.66, 260, 0.45, 0.18, 0.6), 0.22)
  sounds.lose = out
}
// 9. bgm：舒缓国风轻音乐（~21.3s 五声旋律循环 + 琶音衬底），音量压低不盖操作音
//    D 宫五声（D-E-F#-A-B），2 小节动机变奏 4 遍；句间留气口便于无缝 loop
{
  const barDur = 2.6 // 每乐句时长
  const out = silence(barDur * 8 + 0.4)
  // 旋律动机（音级索引→PENTA，-1 休止；[拍长, 音] 序列，拍长单位 ~0.22s）
  const motifs = [
    [[2, 0], [1, 1], [1, 2], [2, 3], [2, 1], [2, -1]], // 变奏 A
    [[2, 3], [1, 2], [1, 1], [2, 2], [2, -1], [3, 0]], // 变奏 B（回到宫音）
    [[1, 4], [1, 3], [2, 2], [2, 1], [2, 3], [2, -1]], // 变奏 C
    [[2, 2], [1, 1], [1, 2], [2, 0], [4, -1]], // 变奏 D（终止在宫音，长气口）
  ]
  const r = rng(99)
  for (let phrase = 0; phrase < 4; phrase++) {
    const base = phrase * barDur
    let at = 0.05
    for (const [len, idx] of motifs[phrase]) {
      if (idx >= 0) {
        const f = PENTA[idx]
        mix(out, pluck(f, Math.min(len * 0.22 + 0.3, 0.6), 0.5, r), base + at)
      }
      at += len * 0.22
    }
    // 衬底琶音：每乐句中后段一组慢琶音（宫-角-羽），音量很低
    mix(out, pluck(PENTA[0] / 2, 0.7, 0.16, r), base + barDur * 0.45)
    mix(out, pluck(PENTA[2] / 2, 0.7, 0.14, r), base + barDur * 0.62)
    mix(out, pluck(PENTA[3] / 2, 0.7, 0.14, r), base + barDur * 0.6)
  }
  sounds.bgm = out
}

// 10. turn：轮到你出牌——木质双音"叩叩"（D5+A5 拨弦）
{
  const out = silence(0.5)
  mix(out, pluck(587.33, 0.16, 0.55, rng(51))) // D5
  mix(out, pluck(880, 0.28, 0.5, rng(52)), 0.08) // A5 高五度，错开 80ms
  sounds.turn = out
}

mkdirSync(OUT, { recursive: true })
for (const [name, samples] of Object.entries(sounds)) {
  const p = join(OUT, `${name}.wav`)
  writeFileSync(p, toWav(samples))
  console.log(`[gen-sounds] ${p} (${(samples.length / SR).toFixed(2)}s)`)
}
console.log(`[gen-sounds] 完成：${Object.keys(sounds).length} 个文件`)
