/**
 * 房间与成员管理（服务器权威）。
 * Room: { roomId, members, state: 'WAITING'|'PLAYING'|'SETTLE', game, createdAt }
 * 成员: { seat, token, name, connected, ready, isHost, isAI, conn, graceTimer, aiTimer }
 * token 是玩家身份凭证（重连用）；conn 是当前 WebSocket 连接（可变）。
 */

import { randomUUID } from 'node:crypto'

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
}
