import type { PracticeEvent } from './session'
import { SESSION_FLUSH_INTERVAL_MS, SESSION_GAP_SECONDS, shouldContinueSession, summarizePracticeEvents } from './session'
import type { IPracticeSession, SessionEndedBy } from './types'
import { db } from '@/utils/db'

/**
 * 运行时会话记录器
 *
 * 触发方式：挂 Dexie 写入钩子（wordRecords / chapterRecords 的 creating），
 * 因此打字页、错题本、复习模式等所有会产生练习记录的入口都自动被覆盖，不需要改业务组件。
 *
 * 落库节奏：
 *   - 每 20 秒 flush 一次进行中的会话（endedBy = 'live'）
 *   - 5 分钟没有新事件 → 以 'idle' 结束
 *   - 页面隐藏/关闭 → 以 'hidden' / 'unload' 落库；5 分钟内回来继续练，仍算同一个会话
 *
 * 线程/并发：写库操作串行排队，会话对象每次新建（而不是共享可变全局），
 * 避免「上一个会话的快照被写进新会话的 id」这类竞态。
 */

type OpenSession = {
  events: PracticeEvent[]
  rowId?: number
  lastEventTime: number
  endedBy: SessionEndedBy
}

/** 只有「刚刚发生」的事件才计入实时会话：防止云同步批量导入历史记录时被当成当前练习 */
const EVENT_RECENCY_SECONDS = 10 * 60

let current: OpenSession | undefined
let started = false
let flushTimer: number | undefined
let idleTimer: number | undefined
let writeChain: Promise<void> = Promise.resolve()

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(task).catch((error) => {
    console.error('[practice] 写入学习会话失败', error)
  })
  return writeChain
}

function writeSession(session: OpenSession, reason: SessionEndedBy): Promise<void> {
  return enqueueWrite(async () => {
    if (session.events.length === 0) return
    const record: IPracticeSession = {
      ...summarizePracticeEvents(session.events),
      endedBy: reason,
    }
    try {
      if (session.rowId === undefined) {
        const id = await db.practiceSessions.add(record)
        if (typeof id === 'number') session.rowId = id
      } else {
        await db.practiceSessions.update(session.rowId, record)
      }
    } catch (error) {
      console.error('[practice] 保存学习会话失败', error)
    }
  })
}

/** 把当前会话落库（不结束会话：之后的事件会继续更新同一条记录） */
export function flushPracticeSession(reason: SessionEndedBy = 'live'): Promise<void> {
  if (!current || current.events.length === 0) return writeChain
  const session = current
  return writeSession(session, reason)
}

/** 结束当前会话（下一次练习会开新会话） */
export function closePracticeSession(reason: SessionEndedBy): Promise<void> {
  const session = current
  current = undefined
  if (!session || session.events.length === 0) return writeChain
  return writeSession(session, reason)
}

function recordPracticeEvent(event: PracticeEvent) {
  const now = nowSeconds()
  if (Math.abs(now - event.timeStamp) > EVENT_RECENCY_SECONDS) return

  if (current && !shouldContinueSession(current.lastEventTime, event.timeStamp)) {
    // 间隔超过 5 分钟：上一个会话先落库，再开新会话
    const previous = current
    current = undefined
    void writeSession(previous, previous.endedBy === 'live' ? 'idle' : previous.endedBy)
  }

  if (!current) {
    current = { events: [], lastEventTime: event.timeStamp, endedBy: 'live' }
  }

  current.events.push(event)
  current.lastEventTime = Math.max(current.lastEventTime, event.timeStamp)
  current.endedBy = 'live'
}

function checkIdle() {
  if (!current || current.events.length === 0) return
  if (nowSeconds() - current.lastEventTime > SESSION_GAP_SECONDS) {
    void closePracticeSession('idle')
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    // 结束后台会话；5 分钟内回来继续练时会续在同一个会话上（见 recordPracticeEvent）
    void flushPracticeSession('hidden')
  }
}

function handlePageHide() {
  void flushPracticeSession('unload')
}

/**
 * 启动记录器。必须在历史回填之后调用，避免回填数据和实时会话互相穿插。
 */
export function startPracticeSessionRecorder() {
  if (started) return
  started = true

  db.wordRecords.hook('creating', (_primaryKey, object) => {
    const record = object as {
      timeStamp?: number
      word?: string
      dict?: string
      chapter?: number | null
      wrongCount?: number
      timing?: number[]
    }
    if (typeof record?.timeStamp !== 'number') return
    recordPracticeEvent({
      timeStamp: record.timeStamp,
      kind: 'word',
      dict: record.dict ?? '',
      chapter: record.chapter ?? null,
      word: record.word ?? '',
      // timing 是「首字母到末字母」的间隔数组，正确按键数 = timing.length + 1
      correctCount: Array.isArray(record.timing) ? record.timing.length + 1 : 0,
      wrongCount: record.wrongCount ?? 0,
    })
  })

  db.chapterRecords.hook('creating', (_primaryKey, object) => {
    const record = object as {
      timeStamp?: number
      dict?: string
      chapter?: number | null
      correctCount?: number
      wrongCount?: number
    }
    if (typeof record?.timeStamp !== 'number') return
    recordPracticeEvent({
      timeStamp: record.timeStamp,
      kind: 'chapter',
      dict: record.dict ?? '',
      chapter: record.chapter ?? null,
      correctCount: record.correctCount ?? 0,
      wrongCount: record.wrongCount ?? 0,
    })
  })

  flushTimer = window.setInterval(() => {
    void flushPracticeSession('live')
  }, SESSION_FLUSH_INTERVAL_MS)

  idleTimer = window.setInterval(() => {
    checkIdle()
  }, 5 * 1000)

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('pagehide', handlePageHide)
}

export function stopPracticeSessionRecorder() {
  if (!started) return
  started = false
  if (flushTimer !== undefined) window.clearInterval(flushTimer)
  if (idleTimer !== undefined) window.clearInterval(idleTimer)
  flushTimer = undefined
  idleTimer = undefined
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('pagehide', handlePageHide)
  void flushPracticeSession('live')
}

/** 调试用：查看内存里进行中的会话（线上排查/自动化测试取证） */
export function getPracticeRecorderState() {
  if (!current) return { hasSession: false, events: 0, rowId: undefined as number | undefined }
  return {
    hasSession: true,
    events: current.events.length,
    rowId: current.rowId,
    summary: summarizePracticeEvents(current.events),
  }
}
