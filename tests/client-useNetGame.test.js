import { describe, it, expect, vi } from 'vitest'

// uni 全局 mock（useNetGame 的 toast 分支依赖 uni API）
globalThis.uni = {
  setStorageSync: vi.fn(),
  getStorageSync: (k) => ({ dingniuzi_player_name: '测试甲' }[k] ?? ''),
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
}

// 可控 fake net：记录 request、测试直接注入推送（与 net.js 同接口：status/on/request/connect）
function fakeNet() {
  const handlers = new Map()
  return {
    status: { value: 'open' },
    sent: [],
    async connect() { return undefined },
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
    // 挂载快照的 reconnect 请求除外：断言的是"没轮到我"不发出对局动作请求
    expect(net.sent.filter((s) => s.type !== 'reconnect')).toHaveLength(0)
  })

  it('game.over：result 写入 view，终局 view 快照应用，revealKept 置位', () => {
    const net = fakeNet()
    // 历史记录写入隔离：setStorageSync 记录调用，测试末尾断言联网落史
    const stored = {}
    uni.setStorageSync = (k, v) => { stored[k] = v }
    const { view, fx } = useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: null, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: { 0: '测试甲', 2: '乙' },
    })
    net.__push('game.over', {
      result: { winner: 2, ranks: [{ seat: 2, points: 0, role: '赢家' }, { seat: 0, points: 1, role: '小庄' }], scores: { 0: -1, 1: -2, 2: 6, 3: -3 } },
      // 服务器 game.over 携带终局视图：终牌已在 tableHistory、state 翻 SETTLE
      view: { state: 'SETTLE', currentSeat: 2, openEnds: { top: 4, bottom: 6 }, myHand: [], myKept: [], opponents: [], tableTile: null, leaderSeat: 2, rollerSeat: 2, result: null, tableHistory: [{ seat: 2, tiles: [{ id: 't9-1', name: '九', a: 9, b: 9 }], side: 'bottom', mirrored: false }] },
      fx: { revealKept: true },
    })
    expect(view.result.winner).toBe(2)
    expect(view.state).toBe('SETTLE') // 终局视图被应用（终牌上链、state 翻转）
    expect(view.tableHistory).toHaveLength(1) // 最后一张牌已在桌面
    expect(fx.revealKept).toBe(true)
    // 联网局落史：mode='net'，昵称快照随条目保存；不写 dingniuzi_stats（那是单机口径，
    // 主页联网统计从历史条目实时汇总）
    const history = stored['dingniuzi_history']
    expect(history).toHaveLength(1)
    expect(history[0].mode).toBe('net')
    expect(history[0].scores[2]).toBe(6)
    expect(history[0].roles[0]).toBe('小庄')
    expect(history[0].names).toEqual({ 0: '测试甲', 2: '乙' })
    expect(stored['dingniuzi_stats']).toBeUndefined()
    uni.setStorageSync = vi.fn() // 还原 mock，避免污染其他用例
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

  it('fake net 退订契约：off() 后不再收到推送（与 net.js Set 语义一致）', () => {
    const net = fakeNet()
    const seen = []
    const off = net.on('game.state', (p) => seen.push(p))
    net.__push('game.state', { v: 1 })
    expect(seen).toHaveLength(1)
    off() // 退订后处理器被真正移除
    net.__push('game.state', { v: 2 })
    expect(seen).toHaveLength(1)
    // 重复退订安全（Set.delete 幂等）
    expect(() => off()).not.toThrow()
  })

  it('两个 useNetGame 实例各自独立接收推送，互不串扰', () => {
    const net = fakeNet()
    const a = useNetGame(net)
    const b = useNetGame(net)
    expect(a.view.state).toBe('')
    expect(b.view.state).toBe('')
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: null, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 0, rollerSeat: 0, result: null },
      fx: {}, yourSeat: 0, names: {},
    })
    // 同一 net 上的两个订阅都会收到推送，且各自维护独立 view
    expect(a.view.state).toBe('PLAYING')
    expect(b.view.state).toBe('PLAYING')
    // 单测在组件外调用（无 getCurrentInstance）：订阅保持注册，推送仍生效（预期行为，不告警不崩溃）
  })

  it('视角旋转：快照未到（names 空）时 labelOf 不把别家误标成「我」', () => {
    const net = fakeNet()
    const { labelOf } = useNetGame(net)
    // 初始 mySeat=0 但 names 为空：其余座位显示占位而非「我」
    expect(labelOf(0)).toBe('我') // 默认座位 0 是自己
    expect(labelOf(1)).toBe('座位1')
    expect(labelOf(2)).toBe('座位2')
    expect(labelOf(3)).toBe('座位3')
  })

  it('视角旋转：非 0 座位玩家 labelOf 中「我」跟随 yourSeat，其余显示昵称', () => {
    const net = fakeNet()
    const { labelOf, mySeat } = useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', currentSeat: 0, openEnds: null, myHand: [], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 1, rollerSeat: 1, result: null },
      fx: {}, yourSeat: 3, names: { 0: '甲', 1: '乙', 2: '丙', 3: '丁' },
    })
    expect(mySeat.value).toBe(3)
    expect(labelOf(3)).toBe('我') // 我的绝对座位显示「我」
    expect(labelOf(0)).toBe('甲') // 别家显示昵称（颜色仍绑定绝对座位，跨视角一致）
    expect(labelOf(1)).toBe('乙')
    expect(labelOf(2)).toBe('丙')
  })

  it('挂载即拉快照：reconnect 回执带 gameState 时经 game.state 处理器填充视图', async () => {
    const net = fakeNet()
    uni.getStorageSync = (k) => ({ dingniuzi_player_token: 'tok-8' }[k] ?? '')
    const gameState = {
      view: { state: 'PLAYING', currentSeat: 3, openEnds: { top: 2, bottom: 4 }, myHand: [{ id: 't24-1', name: '二四', a: 2, b: 4 }], myKept: [], opponents: [], tableHistory: [], tableTile: null, leaderSeat: 3, rollerSeat: 3, result: null },
      fx: { dice: null, diceRolling: false, revealKept: false },
      roomId: 7, yourSeat: 1, names: { 3: '丁' },
    }
    net.request = async (type, payload) => {
      net.sent.push({ type, payload })
      if (type === 'reconnect') {
        // 模拟服务器：先走推送通道重发快照（game.vue 只认订阅推送），再给请求回执
        net.__push('game.state', gameState)
        return { type: 'reconnected', payload: { room: {}, yourSeat: 1 } }
      }
      return { type: 'action.ok', payload: {} }
    }
    const { view, mySeat, roomId, labelOf } = useNetGame(net)
    expect(net.sent.some((s) => s.type === 'reconnect' && s.payload.token === 'tok-8')).toBe(true)
    expect(view.state).toBe('PLAYING') // 无需任何注入式推送，快照已生效（修复 room.vue 跳转造成的开局推送丢失）
    expect(view.myHand).toHaveLength(1)
    expect(mySeat.value).toBe(1)
    expect(roomId.value).toBe(7)
    expect(labelOf(3)).toBe('丁')
  })

  it('快照失败静默：reconnect 收 error 回执或请求抛异常都不崩、不清空已有视图', async () => {
    const net = fakeNet()
    uni.getStorageSync = (k) => ({ dingniuzi_player_token: 'tok-9' }[k] ?? '')
    net.request = async (type) => {
      if (type === 'reconnect') return { type: 'error', payload: { code: 'ROOM_GONE', message: '房间已解散' } }
      return { type: 'action.ok', payload: {} }
    }
    const { view } = useNetGame(net)
    await Promise.resolve() // 让 fetchSnapshot 的微队列跑完
    expect(view.state).toBe('') // 无快照即保持空视图，不抛错
  })

  it('连接未开时快照先 connect 再请求；未存 token 也照发（服务器回错误回执，静默忽略）', async () => {
    const net = fakeNet()
    net.status = { value: 'connecting' }
    uni.getStorageSync = () => ''
    let connected = false
    net.connect = async () => { connected = true; net.status.value = 'open' }
    const { fetchSnapshot } = useNetGame(net)
    await fetchSnapshot()
    expect(connected).toBe(true)
    expect(net.sent.some((s) => s.type === 'reconnect' && s.payload.token === '')).toBe(true)
  })
})

describe('useNetGame redeal', () => {
  it('redeal() 转发 game.redeal 请求；失败回执带服务器原因（提示收敛到页面层）', async () => {
    const net = fakeNet()
    net.request = async (type, payload) => {
      net.sent.push({ type, payload })
      if (type === 'game.redeal') return { type: 'error', payload: { code: 'ILLEGAL', message: '手牌不满足重新发牌条件' } }
      return { type: 'action.ok', payload: {} }
    }
    const { redeal } = useNetGame(net)
    const res = await redeal()
    expect(res.ok).toBe(false)
    expect(net.sent.some((m) => m.type === 'game.redeal')).toBe(true)
    expect(res.reason).toBe('手牌不满足重新发牌条件')
    expect(uni.showToast).not.toHaveBeenCalled() // a8716d3 起错误提示交页面层（game.vue onRedeal），composable 不再 toast
  })

  it('canRedealNow：PLAYING + 无出牌 + 满足牌型 + 未申请过 = true', () => {
    const net = fakeNet()
    const { canRedealNow } = useNetGame(net)
    net.__push('game.state', {
      view: {
        state: 'PLAYING', leaderSeat: 0, rollerSeat: 0, currentSeat: 0,
        tableTile: null, openEnds: null,
        myHand: [
          { id: 't5-1', name: '红八', a: 4, b: 4, type: '横牌', red: true },
          { id: 't5-2', name: '红八', a: 4, b: 4, type: '横牌', red: true },
          { id: 't1-1', name: '大天', a: 6, b: 6, type: '横牌', red: false },
          { id: 't3-1', name: '大五', a: 5, b: 5, type: '横牌', red: false },
          { id: 't10-1', name: '二板', a: 2, b: 2, type: '横牌', red: false },
          { id: 't11-1', name: '地幺', a: 1, b: 1, type: '横牌', red: false },
        ],
        myKept: [], opponents: [], result: null, tableHistory: [], redealUsed: [],
      },
      fx: {}, yourSeat: 0, names: {},
    })
    expect(canRedealNow.value).toBe(true)
    // 已申请过（redealUsed 含我）
    net.__push('game.state', {
      view: { state: 'PLAYING', tableHistory: [], redealUsed: [0], myHand: [], myKept: [], opponents: [], result: null, tableTile: null, openEnds: null, leaderSeat: 0, rollerSeat: 0, currentSeat: 0 },
      fx: {}, yourSeat: 0, names: {},
    })
    expect(canRedealNow.value).toBe(false)
  })

  it('收到 game.redealt 推送：toast 提示申请人', () => {
    const net = fakeNet()
    useNetGame(net)
    net.__push('game.state', {
      view: { state: 'PLAYING', myHand: [], myKept: [], opponents: [], tableHistory: [], result: null, tableTile: null, openEnds: null, leaderSeat: 0, rollerSeat: 0, currentSeat: 0, redealUsed: [] },
      fx: {}, yourSeat: 0, names: { 2: '老王' },
    })
    uni.showToast.mockClear()
    net.__push('game.redealt', { seat: 2 })
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '老王申请重新发牌' }))
  })
})
