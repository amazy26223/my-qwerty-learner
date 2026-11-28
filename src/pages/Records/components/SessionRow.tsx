import type { IPracticeSession, SessionEndedBy } from '@/utils/practice'
import { formatClockTime, formatDurationText } from '@/utils/practice'

type EndedByMeta = {
  label: string
  className: string
  /** live 会话额外显示一个绿色脉冲点 */
  pulse?: boolean
}

/** 结束原因 → 中文小标签（数据层 SessionEndedBy 的 5 种取值，全部覆盖） */
const ENDED_BY_META: Record<SessionEndedBy, EndedByMeta> = {
  live: {
    label: '进行中',
    className: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300',
    pulse: true,
  },
  idle: {
    label: '空闲结束',
    className: 'bg-gray-500/10 text-gray-500 dark:bg-gray-400/10 dark:text-gray-300',
  },
  hidden: {
    label: '切走结束',
    className: 'bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300',
  },
  unload: {
    label: '关页结束',
    className: 'bg-rose-500/10 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300',
  },
  backfill: {
    label: '历史重建',
    className: 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300',
  },
}

/** 旧数据/云同步可能带来未知的 endedBy，兜底成一个中性标签 */
const FALLBACK_META: EndedByMeta = {
  label: '已结束',
  className: 'bg-gray-500/10 text-gray-500 dark:bg-gray-400/10 dark:text-gray-300',
}

/** 会话结束标签 */
function EndedByTag({ endedBy }: { endedBy: SessionEndedBy }) {
  const meta = ENDED_BY_META[endedBy] ?? FALLBACK_META

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${meta.className}`}>
      {meta.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {meta.label}
    </span>
  )
}

export default function SessionRow({ session }: { session: IPracticeSession }) {
  // 所有数字都做 0 兜底，避免历史/云端脏数据渲染出 NaN
  const wordCount = session.wordCount || 0
  const chapterCount = session.chapterCount || 0
  const accuracy = Math.min(100, Math.max(0, Math.round(session.accuracy || 0)))
  const avgWpm = Math.max(0, Math.round(session.avgWpm || 0))
  const activeSeconds = Math.max(0, session.activeSeconds || 0)
  const dicts = (session.dicts || []).filter((dict) => dict.length > 0)

  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-lg transition-shadow hover:shadow-xl dark:bg-gray-700 dark:bg-opacity-50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-base font-medium text-gray-700 dark:text-gray-100">
            {formatClockTime(session.startTime)} – {formatClockTime(session.endTime)}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-300">活跃 {formatDurationText(activeSeconds)}</span>
        </div>
        <EndedByTag endedBy={session.endedBy} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-300">
        <span>{wordCount} 词</span>
        <span>{chapterCount} 章</span>
        <span>正确率 {accuracy}%</span>
        <span>{avgWpm} WPM</span>
        {dicts.length > 0 && <span className="min-w-0 max-w-full truncate">{dicts.join(' / ')}</span>}
      </div>
    </div>
  )
}
