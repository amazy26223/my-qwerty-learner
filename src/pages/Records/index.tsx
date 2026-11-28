import ActivityChart from './components/ActivityChart'
import OverviewCards from './components/OverviewCards'
import SessionList from './components/SessionList'
import Layout from '@/components/Layout'
import { db } from '@/utils/db'
import type { IPracticeSession } from '@/utils/practice'
import { computePracticeOverview, ensurePracticeSessionHistory, getRecentDayStats, groupSessionsByDay } from '@/utils/practice'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation, useNavigate } from 'react-router-dom'
import IconFlame from '~icons/tabler/flame'
import IconX from '~icons/tabler/x'

/**
 * 连续学习徽章
 * streakDays > 0 时用 indigo 醒目样式；为 0 时退化为灰色文案（仍然渲染，避免标题行高度抖动）
 */
function StreakBadge({ streakDays }: { streakDays: number }) {
  const days = Math.max(0, streakDays || 0)

  if (days <= 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-200/70 px-3 py-1 text-sm text-gray-400 dark:bg-gray-700/60 dark:text-gray-500">
        连续学习 0 天
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-3 py-1 text-sm font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-500/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30">
      <IconFlame className="h-4 w-4" />
      连续学习 {days} 天
    </span>
  )
}

/** 没有任何会话时的空状态 */
function RecordsEmptyState() {
  return (
    <div className="mt-8 grid h-80 w-full place-content-center rounded-lg bg-white px-8 text-center shadow-lg dark:bg-gray-700 dark:bg-opacity-50">
      <p className="text-2xl text-gray-400 dark:text-gray-300">暂无学习记录</p>
      <p className="mt-3 text-sm text-gray-400 dark:text-gray-400">开始一次练习后，这里会自动生成学习会话</p>
    </div>
  )
}

const Records = () => {
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * 返回打字页：
   * - 从打字页工具栏点进来的（带了 state 标记）→ 直接用浏览器历史回退（navigate(-1)），
   *   不再往历史里追加一条 '/'，避免"关掉记录页后按后退/关闭又落回 /records"的错觉
   * - 直接输地址/刷新/收藏进来的 → 没有可回退的站内历史，回到首页
   */
  const onBack = useCallback(() => {
    const fromEntry = (location.state as { fromRecordsEntry?: boolean } | null)?.fromRecordsEntry === true
    if (fromEntry && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }, [location.state, navigate])

  useHotkeys('enter,esc', onBack, { preventDefault: true })

  // 页面挂载时做一次幂等历史回填（别处已回填过会立即返回 0），保证第一次进入也有数据可看
  useEffect(() => {
    void ensurePracticeSessionHistory()
  }, [])

  // 实时订阅会话表：练习过程中记录器会周期性 flush，列表与统计随之自动刷新
  const sessions = useLiveQuery(() => db.practiceSessions.orderBy('startTime').toArray(), [], undefined as IPracticeSession[] | undefined)

  const overview = useMemo(() => computePracticeOverview(sessions ?? []), [sessions])
  const recentDayStats = useMemo(() => getRecentDayStats(sessions ?? [], 14), [sessions])
  const dayGroups = useMemo(() => groupSessionsByDay(sessions ?? []), [sessions])

  return (
    <Layout>
      {/* 外层撑满一屏：Header 固定、内容区内部滚动、Footer 由 Layout 负责贴底 */}
      <div className="relative flex h-screen min-h-0 w-full flex-col items-center pb-4">
        <div className="flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-8 md:px-8">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="text-2xl font-bold text-gray-700 dark:text-gray-100 md:text-3xl">学习记录</h1>
            <StreakBadge streakDays={overview.streakDays} />
          </div>
          <IconX
            className="mt-1 h-7 w-7 shrink-0 cursor-pointer text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
            onClick={onBack}
          />
        </div>

        <ScrollArea.Root className="mt-6 w-full max-w-5xl flex-1 overflow-hidden px-4 md:px-8">
          <ScrollArea.Viewport className="h-full w-full pb-[20rem] [&>div]:!block">
            {sessions === undefined && (
              <div className="mt-8 grid h-40 w-full place-content-center rounded-lg bg-white text-sm text-gray-400 shadow-lg dark:bg-gray-700 dark:bg-opacity-50 dark:text-gray-300">
                加载中…
              </div>
            )}

            {sessions !== undefined && sessions.length === 0 && <RecordsEmptyState />}

            {sessions !== undefined && sessions.length > 0 && (
              <div className="flex flex-col gap-4 md:gap-6">
                <OverviewCards overview={overview} />
                <ActivityChart days={recentDayStats} />
                <SessionList groups={dayGroups} />
              </div>
            )}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="flex w-2 touch-none select-none bg-transparent p-0.5" orientation="vertical">
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-gray-400/60 dark:bg-gray-400/50" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
    </Layout>
  )
}

export default Records
