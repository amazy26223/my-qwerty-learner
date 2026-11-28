/**
 * 学习记录（会话）的共享类型
 *
 * 一条 practiceSession 表示「一次连续练习」。切分规则、双口径时长都定义在
 * `./session.ts`，这里只放数据结构与常量。
 */

/** 会话的结束原因 */
export type SessionEndedBy =
  /** 5 分钟没有新的练习事件（idle 结束） */
  | 'idle'
  /** 页面被隐藏/切走标签页时结束 */
  | 'hidden'
  /** 关闭/刷新页面时结束 */
  | 'unload'
  /** 由历史记录回填出来的会话 */
  | 'backfill'
  /** 会话仍在进行中（每 20 秒 flush 到 IndexedDB 的中间态） */
  | 'live'

export interface IPracticeSession {
  id?: number
  /** 会话内第一条记录的时间（unix 秒） */
  startTime: number
  /** 会话内最后一条记录的时间（unix 秒） */
  endTime: number
  /** 活跃时长：Σ min(相邻记录间隔, 60s) */
  activeSeconds: number
  /** 总跨度：末条时间 − 首条时间 */
  totalSeconds: number
  /** 涉及章节数（去重） */
  chapterCount: number
  /** 练习词数（含重复） */
  wordCount: number
  /** 练习过的不同单词数 */
  uniqueWordCount: number
  /** 正确按键数 */
  correctCount: number
  /** 错误按键数 */
  wrongCount: number
  /** 涉及的词典 */
  dicts: string[]
  /** 涉及的章节编号（去重，不含 null） */
  chapters: number[]
  /** 平均速度：词/分钟（按活跃时长折算） */
  avgWpm: number
  /** 按键正确率，0~100 的整数 */
  accuracy: number
  endedBy: SessionEndedBy
}

export class PracticeSession implements IPracticeSession {
  id?: number
  startTime: number
  endTime: number
  activeSeconds: number
  totalSeconds: number
  chapterCount: number
  wordCount: number
  uniqueWordCount: number
  correctCount: number
  wrongCount: number
  dicts: string[]
  chapters: number[]
  avgWpm: number
  accuracy: number
  endedBy: SessionEndedBy

  constructor(session: IPracticeSession) {
    this.startTime = session.startTime
    this.endTime = session.endTime
    this.activeSeconds = session.activeSeconds
    this.totalSeconds = session.totalSeconds
    this.chapterCount = session.chapterCount
    this.wordCount = session.wordCount
    this.uniqueWordCount = session.uniqueWordCount
    this.correctCount = session.correctCount
    this.wrongCount = session.wrongCount
    this.dicts = session.dicts
    this.chapters = session.chapters
    this.avgWpm = session.avgWpm
    this.accuracy = session.accuracy
    this.endedBy = session.endedBy
  }

  /** 时长文案，列表里直接展示 */
  get durationText() {
    return formatDurationText(this.activeSeconds)
  }
}

/** 秒数 → 「1 小时 23 分」/「12 分 30 秒」/「8 秒」 */
export function formatDurationText(seconds: number) {
  const total = Math.max(0, Math.round(seconds || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes > 0) return secs > 0 ? `${minutes} 分 ${secs} 秒` : `${minutes} 分`
  return `${secs} 秒`
}
