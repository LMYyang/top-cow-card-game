<!-- src/pages/game/game.vue -->
<template>
  <view class="table">
    <!-- 对家（上） -->
    <OpponentZone position="top" :seat="2" :label="labelOf(2)" :hand-count="opponentBySeat(2).handCount" :kept-count="opponentBySeat(2).keptCount" :is-leader="view.leaderSeat === 2" :last-move="lastMoveOf(2)" :discard-history="discardEntries" />

    <view class="middle-row">
      <!-- 上家（左） -->
      <OpponentZone position="left" :seat="3" :label="labelOf(3)" :hand-count="opponentBySeat(3).handCount" :kept-count="opponentBySeat(3).keptCount" :is-leader="view.leaderSeat === 3" :last-move="lastMoveOf(3)" :discard-history="discardEntries" />

      <!-- 中央 -->
      <CenterArea>
        <template v-if="view.state === 'ROLLING'">
          <view class="dice" :class="{ rolling: fx.diceRolling }">{{ diceFace }}</view>
          <button class="btn-primary" :disabled="fx.diceRolling" @click="roll()">掷骰定头牌</button>
        </template>
        <template v-else-if="view.state === 'PLAYING'">
          <TableTimeline :history="view.tableHistory" />
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
      <OpponentZone position="right" :seat="1" :label="labelOf(1)" :hand-count="opponentBySeat(1).handCount" :kept-count="opponentBySeat(1).keptCount" :is-leader="view.leaderSeat === 1" :last-move="lastMoveOf(1)" :discard-history="discardEntries" />
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
      @select="selectedId = $event"
      @choose-side="mySide = $event"
      @confirm-play="onConfirmPlay"
      @confirm-discard="onConfirmDiscard"
    />

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
import { ref, computed } from 'vue'
import OpponentZone from '../../components/OpponentZone.vue'
import CenterArea from '../../components/CenterArea.vue'
import HandArea from '../../components/HandArea.vue'
import TableTimeline from '../../components/TableTimeline.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'
import { placeSides } from '../../core/rules.js'
import { useGame } from '../../composables/useGame.js'

const {
  view, fx, myTurn, mustDiscard, playableIds, labelOf,
  roll, myPlay, myDiscard,
} = useGame()

const selectedId = ref(null)
const mySide = ref('bottom') // 我出牌的放置端 bottom | top，默认下端

const DICE_FACES = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' }
const diceFace = computed(() => (fx.dice ? DICE_FACES[fx.dice] : '⚀'))

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
  uni.navigateBack()
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
.middle-row { flex: 1; display: flex; min-height: 0; }
.dice { font-size: 96rpx; line-height: 1; margin-bottom: 24rpx; }
.dice.rolling { animation: shake 0.3s infinite; }
@keyframes shake {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-15deg) translateY(-8rpx); }
  75% { transform: rotate(15deg) translateY(8rpx); }
}
.table-empty, .turn-hint, .settle-brief { color: #b0a685; font-size: 26rpx; margin: 8rpx 0; }

.settle-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
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
