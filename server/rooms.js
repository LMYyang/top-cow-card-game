/**
 * 房间与成员管理（服务器权威）。
 * Room: { roomId, members, state: 'WAITING'|'ROLLING'|'PLAYING'|'SETTLE', game, createdAt }
 * 成员: { seat, token, name, connected, ready, isHost, isAI, conn, graceTimer, aiTimer }
 * token 是玩家身份凭证（重连用）；conn 是当前 WebSocket 连接（可变）。
 */

import { randomUUID } from 'node:crypto'

import { createGame, rollDice, play, discard, viewOf } from '../src/core/game.js'
import { aiChoosePlay, aiChooseDiscard } from '../src/core/ai.js'

const GRACE_MS = 60_000 // 断线宽限：超时未重连则踢出（Task 3 使用）

function makeToken() {
  return randomUUID() // 高熵不可猜测，重连凭证安全
}

export class RoomManager {
  constructor() {
    this.rooms = new Map() // roomId -> Room
    this.tokens = new Map() // token -> Room（重连索引）
    this.now = () => Date.now()
  }

  /** 房间快照（下发给客户端的 members 形态，剥离连接与定时器等内部字段） */
  roomState(room) {
    return {
      roomId: room.roomId,
      state: room.state,
      members: room.members.map((m) => ({
        seat: m.seat, name: m.name, connected: m.connected,
        ready: m.ready, isHost: m.isHost, isAI: m.isAI,
      })),
    }
  }

  broadcast(room, type, payload, exceptToken = null) {
    for (const m of room.members) {
      if (m.token === exceptToken || !m.conn) continue
      m.conn.send({ type, payload })
    }
  }

  pushRoomState(room, exceptToken = null) {
    this.broadcast(room, 'room.state', { room: this.roomState(room) }, exceptToken)
  }

  /** 按座位序找第一个空位；满返回 -1 */
  firstVacantSeat(room) {
    const used = new Set(room.members.map((m) => m.seat))
    for (let s = 0; s < 4; s++) if (!used.has(s)) return s
    return -1
  }

  /** 按 conn 反查成员（防同一连接重复加入产生幽灵成员），O(n) 足够 */
  findMemberByConn(conn) {
    for (const room of this.rooms.values()) {
      const m = room.members.find((mm) => mm.conn === conn)
      if (m) return { room, member: m }
    }
    return null
  }

  /** 从 WAITING 房间移除成员：销毁空房 / 转移房主并广播（不发 kicked，Task 3 的 leave 才发） */
  removeMember(room, member) {
    room.members = room.members.filter((m) => m !== member)
    this.tokens.delete(member.token)
    if (room.members.length === 0) {
      this.destroyRoom(room.roomId)
      return
    }
    if (member.isHost) this.promoteHost(room)
    this.pushRoomState(room)
  }

  /** 房主转移：成员 isHost 为唯一事实来源（Task 3 复用） */
  promoteHost(room) {
    const next = room.members[0]
    if (next) next.isHost = true
  }

  /** 销毁房间：清空 token 索引与成员连接引用（Task 3 会扩展定时器清理） */
  destroyRoom(roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const m of room.members) {
      this.tokens.delete(m.token)
      if (m.graceTimer) clearTimeout(m.graceTimer)
      m.conn = null
    }
    this.rooms.delete(roomId)
  }

  createRoom(conn, name) {
    const existing = this.findMemberByConn(conn)
    if (existing) this.removeMember(existing.room, existing.member) // 换房：先自动离开旧房
    const roomId = this.newRoomId()
    const room = { roomId, members: [], state: 'WAITING', game: null, createdAt: this.now() }
    this.rooms.set(roomId, room)
    return this.joinRoom(conn, name, roomId)
  }

  newRoomId() {
    for (;;) {
      const id = 100000 + Math.floor(Math.random() * 900000)
      if (!this.rooms.has(id)) return id
    }
  }

  joinRoom(conn, name, roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在或已解散' } }
    if (room.state !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局已开始，无法加入' } }
    const existing = this.findMemberByConn(conn)
    if (existing && existing.room !== room) this.removeMember(existing.room, existing.member) // 换房：先自动离开旧房
    const seat = this.firstVacantSeat(room)
    if (seat === -1) return { error: { code: 'ROOM_FULL', message: '房间已满' } }
    const token = makeToken()
    const member = { seat, token, name, connected: true, ready: false, isHost: room.members.length === 0, isAI: false, conn, graceTimer: null, aiTimer: null }
    room.members.push(member)
    this.tokens.set(token, room)
    this.pushRoomState(room) // 新成员也会收到（其 conn 已在 members 中）
    return { room, token, seat }
  }

  quickMatch(conn, name) {
    const candidates = [...this.rooms.values()]
      .filter((r) => r.state === 'WAITING' && this.firstVacantSeat(r) !== -1)
      .sort((a, b) => a.createdAt - b.createdAt)
    if (candidates.length > 0) return this.joinRoom(conn, name, candidates[0].roomId)
    return this.createRoom(conn, name)
  }

  roomOf(token) {
    return this.tokens.get(token) || null
  }

  memberByToken(room, token) {
    return room.members.find((m) => m.token === token) || null
  }

  moveSeat(token, roomId, seat) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (room.state !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能换座位' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    if (!Number.isInteger(seat) || seat < 0 || seat > 3) return { error: { code: 'SEAT_INVALID', message: '座位号非法' } }
    if (seat === me.seat) return { ok: true }
    const target = room.members.find((m) => m.seat === seat)
    if (target) return { error: { code: 'SEAT_TAKEN', message: '该座位已有人' } }
    me.seat = seat
    this.pushRoomState(room)
    return { ok: true }
  }

  setReady(token, roomId, ready) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (room.state !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能修改准备状态' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    me.ready = !!ready
    this.pushRoomState(room)
    return { ok: true }
  }

  // ---------- 对局 ----------

  /** 错误回执：发回该成员当前连接（断言测试与客户端提示都用它） */
  sendError(member, code, message) {
    if (member?.conn) member.conn.send({ type: 'error', payload: { code, message } })
  }

  canStart(room) {
    if (room.members.length !== 4) return { ok: false, message: '需要 4 名玩家' }
    if (!room.members.every((m) => m.ready || m.isAI)) return { ok: false, message: '所有玩家须先准备' }
    return { ok: true }
  }

  startGame(token, roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    const me = this.memberByToken(room, token)
    if (!me || !me.isHost) {
      this.sendError(me, 'NOT_HOST', '只有房主能开始')
      return { error: { code: 'NOT_HOST', message: '只有房主能开始' } }
    }
    const check = this.canStart(room)
    if (!check.ok) {
      this.sendError(me, 'CANNOT_START', check.message)
      return { error: { code: 'CANNOT_START', message: check.message } }
    }
    this.beginRound(room, me.seat) // 首局掷骰者=房主座位
    return { ok: true }
  }

  /** 开一局（首局或连续局）。rollerSeat：本局掷骰者座位 */
  beginRound(room, rollerSeat) {
    room.game = createGame(Math.random, rollerSeat)
    room.state = 'PLAYING'
    room.settleAck = new Set()
    room.fx = { dice: null, diceRolling: false, revealKept: false }
    this.pushRoomState(room)
    this.pushGameState(room)
    this.maybeAutoRoll(room)
  }

  /** 下发各座位的私有视图（viewOf 按座位过滤手牌） */
  pushGameState(room, onlySeat = null) {
    for (const m of room.members) {
      if (!m.conn) continue
      if (onlySeat !== null && m.seat !== onlySeat) continue
      m.conn.send({ type: 'game.state', payload: this.gameView(room, m.seat) })
    }
  }

  /** 组装某座位的游戏视图（core viewOf + fx） */
  gameView(room, seat) {
    const g = room.game
    return { view: viewOf(g, seat), fx: { ...room.fx }, roomId: room.roomId, yourSeat: seat }
  }

  /** 通用动作入口：roll/play/discard。校验身份与轮次后委托 core */
  gameAction(token, type, payload) {
    const room = this.roomOf(token)
    if (!room) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    const g = room.game
    if (!g) {
      this.sendError(me, 'NO_GAME', '对局未开始')
      return { error: { code: 'NO_GAME', message: '对局未开始' } }
    }

    if (type === 'game.roll') {
      if (g.state !== 'ROLLING') {
        this.sendError(me, 'BAD_STATE', '当前不可掷骰')
        return { error: { code: 'BAD_STATE', message: '当前不可掷骰' } }
      }
      if (g.rollerSeat !== me.seat) {
        this.sendError(me, 'NOT_YOUR_TURN', '不是你的掷骰权')
        return { error: { code: 'NOT_YOUR_TURN', message: '不是你的掷骰权' } }
      }
      if (me.aiTimer) {
        this.sendError(me, 'NOT_YOUR_TURN', '托管中')
        return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      }
      const dice = 1 + Math.floor(Math.random() * 6)
      this.scheduleDice(room, dice)
      return { ok: true }
    }
    if (type === 'game.play') {
      if (g.state !== 'PLAYING') {
        this.sendError(me, 'BAD_STATE', '非出牌阶段')
        return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      }
      if (g.currentSeat !== me.seat) {
        this.sendError(me, 'NOT_YOUR_TURN', '没轮到你')
        return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      }
      if (me.aiTimer) {
        this.sendError(me, 'NOT_YOUR_TURN', '托管中')
        return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      }
      const res = play(g, me.seat, payload.tileIds || [], payload.side === 'top' ? 'top' : 'bottom')
      if (!res.ok) {
        this.sendError(me, 'ILLEGAL', res.reason)
        return { error: { code: 'ILLEGAL', message: res.reason } }
      }
      this.afterAction(room)
      return { ok: true }
    }
    if (type === 'game.discard') {
      if (g.state !== 'PLAYING') {
        this.sendError(me, 'BAD_STATE', '非出牌阶段')
        return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      }
      if (g.currentSeat !== me.seat) {
        this.sendError(me, 'NOT_YOUR_TURN', '没轮到你')
        return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      }
      if (me.aiTimer) {
        this.sendError(me, 'NOT_YOUR_TURN', '托管中')
        return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      }
      const res = discard(g, me.seat, payload.tileId)
      if (!res.ok) {
        this.sendError(me, 'ILLEGAL', res.reason)
        return { error: { code: 'ILLEGAL', message: res.reason } }
      }
      this.afterAction(room)
      return { ok: true }
    }
    this.sendError(me, 'UNKNOWN_ACTION', '未知动作')
    return { error: { code: 'UNKNOWN_ACTION', message: '未知动作' } }
  }

  /** 掷骰服务端时间线：立即 rolling → 1.2s 定骰 → 再 2.4s 执行 rollDice 进 PLAYING */
  scheduleDice(room, dice) {
    const g = room.game
    room.state = 'ROLLING'
    room.fx = { dice: null, diceRolling: true, revealKept: false }
    g.pendingDice = dice
    this.pushGameState(room)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice, diceRolling: false, revealKept: false }
      this.pushGameState(room)
    }, 1200)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice: null, diceRolling: false, revealKept: false }
      const res = rollDice(g, dice)
      if (res.ok) {
        room.state = 'PLAYING'
        this.pushRoomState(room)
        this.pushGameState(room)
        this.scheduleAiTurn(room)
      }
    }, 1200 + 2400)
  }

  /** 掷骰权在 AI/托管座位时自动掷（1s 延迟后走同一编排） */
  maybeAutoRoll(room) {
    const g = room.game
    if (!g || g.state !== 'ROLLING') return
    const roller = room.members.find((m) => m.seat === g.rollerSeat)
    if (!roller) return
    if (roller.isAI || roller.aiTimer) {
      setTimeout(() => {
        if (room.game === g && g.state === 'ROLLING') this.scheduleDice(room, 1 + Math.floor(Math.random() * 6))
      }, 1000)
    }
  }

  /** 每次动作后：检测终局 / 推送视图 / 调度托管座位 */
  afterAction(room) {
    const g = room.game
    if (g.state === 'SETTLE') {
      room.fx = { dice: null, diceRolling: false, revealKept: true }
      room.state = 'SETTLE'
      for (const m of room.members) {
        if (m.conn) m.conn.send({ type: 'game.over', payload: { result: g.result, view: viewOf(g, m.seat), fx: { ...room.fx } } })
      }
      return
    }
    room.fx = { dice: null, diceRolling: false, revealKept: false }
    this.pushGameState(room)
    this.scheduleAiTurn(room)
  }

  /** 轮到 AI/托管座位时延时代打（真人重连后 aiTimer 清空，定时器自取消） */
  scheduleAiTurn(room) {
    const g = room.game
    if (!g || g.state !== 'PLAYING') return
    const seat = g.currentSeat
    const member = room.members.find((m) => m.seat === seat)
    if (!member || (!member.isAI && !member.aiTimer)) return // 真人在位，等待其动作
    const delay = 600 + Math.floor(Math.random() * 400)
    setTimeout(() => {
      if (room.game !== g || g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const m2 = room.members.find((x) => x.seat === seat)
      if (!m2 || (!m2.isAI && !m2.aiTimer)) return // 已重连，取消
      const hand = g.players[seat].hand
      if (g.openEnds === null) {
        const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: g.players.filter((p) => p.seat !== seat).map((p) => p.hand) })
        if (choice) play(g, seat, choice.tileIds, choice.side)
      } else {
        const choice = aiChoosePlay(hand, g.openEnds, { isLeadFirst: false })
        if (choice) play(g, seat, choice.tileIds, choice.side)
        else {
          const d = aiChooseDiscard(hand, g.openEnds)
          if (d) discard(g, seat, d.tileId)
        }
      }
      this.afterAction(room)
    }, delay)
  }
}
