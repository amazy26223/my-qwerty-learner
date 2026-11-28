import SessionRow from './SessionRow'
import type { SessionDayGroup } from '@/utils/practice'
import { formatDurationText } from '@/utils/practice'

export default function SessionList({ groups }: { groups: SessionDayGroup[] }) {
  const totalSessions = groups.reduce((sum, group) => sum + (group.sessions?.length || 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-base font-semibold text-gray-700 dark:text-gray-100">会话列表</h2>
        <span className="text-xs text-gray-400 dark:text-gray-400">
          {groups.length} 天 · 共 {totalSessions} 次会话
        </span>
      </div>

      {groups.map((group) => (
        <section key={group.day} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-100">{group.label}</h3>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              活跃 {formatDurationText(group.stats.activeSeconds || 0)} · {group.stats.sessionCount || 0} 次会话 ·{' '}
              {group.stats.wordCount || 0} 词
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {group.sessions.map((session) => (
              <SessionRow key={session.id ?? `${session.startTime}-${session.endTime}`} session={session} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
