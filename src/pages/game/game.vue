<!-- src/pages/game/game.vue -->
<template>
  <view class="table" :class="{ revealing: fx.revealKept }" @click="onRevealTap">
    <!-- 联网模式连接状态条：断线/重连中置顶提示 -->
    <view v-if="isNet && connection !== 'open'" class="net-bar">连接断开，重连中…</view>
    <!-- 对家（上） -->
    <view id="opp-top-anchor">
      <OpponentZone position="top" :seat="2" :label="labelOf(2)" :hand-count="opponentBySeat(2).handCount" :kept-count="opponentBySeat(2).keptCount" :is-leader="view.leaderSeat === 2" :last-move="lastMoveOf(2)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
    </view>

    <view class="middle-row">
      <!-- 上家（左） -->
      <view id="opp-left-anchor">
        <OpponentZone position="left" :seat="3" :label="labelOf(3)" :hand-count="opponentBySeat(3).handCount" :kept-count="opponentBySeat(3).keptCount" :is-leader="view.leaderSeat === 3" :last-move="lastMoveOf(3)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
      </view>

      <!-- 中央 -->
      <CenterArea>
        <template v-if="view.state === 'ROLLING'">
          <view class="dice" :class="{ rolling: fx.diceRolling, landed: diceLanded }">{{ diceFace }}</view>
          <!-- 落定后先看点数，稍后揭示头牌，再自动进入出牌阶段 -->
          <view v-if="leaderRevealed" class="dice-result">{{ diceResultText }}</view>
          <!-- 掷骰权在我时才显示按钮；他人掷骰时到点自动掷，仅显示状态文案（solo: 0=我；net: 服务器 rollerSeat） -->
          <button v-else-if="diceRollerSeat === mySeatVal" class="btn-primary" :disabled="fx.diceRolling" @click="roll()">{{ fx.diceRolling ? '掷骰中…' : '掷骰定头牌' }}</button>
          <view v-else class="turn-hint">{{ labelOf(diceRollerSeat) }}掷骰中…</view>
        </template>
        <template v-else-if="view.state === 'PLAYING'">
          <view id="timeline-anchor" class="timeline-wrap">
            <TableTimeline :history="view.tableHistory" :open-ends="view.openEnds" />
          </view>
          <view class="turn-hint">
            {{ turnText }}
          </view>
        </template>
        <template v-else-if="view.state === 'SETTLE'">
          <TableTimeline :history="view.tableHistory" />
          <view class="settle-brief">本局结束</view>
        </template>
      </CenterArea>

      <!-- 下家（右） -->
      <view id="opp-right-anchor">
        <OpponentZone position="right" :seat="1" :label="labelOf(1)" :hand-count="opponentBySeat(1).handCount" :kept-count="opponentBySeat(1).keptCount" :is-leader="view.leaderSeat === 1" :last-move="lastMoveOf(1)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
      </view>
    </view>

    <!-- 我的手牌 -->
    <view id="hand-anchor">
      <HandArea
        :hand="view.myHand"
        :kept="view.myKept"
        :playable-ids="playableIds"
        :my-turn="myTurn"
        :must-discard="mustDiscard"
        :selected-id="selectedId"
        :side="mySide"
        :open-ends="view.openEnds"
        :reveal-kept="fx.revealKept"
        @select="selectedId = $event"
        @choose-side="mySide = $event"
        @side-pick="onSidePick"
        @confirm-play="onConfirmPlay"
        @confirm-discard="onConfirmDiscard"
      >
        <!-- 亮牌阶段提示：位于"本局结束"与我的头像之间，等待玩家点击任意处继续 -->
        <view v-if="fx.revealKept && !fx.settleShow" class="tap-hint">点击屏幕任意处继续</view>
      </HandArea>
    </view>

    <!-- 飞牌动画层：出牌/扣牌后牌从出牌方飞向桌面链端（fixed 覆盖层，不参与布局） -->
    <view v-if="fly.tile" class="fly-layer" :style="flyStyle">
      <PlayingTile :tile="fly.tile" size="sm" :horizontal="fly.tile.type === '横牌'" />
    </view>

    <!-- 结算覆盖层 -->
    <view v-if="fx.settleShow && view.result" class="settle-overlay">
      <view class="settle-card">
        <text class="settle-title">本局结算</text>
        <view v-for="r in view.result.ranks" :key="r.seat" class="settle-row" :class="{ winner: r.seat === view.result.winner }">
          <view class="settle-player">
            <PlayerAvatar :seat="r.seat" size="sm" />
            <text>{{ labelOf(r.seat) }}{{ r.seat === view.result.winner ? ' 🏆' : '' }}</text>
          </view>
          <text>扣 {{ r.points }} 点 · {{ r.role }}</text>
          <text class="score">{{ view.result.scores[r.seat] > 0 ? '+' : '' }}{{ view.result.scores[r.seat] }}</text>
        </view>
        <view class="settle-actions">
          <button class="btn-primary" @click="restart">再来一局</button>
          <button class="btn-secondary" @click="goHome">回主菜单</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed, watch, onUnmounted, isRef } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import OpponentZone from '../../components/OpponentZone.vue'
import CenterArea from '../../components/CenterArea.vue'
import HandArea from '../../components/HandArea.vue'
import TableTimeline from '../../components/TableTimeline.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'
import { placeSides } from '../../core/rules.js'
import { useGame } from '../../composables/useGame.js'
import { useNetGame } from '../../composables/useNetGame.js'

/**
 * 双模式接入：solo（单机 AI）与 net（联网对战）。
 * 模式由 onLoad 的 query.mode 决定，此时才实例化对应 composable（useNetGame 订阅推送）。
 * 全部绑定走 computed 代理 + 空对象兜底（gameApi 就绪前模板已在渲染）；
 * solo 的 view/fx 为 reactive 对象、net 的 myTurn 等为 computed，isRef 区分后统一解包。
 */
const isNet = ref(false)
const gameApi = ref(null)
onLoad((query) => {
  isNet.value = query.mode === 'net'
  gameApi.value = isNet.value ? useNetGame() : useGame()
})

function emptyView() {
  return { state: '', myHand: [], myKept: [], opponents: [], tableHistory: [], openEnds: null, leaderSeat: null, currentSeat: null, rollerSeat: null, result: null }
}
function emptyFx() {
  return { dice: null, diceRolling: false, settleShow: false, revealKept: false, lastMove: null }
}
const unwrap = (v, fallback) => (isRef(v) ? v.value : v) ?? fallback
const view = computed(() => unwrap(gameApi.value?.view, emptyView()))
const fx = computed(() => unwrap(gameApi.value?.fx, emptyFx()))
const myTurn = computed(() => unwrap(gameApi.value?.myTurn, false))
const mustDiscard = computed(() => unwrap(gameApi.value?.mustDiscard, false))
const playableIds = computed(() => unwrap(gameApi.value?.playableIds, []))
// 掷骰权座位：net 下以服务器 view.rollerSeat 为准（useNetGame 已聚合）；solo 恒为 0
const diceRollerSeat = computed(() => unwrap(gameApi.value?.diceRollerSeat, 0))
const mySeatVal = computed(() => unwrap(gameApi.value?.mySeat, 0))
// 连接状态（net）：非 open 时顶部显示断线重连条；solo 无此概念，恒 open
const connection = computed(() => unwrap(gameApi.value?.connection, 'open'))

const selectedId = ref(null)
const mySide = ref('bottom') // 我出牌的放置端 bottom | top，默认下端

/** UI 视角座位名（solo：固定称呼；net：服务器成员昵称） */
const labelOf = (seat) => gameApi.value?.labelOf(seat) ?? String(seat)

/** 动作代理：solo 同步返回 {ok,...}，net 为 async 请求，统一 await 后处理 */
const roll = (...args) => gameApi.value?.roll(...args)
async function myPlay(tileId, side) {
  const res = await gameApi.value?.myPlay(tileId, side)
  if (res?.ok) {
    selectedId.value = null
    mySide.value = 'bottom' // 出完复位为默认下端
  } else {
    uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
  }
}
async function myDiscard(tileId) {
  const res = await gameApi.value?.myDiscard(tileId)
  if (res?.ok) selectedId.value = null
  else uni.showToast({ title: res?.reason || '扣牌失败', icon: 'none' })
}

const DICE_FACES = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' }
// 掷骰动画期间骰面快速随机跳动（初始/落定后显示 fx.dice，动画期间随机）
const randomFace = ref(1)
const diceFace = computed(() => (fx.value.dice ? DICE_FACES[fx.value.dice] : DICE_FACES[randomFace.value]))

// 落定后触发回弹动画；停顿展示点数，随后提示头牌归属，再自动进入出牌阶段
const diceLanded = ref(false)
const leaderRevealed = ref(false)
let diceFaceTimer = null
let revealTimer = null
const diceResultText = computed(() => {
  if (!fx.value.dice) return ''
  const OFFSET_NAMES = { 1: '自己', 5: '自己', 2: '下家', 6: '下家', 3: '对家', 4: '上家' }
  return `掷出 ${fx.value.dice} 点 · ${OFFSET_NAMES[fx.value.dice]}是头牌`
})
function clearTimers() {
  if (diceFaceTimer) { clearInterval(diceFaceTimer); diceFaceTimer = null }
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null }
}
/** 亮牌阶段（结算弹窗前）：点击屏幕任意位置 → 弹出结算（settleShow 由客户端本地点亮，两模式一致） */
function onRevealTap() {
  if (fx.value.revealKept && !fx.value.settleShow && view.value.result) {
    fx.value.settleShow = true // fx 是 reactive 对象（computed 仅包引用），原地赋值两模式均生效
  }
}
watch(
  () => fx.value.diceRolling,
  (rolling) => {
    if (rolling) {
      diceLanded.value = false
      leaderRevealed.value = false
      // 动画期间每 80ms 随机换一个骰面，模拟翻滚
      diceFaceTimer = setInterval(() => {
        randomFace.value = 1 + Math.floor(Math.random() * 6)
      }, 80)
    } else {
      if (diceFaceTimer) { clearInterval(diceFaceTimer); diceFaceTimer = null }
      if (!fx.value.dice) return // 非落定（如重置），不进入揭示流程
      // 落定：先复位 class 以便重复触发回弹动画
      diceLanded.value = false
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          diceLanded.value = true
        })
      })
      // 停顿 1s 看点数 → 揭示头牌 → 再停 1.2s 自动进阶段（与 useGame 的 1.6s 落定→进阶段节奏衔接）
      revealTimer = setTimeout(() => {
        leaderRevealed.value = true
      }, 1000)
    }
  }
)
onUnmounted(clearTimers)

const turnText = computed(() => {
  if (view.value.state !== 'PLAYING') return ''
  if (view.value.currentSeat === mySeatVal.value) {
    if (view.value.openEnds === null) return '你是头牌，请出第一张牌'
    return mustDiscard.value ? '无牌可接，请扣牌' : '轮到你出牌'
  }
  return `等待 ${labelOf(view.value.currentSeat)} 行动…`
})

function opponentBySeat(seat) {
  return view.value.opponents.find((o) => o.seat === seat) || { handCount: 0, keptCount: 0 }
}
/** 各家气泡显示"历史最后一条"行动（出牌/扣牌）：只标最新动作的归属者，别人出牌后即消失 */
function lastMoveOf(seat) {
  const history = view.value.tableHistory
  if (!history || history.length === 0) return null
  const last = history[history.length - 1]
  return last.seat === seat ? last : null
}

/** 所有扣牌条目（供各 OpponentZone 展示自己扣的牌背） */
const discardEntries = computed(() => view.value.tableHistory.filter((e) => e.discarded))

/** 选中的牌：两端都可接时返回 null（需用户选端），否则返回唯一可接端；首出/不可接也返回 null */
const selectedForcedSide = computed(() => {
  if (!selectedId.value || view.value.openEnds === null) return null
  // 链两端点数相同（如 3|3）：上下端无差异，直接放下端，不弹选择器
  if (view.value.openEnds.top === view.value.openEnds.bottom) return 'bottom'
  const t = view.value.myHand.find((x) => x.id === selectedId.value)
  if (!t) return null
  const options = placeSides(t, view.value.openEnds)
  if (options.length !== 1) return null // 0 个不可接；2 个由用户选
  return options[0].side
})

function onConfirmPlay() {
  if (!selectedId.value) return
  // 若选中的牌只有一端可接，忽略手动选择、按真实可接端出（避免默认 bottom 被静默拒绝）
  myPlay(selectedId.value, selectedForcedSide.value || mySide.value)
}

/** 两端都可接时：点悬浮的"上端/下端"按钮即选定端并直接出牌（省去再点出牌按钮） */
function onSidePick({ id, side }) {
  if (!id || selectedId.value !== id) return
  myPlay(id, side)
}
function onConfirmDiscard() {
  if (!selectedId.value) return
  myDiscard(selectedId.value)
}

// ---------- 飞牌动画 ----------
// 出牌/扣牌入桌太快看不清来路：监听 tableHistory 新条目，让一张牌的克隆从出牌方头像位置
// 飞向桌面中央（接上端从上入、下端从下入、扣牌从侧入），结束后由真实牌桌接管显示。
// 定位用 id + getElementById：uni-app H5 下 <script setup> 组件默认关闭实例，
// 父组件 ref 拿不到 $el（此前动画静默失效的根因），原生 DOM 查询最可靠。
const fly = reactive({ tile: null, fromX: 0, fromY: 0, toX: 0, toY: 0, moving: false })
let flyTimer = null

/** 屏幕坐标（px）：DOM 元素中心；查不到返回 null（不播动画，静默降级） */
function centerOfEl(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function elById(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null
}

/** 出牌方（座位）锚点元素：我=手牌区包裹层（头含头像），其余=各 OpponentZone 包裹层 */
function anchorElOf(seat) {
  if (seat === mySeatVal.value) return elById('hand-anchor')
  return elById({ 1: 'opp-right-anchor', 2: 'opp-top-anchor', 3: 'opp-left-anchor' }[seat])
}

/** 桌面中央（时间线容器）中心：飞牌终点 */
function tableCenter() {
  return centerOfEl(elById('timeline-anchor'))
}

/** 新入桌条目 → 飞牌参数；无法定位起终点时返回 null */
function flyFromEntry(entry) {
  const from = centerOfEl(anchorElOf(entry.seat))
  const to = tableCenter()
  if (!from || !to) return null
  const tile = entry.discarded || entry.tiles[entry.tiles.length - 1]
  if (!tile) return null
  return { tile, from, to }
}

/** 飞牌层样式：left/top 从起点过渡到终点（px 定位 + 过渡），transform 固定居中偏移 */
const flyStyle = computed(() => ({
  left: `${fly.fromX}px`,
  top: `${fly.fromY}px`,
  transform: 'translate(-50%, -50%) scale(1.15)',
  transition: fly.moving
    ? 'left 0.9s cubic-bezier(0.3, 0.7, 0.4, 1), top 0.9s cubic-bezier(0.3, 0.7, 0.4, 1)'
    : 'none',
}))

function playFly(entry) {
  const f = flyFromEntry(entry)
  if (!f) return
  clearTimeout(flyTimer)
  fly.tile = f.tile
  fly.fromX = f.from.x
  fly.fromY = f.from.y
  fly.moving = false
  // 双 rAF 确保起点样式已渲染，再切到过渡态飞向终点
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fly.fromX = f.to.x
      fly.fromY = f.to.y
      fly.moving = true
    })
  })
  // 动画完成后隐藏克隆（真实牌桌 TableTimeline 已显示新牌），0.95s > 0.9s 过渡避免闪断
  flyTimer = setTimeout(() => { fly.tile = null; fly.moving = false }, 950)
}
onUnmounted(() => clearTimeout(flyTimer))

/** 监听桌面历史：出现新条目（出牌/扣牌）即起飞克隆牌。solo 与 net 共用（数据源都是 tableHistory） */
watch(
  () => view.value.tableHistory.length,
  (n, old) => {
    if (!n || (old !== undefined && n <= old)) return
    const entry = view.value.tableHistory[n - 1]
    if (entry && view.value.state !== 'SETTLE') playFly(entry)
  }
)

async function restart() {
  if (isNet.value) {
    // 联网局：服务器驱动下一局（settleContinue → 全员确认/超时后 beginRound 推送），
    // 本地不写 storage、不重定向，仅收起结算弹窗等待服务器推送新局。
    await gameApi.value?.restart()
    fx.value.settleShow = false
    return
  }
  // 把上一局赢家写入 storage，useGame 初始化时读取作为下一局掷骰者（连续局规则）。
  const winner = view.value.result?.winner
  if (winner !== undefined && winner !== null) {
    uni.setStorageSync('dingniuzi_last_winner', winner)
  }
  fx.value.settleShow = false
  fx.value.dice = null
  fx.value.lastMove = null
  uni.redirectTo({ url: '/pages/game/game' })
}
async function goHome() {
  if (isNet.value) {
    // 联网局必须通知服务器退房：对局中 leave 视为断线（60s 宽限 + AI 托管），
    // 否则连接仍存活、座位永不进入托管，轮到该座位时全场卡死。
    try { await gameApi.value?.leave() } catch { /* 已断线等场景：服务器宽限兜底 */ }
  }
  // 不用 navigateBack：restart 走 redirectTo 重开本页，H5 下历史栈里会残留上一局游戏页，
  // navigateBack 会退回栈里前一个 game 实例（看起来像"又跳回游戏"）。reLaunch 清空页面栈直达主菜单。
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped>
.table {
  min-height: 100vh;
  /* 手机浏览器的 100vh 是"大视口"高度（按地址栏收起后计算），地址栏展开时内容比可视区高，
     底部"我的手牌区"会被浏览器工具栏遮住；dvh 动态视口高度随工具栏收展自适应，
     老浏览器不支持时自动回退到上面的 100vh */
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 20rpx;
  /* index.html 声明了 viewport-fit=cover，iPhone 底部 Home 指示条区域会压住内容，补足安全区高度 */
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.middle-row { flex: 1; display: flex; min-height: 0; padding-bottom: 8rpx; }
/* 联网断线提示条：覆盖在页面顶部 */
.net-bar {
  position: fixed; top: 0; left: 0; right: 0;
  background: #a04030; color: #fff; font-size: 24rpx;
  text-align: center; padding: 8rpx 0; z-index: 999;
}
/* 局末亮牌阶段：各区扣牌翻开后行数变多、整体变高，取消 flex 压缩让内容自然撑高，
   防止窄视口下对手区亮出的牌面底部被裁（页面可自然向下延展） */
.table.revealing > * { flex-shrink: 0; }
.table.revealing .middle-row { flex: 1 0 auto; min-height: 340rpx; }
.dice { font-size: 96rpx; line-height: 1; margin-bottom: 24rpx; color: #c9a227; }
/* 掷骰中：快速翻转跳动 */
.dice.rolling { animation: tumble 0.35s infinite; }
@keyframes tumble {
  0%   { transform: rotate(0) translate(0, 0) scale(1); }
  25%  { transform: rotate(-40deg) translate(-18rpx, -16rpx) scale(1.12); }
  50%  { transform: rotate(25deg) translate(14rpx, -30rpx) scale(0.9); }
  75%  { transform: rotate(55deg) translate(20rpx, 10rpx) scale(1.1); }
  100% { transform: rotate(0) translate(0, 0) scale(1); }
}
/* 落定：从高处落下 + 回弹 */
.dice.landed { animation: drop-bounce 0.5s ease-out; }
@keyframes drop-bounce {
  0%   { transform: translateY(-64rpx) scale(1.25); opacity: 0.4; }
  55%  { transform: translateY(0) scale(0.92); opacity: 1; }
  75%  { transform: translateY(-14rpx) scale(1.06); }
  100% { transform: translateY(0) scale(1); }
}
/* 头牌揭示文案 */
.dice-result {
  color: #c9a227;
  font-size: 32rpx;
  font-weight: bold;
  margin-bottom: 24rpx;
  animation: fade-in 0.4s ease-out;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(12rpx); }
  to   { opacity: 1; transform: translateY(0); }
}
.table-empty, .turn-hint, .settle-brief { color: #b0a685; font-size: 26rpx; margin: 20rpx 0; }

.settle-overlay {
  position: fixed; inset: 0;
  /* 半透明遮罩：结算时仍能透出后面各家亮出的扣牌 */
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
}
/* 亮牌阶段等待点击的提示：位于中央"本局结束"与我的头像之间（左右离边缘等距=水平居中），呼吸闪烁吸引注意 */
.tap-hint {
  position: fixed; left: 0; right: 0; bottom: 30%;
  text-align: center;
  color: #c9a227; font-size: 28rpx; font-weight: bold;
  animation: tap-pulse 1.2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes tap-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.settle-card {
  background: rgba(74, 52, 24, 0.88);
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  width: 620rpx;
  display: flex; flex-direction: column; gap: 20rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.5);
}
.settle-title { font-size: 40rpx; font-weight: bold; text-align: center; color: #c9a227; }
.settle-row {
  display: flex; justify-content: space-between; align-items: center;
  background: rgba(0,0,0,0.25); border-radius: 12rpx; padding: 20rpx 24rpx; font-size: 28rpx;
}
.settle-row.winner { border: 2rpx solid #c9a227; }
.settle-player { display: flex; align-items: center; gap: 12rpx; }
.settle-row .score { font-weight: bold; }
.settle-actions { display: flex; flex-direction: column; gap: 16rpx; margin-top: 12rpx; }

/* 飞牌动画层：fixed 克隆牌，从出牌方头像飞向桌面中心；pointer-events 穿透不挡操作 */
.fly-layer {
  position: fixed;
  z-index: 90;
  pointer-events: none;
  filter: drop-shadow(0 8rpx 16rpx rgba(0, 0, 0, 0.5));
}
.timeline-wrap { display: flex; justify-content: center; width: 100%; }
/* 定位锚点包裹层：不改变内部布局（display: contents），仅提供 getElementById 锚点 */
#opp-top-anchor, #opp-left-anchor, #opp-right-anchor, #hand-anchor { display: contents; }
</style>
