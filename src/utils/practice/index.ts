import { ensurePracticeSessionHistory } from './backfill'
import { startPracticeSessionRecorder } from './recorder'
import type { IPracticeSession } from './types'
import { db } from '@/utils/db'

/**
 * 学习记录（会话 + 时长统计）对外入口
 *
 * - 数据表：`practiceSessions`（RecordDB v4），随云同步整库备份/并集合并
 * - 回填：`ensurePracticeSessionHistory()`（幂等）
 * - 实时记录器：`startPracticeSessionRecorder()`（挂 Dexie 写入钩子，每 20 秒 flush）
 * - 统计：`computePracticeOverview` / `groupSessionsByDay` / `getRecentDayStats`
 */

export * from './types'
export * from './session'
export * from './stats'
export { ensurePracticeSessionHistory, backfillPracticeSessionsFromHistory, collectHistoryPracticeEvents } from './backfill'
export {
  flushPracticeSession,
  closePracticeSession,
  getPracticeRecorderState,
  startPracticeSessionRecorder,
  stopPracticeSessionRecorder,
} from './recorder'

/** 读取全部会话（按开始时间升序） */
export async function loadPracticeSessions(): Promise<IPracticeSession[]> {
  return db.practiceSessions.orderBy('startTime').toArray()
}

/** 会话条数 */
export async function countPracticeSessions(): Promise<number> {
  return db.practiceSessions.count()
}

/**
 * 应用启动时调用：先重建历史会话，再启动实时记录器。
 * 顺序很重要：记录器会挂 Dexie 写入钩子，先回填可以避免历史记录被当成"正在发生的练习"。
 */
export async function initPracticeSessions(): Promise<number> {
  const created = await ensurePracticeSessionHistory()
  startPracticeSessionRecorder()
  return created
}
