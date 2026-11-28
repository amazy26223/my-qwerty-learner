import type { IPracticeSession } from './types'
import dayjs from 'dayjs'

/**
 * 学习记录的聚合统计（纯函数，无浏览器依赖）
 *
 * 时间口径：数据库里的 timeStamp 是普通 unix 秒（`getUTCUnixTimestamp()` 等价于 `Date.now()/1000`），
 * 所以「哪一天」一律按本地时区算（和 Analysis 页 `dayjs(timeStamp * 1000).format('YYYY-MM-DD')` 一致）。
 */

export type PracticePeriodStats = {
  /** 会话数 */
  sessionCount: number
  /** 活跃时长（Σ 各会话 activeSeconds） */
  activeSeconds: number
  /** 总跨度（Σ 各会话 totalSeconds） */
  totalSeconds: number
  wordCount: number
  /** 各会话去重词数之和（跨会话可能重复计数，展示时优先用 wordCount） */
  uniqueWordCount: number
  chapterCount: number
  correctCount: number
  wrongCount: number
  /** 词/分钟，按活跃时长折算 */
  avgWpm: number
  /** 按键正确率，0~100 整数 */
  accuracy: number
  dicts: string[]
}

export const EMPTY_PERIOD_STATS: PracticePeriodStats = {
  sessionCount: 0,
  activeSeconds: 0,
  totalSeconds: 0,
  wordCount: 0,
  uniqueWordCount: 0,
  chapterCount: 0,
  correctCount: 0,
  wrongCount: 0,
  avgWpm: 0,
  accuracy: 0,
  dicts: [],
}

export function summarizeSessions(sessions: IPracticeSession[]): PracticePeriodStats {
  if (sessions.length === 0) return { ...EMPTY_PERIOD_STATS }

  let activeSeconds = 0
  let totalSeconds = 0
  let wordCount = 0
  let uniqueWordCount = 0
  let chapterFallback = 0
  let correctCount = 0
  let wrongCount = 0
  const dicts = new Set<string>()
  // 章节数按「去重后的章节」计数：同一个章节跨两次会话练习时不会重复计入累计
  const chapters = new Set<number>()

  for (const session of sessions) {
    activeSeconds += session.activeSeconds || 0
    totalSeconds += session.totalSeconds || 0
    wordCount += session.wordCount || 0
    uniqueWordCount += session.uniqueWordCount || 0
    chapterFallback += session.chapterCount || 0
    correctCount += session.correctCount || 0
    wrongCount += session.wrongCount || 0
    for (const chapter of session.chapters || []) chapters.add(chapter)
    for (const dict of session.dicts || []) dicts.add(dict)
  }

  const totalKeyCount = correctCount + wrongCount
  return {
    sessionCount: sessions.length,
    activeSeconds,
    totalSeconds,
    wordCount,
    uniqueWordCount,
    chapterCount: chapters.size > 0 ? chapters.size : chapterFallback,
    correctCount,
    wrongCount,
    avgWpm: activeSeconds > 0 ? Math.round((wordCount / activeSeconds) * 60) : 0,
    accuracy: totalKeyCount > 0 ? Math.round((correctCount / totalKeyCount) * 100) : 0,
    dicts: Array.from(dicts).sort(),
  }
}

/** unix 秒 → 本地日期键 YYYY-MM-DD */
export function sessionDayKey(timeStamp: number): string {
  return dayjs(timeStamp * 1000).format('YYYY-MM-DD')
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 日期键 → 展示用标签：今天/昨天/「11-28 周五」
 * 标签里的星期按本地时区解析该日期生成，不依赖「今天是几号」
 */
export function formatDayLabel(dayKey: string, todayKey?: string): string {
  const today = todayKey ?? dayjs().format('YYYY-MM-DD')
  if (dayKey === today) return '今天'
  if (dayKey === dayjs(today).subtract(1, 'day').format('YYYY-MM-DD')) return '昨天'
  const date = dayjs(dayKey)
  if (!date.isValid()) return dayKey
  return `${date.format('MM-DD')} ${WEEKDAY_LABELS[date.day()]}`
}

/** unix 秒 → 本地 HH:mm */
export function formatClockTime(timeStamp: number): string {
  return dayjs(timeStamp * 1000).format('HH:mm')
}

export type SessionDayGroup = {
  /** YYYY-MM-DD */
  day: string
  label: string
  sessions: IPracticeSession[]
  stats: PracticePeriodStats
}

/** 按天分组，新的在前；组内会话按开始时间倒序 */
export function groupSessionsByDay(sessions: IPracticeSession[], todayKey?: string): SessionDayGroup[] {
  const buckets = new Map<string, IPracticeSession[]>()
  for (const session of sessions) {
    const day = sessionDayKey(session.startTime)
    const bucket = buckets.get(day)
    if (bucket) bucket.push(session)
    else buckets.set(day, [session])
  }

  return Array.from(buckets.keys())
    .sort((a, b) => (a < b ? 1 : -1))
    .map((day) => {
      const list = (buckets.get(day) ?? []).slice().sort((a, b) => b.startTime - a.startTime)
      return { day, label: formatDayLabel(day, todayKey), sessions: list, stats: summarizeSessions(list) }
    })
}

export type DailyActiveStats = {
  day: string
  /** MM-DD */
  shortLabel: string
  weekday: string
  activeSeconds: number
  sessionCount: number
  wordCount: number
}

/** 最近 N 天（含今天）的每日活跃时长，升序，没有练习的日子补 0 —— 柱状图数据源 */
export function getRecentDayStats(sessions: IPracticeSession[], days = 14, now: number = Date.now()): DailyActiveStats[] {
  const today = dayjs(now).startOf('day')
  const byDay = new Map<string, DailyActiveStats>()

  for (let i = days - 1; i >= 0; i--) {
    const date = today.subtract(i, 'day')
    const day = date.format('YYYY-MM-DD')
    byDay.set(day, {
      day,
      shortLabel: date.format('MM-DD'),
      weekday: WEEKDAY_LABELS[date.day()],
      activeSeconds: 0,
      sessionCount: 0,
      wordCount: 0,
    })
  }

  for (const session of sessions) {
    const entry = byDay.get(sessionDayKey(session.startTime))
    if (!entry) continue
    entry.activeSeconds += session.activeSeconds || 0
    entry.sessionCount += 1
    entry.wordCount += session.wordCount || 0
  }

  return Array.from(byDay.values())
}

/** 连续学习天数：从今天（今天没练则从昨天）往前数连续有记录的天数 */
export function calculateStreakDays(sessions: IPracticeSession[], now: number = Date.now()): number {
  if (sessions.length === 0) return 0
  const days = new Set(sessions.map((session) => sessionDayKey(session.startTime)))
  const today = dayjs(now).startOf('day')
  let cursor = today
  if (!days.has(today.format('YYYY-MM-DD'))) {
    cursor = today.subtract(1, 'day')
    if (!days.has(cursor.format('YYYY-MM-DD'))) return 0
  }

  let streak = 0
  while (days.has(cursor.format('YYYY-MM-DD'))) {
    streak += 1
    cursor = cursor.subtract(1, 'day')
  }
  return streak
}

export type PracticeOverview = {
  today: PracticePeriodStats
  week: PracticePeriodStats
  total: PracticePeriodStats
  /** 连续学习天数 */
  streakDays: number
}

/** 本周从周一 00:00 算起 */
export function weekStartTime(now: number = Date.now()): number {
  const today = dayjs(now).startOf('day')
  const offset = (today.day() + 6) % 7
  return today.subtract(offset, 'day').unix()
}

export function computePracticeOverview(sessions: IPracticeSession[], now: number = Date.now()): PracticeOverview {
  const todayStart = dayjs(now).startOf('day').unix()
  const weekStart = weekStartTime(now)
  const sorted = sessions.slice().sort((a, b) => a.startTime - b.startTime)

  return {
    // 只按「起点落在区间内」筛选, 不再加「不能晚于现在」的上限:
    // 设备时钟偏差/时区问题时, 否则会出现「会话列表里今天有记录, 今日卡片却是 0」的矛盾
    today: summarizeSessions(sorted.filter((session) => session.startTime >= todayStart)),
    week: summarizeSessions(sorted.filter((session) => session.startTime >= weekStart)),
    total: summarizeSessions(sorted),
    streakDays: calculateStreakDays(sorted, now),
  }
}
