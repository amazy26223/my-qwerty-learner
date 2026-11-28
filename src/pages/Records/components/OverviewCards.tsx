import type { PracticeOverview, PracticePeriodStats } from '@/utils/practice'
import { formatDurationText } from '@/utils/practice'

type OverviewKey = 'today' | 'week' | 'total'

const PERIODS: { key: OverviewKey; title: string }[] = [
  { key: 'today', title: '今日' },
  { key: 'week', title: '本周' },
  { key: 'total', title: '累计' },
]

/** 单张统计卡片：主数字是活跃时长，下面两行是词/章/会话与正确率/平均 WPM */
function StatCard({ title, stats }: { title: string; stats: PracticePeriodStats }) {
  // 所有数字都做 0 兜底，避免脏数据渲染出 NaN / undefined
  const activeSeconds = stats.activeSeconds || 0
  const wordCount = stats.wordCount || 0
  const chapterCount = stats.chapterCount || 0
  const sessionCount = stats.sessionCount || 0
  const accuracy = stats.accuracy || 0
  const avgWpm = stats.avgWpm || 0

  return (
    <div className="flex flex-col rounded-lg bg-white p-5 shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-300">{title}</span>
        <span className="text-xs text-gray-400 dark:text-gray-400">活跃时长</span>
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-gray-700 dark:text-gray-100">{formatDurationText(activeSeconds)}</div>
      <div className="mt-3 text-sm text-gray-500 dark:text-gray-300">
        {wordCount} 词 · {chapterCount} 章 · {sessionCount} 次会话
      </div>
      <div className="mt-1 text-sm text-gray-500 dark:text-gray-300">
        正确率 {accuracy}% · 平均 {avgWpm} WPM
      </div>
    </div>
  )
}

export default function OverviewCards({ overview }: { overview: PracticeOverview }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {PERIODS.map((period) => (
        <StatCard key={period.key} title={period.title} stats={overview[period.key]} />
      ))}
    </div>
  )
}
