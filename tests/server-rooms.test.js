import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RoomManager } from '../server/rooms.js'
import { viewOf } from '../src/core/game.js'

let mgr
beforeEach(() => {
  mgr = new RoomManager()
  mgr.now = () => 1000 // 固定时间便于超时测试
})

function conn(name) {
  // 假连接：记录发送的消息，便于断言
  const sent = []
  return {
    sent,
    name,
    send(msg) { sent.push(msg) },
    close() {},
  }
}

/** 推进假时钟直到对局进入 SETTLE（托管对局全程可能需要数千次 AI 步进） */
function advanceUntilSettle(room) {
  for (let i = 0; i < 2000 && room.game.state !== 'SETTLE'; i++) vi.advanceTimersByTime(100)
}

describe('RoomManager 房间流程', () => {
  it('创建房间：房主落座 0，房间号 6 位', () => {
    const c = conn('甲')
    const { room, token, error } = mgr.createRoom(c, '甲')
    expect(error).toBeUndefined()
    expect(room.roomId).toBeGreaterThanOrEqual(100000)
    expect(room.roomId).toBeLessThanOrEqual(999999)
    expect(token).toBeTruthy()
    expect(room.members).toHaveLength(1)
    expect(room.members[0]).toMatchObject({ seat: 0, name: '甲', isHost: true, connected: true, ready: false })
  })

  it('按房间号加入：空位自动分配座位', () => {
    const c1 = conn('甲')
    const { room, token: t1 } = mgr.createRoom(c1, '甲')
    const c2 = conn('乙')
    const res = mgr.joinRoom(c2, '乙', room.roomId)
    expect(res.error).toBeUndefined()
    expect(res.room.members).toHaveLength(2)
    expect(res.room.members.map(m => m.seat).sort()).toEqual([0, 1])
    expect(res.token).not.toBe(t1)
  })

  it('加入满员房间被拒', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    for (const n of ['乙', '丙', '丁']) mgr.joinRoom(conn(n), n, room.roomId)
    const res = mgr.joinRoom(conn('戊'), '戊', room.roomId)
    expect(res.error).toMatchObject({ code: 'ROOM_FULL' })
  })

  it('加入不存在房间返回 ROOM_GONE', () => {
    const res = mgr.joinRoom(conn('甲'), '甲', 123456)
    expect(res.error).toMatchObject({ code: 'ROOM_GONE' })
  })

  it('快速匹配：优先加入未满未开局房间，否则创建', () => {
    const first = mgr.createRoom(conn('甲'), '甲').room
    const m1 = mgr.quickMatch(conn('乙'), '乙')
    expect(m1.room.roomId).toBe(first.roomId) // 加入已有房间
    const m2 = mgr.quickMatch(conn('丙'), '丙')
    expect(m2.room.roomId).toBe(first.roomId)
    const m3 = mgr.quickMatch(conn('丁'), '丁')
    expect(m3.room.roomId).toBe(first.roomId) // 第 4 人，房间满
    const m4 = mgr.quickMatch(conn('戊'), '戊')
    expect(m4.room.roomId).not.toBe(first.roomId) // 满了 → 新房
  })

  it('换座位：WAITING 阶段可换到空位', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const res = mgr.moveSeat(token, room.roomId, 3)
    expect(res.error).toBeUndefined()
    const me = room.members.find(m => m.token === token)
    expect(me.seat).toBe(3)
  })

  it('换座位：目标座位有人被拒', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const res = mgr.moveSeat(token, room.roomId, 1)
    expect(res.error).toBeDefined()
  })

  it('准备/取消准备；广播 room.state 给所有已连成员', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    const c2 = conn('乙')
    mgr.joinRoom(c2, '乙', room.roomId)
    c1.sent.length = 0
    const res = mgr.setReady(token, room.roomId, true)
    expect(res.error).toBeUndefined()
    expect(room.members.find(m => m.token === token).ready).toBe(true)
    expect(c1.sent.some(m => m.type === 'room.state')).toBe(true)
    expect(c2.sent.some(m => m.type === 'room.state')).toBe(true)
  })

  it('token 唯一且非空；同一 conn 重复 createRoom 自动离开旧房', () => {
    const r1 = mgr.createRoom(conn('甲'), '甲')
    const r2 = mgr.createRoom(conn('乙'), '乙')
    expect(r1.token).toBeTruthy()
    expect(r2.token).toBeTruthy()
    expect(r1.token).not.toBe(r2.token)
    // 同一 conn 重复创建：旧房销毁（仅他一人），新房创建成功
    const c = conn('丙')
    const first = mgr.createRoom(c, '丙').room
    expect(mgr.rooms.has(first.roomId)).toBe(true)
    const second = mgr.createRoom(c, '丙')
    expect(second.error).toBeUndefined()
    expect(second.token).toBeTruthy()
    expect(mgr.rooms.has(first.roomId)).toBe(false) // 旧房已销毁
    expect(mgr.rooms.has(second.room.roomId)).toBe(true)
    expect(second.room.members).toHaveLength(1)
    expect(second.room.members[0]).toMatchObject({ name: '丙', isHost: true })
  })

  it('同一 conn 重复 joinRoom：自动离开旧房（旧房销毁）后加入新房', () => {
    const c = conn('甲')
    const roomA = mgr.createRoom(c, '甲').room
    const roomB = mgr.createRoom(conn('乙'), '乙').room
    const res = mgr.joinRoom(c, '甲', roomB.roomId)
    expect(res.error).toBeUndefined()
    expect(mgr.rooms.has(roomA.roomId)).toBe(false) // A 只有一人，已销毁
    expect(mgr.rooms.has(roomB.roomId)).toBe(true)
    expect(res.room.roomId).toBe(roomB.roomId)
    expect(roomB.members.map(m => m.name)).toEqual(['乙', '甲'])
  })

  it('换座位：非法座位（99、-1、1.5）返回 SEAT_INVALID', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    for (const seat of [99, -1, 1.5]) {
      const res = mgr.moveSeat(token, room.roomId, seat)
      expect(res.error).toMatchObject({ code: 'SEAT_INVALID' })
    }
  })

  it('roomState 快照剥离敏感字段（token/conn/graceTimer/aiTimer）', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    const snapshot = mgr.roomState(room)
    const m0 = snapshot.members[0]
    expect(m0).not.toHaveProperty('token')
    expect(m0).not.toHaveProperty('conn')
    expect(m0).not.toHaveProperty('graceTimer')
    expect(m0).not.toHaveProperty('aiTimer')
    expect(m0).toMatchObject({ seat: 0, name: '甲', isHost: true, gone: false })
  })

  it('setReady 对局中被拒（ROOM_STARTED）', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    room.game = { state: 'PLAYING' } // 模拟对局已开始（阶段派生自 game.state）
    const res = mgr.setReady(token, room.roomId, true)
    expect(res.error).toMatchObject({ code: 'ROOM_STARTED' })
  })

  it('gameView 携带成员昵称表 names（seat→name，供客户端 labelOf）', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    room.game = { state: 'PLAYING', players: [0, 1].map((seat) => ({ seat, hand: [], kept: [] })), tableTile: null, openEnds: null, tableHistory: [], result: null, leaderSeat: null, rollerSeat: null, currentSeat: null }
    const gv = mgr.gameView(room, 0)
    expect(gv.names).toMatchObject({ 0: '甲', 1: '乙' })
  })
})

/** 4 人满员已准备的房间 */
function fullRoom() {
  const c1 = conn('甲')
  const { room, token } = mgr.createRoom(c1, '甲')
  const tokens = [token]
  for (const n of ['乙', '丙', '丁']) {
    const r = mgr.joinRoom(conn(n), n, room.roomId)
    tokens.push(r.token)
    mgr.setReady(r.token, room.roomId, true)
  }
  mgr.setReady(token, room.roomId, true)
  return { room, tokens }
}

describe('开始对局与动作路由', () => {
  it('未满员开始被拒；满员全准备开始成功并广播 game.state', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const early = mgr.startGame(token, room.roomId)
    expect(early.error).toBeDefined()
    // 补齐同一房间至 4 人并全员准备（原稿 fullRoom() 另起新房，其 token 与本 room 不匹配）
    for (const n of ['丙', '丁']) mgr.joinRoom(conn(n), n, room.roomId)
    for (const m of room.members) mgr.setReady(m.token, room.roomId, true)
    vi.useFakeTimers()
    c1.sent.length = 0
    const res = mgr.startGame(token, room.roomId)
    expect(res.error).toBeUndefined()
    expect(mgr.roomStateOf(room)).toBe('ROLLING') // 开局先进入掷骰编排
    const roller = room.members.find(m => m.seat === room.game.rollerSeat)
    mgr.gameAction(roller.token, 'game.roll', {})
    vi.advanceTimersByTime(3600) // 掷骰时间线走完才发牌进 PLAYING
    expect(mgr.roomStateOf(room)).toBe('PLAYING')
    expect(room.game.players).toHaveLength(4)
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true) // 发牌在掷骰定头牌之后
    expect(c1.sent.some(m => m.type === 'game.state')).toBe(true)
    vi.useRealTimers()
  })

  it('非房主开始被拒', () => {
    const { room, tokens } = fullRoom()
    const r1 = mgr.startGame(tokens[1], room.roomId) // 乙非房主
    expect(r1.error).toBeDefined()
  })

  it('对局中开始游戏被拒（ROOM_STARTED）', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const again = mgr.startGame(tokens[0], room.roomId)
    expect(again.error).toMatchObject({ code: 'ROOM_STARTED' })
  })

  it('动作路由：非本座位出牌被拒', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const wrongSeat = room.game.currentSeat
    const notTurnToken = tokens.find((t, i) => i !== wrongSeat)
    const res = mgr.gameAction(notTurnToken, 'game.play', { tileIds: ['t1-1'], side: 'bottom' })
    expect(res.error).toBeDefined()
  })

  it('动作路由：未知动作返回 UNKNOWN_ACTION', () => {
    const { tokens } = fullRoom()
    const res = mgr.gameAction(tokens[0], 'game.foo', {})
    expect(res.error).toMatchObject({ code: 'UNKNOWN_ACTION' })
  })

  it('掷骰由服务端编排：立即 rolling，1.2s 定骰，2.4s 后进 PLAYING', () => {    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const rollerSeat = room.game.rollerSeat
    const rollerToken = tokens[rollerSeat]
    const c = room.members.find(m => m.token === rollerToken).conn
    c.sent.length = 0
    mgr.gameAction(rollerToken, 'game.roll', {})
    expect(mgr.roomStateOf(room)).toBe('ROLLING')
    expect(c.sent.some(m => m.type === 'game.state' && m.payload.fx.diceRolling === true)).toBe(true)
    vi.advanceTimersByTime(1200)
    expect(c.sent.some(m => m.type === 'game.state' && m.payload.fx.dice === room.pendingDice)).toBe(true)
    vi.advanceTimersByTime(2400)
    expect(mgr.roomStateOf(room)).toBe('PLAYING')
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true) // 定骰后完成发牌
    vi.useRealTimers()
  })

  it('掷骰进行中重复掷骰被拒', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const rollerToken = tokens[room.game.rollerSeat]
    const first = mgr.gameAction(rollerToken, 'game.roll', {})
    expect(first.error).toBeUndefined()
    const second = mgr.gameAction(rollerToken, 'game.roll', {})
    expect(second.error).toMatchObject({ code: 'BAD_STATE' })
    vi.advanceTimersByTime(3600)
    expect(mgr.roomStateOf(room)).toBe('PLAYING') // 时间线只跑一次，正常开局
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true)
    expect(room.diceInFlight).toBe(false)
    vi.useRealTimers()
  })

  it('tileIds 非数组被拒（ILLEGAL 出牌数量非法）', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    mgr.gameAction(tokens[room.game.rollerSeat], 'game.roll', {})
    vi.advanceTimersByTime(3600) // 进入 PLAYING
    const token = tokens[room.game.currentSeat]
    const res = mgr.gameAction(token, 'game.play', { tileIds: 't1-1' })
    expect(res.error).toMatchObject({ code: 'ILLEGAL', message: '出牌数量非法' })
    vi.useRealTimers()
  })

  // Task 3 已实现 onDisconnect
  it('完整对局：全员掉线托管，可推进到 SETTLE', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    vi.useFakeTimers()
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    expect(room.game.result).toBeTruthy()
    vi.useRealTimers()
  })

  it('掷骰权座位掉线：托管自动掷骰且重连后不重复掷', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    const rollerSeat = room.game.rollerSeat
    const rollerToken = tokens[rollerSeat]
    // 掷骰权座位掉线 → 托管自动掷
    mgr.onDisconnect(rollerToken)
    vi.advanceTimersByTime(1000 + 3600)
    expect(mgr.roomStateOf(room)).toBe('PLAYING')
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true)
    // 重连后不会再次触发掷骰时间线（手牌数保持 6，不重发）
    mgr.reconnect(conn('重连者'), rollerToken)
    vi.advanceTimersByTime(5000)
    expect(room.game.players.every(p => p.hand.length === 6)).toBe(true)
    vi.useRealTimers()
  })
})

describe('断线重连与结算', () => {
  it('掉线进入托管（aiTimer 置位）；重连后收回托管并收到完整快照', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    mgr.onDisconnect(tokens[1])
    const m2 = room.members.find(m => m.token === tokens[1])
    expect(m2.connected).toBe(false)
    expect(m2.aiTimer).toBeTruthy() // 托管已启动
    // 重连
    const c2b = conn('乙')
    const res = mgr.reconnect(c2b, tokens[1])
    expect(res.error).toBeUndefined()
    expect(m2.connected).toBe(true)
    expect(m2.aiTimer).toBeNull()
    expect(res.gameState).toBeTruthy() // 收到 game.state 快照
    expect(c2b.sent.some(x => x.type === 'game.state')).toBe(true)
    vi.useRealTimers()
  })

  it('宽限期 60s 未重连：标记移除并清理', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    mgr.onDisconnect(tokens[1])
    vi.advanceTimersByTime(60_000)
    const m2 = room.members.find(m => m.token === tokens[1])
    expect(m2.gone).toBe(true) // 标记移除
    expect(mgr.tokens.has(tokens[1])).toBe(false) // token 索引清空
    vi.useRealTimers()
  })

  it('WAITING 阶段房主离开：成员移除并转移房主', () => {
    const { room, tokens } = fullRoom()
    // 甲（房主）主动离开 → WAITING 阶段成员移除、房主转移
    const res = mgr.leave(tokens[0])
    expect(res.ok).toBe(true)
    const next = room.members.find(m => !m.gone)
    expect(next.isHost).toBe(true)
    expect(mgr.tokens.has(tokens[0])).toBe(false)
  })

  it('settleContinue：全员确认后开下一局，掷骰者=上局赢家', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    const winner = room.game.result.winner
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    mgr.gameAction(tokens[1], 'game.settleContinue', {})
    mgr.gameAction(tokens[2], 'game.settleContinue', {})
    mgr.gameAction(tokens[3], 'game.settleContinue', {})
    expect(room.game.state).toBe('ROLLING')
    expect(room.game.rollerSeat).toBe(winner)
    vi.useRealTimers()
  })

  it('settleContinue 5s 超时自动继续', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    vi.advanceTimersByTime(5000)
    expect(room.game.state).toBe('ROLLING')
    vi.useRealTimers()
  })

  it('token 索引在房间销毁后清空', () => {
    const { room, tokens } = fullRoom()
    for (const t of tokens) mgr.leave(t)
    expect(mgr.tokens.size).toBe(0)
    expect(mgr.rooms.size).toBe(0)
  })

  it('sweep：WAITING 空房保留 60s 宽限，超龄才销毁（重连窗口不被提前压缩）', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    room.members[0].connected = false // 模拟全员掉线（未标记 gone）
    room.createdAt = 1000 // now=1000，房龄 0s
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(true) // 宽限期内仍保留
    room.createdAt = 1000 - 60_000 // 房龄恰 60s
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(false) // 超过 60s 销毁
  })
})
