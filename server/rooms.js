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

const GRACE_MS = 60_000 // 对局中断线宽限：超时未重连则踢出（连续局重连窗口依赖它）
const ROOM_IDLE_MS = 5 * 60_000 // WAITING 房无任何活动（无成员进出/无状态变更）多久后销毁

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
        ready: m.ready, isHost: m.isHost, isAI: m.isAI, token: m.token,
      })),
    }
  }

  /** 有效 WAITING 房间列表（供大厅浏览）：有真实成员在线、未开局、未满员，按创建时间升序 */
  listRooms() {
    return [...this.rooms.values()]
      .filter((r) => {
        if (this.roomStateOf(r) !== 'WAITING') return false
        const humans = r.members.filter((m) => !m.isAI && m.connected && !m.gone)
        return humans.length > 0 && r.members.length < 4
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        roomId: r.roomId,
        createdAt: r.createdAt,
        playerCount: r.members.filter((m) => !m.isAI).length,
        members: r.members.filter((m) => !m.isAI).map((m) => ({ name: m.name, connected: m.connected, isHost: m.isHost })),
      }))
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
    room.lastActiveAt = this.now()
    if (room.members.length === 0) {
      this.destroyRoom(room.roomId)
      return
    }
    if (member.isHost) this.promoteHost(room)
    this.pushRoomState(room)
  }

  /** 房主转移：成员 isHost 为唯一事实来源（Task 3 复用）；继任房主免准备（与开局房主同规则） */
  promoteHost(room) {
    const next = room.members[0]
    if (next) {
      next.isHost = true
      next.ready = true
    }
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
    if (existing) {
      // 一人只能有一个有效房间：已有 WAITING 房时再点「创建房间」直接回到老房间，
      // 不再另开新屋（避免同一人刷出一堆有效房），并把昵称按最新输入更新
      existing.member.name = name
      this.pushRoomState(existing.room)
      return { room: existing.room, token: existing.member.token, seat: existing.member.seat, rejoined: true }
    }
    const roomId = this.newRoomId()
    const room = { roomId, members: [], game: null, createdAt: this.now(), lastActiveAt: this.now() }
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
    // 房主免准备（创建即视为已准备），其他真人玩家需手动点准备；空位开局时由 AI 补齐
    const member = { seat, token, name, connected: true, gone: false, ready: room.members.length === 0, isHost: room.members.length === 0, isAI: false, conn, graceTimer: null, aiTimer: null }
    room.members.push(member)
    this.tokens.set(token, room)
    room.lastActiveAt = this.now() // 成员进出刷新活跃时间：有人的房不因房龄被判死
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
    room.lastActiveAt = this.now()
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
    room.lastActiveAt = this.now()
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

  /** 开一局（startGame 触发）。rollerSeat：本局掷骰者座位 */
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
      // 终局节奏：先推 game.over（revealKept=false，客户端先显示终牌落定 + 「本局结束」），
      // 停 1.2s（客户端飞牌 0.95s 落定后留少量缓冲）再推亮牌快照，集体翻开所有扣牌
      room.fx = { dice: null, diceRolling: false, revealKept: false }
      for (const m of room.members) {
        if (m.conn) m.conn.send({ type: 'game.over', payload: { result: g.result, view: viewOf(g, m.seat), fx: { ...room.fx } } })
      }
      const t = setTimeout(() => {
        room.timers.delete(t)
        if (room.game !== g || g.state !== 'SETTLE') return // 已开下一局/房间销毁：不再推旧局亮牌
        room.fx = { dice: null, diceRolling: false, revealKept: true }
        this.pushGameState(room)
      }, 1200)
      room.timers.add(t)
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

  /** 连接断开（非主动离开）。conn 用于忽略已被新连接取代的过期关闭事件。
   *  WAITING 房：掉线即移除（不保留宽限——房间里挂着「掉线」占位没有意义，列表也不该展示死座位）；
   *  对局中：60s 宽限 + AI 托管（重连回场窗口，连续局结算也依赖） */
  onDisconnect(token, conn = null) {
    const room = this.roomOf(token)
    if (!room) return
    const me = this.memberByToken(room, token)
    if (!me) return
    if (conn && me.conn && me.conn !== conn) return // 该连接已被更新连接取代（重连后旧连接才关闭），忽略此关闭事件
    if (this.roomStateOf(room) === 'WAITING') {
      if (me.graceTimer) { clearTimeout(me.graceTimer); me.graceTimer = null }
      this.removeMember(room, me) // 空房自动销毁（removeMember 内处理）
      return
    }
    me.connected = false
    me.conn = null
    if (me.graceTimer) clearTimeout(me.graceTimer)
    me.graceTimer = setTimeout(() => {
      if (me.connected || me.gone) return
      me.gone = true
      this.tokens.delete(token)
      // 对局中：座位空缺由托管继续（aiTimer 已在），通知其余真人
      this.pushRoomState(room)
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

  /** 会话预检（大厅用）：按 token 查是否有可恢复的房，不动连接状态、不收托管。
   *  返回 { roomId, state }（state 为 WAITING/ROLLING/PLAYING/SETTLE）或 null（无可恢复会话） */
  checkSession(token) {
    const room = this.roomOf(token)
    if (!room) return null
    const me = this.memberByToken(room, token)
    if (!me || me.gone) return null
    return { roomId: room.roomId, state: this.roomStateOf(room) }
  }

  /** 断线重连：恢复身份，下发完整快照（room.state + game.state） */
  reconnect(conn, token) {    const room = this.roomOf(token)
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

  /** 房主踢人（仅 WAITING 阶段；对局中不允许——避免中途把人踢出导致 3 打 1）。被踢方收 kicked 推送 */
  kickMember(hostToken, roomId, targetToken) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中不能移出玩家' } }
    const host = this.memberByToken(room, hostToken)
    if (!host || !host.isHost) return { error: { code: 'NOT_HOST', message: '只有房主能移出玩家' } }
    const target = this.memberByToken(room, targetToken)
    if (!target) return { error: { code: 'NOT_IN_ROOM', message: '对方不在此房间' } }
    if (target === host) return { error: { code: 'BAD_REQUEST', message: '不能移出自己' } }
    if (target.conn) target.conn.send({ type: 'kicked', payload: { message: '你已被房主移出房间' } })
    this.removeMember(room, target) // 房主未变：不触发转移；空房销毁/removeMember 内兜底
    return { ok: true }
  }

  /** 房主提醒未准备玩家（仅 WAITING 阶段）。目标收 poke 推送，客户端弹窗提示 */
  pokeMember(hostToken, roomId, targetToken) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: { code: 'ROOM_GONE', message: '房间不存在' } }
    if (this.roomStateOf(room) !== 'WAITING') return { error: { code: 'ROOM_STARTED', message: '对局中无需提醒' } }
    const host = this.memberByToken(room, hostToken)
    if (!host || !host.isHost) return { error: { code: 'NOT_HOST', message: '只有房主能提醒准备' } }
    const target = this.memberByToken(room, targetToken)
    if (!target) return { error: { code: 'NOT_IN_ROOM', message: '对方不在此房间' } }
    if (target === host) return { error: { code: 'BAD_REQUEST', message: '不能提醒自己' } }
    if (target.isAI) return { error: { code: 'BAD_REQUEST', message: 'AI 无需提醒' } }
    if (target.ready) return { error: { code: 'ALREADY_READY', message: '对方已准备' } }
    if (target.conn) target.conn.send({ type: 'poke', payload: { message: '房主提醒你准备' } })
    return { ok: true }
  }

  /** 定时清理（30s 周期，index.js 调用）：
   *  - 对局房：全员 gone（无人能点继续/重连）的死房销毁；
   *  - WAITING 房：空房立即销毁（removeMember 已兜底，这里兜漏网）；有成员但全员掉线的僵尸房
   *    在掉线即移除策略下只会出现在极端时序，同样按「无人在线」销毁；
   *  - WAITING 房长时间无任何活动（成员进出/状态变更超过 ROOM_IDLE_MS）销毁——
   *    防止有人挂着不动的死房长期占用房间号、出现在列表里。
   *  对局中掉线成员保留 60s 宽限（GRACE_MS）供重连，不受 ROOM_IDLE_MS 影响（lastActiveAt 仅记 WAITING 活动）。 */
  sweep() {
    for (const room of [...this.rooms.values()]) {
      const state = this.roomStateOf(room)
      const alive = room.members.some((m) => (m.connected || m.isAI) && !m.gone)
      if (state !== 'WAITING') {
        const allGone = room.members.length > 0 && room.members.every((m) => m.gone)
        if (allGone) this.destroyRoom(room.roomId)
        continue
      }
      if (!alive) {
        this.destroyRoom(room.roomId)
        continue
      }
      // WAITING 且仍有人在线：长时间无活动（无人进出/无准备等状态变更）视为弃置房
      if (this.now() - (room.lastActiveAt ?? room.createdAt) >= ROOM_IDLE_MS) {
        this.destroyRoom(room.roomId)
      }
    }
  }

  // ---------- 结算继续 ----------

  /** 结算后点继续：全员确认（或 5s 超时）后不开新局，而是重置回 WAITING 房间——
   *  所有人跳回房间页、默认已准备，由房主点「开始游戏」开下一局。
   *  AI 成员移除（开局时 fillWithAI 会重新补位）、掉线真人按 WAITING 规则立即移除（不保留宽限） */
  settleContinue(room, me) {
    if (!room.game || room.game.state !== 'SETTLE') return { error: { code: 'BAD_STATE', message: '非结算阶段' } }
    room.settleAck.add(me.seat)
    const active = room.members.filter((m) => !m.gone && !m.isAI).length
    if (active === 0 || room.settleAck.size >= active) {
      this.finishSettle(room)
    } else if (!room.settleTimer) {
      room.settleTimer = setTimeout(() => this.finishSettle(room), 5000)
      room.timers.add(room.settleTimer)
    }
    return { ok: true }
  }

  /** 结算收尾：清空对局（派生状态回 WAITING）、真人默认已准备、清理 AI 与掉线成员，广播 room.state 驱动各端跳回房间页 */
  finishSettle(room) {
    if (room.settleTimer) {
      clearTimeout(room.settleTimer)
      room.timers.delete(room.settleTimer)
      room.settleTimer = null
    }
    if (!room.game || room.game.state !== 'SETTLE') return
    room.game = null
    room.settleAck = new Set()
    room.lastActiveAt = this.now()
    for (const m of [...room.members]) {
      if (m.isAI || !m.connected || m.gone) {
        if (m.graceTimer) { clearTimeout(m.graceTimer); m.graceTimer = null }
        this.tokens.delete(m.token)
        room.members = room.members.filter((x) => x !== m)
      }
    }
    if (room.members.length === 0) {
      this.destroyRoom(room.roomId)
      return
    }
    if (!room.members.some((m) => m.isHost)) this.promoteHost(room)
    for (const m of room.members) m.ready = true // 默认已准备：回房即可再开
    // 延迟推送：终局时 afterAction 有一个 1.2s 后的 revealKept 快照在途，立即广播 room.state
    // 可能先于它到达——客户端跳回房间页后又收到旧局 game.state，若恰好处于重连窗口会被
    // 旧局视图顶掉房间快照。等亮牌推送落地后再通知回房。
    const t = setTimeout(() => {
      room.timers.delete(t)
      if (this.rooms.get(room.roomId) !== room || room.game !== null) return
      this.pushRoomState(room)
    }, 1300)
    room.timers.add(t)
  }
}
