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
    expect(room.members[0]).toMatchObject({ seat: 0, name: '甲', isHost: true, connected: true, ready: true }) // 房主免准备
  })

  it('按房间号加入：空位自动分配座位，非房主未准备', () => {
    const c1 = conn('甲')
    const { room, token: t1 } = mgr.createRoom(c1, '甲')
    const c2 = conn('乙')
    const res = mgr.joinRoom(c2, '乙', room.roomId)
    expect(res.error).toBeUndefined()
    expect(res.room.members).toHaveLength(2)
    expect(res.room.members.map(m => m.seat).sort()).toEqual([0, 1])
    expect(res.token).not.toBe(t1)
    expect(res.room.members.find(m => m.token === res.token).ready).toBe(false) // 非房主需手动准备
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

  it('token 唯一且非空；不同 conn 各自建房', () => {
    const r1 = mgr.createRoom(conn('甲'), '甲')
    const r2 = mgr.createRoom(conn('乙'), '乙')
    expect(r1.token).toBeTruthy()
    expect(r2.token).toBeTruthy()
    expect(r1.token).not.toBe(r2.token)
  })

  it('房主踢人：WAITING 可踢、被踢方收 kicked 推送且 token 失效；非房主/踢自己/对局中被拒', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    const j = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    // 非房主踢人被拒
    expect(mgr.kickMember(j.token, room.roomId, token).error).toMatchObject({ code: 'NOT_HOST' })
    // 踢自己被拒
    expect(mgr.kickMember(token, room.roomId, token).error).toMatchObject({ code: 'BAD_REQUEST' })
    // 踢不存在的人被拒
    expect(mgr.kickMember(token, room.roomId, 'no-such-token').error).toMatchObject({ code: 'NOT_IN_ROOM' })
    // 正常踢人：乙收到 kicked 推送、移出房间、token 失效
    const c2 = room.members.find(m => m.token === j.token).conn
    c1.sent.length = 0
    const res = mgr.kickMember(token, room.roomId, j.token)
    expect(res.error).toBeUndefined()
    expect(room.members.map(m => m.name)).toEqual(['甲'])
    expect(mgr.tokens.has(j.token)).toBe(false)
    expect(c2.sent.some(m => m.type === 'kicked')).toBe(true)
    expect(c1.sent.some(m => m.type === 'room.state')).toBe(true) // 其余人收到更新
    // 对局中踢人被拒
    room.game = { state: 'PLAYING' }
    const r2 = mgr.joinRoom(conn('丙'), '丙', room.roomId)
    expect(r2.error).toMatchObject({ code: 'ROOM_STARTED' })
    room.game = null // 还原 WAITING 再验证一次路由层拒绝（用对局房场景）
    room.game = { state: 'PLAYING' }
    const j2 = { token: 'fake' }
    room.members.push({ seat: 1, token: j2.token, name: '丙', connected: false, gone: false, ready: false, isHost: false, isAI: false, conn: null, graceTimer: null, aiTimer: null })
    expect(mgr.kickMember(token, room.roomId, j2.token).error).toMatchObject({ code: 'ROOM_STARTED' })
    room.members = room.members.filter(m => m.token !== j2.token)
    room.game = null
  })

  it('房主提醒准备：未准备真人收 poke 推送；已准备/自己/AI/非房主被拒', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    const j = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    // 非房主提醒被拒
    expect(mgr.pokeMember(j.token, room.roomId, token).error).toMatchObject({ code: 'NOT_HOST' })
    // 提醒自己被拒
    expect(mgr.pokeMember(token, room.roomId, token).error).toMatchObject({ code: 'BAD_REQUEST' })
    // 正常提醒：乙收到 poke 推送
    const c2 = room.members.find(m => m.token === j.token).conn
    const res = mgr.pokeMember(token, room.roomId, j.token)
    expect(res.error).toBeUndefined()
    expect(c2.sent.some(m => m.type === 'poke')).toBe(true)
    // 已准备后再提醒被拒
    mgr.setReady(j.token, room.roomId, true)
    expect(mgr.pokeMember(token, room.roomId, j.token).error).toMatchObject({ code: 'ALREADY_READY' })
    // 对 AI 提醒被拒（fillWithAI 造一个 AI 成员）
    room.members.push({ seat: 2, token: null, name: 'AI', connected: true, gone: false, ready: true, isHost: false, isAI: true, conn: null, graceTimer: null, aiTimer: null })
    const ai = room.members.find(m => m.isAI)
    expect(mgr.pokeMember(token, room.roomId, ai.token).error).toMatchObject({ code: 'BAD_REQUEST' })
    room.members = room.members.filter(m => m !== ai)
  })

  it('checkSession：WAITING/对局中均返回房号与状态；token 失效返回 null（只读预检不改状态）', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    // WAITING 房：可预检到
    expect(mgr.checkSession(token)).toMatchObject({ roomId: room.roomId, state: 'WAITING' })
    // 对局房：宽限期内仍可预检到
    room.game = { state: 'PLAYING' }
    expect(mgr.checkSession(token)).toMatchObject({ roomId: room.roomId, state: 'PLAYING' })
    expect(room.members.find(m => m.token === token).connected).toBe(true) // 未改变连接状态
    // token 失效：null
    expect(mgr.checkSession('no-such-token')).toBeNull()
    mgr.onDisconnect(token) // 对局中掉线（宽限期内）
    expect(mgr.checkSession(token)).toMatchObject({ roomId: room.roomId, state: 'PLAYING' }) // 宽限期内仍可恢复
    // 宽限超时 → gone（fake timers 需先于 onDisconnect 安装才能拦截 graceTimer 的 setTimeout）
    vi.useFakeTimers()
    mgr.onDisconnect(token)
    vi.advanceTimersByTime(60_000)
    vi.useRealTimers()
    expect(mgr.checkSession(token)).toBeNull()
  })

  it('一人一房：已有 WAITING 房再点创建回到老房间（不另开新屋），昵称同步更新', () => {
    const c = conn('丙')
    const first = mgr.createRoom(c, '丙').room
    expect(mgr.rooms.has(first.roomId)).toBe(true)
    const second = mgr.createRoom(c, '小丙')
    expect(second.error).toBeUndefined()
    expect(second.room.roomId).toBe(first.roomId) // 回老房
    expect(second.token).toBe(first.members[0].token) // token 不变
    expect(second.rejoined).toBe(true)
    expect(second.room.members).toHaveLength(1)
    expect(second.room.members[0]).toMatchObject({ name: '小丙', isHost: true }) // 昵称已更新
    expect(mgr.rooms.size).toBe(1) // 没有另开新屋
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

  it('roomState 快照剥离敏感字段（conn/graceTimer/aiTimer）；token 保留供房主踢人定位目标', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    const snapshot = mgr.roomState(room)
    const m0 = snapshot.members[0]
    expect(m0).not.toHaveProperty('conn')
    expect(m0).not.toHaveProperty('graceTimer')
    expect(m0).not.toHaveProperty('aiTimer')
    expect(m0).toMatchObject({ seat: 0, name: '甲', isHost: true, gone: false })
    expect(m0.token).toBeTruthy()
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

  it('断线后带旧 token 重新 joinRoom：复用历史座位与 token，不产生重复成员', () => {
    const c1 = conn('甲')
    const { room, token: t1 } = mgr.createRoom(c1, '甲')
    const j = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    const j2 = mgr.joinRoom(conn('丙'), '丙', room.roomId)
    // 丙断线（WAITING 房：掉线即移除成员、token 失效）→ 复用路径返回 null，走正常入房
    mgr.onDisconnect(j2.token)
    expect(mgr.tryRejoin(conn('丙2'), '丙', j2.token)).toBeNull()
    expect(room.members.map(m => m.name)).toEqual(['甲', '乙']) // 丙已移除
    // 乙连接被替换（模拟重连前的旧连接关闭竞态）：token 还在、成员未移除 → 复用历史身份
    const c2new = conn('乙')
    const rj = mgr.joinRoom(c2new, '小乙', room.roomId, j.token)
    expect(rj.error).toBeUndefined()
    expect(rj.token).toBe(j.token)
    expect(rj.seat).toBe(j.seat)
    expect(rj.rejoined).toBe(true)
    expect(room.members).toHaveLength(2) // 没有第三个座位
    expect(room.members.filter(m => m.name === '乙' || m.name === '小乙')).toHaveLength(1)
    expect(room.members.find(m => m.token === j.token).conn).toBe(c2new)
    expect(room.members.find(m => m.token === j.token).name).toBe('小乙')
    // 房主对旧 token 踢人等操作仍可用（token 未变）
    expect(mgr.memberByToken(room, j.token).seat).toBe(j.seat)
    void t1
  })

  it('带旧 token 的 tryRejoin：对局中返回 null（走 reconnect 宽限）；gone 成员返回 null', () => {
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    // 对局中：WAITING 校验不通过，复用路径拒绝（仍走 reconnect 通道）
    expect(mgr.tryRejoin(conn('甲'), '甲', tokens[0])).toBeNull()
    // WAITING 房成员已 gone：不复用
    room.game = null
    const m = room.members.find(mm => mm.token === tokens[1])
    m.gone = true
    expect(mgr.tryRejoin(conn('乙'), '乙', tokens[1])).toBeNull()
  })

  it('tryRejoin 对在线成员幂等：重复请求回原身份不另开座位', () => {
    const { room, tokens } = fullRoom()
    const before = room.members.map(m => m.token)
    const rj = mgr.tryRejoin(conn('乙'), '乙', tokens[1])
    expect(rj).not.toBeNull()
    expect(rj.token).toBe(tokens[1])
    expect(room.members.map(m => m.token)).toEqual(before)
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
  it('未满员开局：空位自动补 AI 成员并进入掷骰编排', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    expect(room.members.length).toBe(2) // 两个真人
    vi.useFakeTimers()
    // 非房主（乙）未准备时开局被拒：房主免准备但其余真人须手动准备
    const res = mgr.startGame(token, room.roomId)
    expect(res.error).toMatchObject({ code: 'CANNOT_START' })
    const r2 = room.members.find(m => m.name === '乙')
    mgr.setReady(r2.token, room.roomId, true)
    const res2 = mgr.startGame(token, room.roomId)
    expect(res2.error).toBeUndefined()
    expect(room.members).toHaveLength(4) // 空位已补 AI
    const ais = room.members.filter(m => m.isAI)
    expect(ais).toHaveLength(2)
    expect(ais.every(m => m.ready && m.conn === null && m.token === null)).toBe(true)
    expect(mgr.roomStateOf(room)).toBe('ROLLING') // 开局先进入掷骰编排
    expect(c1.sent.some(m => m.type === 'room.state')).toBe(true) // AI 就位已推送
    // 掷骰权在真人房主手上：房主先掷；随后轮到 AI 座位时代打推进对局。
    // 头牌=掷骰者+骰点偏移：偏移 0（骰 1/5）时头牌即房主本人（真人首出），偏移非 0 时头牌是 AI。
    // 两种路径都必须能推进（AI 座位被 scheduleAiTurn 驱动），故循环步进直至出牌历史非空。
    let rolled = mgr.gameAction(token, 'game.roll', {})
    expect(rolled.error).toBeUndefined()
    vi.advanceTimersByTime(3600)
    expect(mgr.roomStateOf(room)).toBe('PLAYING')
    // 头牌若为真人（乙）：乙的 token 未知名字可能重复，直接用成员 token 找真人代出；更稳妥的方式是允许 AI 路径验证：
    // 直接让头牌座位所属成员（无论真人/AI）行动——真人用其 token 出牌，AI 靠定时器。
    const leaderMember = room.members.find(m => m.seat === room.game.leaderSeat)
    if (!leaderMember.isAI) {
      // 真人头牌：用该成员 token 首出（不拉三家约束由服务器校验，任取手牌第一张可能被拒——
      // 改为直接掉线进托管让 AI 代打，统一走 AI 路径）
      mgr.onDisconnect(leaderMember.token)
    }
    for (let i = 0; i < 30 && room.game.tableHistory.length === 0; i++) vi.advanceTimersByTime(200)
    expect(room.game.tableHistory.length).toBeGreaterThan(0) // AI 已代打
    vi.useRealTimers()
  })

  it('满员全准备开始成功并广播 game.state', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    mgr.joinRoom(conn('乙'), '乙', room.roomId)
    // 补齐同一房间至 4 人并全员准备（原稿 fullRoom() 另起新房，其 token 与本 room 不匹配）
    for (const n of ['丙', '丁']) mgr.joinRoom(conn(n), n, room.roomId)
    for (const m of room.members) mgr.setReady(m.token, room.roomId, true)
    vi.useFakeTimers()
    c1.sent.length = 0
    const res = mgr.startGame(token, room.roomId)
    expect(res.error).toBeUndefined()
    expect(room.members).toHaveLength(4) // 满员不补 AI
    expect(room.members.every(m => !m.isAI)).toBe(true)
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

  it('WAITING 阶段房主离开：成员移除并转移房主（继任默认已准备）', () => {
    const { room, tokens } = fullRoom()
    // 甲（房主）主动离开 → WAITING 阶段成员移除、房主转移
    const res = mgr.leave(tokens[0])
    expect(res.ok).toBe(true)
    const next = room.members.find(m => !m.gone)
    expect(next.isHost).toBe(true)
    expect(next.ready).toBe(true) // 继任房主免准备
    expect(mgr.tokens.has(tokens[0])).toBe(false)
  })

  it('WAITING 阶段成员掉线：立即移除（不等宽限），最后一人掉线房间销毁', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    const joined = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    // 乙掉线 → 立即移出房间
    mgr.onDisconnect(joined.token)
    expect(room.members.map(m => m.name)).toEqual(['甲'])
    expect(mgr.tokens.has(joined.token)).toBe(false)
    // 甲掉线（最后一员）→ 空房立即销毁
    mgr.onDisconnect(token)
    expect(mgr.rooms.has(room.roomId)).toBe(false)
    expect(mgr.tokens.has(token)).toBe(false)
  })

  it('settleContinue：全员确认后重置回 WAITING 房（真人默认已准备，立即广播回房推送），由房主再开新局', () => {
    vi.useFakeTimers()
    const c1 = conn('甲')
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    // 广播需要在线连接：重连甲（clear sent 便于断言本轮推送）
    mgr.reconnect(c1, tokens[0])
    c1.sent.length = 0
    // 乙丙丁仍掉线未 gone（宽限期内）：按 active 名额逐个确认（用 reconnect 建立在线连接）
    const others = room.members.filter((m) => !m.isAI && m.token !== tokens[0])
    const conns = [c1]
    others.forEach((m, i) => {
      const c = conn(m.name)
      conns.push(c)
      mgr.reconnect(c, m.token)
    })
    conns.forEach((c) => { c.sent.length = 0 })
    // 前 3 名真人确认（未齐）：SETTLE 态立即广播准备状态（先回房者实时看到后来者「已准备」）
    const first = room.members.filter((m) => !m.isAI).slice(0, 3)
    for (const m of first) mgr.gameAction(m.token, 'game.settleContinue', {})
    expect(room.game).not.toBeNull() // 未齐，等最后一人
    for (const c of conns) {
      expect(c.sent.some((x) => x.type === 'room.state')).toBe(true) // 每次确认都广播
      c.sent.length = 0
    }
    // 最后一人确认：全员齐 → 收尾（对局清空，立即广播回房推送）
    const last = room.members.find((m) => !m.isAI && !first.includes(m))
    mgr.gameAction(last.token, 'game.settleContinue', {})
    expect(room.game).toBeNull() // 对局清空 → 派生状态回 WAITING
    expect(mgr.roomStateOf(room)).toBe('WAITING')
    for (const m of room.members) expect(m.ready).toBe(true) // 默认已准备，回房即可开局
    // 回房推送立即发出（客户端 settleContinue 回执后本地即跳房，延迟推送反而拖慢回房）
    expect(conns.every((c) => c.sent.some((x) => x.type === 'room.state'))).toBe(true)
    vi.useRealTimers()
  })

  it('settleContinue 5s 超时自动重置回 WAITING 房', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    vi.advanceTimersByTime(5000)
    expect(room.game).toBeNull()
    expect(mgr.roomStateOf(room)).toBe('WAITING')
    expect(room.members.every((m) => m.ready)).toBe(true)
    vi.useRealTimers()
  })

  it('连续局掷骰者=上局赢家：finishSettle 记 winner 座位，startGame 以其开局', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    // 换成 fake rng 不可行（对局已开）：直接推进到 SETTLE 后读取真实 winner
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    const winner = room.game.result.winner
    // 广播需要在线连接：全员重连后逐个确认（与 settleContinue 全员确认测试同一套路）
    const conns = []
    for (const m of room.members.filter((x) => !x.isAI)) {
      const c = conn(m.name)
      conns.push(c)
      mgr.reconnect(c, m.token)
    }
    for (const m of room.members.filter((x) => !x.isAI)) mgr.gameAction(m.token, 'game.settleContinue', {})
    expect(room.game).toBeNull()
    expect(room.lastWinnerSeat).toBe(winner) // 收尾记录上局赢家
    // 再开局：掷骰者=上局赢家（而非房主）
    mgr.startGame(tokens[0], room.roomId)
    expect(room.game.rollerSeat).toBe(winner)
    vi.useRealTimers()
  })

  it('连续局掷骰者回退：上局赢家已不在房（掉线移除）时由房主掷骰', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    let winner = room.game.result.winner
    // 赢家恰是房主（甲）时换测乙丙丁任一人：下面要移除赢家成员，房主必须留在房里点开始
    if (winner === 0) winner = 1
    // 模拟上一局收尾记录（winnerMember=token 形态）
    const wm = room.members.find((m) => m.seat === winner)
    room.lastWinnerSeat = winner
    room.lastWinnerToken = wm ? wm.token : null
    room.game = null
    room.settleAck = new Set()
    room.settleTimer = null
    // 赢家座位成员被移除（模拟掉线清理），仍留在房里的座位照旧
    room.members = room.members.filter((m) => m.seat !== winner)
    mgr.startGame(tokens[0], room.roomId)
    expect(room.game.rollerSeat).not.toBe(winner)
    expect(room.game.rollerSeat).toBe(room.members.find((m) => m.isHost).seat)
    vi.useRealTimers()
  })

  it('SETTLE 态 roomState 带 settling=true 标记；收尾后回 false', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    expect(mgr.roomState(room).settling).toBe(true) // 结算收尾未完成
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    vi.advanceTimersByTime(5000) // 其余未确认，超时收尾
    expect(mgr.roomState(room).settling).toBe(false) // 收尾后回 WAITING
    vi.useRealTimers()
  })

  it('SETTLE 态快照成员带 settled 标记：已确认=true、未确认=false（连续局 ready 全真时的区分依据）', () => {
    vi.useFakeTimers()
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    // 关键前提：连续局收尾时 ready 已全为 true（上一局收尾置位），无法靠 ready 区分谁点了
    expect(room.members.every((m) => m.ready)).toBe(true)
    // 仅房主甲点「再来一局」
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    let snap = mgr.roomState(room)
    expect(snap.settling).toBe(true)
    for (const mem of snap.members) {
      expect(mem.settled).toBe(mem.seat === 0) // 只有甲 settled=true，其余（含 AI 补位无 ack）=false
    }
    // 其余真人逐个确认 → 全员 settled=true → 立即收尾回 WAITING
    for (const m of room.members.filter((x) => !x.isAI && x.token !== tokens[0])) {
      mgr.gameAction(m.token, 'game.settleContinue', {})
    }
    snap = mgr.roomState(room)
    expect(snap.settling).toBe(false)
    expect(snap.members.every((mem) => mem.settled === false)).toBe(true) // 收尾后 settleAck 已清空
    vi.useRealTimers()
  })

  it('SETTLE 收尾未完成时房主开局被拒（须等全员确认或 5s 超时收尾）', () => {
    vi.useFakeTimers()
    const c1 = conn('甲')
    const { room, tokens } = fullRoom()
    mgr.startGame(tokens[0], room.roomId)
    for (const m of room.members) mgr.onDisconnect(m.token)
    advanceUntilSettle(room)
    expect(room.game.state).toBe('SETTLE')
    // 全员重连，仅房主甲点「再来一局」（其余停在结算弹窗）
    mgr.reconnect(c1, tokens[0])
    for (const m of room.members.filter((x) => !x.isAI && x.token !== tokens[0])) mgr.reconnect(conn(m.name), m.token)
    mgr.gameAction(tokens[0], 'game.settleContinue', {})
    c1.sent.length = 0
    // 房主想直接开局：被拒（结算收尾未完成，须等其余玩家确认或超时）
    const res = mgr.startGame(tokens[0], room.roomId)
    expect(res.error).toMatchObject({ code: 'ROOM_STARTED', message: '对局已开始' })
    expect(room.game).not.toBeNull() // 旧对局还在（未收尾）
    // 5s 超时收尾后即可开局
    vi.advanceTimersByTime(5000)
    expect(room.game).toBeNull()
    const res2 = mgr.startGame(tokens[0], room.roomId)
    expect(res2.error).toBeUndefined()
    expect(room.game.state).toBe('ROLLING')
    vi.useRealTimers()
  })

  it('token 索引在房间销毁后清空', () => {
    const { room, tokens } = fullRoom()
    for (const t of tokens) mgr.leave(t)
    expect(mgr.tokens.size).toBe(0)
    expect(mgr.rooms.size).toBe(0)
  })

  it('sweep：WAITING 有成员但全员掉线 → 立即销毁（掉线已在 onDisconnect 即时移除，此处兜底）', () => {
    const { room } = mgr.createRoom(conn('甲'), '甲')
    room.members[0].connected = false // 模拟全员掉线（绕过 onDisconnect 直改状态）
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(false)
  })

  it('sweep：WAITING 有人在线但长时间无活动（lastActiveAt 超 ROOM_IDLE_MS）销毁', () => {
    const c = conn('甲')
    const { room } = mgr.createRoom(c, '甲')
    mgr.now = () => 1000
    room.lastActiveAt = 1000
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(true) // 刚活跃：保留
    room.lastActiveAt = 1000 - 5 * 60_000 // 5 分钟无任何活动
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(false) // 长时间无反应：销毁
  })

  it('sweep：WAITING 房主掉线（在线成员无房主）→ 下一位真人继承房主（免准备），房间保留', () => {
    const c1 = conn('甲')
    const { room, token } = mgr.createRoom(c1, '甲')
    const j = mgr.joinRoom(conn('乙'), '乙', room.roomId)
    // 房主甲连接断开但未走 onDisconnect（模拟心跳清理前的僵尸态：connected 恒 true 属旧 bug，
    // 这里直接改状态模拟"心跳已判定房主死链、成员被移除后继任缺失"的兜底入口）
    room.members = room.members.filter((m) => m !== room.members.find((mm) => mm.token === token))
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(true) // 还有真人乙：房间保留
    const host = room.members.find((m) => m.isHost)
    expect(host.token).toBe(j.token) // 乙继承房主
    expect(host.ready).toBe(true) // 继任房主免准备
    void c1
  })

  it('sweep：WAITING 房仅剩 AI/无人可继任 → 销毁房间', () => {
    const c = conn('甲')
    const { room } = mgr.createRoom(c, '甲')
    // 模拟唯一真人（房主甲）被移除后房里只剩一个 AI 占位（极端时序）
    room.members = room.members.filter((m) => m.isAI) // 移除真人甲
    room.members.push({ seat: 0, token: null, name: 'AI·小牛0', connected: true, gone: false, ready: true, isHost: true, isAI: true, conn: null, graceTimer: null, aiTimer: null })
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(false) // 没有真人能主持：销毁
    void c
  })

  it('sweep：WAITING 房内成员进出会刷新 lastActiveAt，不因房龄被误杀', () => {
    const c = conn('甲')
    mgr.now = () => 1000
    const { room } = mgr.createRoom(c, '甲')
    mgr.now = () => 1000 + 10 * 60_000 // 10 分钟后
    mgr.joinRoom(conn('乙'), '乙', room.roomId) // 新成员进入刷新 lastActiveAt
    mgr.sweep()
    expect(mgr.rooms.has(room.roomId)).toBe(true)
  })

  it('listRooms：只列未开局/有真人在线/未满员的房；满员与对局中不出现', () => {
    const a = mgr.createRoom(conn('甲'), '甲').room
    const b = mgr.createRoom(conn('乙'), '乙').room
    mgr.joinRoom(conn('丙'), '丙', b.roomId)
    mgr.joinRoom(conn('丁'), '丁', b.roomId)
    mgr.joinRoom(conn('戊'), '戊', b.roomId) // b 第 4 人（满员：乙丙丁戊）
    const list = mgr.listRooms()
    expect(list.map((r) => r.roomId)).toEqual([a.roomId]) // b 满员不列
    expect(list[0].playerCount).toBe(1)
    expect(list[0].members[0]).toMatchObject({ name: '甲', connected: true, isHost: true })
    // a 开局后也不列
    a.game = { state: 'PLAYING' }
    expect(mgr.listRooms()).toHaveLength(0)
  })
})
