<!-- src/pages/settings/settings.vue -->
<template>
  <view class="settings">
    <text class="title">游戏设置</text>
    <view class="card">
      <view class="row switch-row" @click="toggleEnabled">
        <view class="row-main">
          <text class="row-title">算账（封账）</text>
          <text class="row-sub">封住三家后按扣点判定：成功翻倍，失败包庄</text>
        </view>
        <view class="switch" :class="{ on: draft.enabled, disabled: readonly }">
          <view class="knob" />
        </view>
      </view>
      <template v-if="draft.enabled">
        <view v-for="acc in ACCOUNTS" :key="acc.key" class="row" @click="toggleAcc(acc.key)">
          <view class="row-main">
            <text class="row-title">{{ acc.label }}</text>
            <text class="row-sub">{{ acc.desc }}</text>
          </view>
          <view class="checkbox" :class="{ on: draft[acc.key] }">✓</view>
        </view>
      </template>
    </view>
    <view class="actions">
      <button v-if="!readonly" class="btn-primary" @click="save">保存</button>
      <button class="btn-secondary" @click="back">返回</button>
    </view>
    <text v-if="readonly" class="readonly-hint">对局设置由房主修改</text>
  </view>
</template>

<script setup>
import { reactive, ref, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../core/settings.js'
import { sharedNet } from '../../utils/net.js'

const ACCOUNTS = [
  { key: 'red', label: '红账', desc: '红十封住 4 点（链上已有另一张红十）' },
  { key: 'yao', label: '幺账', desc: '带 1 竖牌封住 1 点（其余 5 张带 1 竖牌已上链）' },
  { key: 'erSan', label: '三二账', desc: '幺三/三六/二六封住 2、3 点（其余 3 张已上链）' },
  { key: 'wu', label: '五账', desc: '带 5 竖牌封住 5 点（其余 3 张带 5 竖牌已上链）' },
]

const isNet = ref(false)
const readonly = ref(false) // 联网非房主：只读（room.vue 跳转时 host=1/0 决定）
const draft = reactive({ ...DEFAULT_SETTINGS })
let offRoomState = null
let dirty = false // 用户是否已动过 draft（动过后不再用 room.state 推送覆盖未保存的编辑）

onLoad((query) => {
  isNet.value = query.mode === 'net'
  if (isNet.value) {
    readonly.value = query.host !== '1'
    // 初值：room.vue 跳转时随 query 携带（net.on 无回放，room.state 只在变化时推送）
    if (query.s) {
      try { Object.assign(draft, normalizeSettings(JSON.parse(decodeURIComponent(query.s)))) } catch { /* 忽略坏参 */ }
    }
    // 房间设置以服务器 room.state 推送为准：room.vue 改动后推送同步到本页 draft
    const net = sharedNet()
    offRoomState = net.on('room.state', ({ room }) => {
      if (room && !dirty) Object.assign(draft, normalizeSettings(room.settings))
    })
  } else {
    Object.assign(draft, normalizeSettings(uni.getStorageSync('dingniuzi_settings')))
  }
})
onUnmounted(() => offRoomState?.())

function toggleEnabled() {
  if (readonly.value) return
  dirty = true
  draft.enabled = !draft.enabled
  if (draft.enabled) {
    // 首次打开默认四项全选（关闭再打开保留用户上次的账种勾选）
    if (!draft.red && !draft.yao && !draft.erSan && !draft.wu) {
      draft.red = draft.yao = draft.erSan = draft.wu = true
    }
  }
}
function toggleAcc(key) {
  if (readonly.value) return
  dirty = true
  draft[key] = !draft[key]
}

// 联网保存走 net.request 而非 useNetGame：后者每次调用新建实例（新 view/fx + 重挂
// game.state 处理器并触发 reconnect 握手拉快照），设置页只需一条请求，直接用 sharedNet 单例即可
async function save() {
  if (isNet.value) {
    try {
      const net = sharedNet()
      const res = await net.request('room.setSettings', { settings: { ...draft } })
      if (res.type === 'error') {
        uni.showToast({ title: res.payload?.message || '保存失败', icon: 'none' })
        return
      }
    } catch (e) {
      uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      return
    }
  } else {
    uni.setStorageSync('dingniuzi_settings', { ...draft })
  }
  uni.showToast({ title: '已保存', icon: 'none' })
  back()
}
function back() {
  uni.navigateBack()
}
</script>

<style scoped>
.settings { min-height: 100vh; padding: 80rpx 40rpx 60rpx; box-sizing: border-box; display: flex; flex-direction: column; gap: 32rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #f5f0e1; text-align: center; }
.card { background: rgba(58, 44, 20, 0.6); border: 2rpx solid #5a4a32; border-radius: 16rpx; padding: 8rpx 24rpx; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 24rpx 8rpx; border-bottom: 1rpx solid #4a3c22; }
.row:last-child { border-bottom: none; }
.row-main { display: flex; flex-direction: column; gap: 6rpx; flex: 1; }
.row-title { font-size: 30rpx; color: #f5f0e1; }
.row-sub { font-size: 22rpx; color: #b0a685; line-height: 1.4; }
.switch { width: 84rpx; height: 44rpx; border-radius: 999rpx; background: #3a2c14; border: 2rpx solid #5a4a32; position: relative; transition: background 0.2s; flex: none; }
.switch.on { background: #c9a227; border-color: #c9a227; }
.switch .knob { position: absolute; top: 2rpx; left: 2rpx; width: 36rpx; height: 36rpx; border-radius: 50%; background: #f5f0e1; transition: left 0.2s; }
.switch.on .knob { left: 42rpx; }
.checkbox { width: 44rpx; height: 44rpx; border-radius: 8rpx; border: 2rpx solid #8a7040; color: transparent; display: flex; align-items: center; justify-content: center; font-size: 28rpx; flex: none; box-sizing: border-box; }
.checkbox.on { background: #c9a227; border-color: #c9a227; color: #fff; }
.actions { display: flex; flex-direction: column; gap: 20rpx; margin-top: 16rpx; }
.readonly-hint { text-align: center; font-size: 22rpx; color: #b0a685; }
</style>
