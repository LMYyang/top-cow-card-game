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
})
