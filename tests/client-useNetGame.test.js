import { describe, it, expect, vi } from 'vitest'

// uni 全局 mock（useNetGame 的 toast 分支依赖 uni API）
globalThis.uni = {
  setStorageSync: vi.fn(),
  getStorageSync: (k) => ({ dingniuzi_player_name: '测试甲' }[k] ?? ''),
  showToast: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
}

// 可控 fake net：记录 request、测试直接注入推送（与 net.js 同接口：status/on/request）
function fakeNet() {
  const handlers = new Map()
  return {
    status: { value: 'open' },
    sent: [],
    on(type, h) {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type).add(h)
      return () => handlers.get(type)?.delete(h)
    },
    async request(type, payload) { this.sent.push({ type, payload }); return { type: 'action.ok', payload: {} } },
    /** 测试注入推送 */
    __push(type, payload) { for (const h of handlers.get(type) || []) h(payload) },
  }
}

import { useNetGame } from '../src/composables/useNetGame.js'

describe('useNetGame', () => {
  it('收到 game.state 后 view/fx 整体更新；myTurn/mustDiscard/playableIds 正确', () => {
    const net = fakeNet()
    const { view, fx, myTurn, mustDiscard, playableIds, labelOf } = useNetGame(net)
    expect(view.state).toBe('') // 初始空视图
    net.__push('game.state', {
      view: {
        state: 'PLAYING', leaderSeat: 1, rollerSeat: 1, currentSeat: 0,
        tableTile: null, openEnds: { top: 6, bottom: 3 },
        myHand: [{ id: 't5-1', name: '大五', a: 5, b: 5 }, { id: 't11-1', name: '地幺', a: 1, b: 1 }],
        myKept: [], opponents: [{ seat: 1, handCount: 5, keptCount: 0 }, { seat: 2, handCount: 6, keptCount: 0 }, { seat: 3, handCount: 6, keptCount: 0 }],
        result: null, tableHistory: [],
      },
      fx: { dice: null, diceRolling: false, revealKept: false },
      yourSeat: 0,
      names: { 0: '测试甲', 1: '乙', 2: '丙', 3: '丁' },
    })
    expect(view.state).toBe('PLAYING')
    expect(view.myHand).toHaveLength(2)
    expect(myTurn.value).toBe(true)
    // openEnds {6,3}：大五(5,5)接不上、地幺(1,1)也接不上 → 无牌可接须扣牌
    expect(mustDiscard.value).toBe(true)
    expect(playableIds.value).toEqual([])
    expect(labelOf(0)).toBe('我')
    expect(labelOf(1)).toBe('乙')
  })

  it('game.state 携带 roomId/yourSeat/names；可跟牌时 playableIds 给出可接端牌', () => {
    const net = fakeNet()
    const { view, roomId, mySeat, fx, mustDiscard, playableIds, diceRollerSeat } = useNetGame(net)
    expect(roomId.value).toBe(null) // 初始未入房
    net.__push('game.state', {
      view: {
        state: 'PLAYING', leaderSeat: 0, rollerSeat: 0, currentSeat: 2,
        tableTile: null, openEnds: { top: 5, bottom: 3 },
        myHand: [{ id: 't53-1', name: '五三', a: 5, b: 3 }, { id: 't11-1', name: '地幺', a: 1, b: 1 }],
        myKept: [], opponents: [], result: null, tableHistory: [],
      },
      fx: { dice: 3, diceRolling: false, revealKept: false },
      roomId: 42,
      yourSeat: 2,
      names: { 2: '测试甲' },
    })
    expect(roomId.value).toBe(42)
    expect(mySeat.value).toBe(2)
    expect(view.leaderSeat).toBe(0)
    expect(fx.dice).toBe(3)
    // 我座位(2)为当前行动座位 → 轮到我，有牌可接不须扣
    expect(mustDiscard.value).toBe(false)
    // 五三两端 {5,3} 恰好都能接上链两端 {top:5, bottom:3}
    expect(playableIds.value).toEqual(['t53-1'])
    // 掷骰权座位跟随服务器 view.rollerSeat
    expect(diceRollerSeat.value).toBe(0)
  })

  it('动作：myPlay/myDiscard/roll 转发 request；失败返回 {ok:false, reason}', async () => {
    const net = fakeNet()
    net.request = async (type, payload) => {
      net.sent.push({ type, payload }) // 覆写 request 后仍记录发送（供断言）
      if (type === 'game.play') return { type: 'error', payload: { code: 'ILLEGAL', message: '这张牌接不上底端' } }
      return { type: 'action.ok', payload: {} }
    }
    const { view, myPlay, myDiscard, roll } = useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: { top: 6, bottom: 3 }, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: {},
    })
    const bad = await myPlay('t5-1', 'bottom')
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('这张牌接不上底端')
    const goodDiscard = await myDiscard('t5-1')
    expect(goodDiscard.ok).toBe(true)
    await roll()
    expect(net.sent.some(s => s.type === 'game.roll')).toBe(true)
    expect(net.sent.some(s => s.type === 'game.play' && s.payload.tileIds[0] === 't5-1' && s.payload.side === 'bottom')).toBe(true)
    expect(net.sent.some(s => s.type === 'game.discard' && s.payload.tileId === 't5-1')).toBe(true)
  })

  it('没轮到我时动作不发出网络请求，返回 {ok:false}', async () => {
    const net = fakeNet()
    const { myPlay, myDiscard } = useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 1, openEnds: { top: 6, bottom: 3 }, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: {},
    })
    expect((await myPlay('t1', 'bottom')).ok).toBe(false)
    expect((await myDiscard('t1')).ok).toBe(false)
    expect(net.sent).toHaveLength(0)
  })

  it('game.over：result 写入 view，revealKept 置位', () => {
    const net = fakeNet()
    const { view, fx } = useNetGame(net)
    net.__push('game.over', { result: { winner: 2, ranks: [], scores: { 0: -1, 1: -2, 2: 6, 3: -3 } }, fx: { revealKept: true } })
    expect(view.result.winner).toBe(2)
    expect(fx.revealKept).toBe(true)
  })

  it('restart 发 settleContinue', async () => {
    const net = fakeNet()
    const { restart } = useNetGame(net)
    await restart()
    expect(net.sent.some(s => s.type === 'game.settleContinue')).toBe(true)
  })

  it('connection 暴露 net.status；请求抛异常时动作返回 {ok:false, reason}', async () => {
    const net = fakeNet()
    net.request = async (type) => {
      if (type === 'game.discard') throw new Error('请求超时')
      return { type: 'action.ok', payload: {} }
    }
    const { connection, myDiscard } = useNetGame(net)
    expect(connection.value).toBe('open')
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: { top: 6, bottom: 3 }, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: {},
    })
    const res = await myDiscard('t1')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('请求超时')
  })
})
