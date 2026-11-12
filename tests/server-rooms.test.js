import { describe, it, expect, beforeEach } from 'vitest'
import { RoomManager } from '../server/rooms.js'

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
    expect(m0).toMatchObject({ seat: 0, name: '甲', isHost: true })
  })

  it('setReady 对局中被拒（ROOM_STARTED）', () => {
    const { room, token } = mgr.createRoom(conn('甲'), '甲')
    room.state = 'PLAYING' // 模拟对局已开始
    const res = mgr.setReady(token, room.roomId, true)
    expect(res.error).toMatchObject({ code: 'ROOM_STARTED' })
  })
})
