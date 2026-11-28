import type { PracticeEvent } from './session'
import { buildPracticeSessions } from './session'
import { db } from '@/utils/db'

/**
 * 历史回填：用已有的 wordRecords / chapterRecords 的 timeStamp 一次性重建历史会话
 *
 * - 只读原始记录，不改动 wordRecords / chapterRecords（云同步、错题本都依赖它们）
 * - 幂等：practiceSessions 里已经有数据就直接跳过；表被清空（例如云端旧备份覆盖）后会自愈重建
 * - 与运行时记录器的顺序：先回填、再启动记录器（见 src/index.tsx），避免历史数据和实时会话穿插
 */

let inflight: Promise<number> | undefined

/** 把历史记录转成会话事件（wordRecords 一条词、chapterRecords 一章） */
export async function collectHistoryPracticeEvents(): Promise<PracticeEvent[]> {
  const [wordRecords, chapterRecords] = await Promise.all([db.wordRecords.toArray(), db.chapterRecords.toArray()])
  const events: PracticeEvent[] = []

  for (const record of wordRecords) {
    if (typeof record?.timeStamp !== 'number') continue
    events.push({
      timeStamp: record.timeStamp,
      kind: 'word',
      dict: record.dict ?? '',
      chapter: typeof record.chapter === 'number' ? record.chapter : null,
      word: record.word ?? '',
      // timing 是相邻正确按键的间隔数组，正确按键数 = timing.length + 1
      correctCount: Array.isArray(record.timing) ? record.timing.length + 1 : 0,
      wrongCount: record.wrongCount ?? 0,
    })
  }

  for (const record of chapterRecords) {
    if (typeof record?.timeStamp !== 'number') continue
    events.push({
      timeStamp: record.timeStamp,
      kind: 'chapter',
      dict: record.dict ?? '',
      chapter: typeof record.chapter === 'number' ? record.chapter : null,
      correctCount: record.correctCount ?? 0,
      wrongCount: record.wrongCount ?? 0,
    })
  }

  return events
}

/** 执行一次回填，返回新建的会话条数（已有数据时返回 0） */
export async function backfillPracticeSessionsFromHistory(): Promise<number> {
  const existing = await db.practiceSessions.count()
  if (existing > 0) return 0

  const events = await collectHistoryPracticeEvents()
  if (events.length === 0) return 0

  const sessions = buildPracticeSessions(events, 'backfill')
  if (sessions.length === 0) return 0

  await db.practiceSessions.bulkAdd(sessions)
  return sessions.length
}

/** 幂等入口：并发调用只会真正跑一次（跑完自动释放，便于清空后自愈） */
export function ensurePracticeSessionHistory(): Promise<number> {
  if (inflight) return inflight
  inflight = backfillPracticeSessionsFromHistory()
    .catch((error) => {
      console.error('[practice] 历史学习记录回填失败', error)
      return 0
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}
