<template>
  <view class="hand-area">
    <view v-if="mustDiscard" class="hint warn">无牌可接，请选一张扣下</view>
    <view class="hand">
      <PlayingTile
        v-for="t in hand"
        :key="t.id"
        :tile="t"
        :selected="t.id === selectedId"
        :dimmed="myTurn && playableIds.length > 0 && !playableIds.includes(t.id)"
        @click="$emit('select', t.id)"
      />
    </view>
    <view class="kept-row" v-if="kept.length">
      <text class="kept-label">扣牌：</text>
      <PlayingTile v-for="t in kept" :key="t.id" :tile="t" size="sm" face-down />
    </view>
    <view class="actions" v-if="myTurn">
      <button class="btn-primary" :disabled="!selectedId || mustDiscard" @click="$emit('confirm-play')">出牌</button>
      <button class="btn-secondary" :disabled="!selectedId || !mustDiscard" @click="$emit('confirm-discard')">扣牌</button>
    </view>
  </view>
</template>

<script setup>
import PlayingTile from './PlayingTile.vue'

defineProps({
  hand: Array,
  kept: Array,
  playableIds: Array,
  myTurn: Boolean,
  mustDiscard: Boolean,
  selectedId: String,
})
defineEmits(['select', 'confirm-play', 'confirm-discard'])
</script>

<style scoped>
.hand-area { display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 16rpx 0; }
.hint.warn { color: #e0a030; font-size: 24rpx; }
.hand { display: flex; gap: 10rpx; justify-content: center; flex-wrap: wrap; }
.kept-row { display: flex; align-items: center; gap: 8rpx; }
.kept-label { font-size: 22rpx; color: #b0a685; }
.actions { display: flex; gap: 20rpx; }
</style>
