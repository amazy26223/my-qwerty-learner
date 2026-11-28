import Loading from './components/Loading'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import { initCloudSyncOnFocus, initCloudSyncOnStartup } from '@/utils/cloud-sync'
import { getDeployBasePath } from '@/utils/deployBase'
import { initPracticeSessions } from '@/utils/practice'
import { Analytics } from '@vercel/analytics/react'
import 'animate.css'
import { useAtomValue } from 'jotai'
import mixpanel from 'mixpanel-browser'
import process from 'process'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

const AnalysisPage = lazy(() => import('./pages/Analysis'))
const GalleryPage = lazy(() => import('./pages/Gallery-N'))
const RecordsPage = lazy(() => import('./pages/Records'))

if (process.env.NODE_ENV === 'production') {
  // for prod
  mixpanel.init('bdc492847e9340eeebd53cc35f321691')
} else {
  // for dev
  mixpanel.init('5474177127e4767124c123b2d7846e2a', { debug: true })
}

function Root() {
  const darkMode = useAtomValue(isOpenDarkModeAtom)
  useEffect(() => {
    darkMode ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')
  }, [darkMode])

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600)

  useEffect(() => {
    const handleResize = () => {
      // Routes already switch on this flag. Reloading here drops the
      // current practice and, on GitHub Pages, leaves the basename.
      setIsMobile(window.innerWidth <= 600)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    // 学习记录: 先用已有的 wordRecords/chapterRecords 重建历史会话(只读原始记录),
    // 再启动实时记录器。顺序很重要——回填必须早于记录器挂上 Dexie 写入钩子。
    // 完成后再启动云同步, 避免整库导入和回填抢同一批表 (导入会 clearTablesBeforeImport)。
    initPracticeSessions()
      .catch(() => undefined)
      .finally(() => {
        // 云同步: 启动时后台拉取云端较新的数据 (可在 设置 → 数据 中配置/关闭)
        initCloudSyncOnStartup()
        // 云同步: 切回页面时自动检查云端更新 (别的设备练完上传后, 这台电脑无需手动刷新)
        initCloudSyncOnFocus()
      })
  }, [])

  // GitHub Pages 部署时按实际访问路径推导路由 basename (上游写死了官方站仓库名)
  const pagesBaseName = getDeployBasePath()

  return (
    <React.StrictMode>
      <BrowserRouter basename={pagesBaseName}>
        <Suspense fallback={<Loading />}>
          <Routes>
            {isMobile ? (
              <Route path="/*" element={<Navigate to="/mobile" replace />} />
            ) : (
              <>
                <Route index element={<TypingPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/records" element={<RecordsPage />} />
                <Route path="/error-book" element={<ErrorBook />} />
                <Route path="/friend-links" element={<FriendLinks />} />
                <Route path="/*" element={<Navigate to="/" />} />
              </>
            )}
            <Route path="/mobile" element={isMobile ? <MobilePage /> : <Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      {/* Vercel 统计脚本仅存在于 Vercel 部署上, GitHub Pages 下请求会 404, 故按部署环境关闭 */}
      {REACT_APP_DEPLOY_ENV !== 'pages' && <Analytics />}
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

container && createRoot(container).render(<Root />)
