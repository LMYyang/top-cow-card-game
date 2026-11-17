// scripts/gen-sounds.mjs
// 音效合成器：零依赖，手写 WAV（44 字节头 + PCM 16bit 单声道 22050Hz）。
// 运行 node scripts/gen-sounds.mjs 产出 9 个 wav 到 src/static/sounds/（产物已提交仓库，
// 仅调整音色时手动重跑；package.json 有 gen:sounds 别名）。
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
// 简易可复现随机（mulberry32），骰子摇动脉冲间隔抖动用
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 时长 sec 秒的全 0 底 */
const silence = (s) => new Float32Array(sec(s))

/** 把 src 片段叠加到 dst 的 at 秒处 */
function mix(dst, src, at = 0) {
  const off = sec(at)
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i]
  return dst
}

/** 白噪声 burst：时长 dur，指数衰减 tau，幅度 amp（可加 simple lowpass） */
function noiseBurst(dur, tau, amp, lp = 1) {
  const n = sec(dur)
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const w = (Math.random() * 2 - 1)
    prev = prev + lp * (w - prev) // 一阶低通，lp∈(0,1] 越小越闷
    out[i] = prev * amp * Math.exp(-i / SR / tau)
  }
  return out
}

/** 正弦敲击：频率 f0，指数衰减 tau，幅度 amp；f0 随时间滑向 f1（下坠感） */
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

/** 琶音音符：频率 f，时长 dur，幅度 amp（快 attack + 指数尾） */
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

const sounds = {}

// 1. dice-roll：一串密集短噪声脉冲（骰子在手中摇晃，~0.5s），脉冲间隔带随机抖动
{
  const out = silence(0.55)
  const r = rng(42)
  let at = 0
  while (at < 0.45) {
    mix(out, noiseBurst(0.045, 0.012, 0.7, 0.5), at)
    at += 0.03 + r() * 0.04
  }
  sounds['dice-roll'] = out
}
// 2. dice-land：低频闷响 + 短噪声（骰子落碗，~0.25s）
{
  const out = silence(0.3)
  mix(out, tone(150, 90, 0.22, 0.06, 0.9))
  mix(out, noiseBurst(0.08, 0.02, 0.5, 0.35))
  sounds['dice-land'] = out
}
// 3. tile-play：中频"啪"——白噪声 burst + 低频敲击叠加（~0.15s）
{
  const out = silence(0.18)
  mix(out, noiseBurst(0.05, 0.008, 0.95, 0.7))
  mix(out, tone(320, 180, 0.12, 0.03, 0.8))
  sounds['tile-play'] = out
}
// 4. tile-discard：较轻更闷的翻扣声（~0.12s）
{
  const out = silence(0.14)
  mix(out, noiseBurst(0.05, 0.01, 0.6, 0.22))
  mix(out, tone(220, 140, 0.09, 0.025, 0.55))
  sounds['tile-discard'] = out
}
// 5. account-slam：重低音 slam + 尾震（拍桌宣告，~0.4s）
{
  const out = silence(0.45)
  mix(out, tone(120, 55, 0.35, 0.1, 1.0))
  mix(out, noiseBurst(0.1, 0.03, 0.7, 0.4))
  mix(out, tone(60, 50, 0.3, 0.18, 0.5), 0.05) // 尾震
  sounds['account-slam'] = out
}
// 6. settle-win：上扬三音阶琶音 C5-E5-G5（~0.6s）
{
  const out = silence(0.7)
  mix(out, note(523.25, 0.25, 0.7), 0)
  mix(out, note(659.25, 0.25, 0.7), 0.15)
  mix(out, note(783.99, 0.4, 0.8), 0.3)
  sounds['settle-win'] = out
}
// 7. settle-lose：下坠双音（~0.5s）
{
  const out = silence(0.55)
  mix(out, note(392, 0.22, 0.7), 0) // G4
  mix(out, note(311.13, 0.35, 0.7), 0.18) // Eb4
  sounds['settle-lose'] = out
}
// 8. settle-draw：中性单音（~0.3s）
{
  const out = silence(0.35)
  mix(out, note(440, 0.3, 0.6), 0) // A4
  sounds['settle-draw'] = out
}
// 9. reveal-flip：高频短"唰"（亮牌翻牌，~0.1s）
{
  const out = silence(0.12)
  mix(out, noiseBurst(0.06, 0.012, 0.5, 0.9))
  sounds['reveal-flip'] = out
}

mkdirSync(OUT, { recursive: true })
for (const [name, samples] of Object.entries(sounds)) {
  const p = join(OUT, `${name}.wav`)
  writeFileSync(p, toWav(samples))
  console.log(`[gen-sounds] ${p} (${(samples.length / SR).toFixed(2)}s)`)
}
console.log(`[gen-sounds] 完成：${Object.keys(sounds).length} 个文件`)
