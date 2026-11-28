import type { DailyActiveStats } from '@/utils/practice'
import { formatDurationText } from '@/utils/practice'

/** 单根柱子：高度按「当天活跃时长 / 14 天最大活跃时长」换算成百分比 */
function ActivityBar({ day, maxActiveSeconds, isToday }: { day: DailyActiveStats; maxActiveSeconds: number; isToday: boolean }) {
  const activeSeconds = Math.max(0, day.activeSeconds || 0)
  const sessionCount = day.sessionCount || 0
  const wordCount = day.wordCount || 0

  // 高度换算：max 为 0 时（近 14 天都没数据）统一退化为最小高度，杜绝除零 / NaN；
  // 有数据的日子至少 6%，否则极小的值会矮到看不见
  const percent = maxActiveSeconds > 0 ? Math.max((activeSeconds / maxActiveSeconds) * 100, activeSeconds > 0 ? 6 : 2) : 2
  // 柱子顶部的分钟数（不足 1 分钟不显示，具体时长看 title）
  const minutes = Math.round(activeSeconds / 60)

  const barClassName = isToday
    ? 'bg-gradient-to-t from-indigo-600 to-indigo-400 dark:from-indigo-400 dark:to-indigo-300'
    : activeSeconds > 0
    ? 'bg-gradient-to-t from-indigo-400 to-indigo-300 dark:from-indigo-600 dark:to-indigo-500'
    : 'bg-gray-200 dark:bg-gray-600'

  // 悬停提示：MM-DD 周X：活跃 X 分 Y 秒 · N 个会话 · M 词
  const tooltip = `${day.shortLabel} ${day.weekday}：活跃 ${formatDurationText(activeSeconds)} · ${sessionCount} 个会话 · ${wordCount} 词`

  return (
    <div className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={tooltip}>
      {/* 柱状图总高度固定 h-40，柱子用 items-end 贴底；百分比高度相对这一层换算 */}
      <div className="flex h-40 w-full flex-col items-center justify-end gap-1">
        <span className="h-3 text-[10px] leading-3 text-gray-400 dark:text-gray-400">{minutes > 0 ? minutes : ''}</span>
        <div className="flex w-full flex-1 items-end justify-center">
          <div
            className={`w-full max-w-[18px] rounded-t-md transition-all duration-300 group-hover:opacity-80 ${barClassName}`}
            style={{ height: `${percent}%` }}
          />
        </div>
      </div>
      <span
        className={`truncate text-[10px] leading-4 ${
          isToday ? 'font-bold text-indigo-500 dark:text-indigo-300' : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        {day.shortLabel}
      </span>
    </div>
  )
}

export default function ActivityChart({ days }: { days: DailyActiveStats[] }) {
  const maxActiveSeconds = days.reduce((max, day) => Math.max(max, day.activeSeconds || 0), 0)
  // getRecentDayStats 按升序返回且一定包含今天，所以最后一根就是今天
  const todayKey = days.length > 0 ? days[days.length - 1].day : ''

  return (
    <div className="rounded-lg bg-white p-5 shadow-lg dark:bg-gray-700 dark:bg-opacity-50 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-700 dark:text-gray-100">近 14 天活跃时长</h2>
        <span className="text-xs text-gray-400 dark:text-gray-400">柱上数字为分钟 · 悬停查看当天详情</span>
      </div>
      <div className="mt-5 flex gap-0.5 sm:gap-1.5">
        {days.map((day) => (
          <ActivityBar key={day.day} day={day} maxActiveSeconds={maxActiveSeconds} isToday={day.day === todayKey} />
        ))}
      </div>
    </div>
  )
}
