import type { IPracticeSession, SessionEndedBy } from './types'

/**
 * 学习会话的切分与统计规则（纯函数，无浏览器依赖）
 *
 * 规则（与 HANDOFF 中「A. 会话记录 + 时长统计」一致，改之前先看文档）：
 *   1. 相邻两条练习记录的间隔 > 5 分钟 → 断开成两个会话
 *   2. 双口径时长：
 *      - activeSeconds = Σ min(相邻间隔, 60s)   ← 「真正在打字的时间」，抑制挂机
 *      - totalSeconds  = 末条 − 首条            ← 「这次坐下来练了多久」
 *   3. 正确/错误按键口径：
 *      - 会话里有章节记录 → 用章节记录的 correctCount / wrongCount（按键级，最准）
 *      - 没有章节记录（练到一半） → 用词记录的字母数 / wrongCount 估算
 */

/** 相邻记录间隔超过这个值（秒）就断开成两个会话 */
export const SESSION_GAP_SECONDS = 5 * 60
/** 计算活跃时长时，单条间隔最多算 60 秒 */
export const ACTIVE_INTERVAL_CAP_SECONDS = 60
/** 运行时记录器把会话写入 IndexedDB 的间隔（毫秒） */
export const SESSION_FLUSH_INTERVAL_MS = 20 * 1000

export type PracticeEventKind = 'word' | 'chapter'

/** 一次「练习事件」：完成一个单词 或 完成一个章节 */
export interface PracticeEvent {
  timeStamp: number
  kind: PracticeEventKind
  dict: string
  /** 错题本/复习模式下为 null */
  chapter: number | null
  word?: string
  /** 本次事件里的正确按键数 */
  correctCount: number
  /** 本次事件里的错误次数 */
  wrongCount: number
}

export type SessionSummary = Omit<IPracticeSession, 'endedBy'>

const KIND_ORDER: Record<PracticeEventKind, number> = { word: 0, chapter: 1 }

/**
 * 排序 + 去重前的稳定顺序：先按时间，同一秒内词记录在前（章节记录是章节结束时才写的）
 */
export function sortPracticeEvents(events: PracticeEvent[]): PracticeEvent[] {
  return events.slice().sort((a, b) => a.timeStamp - b.timeStamp || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/** 按「间隔 > 5 分钟断开」把事件切成若干会话 */
export function splitPracticeEvents(events: PracticeEvent[], gapSeconds = SESSION_GAP_SECONDS): PracticeEvent[][] {
  const sorted = sortPracticeEvents(events)
  const groups: PracticeEvent[][] = []
  let current: PracticeEvent[] = []

  for (const event of sorted) {
    if (current.length > 0) {
      const previous = current[current.length - 1]
      if (event.timeStamp - previous.timeStamp > gapSeconds) {
        groups.push(current)
        current = []
      }
    }
    current.push(event)
  }
  if (current.length > 0) groups.push(current)

  return groups
}

/** 双口径时长里的「活跃时长」 */
export function computeActiveSeconds(events: PracticeEvent[], capSeconds = ACTIVE_INTERVAL_CAP_SECONDS): number {
  if (events.length < 2) return 0
  let active = 0
  for (let i = 1; i < events.length; i++) {
    active += Math.min(events[i].timeStamp - events[i - 1].timeStamp, capSeconds)
  }
  return active
}

/** 把一个会话内的事件汇总成一条会话记录（事件需已属于同一会话） */
export function summarizePracticeEvents(events: PracticeEvent[]): SessionSummary {
  const sorted = sortPracticeEvents(events)
  const wordEvents = sorted.filter((event) => event.kind === 'word')
  const chapterEvents = sorted.filter((event) => event.kind === 'chapter')

  const words = new Set<string>()
  const dicts = new Set<string>()
  const chapters = new Set<number>()

  for (const event of sorted) {
    if (event.dict) dicts.add(event.dict)
    if (event.chapter !== null && event.chapter !== undefined && event.chapter >= 0) chapters.add(event.chapter)
    if (event.kind === 'word' && event.word) words.add(event.word)
  }

  let correctCount = 0
  let wrongCount = 0
  if (chapterEvents.length > 0) {
    for (const event of chapterEvents) {
      correctCount += event.correctCount
      wrongCount += event.wrongCount
    }
  } else {
    for (const event of wordEvents) {
      correctCount += event.correctCount
      wrongCount += event.wrongCount
    }
  }

  const startTime = sorted[0].timeStamp
  const endTime = sorted[sorted.length - 1].timeStamp
  const activeSeconds = computeActiveSeconds(sorted)
  const wordCount = wordEvents.length
  const totalKeyCount = correctCount + wrongCount

  return {
    startTime,
    endTime,
    activeSeconds,
    totalSeconds: Math.max(0, endTime - startTime),
    chapterCount: chapters.size,
    wordCount,
    uniqueWordCount: words.size,
    correctCount,
    wrongCount,
    dicts: Array.from(dicts).sort(),
    chapters: Array.from(chapters).sort((a, b) => a - b),
    avgWpm: activeSeconds > 0 ? Math.round((wordCount / activeSeconds) * 60) : 0,
    accuracy: totalKeyCount > 0 ? Math.round((correctCount / totalKeyCount) * 100) : 0,
  }
}

/** 把事件整体重建为会话列表（历史回填用） */
export function buildPracticeSessions(events: PracticeEvent[], endedBy: SessionEndedBy = 'backfill'): IPracticeSession[] {
  return splitPracticeEvents(events).map((group) => ({ ...summarizePracticeEvents(group), endedBy }))
}

/** 判断同一个会话是否应该「续上」：新事件与上次事件的间隔不超过 5 分钟 */
export function shouldContinueSession(lastEventTime: number, nextEventTime: number, gapSeconds = SESSION_GAP_SECONDS) {
  return nextEventTime - lastEventTime <= gapSeconds
}
