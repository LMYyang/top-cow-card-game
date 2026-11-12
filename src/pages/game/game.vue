<!-- src/pages/game/game.vue -->
<template>
  <view class="table" :class="{ revealing: fx.revealKept }" @click="onRevealTap">
    <!-- 对家（上） -->
    <OpponentZone position="top" :seat="2" :label="labelOf(2)" :hand-count="opponentBySeat(2).handCount" :kept-count="opponentBySeat(2).keptCount" :is-leader="view.leaderSeat === 2" :last-move="lastMoveOf(2)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />

    <view class="middle-row">
      <!-- 上家（左） -->
      <OpponentZone position="left" :seat="3" :label="labelOf(3)" :hand-count="opponentBySeat(3).handCount" :kept-count="opponentBySeat(3).keptCount" :is-leader="view.leaderSeat === 3" :last-move="lastMoveOf(3)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />

      <!-- 中央 -->
      <CenterArea>
        <template v-if="view.state === 'ROLLING'">
          <view class="dice" :class="{ rolling: fx.diceRolling, landed: diceLanded }">{{ diceFace }}</view>
          <!-- 落定后先看点数，稍后揭示头牌，再自动进入出牌阶段 -->
          <view v-if="leaderRevealed" class="dice-result">{{ diceResultText }}</view>
          <!-- 掷骰权在我时才显示按钮；机器人掷骰时到点自动掷，仅显示状态文案 -->
          <button v-else-if="diceRollerSeat === 0" class="btn-primary" :disabled="fx.diceRolling" @click="roll()">{{ fx.diceRolling ? '掷骰中…' : '掷骰定头牌' }}</button>
          <view v-else class="turn-hint">{{ labelOf(diceRollerSeat) }}掷骰中…</view>
        </template>
        <template v-else-if="view.state === 'PLAYING'">
          <TableTimeline :history="view.tableHistory" :open-ends="view.openEnds" />
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
      <OpponentZone position="right" :seat="1" :label="labelOf(1)" :hand-count="opponentBySeat(1).handCount" :kept-count="opponentBySeat(1).keptCount" :is-leader="view.leaderSeat === 1" :last-move="lastMoveOf(1)" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
    </view>

    <!-- 我的手牌 -->
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
      @confirm-play="onConfirmPlay"
      @confirm-discard="onConfirmDiscard"
    >
      <!-- 亮牌阶段提示：位于"本局结束"与我的头像之间，等待玩家点击任意处继续 -->
      <view v-if="fx.revealKept && !fx.settleShow" class="tap-hint">点击屏幕任意处继续</view>
    </HandArea>

    <!-- 结算覆盖层 -->
    <view v-if="fx.settleShow && view.result" class="settle-overlay">
      <view class="settle-card">
        <text class="settle-title">本局结算</text>
        <view v-for="r in view.result.ranks" :key="r.seat" class="settle-row" :class="{ winner: r.seat === view.result.winner }">
          <view class="settle-player">
            <PlayerAvatar :seat="r.seat" size="sm" />
            <text>{{ labelOf(r.seat) }}</text>
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
import { ref, computed, watch, onUnmounted } from 'vue'
import OpponentZone from '../../components/OpponentZone.vue'
import CenterArea from '../../components/CenterArea.vue'
import HandArea from '../../components/HandArea.vue'
import TableTimeline from '../../components/TableTimeline.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'
import { placeSides } from '../../core/rules.js'
import { useGame } from '../../composables/useGame.js'

const {
  view, fx, myTurn, mustDiscard, playableIds, labelOf, diceRollerSeat,
  roll, myPlay, myDiscard,
} = useGame()

const selectedId = ref(null)
const mySide = ref('bottom') // 我出牌的放置端 bottom | top，默认下端

const DICE_FACES = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' }
// 掷骰动画期间骰面快速随机跳动（初始/落定后显示 fx.dice，动画期间随机）
const randomFace = ref(1)
const diceFace = computed(() => (fx.dice ? DICE_FACES[fx.dice] : DICE_FACES[randomFace.value]))

// 落定后触发回弹动画；停顿展示点数，随后提示头牌归属，再自动进入出牌阶段
const diceLanded = ref(false)
const leaderRevealed = ref(false)
let diceFaceTimer = null
let revealTimer = null
const diceResultText = computed(() => {
  if (!fx.dice) return ''
  const OFFSET_NAMES = { 1: '自己', 5: '自己', 2: '下家', 6: '下家', 3: '对家', 4: '上家' }
  return `掷出 ${fx.dice} 点 · ${OFFSET_NAMES[fx.dice]}是头牌`
})
function clearTimers() {
  if (diceFaceTimer) { clearInterval(diceFaceTimer); diceFaceTimer = null }
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null }
}
/** 亮牌阶段（结算弹窗前）：点击屏幕任意位置 → 弹出结算 */
function onRevealTap() {
  if (fx.revealKept && !fx.settleShow && view.result) {
    fx.settleShow = true
  }
}
watch(
  () => fx.diceRolling,
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
      if (!fx.dice) return // 非落定（如重置），不进入揭示流程
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
  if (view.state !== 'PLAYING') return ''
  if (view.currentSeat === 0) {
    if (view.openEnds === null) return '你是头牌，请出第一张牌'
    return mustDiscard.value ? '无牌可接，请扣牌' : '轮到你出牌'
  }
  return `等待 ${labelOf(view.currentSeat)} 行动…`
})

function opponentBySeat(seat) {
  return view.opponents.find((o) => o.seat === seat) || { handCount: 0, keptCount: 0 }
}
function lastMoveOf(seat) {
  const history = view.tableHistory
  if (!history || history.length === 0) return null
  const last = history[history.length - 1]
  return last.seat === seat ? last : null
}

/** 所有扣牌条目（供各 OpponentZone 展示自己扣的牌背） */
const discardEntries = computed(() => view.tableHistory.filter((e) => e.discarded))

/** 选中的牌：两端都可接时返回 null（需用户选端），否则返回唯一可接端；首出/不可接也返回 null */
const selectedForcedSide = computed(() => {
  if (!selectedId.value || view.openEnds === null) return null
  // 链两端点数相同（如 3|3）：上下端无差异，直接放下端，不弹选择器
  if (view.openEnds.top === view.openEnds.bottom) return 'bottom'
  const t = view.myHand.find((x) => x.id === selectedId.value)
  if (!t) return null
  const options = placeSides(t, view.openEnds)
  if (options.length !== 1) return null // 0 个不可接；2 个由用户选
  return options[0].side
})

function onConfirmPlay() {
  if (!selectedId.value) return
  // 若选中的牌只有一端可接，忽略手动选择、按真实可接端出（避免默认 bottom 被静默拒绝）
  const side = selectedForcedSide.value || mySide.value
  const res = myPlay(selectedId.value, side)
  if (res.ok) {
    selectedId.value = null
    mySide.value = 'bottom' // 出完复位为默认下端
  } else {
    uni.showToast({ title: res.reason || '出牌失败', icon: 'none' })
  }
}
function onConfirmDiscard() {
  if (!selectedId.value) return
  const res = myDiscard(selectedId.value)
  if (res.ok) {
    selectedId.value = null
  } else {
    uni.showToast({ title: res.reason || '扣牌失败', icon: 'none' })
  }
}

function restart() {
  // 把上一局赢家写入 storage，useGame 初始化时读取作为下一局掷骰者（连续局规则）。
  const winner = view.result?.winner
  if (winner !== undefined && winner !== null) {
    uni.setStorageSync('dingniuzi_last_winner', winner)
  }
  fx.settleShow = false
  fx.dice = null
  fx.lastMove = null
  uni.redirectTo({ url: '/pages/game/game' })
}
function goHome() {
  // 不用 navigateBack：restart 走 redirectTo 重开本页，H5 下历史栈里会残留上一局游戏页，
  // navigateBack 会退回栈里前一个 game 实例（看起来像"又跳回游戏"）。reLaunch 清空页面栈直达主菜单。
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped>
.table {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 20rpx;
  box-sizing: border-box;
}
.middle-row { flex: 1; display: flex; min-height: 0; padding-bottom: 8rpx; }
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
  background: rgba(0, 0, 0, 0.72);
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
  background: #4a3418;
  border-radius: 24rpx;
  padding: 48rpx 40rpx;
  width: 620rpx;
  display: flex; flex-direction: column; gap: 20rpx;
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
</style>
