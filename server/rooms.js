/**
 * 房间与成员管理（服务器权威）。
 * Room: { roomId, members, game, fx, settleAck, diceInFlight, pendingDice, timers, createdAt }
 * 阶段不在 room 上冗余存储：对局中即 room.game.state，未开局为 'WAITING'，统一由 roomStateOf(room) 派生。
 * 成员: { seat, token, name, connected, gone, ready, isHost, isAI, conn, graceTimer, aiTimer }
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

  /** 派生房间阶段：对局中取 core 的 game.state，未开局为 WAITING（单一事实来源，避免双份状态漂移） */
  roomStateOf(room) {
    return room.game ? room.game.state : 'WAITING'
  }

  /** 房间快照（下发给客户端的 members 形态，剥离连接与定时器等内部字段） */
  roomState(room) {
    return {
      roomId: room.roomId,
      state: this.roomStateOf(room),
      members: room.members.map((m) => ({
        seat: m.seat, name: m.name, connected: m.connected, gone: m.gone,
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

  /** 从 WAITING 房间移除成员：销毁空房 / 转移房主并广播（不发 kicked：主动离开方无需通知，断线方 conn 已置空无法送达） */
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

  /** 销毁房间：清空 token 索引、成员连接引用与未决的对局编排定时器 */
  destroyRoom(roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const m of room.members) {
      this.tokens.delete(m.token)
      if (m.graceTimer) clearTimeout(m.graceTimer)
      m.conn = null
    }
    for (const t of room.timers || []) clearTimeout(t)
    if (room.settleTimer) clearTimeout(room.settleTimer) // Task 3 的结算推进定时器（防御性）
    this.rooms.delete(roomId)
  }

  createRoom(conn, name) {
    const existing = this.findMemberByConn(conn)
    if (existing && this.roomStateOf(existing.room) !== 'WAITING') {
      // 对局进行中的旧成员身份不能丢弃（否则其他 3 人局面卡死）：拒绝换房
      return { error: { code: 'ROOM_STARTED', message: '对局进行中，不能更换房间' } }
    }
    if (existing) this.removeMember(existing.room, existing.member) // 换房：先自动离开旧 WAITING 房
    const roomId = this.newRoomId()
    const room = { roomId, members: [], game: null, createdAt: this.now() }
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
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局已开始，无法加入' } }
    const seat = this.firstVacantSeat(room)
    if (seat === -1) return { error: { code: 'ROOM_FULL', message: '房间已满' } }
    // 校验全部通过后才处理旧成员身份：避免"先移除后校验失败"导致玩家凭空掉出房间
    const existing = this.findMemberByConn(conn)
    if (existing && existing.room !== room) {
      if (this.roomStateOf(existing.room) !== 'WAITING') {
        // 对局进行中的旧成员身份不能丢弃（否则其他 3 人局面卡死）：拒绝换房
        return { error: { code: 'ROOM_STARTED', message: '对局进行中，不能更换房间' } }
      }
      this.removeMember(existing.room, existing.member) // 换房：自动离开旧 WAITING 房
    }
    const token = makeToken()
    const member = { seat, token, name, connected: true, gone: false, ready: false, isHost: room.members.length === 0, isAI: false, conn, graceTimer: null, aiTimer: null }
    room.members.push(member)
    this.tokens.set(token, room)
    this.pushRoomState(room) // 新成员也会收到（其 conn 已在 members 中）
    return { room, token, seat }
  }

  quickMatch(conn, name) {
    const candidates = [...this.rooms.values()]
      .filter((r) => this.roomStateOf(r) === 'WAITING' && this.firstVacantSeat(r) !== -1)
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
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能换座位' } }
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
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能修改准备状态' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    me.ready = !!ready
    this.pushRoomState(room)
    return { ok: true }
  }

  // ---------- 对局 ----------

  canStart(room) {
    if (room.members.length === 0) return { ok: false, message: '需要至少 1 名玩家' }
    if (!room.members.every((m) => m.ready || m.isAI)) return { ok: false, message: '所有玩家须先准备' }
    return { ok: true }
  }

  /** 开局前把空位补成 AI 成员（isAI 天然已准备；走 scheduleAiTurn/maybeAutoRoll 既有托管代打路径） */
  fillWithAI(room) {
    const used = new Set(room.members.map((m) => m.seat))
    for (let seat = 0; seat < 4; seat++) {
      if (used.has(seat)) continue
      room.members.push({
        seat, token: null, name: `AI·小牛${seat}`, connected: true, gone: false,
        ready: true, isHost: false, isAI: true, conn: null, graceTimer: null, aiTimer: null,
      })
    }
  }

  startGame(token, roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局已开始' } }
    const me = this.memberByToken(room, token)
    if (!me || !me.isHost) return { error: { code: 'NOT_HOST', message: '只有房主能开始' } }
    this.fillWithAI(room) // 空位自动补 AI：2~3 名真人也能开局（canStart 不再要求满员）
    const check = this.canStart(room)
    if (!check.ok) return { error: { code: 'CANNOT_START', message: check.message } }
    this.pushRoomState(room) // 房间页立即看到 AI 座位就位
    this.beginRound(room, me.seat) // 首局掷骰者=房主座位
    return { ok: true }
  }

  /** 开一局（首局或连续局）。rollerSeat：本局掷骰者座位 */
  beginRound(room, rollerSeat) {
    room.game = createGame(Math.random, rollerSeat)
    room.settleAck = new Set()
    room.timers = new Set() // 本局编排定时器（掷骰/托管），destroyRoom 时统一清理
    room.diceInFlight = false
    room.pendingDice = null
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

  /** 组装某座位的游戏视图（core viewOf + fx + 成员昵称表，客户端 labelOf 显示真实昵称） */
  gameView(room, seat) {
    const g = room.game
    const names = {}
    for (const m of room.members) names[m.seat] = m.name
    return { view: viewOf(g, seat), fx: { ...room.fx }, roomId: room.roomId, yourSeat: seat, names }
  }

  /** 通用动作入口：roll/play/discard。校验身份与轮次后委托 core；失败只经返回值回传（消息路由层统一回执，避免双通道） */
  gameAction(token, type, payload) {
    payload = payload || {}
    const room = this.roomOf(token)
    if (!room) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    const me = this.memberByToken(room, token)
    if (!me) return { error: { code: 'NOT_IN_ROOM', message: '不在此房间' } }
    if (type !== 'game.roll' && type !== 'game.play' && type !== 'game.discard' && type !== 'game.settleContinue') {
      return { error: { code: 'UNKNOWN_ACTION', message: '未知动作' } } // 协议层校验，不依赖对局状态
    }
    const g = room.game
    if (!g) return { error: { code: 'NO_GAME', message: '对局未开始' } }

    if (type === 'game.roll') {
      if (g.state !== 'ROLLING') return { error: { code: 'BAD_STATE', message: '当前不可掷骰' } }
      if (g.rollerSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '不是你的掷骰权' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      if (room.diceInFlight) return { error: { code: 'BAD_STATE', message: '正在掷骰中' } }
      const dice = 1 + Math.floor(g.rng() * 6)
      this.scheduleDice(room, dice)
      return { ok: true }
    }
    if (type === 'game.play') {
      if (g.state !== 'PLAYING') return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      if (g.currentSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      const tileIds = Array.isArray(payload?.tileIds) ? payload.tileIds : []
      const res = play(g, me.seat, tileIds, payload.side === 'top' ? 'top' : 'bottom')
      if (!res.ok) return { error: { code: 'ILLEGAL', message: res.reason } }
      this.afterAction(room)
      return { ok: true }
    }
    if (type === 'game.discard') {
      if (g.state !== 'PLAYING') return { error: { code: 'BAD_STATE', message: '非出牌阶段' } }
      if (g.currentSeat !== me.seat) return { error: { code: 'NOT_YOUR_TURN', message: '没轮到你' } }
      if (me.aiTimer) return { error: { code: 'NOT_YOUR_TURN', message: '托管中' } }
      const res = discard(g, me.seat, payload.tileId)
      if (!res.ok) return { error: { code: 'ILLEGAL', message: res.reason } }
      this.afterAction(room)
      return { ok: true }
    }
    if (type === 'game.settleContinue') return this.settleContinue(room, me)
    return { error: { code: 'UNKNOWN_ACTION', message: '未知动作' } }
  }

  /** 掷骰服务端时间线：立即 rolling → 1.2s 定骰 → 再 2.4s 执行 rollDice 进 PLAYING */
  scheduleDice(room, dice) {
    const g = room.game
    room.diceInFlight = true // 编排进行中，拒绝二次 game.roll（否则展示骰与结算骰分叉）
    room.pendingDice = dice
    room.fx = { dice: null, diceRolling: true, revealKept: false }
    this.pushGameState(room)
    const t1 = setTimeout(() => {
      room.timers.delete(t1)
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice, diceRolling: false, revealKept: false }
      this.pushGameState(room)
    }, 1200)
    room.timers.add(t1)
    const t2 = setTimeout(() => {
      room.timers.delete(t2)
      if (room.game === g) {
        room.diceInFlight = false
        room.pendingDice = null
      }
      if (room.game !== g || g.state !== 'ROLLING') return
      room.fx = { dice: null, diceRolling: false, revealKept: false }
      const res = rollDice(g, dice)
      if (res.ok) {
        this.pushRoomState(room)
        this.pushGameState(room)
        this.scheduleAiTurn(room)
      }
    }, 1200 + 2400)
    room.timers.add(t2)
  }

  /** 掷骰权在 AI/托管座位时自动掷（1s 延迟后走同一编排） */
  maybeAutoRoll(room) {
    const g = room.game
    if (!g || g.state !== 'ROLLING') return
    const roller = room.members.find((m) => m.seat === g.rollerSeat)
    if (!roller) return
    if (roller.isAI || roller.aiTimer) {
      const t = setTimeout(() => {
        room.timers.delete(t)
        const r2 = room.members.find((m) => m.seat === g.rollerSeat)
        if (!r2 || (!r2.isAI && !r2.aiTimer)) return // 托管座位已重连，取消代掷
        if (room.game === g && g.state === 'ROLLING' && !room.diceInFlight) {
          this.scheduleDice(room, 1 + Math.floor(room.game.rng() * 6))
        }
      }, 1000)
      room.timers.add(t)
    }
  }

  /** 每次动作后：检测终局 / 推送视图 / 调度托管座位 */
  afterAction(room) {
    const g = room.game
    if (g.state === 'SETTLE') {
      room.fx = { dice: null, diceRolling: false, revealKept: true }
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
    const t = setTimeout(() => {
      room.timers.delete(t)
      if (room.game !== g || g.state !== 'PLAYING' || g.currentSeat !== seat) return
      const m2 = room.members.find((x) => x.seat === seat)
      if (!m2 || (!m2.isAI && !m2.aiTimer)) return // 已重连，取消
      const hand = g.players[seat].hand
      let ok = false
      if (g.openEnds === null) {
        const choice = aiChoosePlay(hand, null, { isLeadFirst: true, otherHands: g.players.filter((p) => p.seat !== seat).map((p) => p.hand) })
        ok = choice ? play(g, seat, choice.tileIds, choice.side).ok : false
        if (!ok) console.error('[rooms] AI lead play failed', { seat, choice })
      } else {
        const choice = aiChoosePlay(hand, g.openEnds, { isLeadFirst: false })
        if (choice) ok = play(g, seat, choice.tileIds, choice.side).ok
        if (!ok) {
          const d = aiChooseDiscard(hand, g.openEnds)
          ok = d ? discard(g, seat, d.tileId).ok : false
        }
        if (!ok) console.error('[rooms] AI follow failed', { seat })
      }
      if (ok) this.afterAction(room) // 失败则不推进（避免死循环）；理论不可达路径，留日志排查
    }, delay)
    room.timers.add(t)
  }

  // ---------- 断线/重连/离开/销毁 ----------

  /** 连接关闭：按 token 触发断线流程（index.js 调用）。带上 conn 供过期关闭识别 */
  onConnClose(conn) {
    if (!conn.token) return
    this.onDisconnect(conn.token, conn)
  }

  /** 连接断开（非主动离开）。启动宽限计时 + AI 托管。conn 用于忽略已被新连接取代的过期关闭事件 */
  onDisconnect(token, conn = null) {
    const room = this.roomOf(token)
    if (!room) return
    const me = this.memberByToken(room, token)
    if (!me) return
    if (conn && me.conn && me.conn !== conn) return // 该连接已被更新连接取代（重连后旧连接才关闭），忽略此关闭事件
    me.connected = false
    me.conn = null
    if (me.graceTimer) clearTimeout(me.graceTimer)
    me.graceTimer = setTimeout(() => {
      if (me.connected || me.gone) return
      me.gone = true
      this.tokens.delete(token)
      if (this.roomStateOf(room) === 'WAITING') {
        // 未开局：直接移除成员（走既有 removeMember：空房销毁/房主转移/推送）
        this.removeMember(room, me)
      } else {
        // 对局中：座位空缺由托管继续（aiTimer 已在），通知其余真人
        this.pushRoomState(room)
      }
    }, GRACE_MS)
    this.enableAiControl(room, me)
    this.pushRoomState(room)
  }

  /** 掉线座位进入托管：标记 aiTimer，若正轮到该座位立即调度 */
  enableAiControl(room, member) {
    if (member.isAI || member.aiTimer) return
    member.aiTimer = true
    const g = room.game
    if (!g) return
    if (g.state === 'PLAYING' && g.currentSeat === member.seat) this.scheduleAiTurn(room)
    if (g.state === 'ROLLING' && g.rollerSeat === member.seat) this.maybeAutoRoll(room)
  }

  /** 重连收回托管 */
  disableAiControl(member) {
    member.aiTimer = null
  }

  /** 断线重连：恢复身份，下发完整快照（room.state + game.state） */
  reconnect(conn, token) {
    const room = this.roomOf(token)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间已解散' } }
    const me = this.memberByToken(room, token)
    if (!me || me.gone) return { error: { code: 'ROOM_GONE', message: '房间已解散' } }
    if (me.conn && me.conn !== conn) { try { me.conn.close() } catch { /* 旧连接已死 */ } }
    me.conn = conn
    me.connected = true
    if (me.graceTimer) { clearTimeout(me.graceTimer); me.graceTimer = null }
    this.disableAiControl(me)
    conn.send({ type: 'room.state', payload: { room: this.roomState(room) } })
    let gameState = null
    if (room.game) {
      gameState = this.gameView(room, me.seat)
      conn.send({ type: 'game.state', payload: gameState })
    }
    this.pushRoomState(room, token) // 通知他人
    return { room, seat: me.seat, gameState }
  }

  /** 主动离开。WAITING 移除成员（房主转移/空房销毁）；对局中按断线处理（宽限+托管） */
  leave(token) {
    const room = this.roomOf(token)
    if (!room) return { ok: true }
    const me = this.memberByToken(room, token)
    if (!me) return { ok: true }
    if (me.graceTimer) { clearTimeout(me.graceTimer); me.graceTimer = null }
    if (this.roomStateOf(room) === 'WAITING') {
      this.removeMember(room, me)
      return { ok: true }
    }
    // 对局中视为断线（走宽限+托管，无法真正退赛）
    if (me.conn) { try { me.conn.close() } catch { /* noop */ } }
    this.onDisconnect(token)
    return { ok: true }
  }

  /** 定时清理：WAITING 且无人在线的僵尸房（保留 60s 宽限，与断线踢出时限一致）；对局中全员掉线（无人点继续）的死房 */
  sweep() {
    for (const room of [...this.rooms.values()]) {
      const alive = room.members.some((m) => m.connected && !m.gone)
      const allGone = room.members.length > 0 && room.members.every((m) => m.gone)
      const waitingStale = this.roomStateOf(room) === 'WAITING' && !alive && room.members.every((m) => m.gone || this.now() - room.createdAt >= GRACE_MS)
      if (waitingStale || allGone) this.destroyRoom(room.roomId)
    }
  }

  // ---------- 结算继续 ----------

  /** 结算后点继续：全员确认（或 5s 超时）开下一局，掷骰者=上局赢家。
   *  AI 成员自动计入确认数（不占 active 名额也不投确认），真人确认齐或超时即开 */
  settleContinue(room, me) {
    if (!room.game || room.game.state !== 'SETTLE') return { error: { code: 'BAD_STATE', message: '非结算阶段' } }
    room.settleAck.add(me.seat)
    const active = room.members.filter((m) => !m.gone && !m.isAI).length
    if (active === 0 || room.settleAck.size >= active) {
      this.startNextRound(room)
    } else if (!room.settleTimer) {
      room.settleTimer = setTimeout(() => this.startNextRound(room), 5000)
      room.timers.add(room.settleTimer)
    }
    return { ok: true }
  }

  startNextRound(room) {
    if (room.settleTimer) { clearTimeout(room.settleTimer); room.settleTimer = null }
    if (!room.game || room.game.state !== 'SETTLE') return
    const winner = room.game.result.winner
    this.beginRound(room, winner)
  }
}
