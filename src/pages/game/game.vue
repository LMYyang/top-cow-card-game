<template>
  <view class="table" :class="{ revealing: fx.revealKept, shake: tableShake }" @click="onRevealTap">
    <!-- 联网模式连接状态条：断线/重连中置顶提示 -->
    <view v-if="isNet && connection !== 'open'" class="net-bar">连接断开，重连中…</view>
    <!-- 返回主菜单：右上角小按钮（不遮牌面）；对局中先确认再走 goHome（联网局通知服务器退房） -->
    <button class="btn-home" @click.stop="play('click'); confirmGoHome()">‹ 主菜单</button>
    <button class="btn-home btn-mute" @click.stop="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
    <!-- 联网模式房间号：左上角小徽标（不遮牌面） -->
    <view v-if="isNet && roomNum" class="room-badge">房间 {{ roomNum }}</view>
    <!-- 对家（上）：座位按我的座位旋转，头像颜色对应同一人 -->
    <view id="opp-top-anchor">
      <OpponentZone position="top" :seat="seatAt(2)" :label="labelOf(seatAt(2))" :hand-count="opponentBySeat(seatAt(2)).handCount" :kept-count="opponentBySeat(seatAt(2)).keptCount" :is-leader="view.leaderSeat === seatAt(2)" :last-move="lastMoveOf(seatAt(2))" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
    </view>

    <view class="middle-row">
      <!-- 上家（左） -->
      <view id="opp-left-anchor">
        <OpponentZone position="left" :seat="seatAt(3)" :label="labelOf(seatAt(3))" :hand-count="opponentBySeat(seatAt(3)).handCount" :kept-count="opponentBySeat(seatAt(3)).keptCount" :is-leader="view.leaderSeat === seatAt(3)" :last-move="lastMoveOf(seatAt(3))" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
      </view>

      <!-- 中央 -->
      <CenterArea>
        <template v-if="view.state === 'ROLLING'">
          <view class="dice" :class="{ rolling: fx.diceRolling, landed: diceLanded }">{{ diceFace }}</view>
          <!-- 落定后先看点数，稍后揭示头牌，再自动进入出牌阶段 -->
          <view v-if="leaderRevealed" class="dice-result">{{ diceResultText }}</view>
          <!-- 掷骰权在我时才显示按钮；落定（fx.dice 有值）后隐藏，避免间隙按钮复活被重复点击 -->
          <button v-else-if="diceRollerSeat === mySeatVal && !fx.dice" class="btn-primary" :disabled="fx.diceRolling" @click="play('click'); roll()">{{ fx.diceRolling ? '掷骰中…' : '掷骰定头牌' }}</button>
          <view v-else class="turn-hint">{{ labelOf(diceRollerSeat) }}掷骰中…</view>
        </template>
        <template v-else-if="view.state === 'PLAYING'">
          <view id="timeline-anchor" class="timeline-wrap">
            <TableTimeline :history="view.tableHistory" :open-ends="view.openEnds" :latest-hidden="latestHidden" />
          </view>
          <view class="turn-hint">
            {{ turnText }}
          </view>
          <!-- 申请重新发牌：发牌后、首出前且我满足牌型时显示（solo/net 双模式） -->
          <button v-if="canRedealNow" class="btn-primary btn-redeal" :disabled="redealBusy" @click="play('click'); onRedeal()">申请重新发牌</button>
        </template>
        <template v-else-if="view.state === 'SETTLE'">
          <!-- latest-hidden 必须传：否则状态翻 SETTLE 时 TableTimeline 重新挂载，终牌飞行途中直接显示在桌上穿帮 -->
          <TableTimeline :history="view.tableHistory" :latest-hidden="latestHidden" />
          <view v-if="settleBrief" class="settle-brief">本局结束</view>
        </template>
      </CenterArea>

      <!-- 下家（右） -->
      <view id="opp-right-anchor">
        <OpponentZone position="right" :seat="seatAt(1)" :label="labelOf(seatAt(1))" :hand-count="opponentBySeat(seatAt(1)).handCount" :kept-count="opponentBySeat(seatAt(1)).keptCount" :is-leader="view.leaderSeat === seatAt(1)" :last-move="lastMoveOf(seatAt(1))" :discard-history="discardEntries" :reveal-kept="fx.revealKept" />
      </view>
    </view>

    <!-- 我的手牌 -->
    <view id="hand-anchor">
      <HandArea
        :hand="view.myHand"
        :kept="view.myKept"
        :seat="mySeatVal"
        :playable-ids="playableIds"
        :my-turn="myTurn"
        :must-discard="mustDiscard"
        :selected-id="selectedId"
        :side="mySide"
        :open-ends="view.openEnds"
        :reveal-kept="fx.revealKept"
        :is-leader="view.leaderSeat === mySeatVal"
        :declarations="myDeclarations"
        @select="selectedId = $event"
        @ui-click="play('click')"
        @choose-side="mySide = $event"
        @side-pick="onSidePick"
        @declare="onDeclare"
        @no-declare="onNoDeclare"
        @confirm-play="onConfirmPlay"
        @confirm-discard="onConfirmDiscard"
      >
        <!-- 亮牌阶段提示：终局最后一飞未落地时先不提示 -->
        <view v-if="fx.revealKept && !fx.settleShow && flyLanded" class="tap-hint">点击屏幕任意处继续</view>
      </HandArea>
    </view>

    <!-- 飞牌动画层：牌从出牌方飞向桌面链端（fixed 覆盖层）。竖牌按放置的 mirrored 渲染，横牌不镜像 -->
    <view v-if="fly.tile" class="fly-layer" :style="flyStyle">
      <PlayingTile :tile="fly.tile" size="sm" :horizontal="fly.tile.type === '横牌'" :mirrored="fly.mirrored" />
    </view>

    <!-- 算账宣告特效：大字由大到小飞入拍桌，落定震动+闪光后消散；不挡操作 -->
    <view v-if="accountSplashShow" class="account-splash-layer">
      <view class="account-splash" :class="{ slammed: accountSlammed }">
        <text class="splash-text">算账</text>
        <text class="splash-sub">{{ accountSplashSub }}</text>
      </view>
      <view v-if="accountSlammed" class="splash-flash" />
    </view>

    <!-- 结算覆盖层 -->
    <view v-if="fx.settleShow && view.result" class="settle-overlay">
      <!-- 我赢时的庆祝特效：彩带纸屑 + 卷曲丝带，不挡按钮点击 -->
      <view v-if="iAmWinner" class="confetti-layer">
        <view v-for="n in 18" :key="n" class="confetti" :class="'c' + (n % 4)" :style="confettiStyle(n)" />
        <view v-for="n in 8" :key="'r' + n" class="ribbon" :class="'r' + (n % 3)" :style="ribbonStyle(n)">
          <view class="ribbon-band" />
        </view>
      </view>
      <view class="settle-card" :class="{ 'winner-card': iAmWinner }">
        <text class="settle-title" :class="{ 'winner-title': iAmWinner }">{{ iAmWinner ? '🏆 恭喜获胜' : '本局结算' }}</text>
        <view v-for="r in settleRanks" :key="r.seat" class="settle-row" :class="{ winner: r.seat === view.result.winner }">
          <PlayerAvatar :seat="r.seat" size="sm" />
          <!-- 与历史记录弹框同格式：昵称/庄位两行 + 扣点 + 得分 -->
          <view class="settle-who">
            <text class="settle-name">{{ labelOf(r.seat) }}{{ r.seat === view.result.winner ? ' 🏆' : '' }}</text>
            <text class="settle-role">{{ r.role }}</text>
          </view>
          <view class="settle-points">
            <text>扣 {{ r.points }} 点</text>
            <text v-if="accountTag(r.seat)" class="account-tag" :class="{ fail: !view.result.account.success }">{{ accountTag(r.seat) }}</text>
          </view>
          <text class="score" :class="{ negative: view.result.scores[r.seat] < 0 }">
            {{ view.result.scores[r.seat] > 0 ? '+' : '' }}{{ view.result.scores[r.seat] }} 积分
          </text>
        </view>
        <view class="settle-actions">
          <button class="btn-primary" @click="play('click'); restart()">再来一局</button>
          <button class="btn-secondary" @click="play('click'); goHome()">回主菜单</button>
        </view>
      </view>
    </view>

    <!-- 返回确认弹窗：自绘深木色卡片 -->
    <view v-if="homeConfirmShow" class="settle-overlay" @click="homeConfirmShow = false">
      <view class="settle-card home-confirm-card" @click.stop>
        <text class="settle-title">返回主菜单</text>
        <text class="home-confirm-text">{{ homeConfirmText }}</text>
        <view class="settle-actions">
          <button class="btn-primary" @click="play('click'); goHome()">退出</button>
          <button class="btn-secondary" @click="play('click'); homeConfirmShow = false">继续玩</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed, watch, onUnmounted, isRef } from 'vue'
import { onLoad, onShow, onReady } from '@dcloudio/uni-app'
import OpponentZone from '../../components/OpponentZone.vue'
import CenterArea from '../../components/CenterArea.vue'
import HandArea from '../../components/HandArea.vue'
import TableTimeline from '../../components/TableTimeline.vue'
import PlayingTile from '../../components/PlayingTile.vue'
import PlayerAvatar from '../../components/PlayerAvatar.vue'
import { placeSides, diceToSeatOffset, declarationFor } from '../../core/rules.js'
import { useGame } from '../../composables/useGame.js'
import { useNetGame } from '../../composables/useNetGame.js'
import { useSound } from '../../composables/useSound.js'
import { sharedNet } from '../../utils/net.js'

/**
 * 双模式接入：solo（单机 AI）与 net（联网对战）。
 * 模式由 onLoad 的 query.mode 决定，此时才实例化对应 composable（useNetGame 订阅推送）。
 * 全部绑定走 computed 代理 + 空对象兜底（gameApi 就绪前模板已在渲染）；
 * solo 的 view/fx 为 reactive 对象、net 的 myTurn 等为 computed，isRef 区分后统一解包。
 */
const { play, muted, toggleMute, startBgm, stopBgm, playCardVoice, playWithholdVoice } = useSound()
// BGM 首播放 onReady：redirectTo 重建本页时旧页卸载晚于新页 setup，
// setup 起播会被旧页 stopBgm 停掉且恢复播放被浏览器自动播放策略拒绝 → 整局无声
onUnmounted(() => stopBgm())
watch(muted, (m) => { if (m === false) startBgm() })
onReady(() => { if (muted.value === false) startBgm() })
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
}const unwrap = (v, fallback) => (isRef(v) ? v.value : v) ?? fallback
const view = computed(() => unwrap(gameApi.value?.view, emptyView()))
const fx = computed(() => unwrap(gameApi.value?.fx, emptyFx()))
const myTurn = computed(() => unwrap(gameApi.value?.myTurn, false))
const mustDiscard = computed(() => unwrap(gameApi.value?.mustDiscard, false))
const playableIds = computed(() => unwrap(gameApi.value?.playableIds, []))
// 掷骰权座位：以响应式 view.rollerSeat 为准（solo 的 diceRollerSeat 导出是 init 时常量，
// 重发后不反映变化）；为空时回退 composable 导出
const diceRollerSeat = computed(() => view.value.rollerSeat ?? unwrap(gameApi.value?.diceRollerSeat, 0))
const canRedealNow = computed(() => unwrap(gameApi.value?.canRedealNow, false))
const mySeatVal = computed(() => unwrap(gameApi.value?.mySeat, 0))
const connection = computed(() => unwrap(gameApi.value?.connection, 'open'))
const roomNum = computed(() => unwrap(gameApi.value?.roomId, null))

// 结算后回房间：服务器把 SETTLE 房重置回 WAITING 并广播 room.state。
// 订阅须在 setup 里无条件注册（onLoad 晚于 setup 主体，isNet 判断移入回调内，非 net 模式忽略推送）
let offRoomState = null
{
  const n = sharedNet()
  offRoomState = n.on('room.state', ({ room }) => {
    if (!isNet.value) return
    if (!room || room.state !== 'WAITING') return
    if (roomNum.value && room.roomId !== roomNum.value) return // 非本房间广播
    fx.value.settleShow = false
    // 跳转前先摘掉本订阅：否则与 room.vue 的 game.state 处理器竞态——
    // 卸载 game 页途中在途 SETTLE 态快照触发 room.vue 跳牌桌，两次 redirectTo 相互取消
    offRoomState?.()
    uni.redirectTo({ url: `/pages/room/room?roomId=${room.roomId}` })
  })
  onUnmounted(() => offRoomState?.())
}

const selectedId = ref(null)
const mySide = ref('bottom') // 我出牌的放置端 bottom | top，默认下端

/** UI 视角座位名（solo：固定称呼；net：服务器成员昵称） */
const labelOf = (seat) => gameApi.value?.labelOf(seat) ?? String(seat)

/**
 * 视角旋转：把"相对方位偏移"换算成绝对座位。
 * 布局约定 bottom=我(偏移0)、right=下家(1)、top=对家(2)、left=上家(3)，
 * mySeat=0（solo 恒 0）时恒等映射，不影响单机；net 下每人看到自己在下方，
 * 座位相对方位不变、整个视图按本人旋转。
 */
const seatAt = (offset) => (mySeatVal.value + offset) % 4

/** 动作代理：solo 同步返回 {ok,...}，net 为 async 请求，统一 await 后处理 */
const roll = (...args) => gameApi.value?.roll(...args)
async function myPlay(tileId, side) {
  const res = await gameApi.value?.myPlay(tileId, side)
  if (res?.ok) {
    selectedId.value = null
    mySide.value = 'bottom' // 出完复位为默认下端
  } else {
    uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
    if (isNet.value) netRoomGoneRedirect(res?.code) // 房间已被服务器销毁：跳回大厅
  }
}
async function myDiscard(tileId) {
  const res = await gameApi.value?.myDiscard(tileId)
  // 不在此播音：tableHistory watcher 对扣牌条目统一播 withhold 语音，这里再播会双音
  if (res?.ok) { selectedId.value = null }
  else {
    uni.showToast({ title: res?.reason || '扣牌失败', icon: 'none' })
    if (isNet.value) netRoomGoneRedirect(res?.code) // 房间已被服务器销毁：跳回大厅
  }
}
/** 申请重新发牌（双模式代理）：solo 同步 / net async，await 兼容两者 */
const redealBusy = ref(false)
async function onRedeal() {
  if (redealBusy.value) return
  redealBusy.value = true
  try {
    const res = await gameApi.value?.redeal()
    if (res && !res.ok) {
      uni.showToast({ title: res.reason || '申请失败', icon: 'none' })
      if (isNet.value) netRoomGoneRedirect(res.code)
    }
  } finally {
    redealBusy.value = false
  }
}

/** 房间被服务器销毁后的跳转（net 专用）：useNetGame 已 toast 原因，这里只跳大厅 */
function netRoomGoneRedirect(code) {
  if (code !== 'ROOM_GONE') return
  uni.removeStorageSync('dingniuzi_player_token')
  setTimeout(() => uni.reLaunch({ url: '/pages/lobby/lobby' }), 1500)
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
// 骰子界面复位（连续局/重发共用）：清残留的 leaderRevealed/settleBrief/revealKept/fx.dice，
// 否则下一局 ROLLING 时模板 v-if 文案顶掉掷骰按钮，掷骰者点不到按钮全场卡死
function resetDiceUi() {
  clearTimers()
  diceLanded.value = false
  leaderRevealed.value = false
  randomFace.value = 1 + Math.floor(Math.random() * 6)
  settleBrief.value = false
  fx.value.revealKept = false
  fx.value.settleShow = false
  fx.value.lastMove = null
  fx.value.dice = null
  latestHidden.value = false
}
// 连续局复位：beginRound 每局都重设 rollerSeat，以它为锚调 resetDiceUi
watch(
  () => view.value.rollerSeat,
  () => resetDiceUi()
)
// 重发复位：redeal 使状态 PLAYING→ROLLING，若掷骰权恰好回到原掷骰者，上面的 watch 不触发
watch(
  () => view.value.state,
  (state, old) => {
    if (state === 'ROLLING' && old === 'PLAYING') resetDiceUi()
  }
)
const diceResultText = computed(() => {
  if (!fx.value.dice) return ''
  // 头牌 = 掷骰者 + 骰点偏移，换算成相对「我」的方位称呼
  const rel = (diceRollerSeat.value + diceToSeatOffset(fx.value.dice) - mySeatVal.value + 4) % 4
  const REL_NAMES = ['自己', '下家', '对家', '上家']
  return `掷出 ${fx.value.dice} 点 · ${REL_NAMES[rel]}是头牌`
})
function clearTimers() {
  if (diceFaceTimer) { clearInterval(diceFaceTimer); diceFaceTimer = null }
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null }
}
/** 亮牌阶段：点击屏幕任意位置 → 弹出结算。终局最后一飞未落地时拦下 */
function onRevealTap() {
  if (fx.value.revealKept && !fx.value.settleShow && view.value.result && flyLanded.value) {
    fx.value.settleShow = true
  }
}
watch(
  () => fx.value.diceRolling,
  (rolling) => {
    if (rolling) {
      diceLanded.value = false
      leaderRevealed.value = false
      play('shuffle') // 摇骰即洗牌音
      // 动画期间每 80ms 随机换骰面，模拟翻滚
      diceFaceTimer = setInterval(() => {
        randomFace.value = 1 + Math.floor(Math.random() * 6)
      }, 80)
    } else {
      if (diceFaceTimer) { clearInterval(diceFaceTimer); diceFaceTimer = null }
      if (!fx.value.dice) return // 非落定（如重置），不进入揭示流程
      play('click')
      // 先复位 class 以便重复触发回弹动画
      diceLanded.value = false
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          diceLanded.value = true
        })
      })
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

/** 结算名单按视角旋转排序：我在最上，其余按下家→对家→上家 */
const settleRanks = computed(() => {
  const ranks = view.value.result?.ranks
  if (!ranks) return []
  return [...ranks].sort(
    (a, b) => ((a.seat - mySeatVal.value + 4) % 4) - ((b.seat - mySeatVal.value + 4) % 4)
  )
})

/** 本局我赢了：结算弹窗切换为获胜庆祝样式 */
const iAmWinner = computed(() =>
  view.value.result && view.value.result.winner === mySeatVal.value
)

/** 结算卡账目标签：非宣告者行返回 '' */
function accountTag(seat) {
  const a = view.value.result?.account
  if (!a || a.seat !== seat) return ''
  return `${a.type}${a.success ? ' ✓×2' : ' ✗包庄'}`
}

/** 彩带粒子样式：按序号确定性散布，每次弹出结算重放 */
function confettiStyle(n) {
  const left = (n * 5.5) % 100
  const delay = (n % 6) * 0.25
  const duration = 2.6 + (n % 5) * 0.4
  const rotate = (n * 47) % 360
  return { left: `${left}%`, animationDelay: `${delay}s`, animationDuration: `${duration}s`, '--rot': `${rotate}deg` }
}

/** 卷曲丝带样式：--dur/--delay 同时供外层下落与内层翻卷两个动画使用 */
function ribbonStyle(n) {
  const left = (n * 12.5 + 6) % 100
  const delay = (n % 4) * 0.5
  const duration = 3.4 + (n % 4) * 0.5
  const sway = 40 + (n % 3) * 30
  return { left: `${left}%`, '--delay': `${delay}s`, '--dur': `${duration}s`, '--sway': `${sway}px` }
}

function opponentBySeat(seat) {
  return view.value.opponents.find((o) => o.seat === seat) || { handCount: 0, keptCount: 0 }
}
/** 各家气泡显示历史最后一条行动（只标最新动作的归属者） */
function lastMoveOf(seat) {
  const history = view.value.tableHistory
  if (!history || history.length === 0) return null
  const last = history[history.length - 1]
  return last.seat === seat ? last : null
}

/** 所有扣牌条目（供各 OpponentZone 展示自己扣的牌背） */
const discardEntries = computed(() => view.value.tableHistory.filter((e) => e.discarded))

/** 选中的牌：两端都可接时返回 null（需用户选端），否则返回唯一可接端 */
const selectedForcedSide = computed(() => {
  if (!selectedId.value || view.value.openEnds === null) return null
  // 链两端点数相同：上下端无差异，直接放下端
  if (view.value.openEnds.top === view.value.openEnds.bottom) return 'bottom'
  const t = view.value.myHand.find((x) => x.id === selectedId.value)
  if (!t) return null
  const options = placeSides(t, view.value.openEnds)
  if (options.length !== 1) return null
  return options[0].side
})

function onConfirmPlay() {
  if (!selectedId.value) return
  // 只有一端可接时按真实可接端出，避免默认 bottom 被静默拒绝
  myPlay(selectedId.value, selectedForcedSide.value || mySide.value)
}

/** 两端都可接时：点悬浮的上端/下端按钮即选定端并直接出牌 */
function onSidePick({ id, side }) {
  if (!id || selectedId.value !== id) return
  myPlay(id, side)
}
function onConfirmDiscard() {
  if (!selectedId.value) return
  myDiscard(selectedId.value)
}

// ---------- 算账宣告 ----------
/** 选中牌的可宣告项（[{ type, side }]）：仅轮到我、链已开出且选中手牌时计算 */
const myDeclarations = computed(() => {  if (!myTurn.value || view.value.openEnds === null || !selectedId.value) return []
  const t = view.value.myHand.find((x) => x.id === selectedId.value)
  if (!t) return []
  const chainTiles = (view.value.tableHistory || []).flatMap((e) => e.tiles || [])
  return declarationFor(t, view.value.openEnds, chainTiles, view.value.myHand, view.value.settings || null)
})

/** 宣告出牌：按宣告端出牌并 declare=true */
async function onDeclare({ id, side }) {
  const res = await gameApi.value?.myPlay(id, side, true)
  if (res?.ok) {
    selectedId.value = null
    mySide.value = 'bottom'
  } else {
    uni.showToast({ title: res?.reason || '宣告失败', icon: 'none' })
    if (isNet.value) netRoomGoneRedirect(res?.code)
  }
}

/** 不算账：红/幺/五账 = 接另一端照常出；二三账 = 收回重选 */
async function onNoDeclare({ id }) {
  const t = view.value.myHand.find((x) => x.id === id)
  if (!t) return
  const decl = myDeclarations.value
  if (decl.length && decl[0].type === '二三账') {
    selectedId.value = null
    uni.showToast({ title: '已收回，请选择其他牌', icon: 'none' })
    return
  }
  const options = placeSides(t, view.value.openEnds)
  const declSides = new Set(decl.map((d) => d.side))
  const normal = options.find((o) => !declSides.has(o.side))
  const side = normal ? normal.side : options[0]?.side || 'bottom'
  const res = await gameApi.value?.myPlay(id, side)
  if (res?.ok) { selectedId.value = null; mySide.value = 'bottom' }
  else {
    uni.showToast({ title: res?.reason || '出牌失败', icon: 'none' })
    if (isNet.value) netRoomGoneRedirect(res?.code)
  }
}

// ---------- 算账宣告特效 ----------
const accountSplashShow = ref(false)
const accountSlammed = ref(false)
let splashTimer1 = null
let splashTimer2 = null
const accountSplashSub = computed(() => {
  const a = fx.value.accountSplash
  if (!a) return ''
  const rel = (a.seat - mySeatVal.value + 4) % 4
  const NAMES = ['我', '下家', '对家', '上家']
  return `${a.type} · ${NAMES[rel]}`
})
watch(
  () => fx.value.accountSplash,
  (a) => {
    if (!a) return
    accountSplashShow.value = true
    accountSlammed.value = false
    clearTimeout(splashTimer1)
    clearTimeout(splashTimer2)
    splashTimer1 = setTimeout(() => { accountSlammed.value = true }, 450)
    splashTimer2 = setTimeout(() => { accountSplashShow.value = false }, 1800)
  }
)
onUnmounted(() => { clearTimeout(splashTimer1); clearTimeout(splashTimer2); clearTimeout(splashTimer3) })

// 轮到我出牌提示音：state 首次进 PLAYING 时快照 myTurn——进局瞬间本就轮到我时
// 首次翻转是初始局面而非轮转，吞掉不响；快照消费后复位，后续每次真轮转都响。
// 顺序约束：state watcher 必须建在 myTurn watcher 之前（同帧刷新按创建序执行）
const entryMyTurn = ref(false)
watch(
  () => view.value.state,
  (s, os) => {
    if (s === 'PLAYING' && os !== 'PLAYING') entryMyTurn.value = myTurn.value
  }
)
watch(myTurn, (v) => {
  if (!v || view.value.state !== 'PLAYING') return
  if (entryMyTurn.value) { entryMyTurn.value = false; return } // 先消费进局快照
  if (mustDiscard.value) return // 扣牌回合不提示
  play('turn')
})

// 牌桌震动：拍桌瞬间触发 0.3s 抖动，先复位 class 再下一帧挂上，保证重复触发
const tableShake = ref(false)
let splashTimer3 = null
watch(accountSlammed, (v) => {
  if (!v) return
  play('suanzhang')
  tableShake.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { tableShake.value = true })
  })
  splashTimer3 = setTimeout(() => { tableShake.value = false }, 400)
})

// ---------- 飞牌动画 ----------
// 监听 tableHistory 新条目：一张牌的克隆从出牌方头像位置飞向链上实际落点。
// 飞行期间链上真牌隐藏（latestHidden），落地瞬间显现，避免"克隆与真牌同时出现"穿帮。
// 扣牌不飞（会暴露扣的牌面）。定位用 id + getElementById：uni-app H5 下 <script setup>
// 组件默认关闭实例，父组件 ref 拿不到 $el，原生 DOM 查询最可靠。
const fly = reactive({ tile: null, mirrored: false, fromX: 0, fromY: 0, toX: 0, toY: 0, moving: false })
const latestHidden = ref(false)
// 终局最后一飞：落地前压住亮牌/结算，落地后统一放行
let flyTimer = null
const flyLanded = ref(true)
// 终局节奏（客户端统一编排，solo/net 一致）：
// 终牌落定 → settleBrief「本局结束」 → 停 1s → revealKept 亮扣牌 → 点击 → 结算弹窗
const settleBrief = ref(false)
let settlePaceTimer = null

/** 屏幕坐标（px）：元素或其内部第一个有尺寸的后代的中心（display:contents 层须穿透） */
function centerOfEl(el) {
  let node = el
  for (let depth = 0; node && depth < 5; depth++) {
    if (typeof node.getBoundingClientRect !== 'function') return null
    const r = node.getBoundingClientRect()
    if (r.width > 0 || r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    node = node.firstElementChild
  }
  return null
}

function elById(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null
}

/** 出牌方（座位）锚点元素：我=手牌区包裹层（头含头像），其余=按相对方位取各 OpponentZone 包裹层 */
function anchorElOf(seat) {
  if (seat === mySeatVal.value) return elById('hand-anchor')
  const offset = (seat - mySeatVal.value + 4) % 4
  return elById({ 1: 'opp-right-anchor', 2: 'opp-top-anchor', 3: 'opp-left-anchor' }[offset])
}

/** 读取链上新条目真牌的最终渲染朝向：真牌根节点带 mirrored class（取反与否取决于所在列方向） */
function readRealMirrored() {
  return elById('latest-entry-anchor')?.querySelector('.tile')?.classList.contains('mirrored') ?? null
}

/** 桌面中央（时间线容器）中心：飞牌兜底终点 */
function tableCenter() {
  return centerOfEl(elById('timeline-anchor'))
}

/** 新入桌条目 → 飞牌参数；扣牌不飞（返回 null），无法定位起终点也不飞。
 *  终点 to 延迟解析：watch 触发时 Vue 尚未把新 entry 渲染进 DOM，双 rAF 后才调用 */
function flyFromEntry(entry) {
  if (entry.discarded) return null
  const from = centerOfEl(anchorElOf(entry.seat))
  if (!from) return null
  const tile = entry.tiles[entry.tiles.length - 1]
  if (!tile) return null
  return {
    tile,
    from,
    // 初始朝向取放置镜像，双 rAF 后由 playFly 回读真牌 DOM 的 mirrored class 校正
    mirrored: !!entry.mirrored,
    resolveTo() {
      return centerOfEl(elById('latest-entry-anchor')) || tableCenter()
    },
  }
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
  if (!f) {
    // 起飞失败兜底：latestHidden 已由 watcher 置 true，这里定时放行保证必然解除
    clearTimeout(flyTimer)
    flyTimer = setTimeout(() => { latestHidden.value = false }, 50)
    return
  }
  clearTimeout(flyTimer)
  fly.tile = f.tile
  fly.mirrored = f.mirrored
  fly.fromX = f.from.x
  fly.fromY = f.from.y
  fly.moving = false
  flyLanded.value = false
  // 双 rAF：Vue 已把新 entry 渲染进 DOM，此时才解析终点并切到过渡态
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // 回读真牌 DOM 的 mirrored class 校正飞行朝向（链条拐进向上列后与放置镜像相反）
      const real = readRealMirrored()
      if (real !== null) fly.mirrored = real
      const to = f.resolveTo()
      if (to) {
        fly.fromX = to.x
        fly.fromY = to.y
      }
      fly.moving = true
    })
  })
  // 动画完成：隐藏克隆、显现真牌，0.95s > 0.9s 过渡避免闪断
  flyTimer = setTimeout(() => {
    fly.tile = null
    fly.moving = false
    latestHidden.value = false
    flyLanded.value = true
    play(entry.seat === mySeatVal.value ? 'play_card' : 'other_play')
  }, 950)
}
onUnmounted(() => clearTimeout(flyTimer))
onUnmounted(() => clearTimeout(settlePaceTimer))

/** 终局节奏编排（solo/net 一致，终牌落地后触发） */
function paceSettle() {
  clearTimeout(settlePaceTimer)
  settleBrief.value = true
  // 结算音：以我的积分为准（正=赢/负=输）；winner 缺失时按输音兜底
  const r = view.value.result
  const s = r?.scores?.[mySeatVal.value] || 0
  play(s > 0 ? 'win' : 'lose')
  settlePaceTimer = setTimeout(() => { fx.value.revealKept = true }, 1000)
}

/** 监听桌面历史：出现新出牌条目即起飞克隆牌（扣牌条目不飞）。终局条目也要飞：
 *  最后一张牌先落桌、落地后再进入亮牌/结算。
 *  语音播报（与特效共用本 watcher）：
 *  - 出牌条目：宣告算账播「算账」人声，其余按最后入链的牌名播报；
 *  - 扣牌条目：随机播 withhold 一条。
 *  语音在牌离手即响；重连快照重放不会重复播报（watcher 只在长度增长时触发）。
 */
watch(
  () => view.value.tableHistory.length,
  (n, old) => {
    if (!n || (old !== undefined && n <= old)) return
    const entry = view.value.tableHistory[n - 1]
    if (entry?.tiles) {
      // 先隐藏链上真牌再起飞：playFly 内部有起飞失败兜底，隐藏必然最终解除
      latestHidden.value = true
      playFly(entry)
      // 宣告成立（本条目出牌者 = account.seat）→ 播「算账」不读牌名
      const acc = view.value.account
      playCardVoice(entry.tiles[entry.tiles.length - 1].name, !!acc && acc.seat === entry.seat)
    } else if (entry?.discarded) {
      playWithholdVoice()
    }
  }
)

/** 终局落地门：终牌飞完且还没编排过节奏时触发 paceSettle；
 *  连续局 state 回 ROLLING 时先清 settleBrief，下局终局可重新编排 */
watch(
  () => [view.value.state, flyLanded.value],
  ([state, landed]) => {
    if (state === 'SETTLE' && landed && view.value.result && !settleBrief.value && !fx.value.revealKept) {
      paceSettle()
    }
  },
  { immediate: true }
)

async function restart() {
  if (isNet.value) {
    // 联网局：发 settleContinue，回执成功即本地跳回房间页（服务器已把本人置 ready，
    // 全员确认后房主可开局）。跳转挪进宏任务：回执在 WS 微任务续体里 resolve，
    // 同上下文里 redirectTo 的导航链会与后续微任务竞态（页面不切换）。
    // 回执失败或 roomId 缺失则留在结算弹窗，等服务器广播兜底跳转。
    const res = await gameApi.value?.restart()
    const rid = roomNum.value
    if (res && rid != null) {
      setTimeout(() => {
        uni.redirectTo({
          url: `/pages/room/room?roomId=${rid}`,
          fail: (e) => uni.showToast({ title: '跳转失败：' + (e.errMsg || '未知原因'), icon: 'none' }),
        })
      }, 0)
    } else {
      console.warn(res ? '[game] settleContinue 已确认但 roomId 缺失' : '[game] settleContinue 未确认', '，留在结算弹窗等服务器广播兜底')
    }
    return
  }
  // 把上一局赢家写入 storage 作为下一局掷骰者（连续局规则）
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
    // 联网局必须通知服务器退房：否则连接仍存活、座位永不进入托管，轮到该座位时全场卡死
    try { await gameApi.value?.leave() } catch { /* 已断线等场景：服务器宽限兜底 */ }
  }
  // 不用 navigateBack：redirectTo 重开本页后历史栈残留旧 game 实例，
  // navigateBack 会退回栈里前一个 game 实例；reLaunch 清空页面栈直达主菜单
  uni.reLaunch({ url: '/pages/index/index' })
}
/** 右上角返回：对局进行中先弹确认（防误触掉线弃局） */
const homeConfirmShow = ref(false)
const homeConfirmText = ref('')
function confirmGoHome() {
  const inPlay = view.value.state === 'ROLLING' || view.value.state === 'PLAYING' || (view.value.state === 'SETTLE' && !fx.value.settleShow)
  if (!inPlay) return goHome()
  homeConfirmText.value = isNet.value
    ? '对局尚未结束，返回后你的座位将由 AI 托管（60 秒内可从大厅重连回房）'
    : '对局尚未结束，确定要退出吗？'
  homeConfirmShow.value = true
}
</script>

<style scoped>
.table {
  min-height: 100vh;
  /* 100vh 是"大视口"高度，地址栏展开时底部手牌区会被遮住；dvh 随工具栏收展自适应 */
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 20rpx;
  /* 补足 iPhone 底部 Home 指示条安全区 */
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.middle-row { flex: 1; display: flex; min-height: 0; padding-bottom: 8rpx; }
/* 联网断线提示条 */
.net-bar {
  position: fixed; top: 0; left: 0; right: 0;
  background: #a04030; color: #fff; font-size: 24rpx;
  text-align: center; padding: 8rpx 0; z-index: 999;
}
/* 右上角主菜单按钮：fixed 不遮牌面 */
.btn-home {
  position: fixed; top: 16rpx; right: 16rpx; z-index: 50;
  font-size: 24rpx; line-height: 1.4; padding: 10rpx 22rpx; margin: 0;
  background: rgba(58, 44, 20, 0.85); color: #b0a685;
  border: 2rpx solid #5a4a32; border-radius: 999rpx;
}
/* 静音开关：与主菜单按钮并排 */
.btn-mute {
  position: fixed; top: 16rpx; right: 160rpx; z-index: 50;
}
/* 左上角房间号徽标 */
.room-badge {
  position: fixed; top: 16rpx; left: 16rpx; z-index: 50;
  font-size: 24rpx; line-height: 1.4; padding: 10rpx 22rpx;
  background: rgba(58, 44, 20, 0.85); color: #b0a685;
  border: 2rpx solid #5a4a32; border-radius: 999rpx;
  pointer-events: none;
}
/* 亮牌阶段：取消 flex 压缩让内容自然撑高，防止窄视口下亮出的牌面底部被裁 */
.table.revealing > * { flex-shrink: 0; }
.table.revealing .middle-row { flex: 1 0 auto; min-height: 340rpx; }
.dice { font-size: 96rpx; line-height: 1; margin-bottom: 24rpx; color: #c9a227; }
/* 掷骰中：快速翻转跳动 */
.dice.rolling { animation: tumble 0.35s infinite; }@keyframes tumble {
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
/* 申请重新发牌：小号主按钮，居中 */
.btn-redeal {
  margin: 12rpx auto 0;
  font-size: 26rpx;
  padding: 10rpx 30rpx;
  line-height: 1.5;
}

.settle-overlay {
  position: fixed; inset: 0;
  /* 半透明：结算时仍能透出各家亮出的扣牌 */
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
}
/* 亮牌阶段提示：呼吸闪烁吸引注意 */
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

/* 我获胜的结算卡：金色边框微光 + 弹入动画 */
.settle-card.winner-card {
  border: 3rpx solid #c9a227;
  box-shadow: 0 0 40rpx rgba(201, 162, 39, 0.45), 0 8rpx 32rpx rgba(0, 0, 0, 0.5);
  animation: winner-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
  position: relative; overflow: visible;
}
@keyframes winner-pop {
  0%   { transform: scale(0.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.settle-title.winner-title {
  color: #e8c95a;
  font-size: 44rpx;
  text-shadow: 0 0 24rpx rgba(201, 162, 39, 0.8);
  /* 入场：缩放落位 + 呼吸发光循环 */
  animation: winner-drop-in 0.6s cubic-bezier(0.2, 1.3, 0.35, 1) both, winner-glow 1.6s ease-in-out 0.6s infinite;
  display: block;
}
/* scale 从 5 倍缩到 1，带轻微过冲回弹 */
@keyframes winner-drop-in {
  0%   { transform: scale(5); opacity: 0; }
  60%  { transform: scale(0.94); opacity: 1; }
  80%  { transform: scale(1.04); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes winner-glow {
  0%, 100% { text-shadow: 0 0 24rpx rgba(201, 162, 39, 0.8); }
  50%      { text-shadow: 0 0 44rpx rgba(232, 201, 90, 1); }
}

/* 庆祝彩带：pointer-events 穿透不挡按钮点击 */
.confetti-layer {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}
.confetti {
  position: absolute;
  top: -30rpx;
  width: 16rpx; height: 26rpx;
  border-radius: 4rpx;
  opacity: 0.9;
  animation-name: confetti-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
/* 四种配色 */
.confetti.c0 { background: #c9a227; }
.confetti.c1 { background: #a04030; }
.confetti.c2 { background: #4a8f7b; }
.confetti.c3 { background: #f5f0e1; }
@keyframes confetti-fall {
  0%   { transform: translateY(-6vh) rotate3d(1, 1, 0, 0deg); opacity: 0.9; }
  100% { transform: translateY(110vh) rotate3d(1, 1, 0, 720deg); opacity: 0.5; }
}

/* 卷曲丝带：双层结构——外层下落+摇摆，内层旋转翻卷，模拟丝带被风卷动 */
.ribbon {
  position: absolute;
  top: -60rpx;
  animation: ribbon-drop var(--dur, 3.6s) cubic-bezier(0.45, 0, 0.55, 1) var(--delay, 0s) infinite;
}
.ribbon-band {
  display: block;
  width: 12rpx; height: 72rpx;
  border-radius: 6rpx;
  opacity: 0.85;
  animation: ribbon-spin calc(var(--dur, 3.6s) / 3) linear var(--delay, 0s) infinite;
  transform-style: preserve-3d;
}
.ribbon.r0 .ribbon-band { background: linear-gradient(180deg, #c9a227, #e8c95a); }
.ribbon.r1 .ribbon-band { background: linear-gradient(180deg, #a04030, #c96050); }
.ribbon.r2 .ribbon-band { background: linear-gradient(180deg, #4a8f7b, #6ab59e); }
/* 外层下落：三段摆 X/Y 缓动错相位形成 S 形飘落 */
@keyframes ribbon-drop {
  0%   { transform: translate(0, 0) rotate(6deg); }
  25%  { transform: translate(calc(var(--sway) * 1), 26vh) rotate(-10deg); }
  50%  { transform: translate(calc(var(--sway) * -0.7), 52vh) rotate(8deg); }
  75%  { transform: translate(calc(var(--sway) * 0.7), 78vh) rotate(-8deg); }
  100% { transform: translate(0, 112vh) rotate(6deg); }
}
/* 内层翻卷：rotateX 前后翻面 + 轻微侧摆 */
@keyframes ribbon-spin {
  0%   { transform: rotateX(-80deg) rotateZ(-6deg); }
  25%  { transform: rotateX(0deg)    rotateZ(4deg); }
  50%  { transform: rotateX(80deg)  rotateZ(-4deg); }
  75%  { transform: rotateX(0deg)   rotateZ(5deg); }
  100% { transform: rotateX(-80deg) rotateZ(-6deg); }
}
.settle-row {
  display: flex; align-items: center; gap: 16rpx;
  background: rgba(0,0,0,0.25); border-radius: 12rpx; padding: 16rpx 24rpx; font-size: 28rpx;
}
.settle-row.winner { border: 2rpx solid #c9a227; }
/* 与历史记录弹框同构：头像 + 昵称/庄位 + 扣点 + 得分 */
.settle-who { display: flex; flex-direction: column; gap: 2rpx; width: 140rpx; flex: none; }
.settle-name { font-size: 26rpx; color: #f5f0e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settle-role { font-size: 22rpx; color: #b0a685; }
.settle-row.winner .settle-role { color: #c9a227; font-weight: bold; }
.settle-points { font-size: 24rpx; color: #b0a685; flex: 1; display: flex; flex-direction: column; gap: 4rpx; align-items: center; }
.settle-row .score { font-weight: bold; color: #c9a227; width: 140rpx; text-align: right; }
.settle-row .score.negative { color: #a04030; }
.settle-actions { display: flex; flex-direction: column; gap: 16rpx; margin-top: 12rpx; }
.home-confirm-card { width: 560rpx; gap: 28rpx; }
.home-confirm-text { font-size: 28rpx; color: #f5f0e1; text-align: center; line-height: 1.6; }

/* 飞牌动画层：fixed 克隆牌，pointer-events 穿透不挡操作 */
.fly-layer {
  position: fixed;
  z-index: 90;
  pointer-events: none;
  filter: drop-shadow(0 8rpx 16rpx rgba(0, 0, 0, 0.5));
}
.timeline-wrap { display: flex; justify-content: center; width: 100%; }
/* 锚点包裹层：display:contents 不改变布局，仅提供 getElementById 锚点 */
#opp-top-anchor, #opp-left-anchor, #opp-right-anchor, #hand-anchor { display: contents; }

/* 结算卡账目标签：与历史记录徽章同款药丸 */
.account-tag {
  font-size: 20rpx; color: #f5f0e1; background: rgba(201, 162, 39, 0.22);
  padding: 2rpx 12rpx; border-radius: 999rpx; white-space: nowrap;
}
.account-tag.fail { color: #ffd9c9; background: rgba(160, 64, 48, 0.55); }

/* 算账拍桌特效层：fixed 全屏，pointer-events 穿透 */
.account-splash-layer { position: fixed; inset: 0; z-index: 95; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.account-splash { display: flex; flex-direction: column; align-items: center; animation: splash-fly 0.45s cubic-bezier(0.5, 0, 0.75, 0.4) both; }
.account-splash.slammed { animation: splash-slam 0.18s ease-out both; }
.splash-text { font-size: 200rpx; font-weight: 900; color: #c9a227; text-shadow: 0 0 40rpx rgba(201, 162, 39, 0.9), 0 12rpx 24rpx rgba(0, 0, 0, 0.6); letter-spacing: 24rpx; }
.splash-sub { margin-top: 12rpx; font-size: 30rpx; color: #f5f0e1; background: rgba(58, 44, 20, 0.85); padding: 8rpx 28rpx; border-radius: 999rpx; }
@keyframes splash-fly {
  0% { transform: scale(8); opacity: 0; }
  60% { transform: scale(1.6); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes splash-slam {
  0% { transform: scale(1); }
  40% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
/* 拍桌瞬间金色闪光 */
.splash-flash { position: absolute; inset: 0; background: radial-gradient(circle, rgba(201, 162, 39, 0.35), transparent 70%); animation: flash-out 0.5s ease-out both; }
@keyframes flash-out { 0% { opacity: 1; } 100% { opacity: 0; } }
/* 拍桌瞬间牌桌震动 */
.table.shake { animation: table-shake 0.3s ease-out; }
@keyframes table-shake {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-8rpx, 4rpx); }
  50% { transform: translate(6rpx, -4rpx); }
  75% { transform: translate(-4rpx, 2rpx); }
}

</style>
