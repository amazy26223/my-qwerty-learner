import styles from './index.module.css'
import type { CloudSyncConfig, SyncDirection, SyncResult } from '@/utils/cloud-sync'
import { syncNow } from '@/utils/cloud-sync'
import { DEFAULT_CLOUD_SYNC_CONFIG, getCloudSyncStateLastSyncedAt, loadCloudSyncConfig, saveCloudSyncConfig } from '@/utils/cloud-sync'
import type { ExportProgress, ImportProgress } from '@/utils/db/data-export'
import { exportDatabase, importDatabase } from '@/utils/db/data-export'
import * as Progress from '@radix-ui/react-progress'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { Switch } from '@headlessui/react'
import { useCallback, useEffect, useState } from 'react'

const inputClass =
  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm outline-none transition-colors focus:border-indigo-400 dark:border-neutral-600 dark:bg-gray-700 dark:text-neutral-200'

export default function DataSetting() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)

  // ---- 云端同步 ----
  const [cloudConfig, setCloudConfig] = useState<CloudSyncConfig>(DEFAULT_CLOUD_SYNC_CONFIG)
  const [cloudSaveMessage, setCloudSaveMessage] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>(undefined)

  useEffect(() => {
    setCloudConfig(loadCloudSyncConfig())
    setLastSyncedAt(getCloudSyncStateLastSyncedAt())
  }, [])

  const updateCloudConfig = useCallback((patch: Partial<CloudSyncConfig>) => {
    setCloudConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  const onToggleCloudEnabled = useCallback(
    (checked: boolean) => {
      const next = { ...cloudConfig, enabled: checked }
      setCloudConfig(next)
      saveCloudSyncConfig(next)
      setCloudSaveMessage(checked ? '已开启云端同步（记得保存下方配置）' : '已关闭云端同步')
    },
    [cloudConfig],
  )

  const onToggleAutoUpload = useCallback(
    (checked: boolean) => {
      const next = { ...cloudConfig, autoUpload: checked }
      setCloudConfig(next)
      saveCloudSyncConfig(next)
    },
    [cloudConfig],
  )

  const onToggleAutoDownload = useCallback(
    (checked: boolean) => {
      const next = { ...cloudConfig, autoDownload: checked }
      setCloudConfig(next)
      saveCloudSyncConfig(next)
    },
    [cloudConfig],
  )

  const onClickSaveCloudConfig = useCallback(() => {
    saveCloudSyncConfig(cloudConfig)
    setCloudSaveMessage('配置已保存到本浏览器')
  }, [cloudConfig])

  const onClickSync = useCallback(
    async (direction: SyncDirection) => {
      saveCloudSyncConfig(cloudConfig)
      setCloudSaveMessage('配置已保存到本浏览器')
      setIsSyncing(true)
      setSyncMessage('')
      try {
        const result: SyncResult = await syncNow(direction)
        setSyncMessage(result.message)
      } catch (error) {
        setSyncMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setIsSyncing(false)
        setLastSyncedAt(getCloudSyncStateLastSyncedAt())
      }
    },
    [cloudConfig],
  )

  const exportProgressCallback = useCallback(({ totalRows, completedRows, done }: ExportProgress) => {
    if (done) {
      setIsExporting(false)
      setExportProgress(100)
      return true
    }
    if (totalRows) {
      setExportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onClickExport = useCallback(() => {
    setExportProgress(0)
    setIsExporting(true)
    exportDatabase(exportProgressCallback)
  }, [exportProgressCallback])

  const importProgressCallback = useCallback(({ totalRows, completedRows, done }: ImportProgress) => {
    if (done) {
      setIsImporting(false)
      setImportProgress(100)
      return true
    }
    if (totalRows) {
      setImportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onStartImport = useCallback(() => {
    setImportProgress(0)
    setIsImporting(true)
  }, [])

  const onClickImport = useCallback(() => {
    importDatabase(onStartImport, importProgressCallback)
  }, [importProgressCallback, onStartImport])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>云端同步（GitHub 私有仓库）</span>
            <span className={styles.sectionDescription}>
              把学习记录与全部配置自动备份到<strong>你自己的 GitHub 私有仓库</strong>，多设备间自动同步、换浏览器也不丢数据。使用步骤：
              ① 新建一个 Private 仓库；② 创建 Fine-grained Personal Access Token（只授权这一个仓库的 Contents: Read and write 权限）；
              ③ 填写下方信息并保存。开启后，启动时自动拉取云端新数据，完成章节练习后自动上传，双端都有新记录时自动做记录级合并。
            </span>
            <span className="pl-4 text-left text-sm font-bold leading-tight text-red-500">
              Token 只保存在本浏览器中，不会包含在云端备份文件里；请勿授权超出需要的权限。
            </span>

            <div className="flex w-full flex-col items-start gap-3 py-0 pl-4">
              <div className="flex w-full flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">GitHub 用户名（Owner）</span>
                <input className={inputClass} value={cloudConfig.owner} placeholder="your-github-username" onChange={(e) => updateCloudConfig({ owner: e.target.value })} />
              </div>
              <div className="flex w-full flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">私有仓库名（Repo）</span>
                <input className={inputClass} value={cloudConfig.repo} placeholder="qwerty-learner-backup" onChange={(e) => updateCloudConfig({ repo: e.target.value })} />
              </div>
              <div className="flex w-full flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">备份文件路径</span>
                <input className={inputClass} value={cloudConfig.path} placeholder="qwerty-learner-backup/data.gz" onChange={(e) => updateCloudConfig({ path: e.target.value })} />
              </div>
              <div className="flex w-full flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">Access Token（需要 Contents 读写权限）</span>
                <input
                  className={inputClass}
                  type="password"
                  value={cloudConfig.token}
                  placeholder="github_pat_..."
                  autoComplete="off"
                  onChange={(e) => updateCloudConfig({ token: e.target.value })}
                />
              </div>
            </div>

            <div className={styles.switchBlock}>
              <span className="text-sm font-medium text-gray-600">开启云端同步</span>
              <Switch checked={cloudConfig.enabled} onChange={onToggleCloudEnabled} className="switch-root">
                <span aria-hidden="true" className="switch-thumb" />
              </Switch>
            </div>
            <div className={styles.switchBlock}>
              <span className="text-sm font-medium text-gray-600">完成章节练习后自动上传</span>
              <Switch checked={cloudConfig.autoUpload} onChange={onToggleAutoUpload} className="switch-root">
                <span aria-hidden="true" className="switch-thumb" />
              </Switch>
            </div>
            <div className={styles.switchBlock}>
              <span className="text-sm font-medium text-gray-600">应用启动时自动同步</span>
              <Switch checked={cloudConfig.autoDownload} onChange={onToggleAutoDownload} className="switch-root">
                <span aria-hidden="true" className="switch-thumb" />
              </Switch>
            </div>

            <div className="flex w-full flex-wrap items-center justify-start gap-2 py-0 pl-4">
              <button className="my-btn-primary disabled:bg-gray-300" type="button" onClick={onClickSaveCloudConfig} title="保存设置">
                保存设置
              </button>
              <button className="my-btn-primary disabled:bg-gray-300" type="button" onClick={() => onClickSync('auto')} disabled={isSyncing} title="智能同步">
                立即同步
              </button>
              <button className="my-btn-primary disabled:bg-gray-300" type="button" onClick={() => onClickSync('upload')} disabled={isSyncing} title="用本地数据覆盖云端">
                仅上传
              </button>
              <button className="my-btn-primary disabled:bg-gray-300" type="button" onClick={() => onClickSync('download')} disabled={isSyncing} title="用云端数据覆盖本地">
                仅下载
              </button>
            </div>

            {cloudSaveMessage && (
              <span className="pl-4 text-xs font-normal leading-tight text-gray-600">{cloudSaveMessage}</span>
            )}
            <span className="pl-4 text-xs font-normal leading-tight text-gray-600">
              {isSyncing ? '正在同步…（备份文件较大时可能需要几十秒）' : syncMessage}
              {!isSyncing && !syncMessage && (lastSyncedAt ? `上次同步：${new Date(lastSyncedAt).toLocaleString()}` : '尚未同步过')}
            </span>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导出</span>
            <span className={styles.sectionDescription}>
              手动把当前数据导出为 gz 文件保存。如果您需要在不同的设备、浏览器或者其他非官方部署上使用 Qwerty Learner，
              且不方便使用上方的云端同步，可以手动进行数据同步和保存。
            </span>
            <span className="pl-4 text-left text-sm font-bold leading-tight text-red-500">
              为了您的数据安全，请不要修改导出的数据文件。
            </span>
            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={exportProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - exportProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${exportProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickExport}
              disabled={isExporting}
              title="导出数据"
            >
              导出数据
            </button>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导入</span>
            <span className={styles.sectionDescription}>
              请注意，导入数据将<strong className="text-sm font-bold text-red-500"> 完全覆盖 </strong>当前数据。请谨慎操作。
            </span>

            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={importProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - importProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${importProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickImport}
              disabled={isImporting}
              title="导入数据"
            >
              导入数据
            </button>
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
