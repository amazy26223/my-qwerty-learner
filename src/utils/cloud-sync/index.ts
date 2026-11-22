import type { CloudBackupPayload, CloudSyncConfig, SyncDirection, SyncResult } from './types'
import { isSyncConfigUsable, loadCloudSyncConfig, loadCloudSyncState, markLocalDirty, saveCloudSyncState } from './storage'
import { applyPayloadToBrowser, decodePayload, encodePayload, getDeviceTag, hashSnapshot, snapshotLocalData } from './engine'
import { mergeConfigMaps, mergeDexieExports } from './merge'
import type { DexieExportJSON } from './types'

export { DEFAULT_CLOUD_SYNC_CONFIG, loadCloudSyncConfig, saveCloudSyncConfig, isSyncConfigUsable, getCloudSyncStateLastSyncedAt, markLocalDirty } from './storage'
export type { CloudSyncConfig, CloudSyncState, SyncDirection, SyncResult, SyncOutcome, CloudBackupPayload } from './types'
export { mergeConfigMaps, mergeDexieExports } from './merge'

/**
 * 云端同步入口 (GitHub 私有仓库方案)
 *
 * 数据流: 本地快照 (Dexie 全库导出 + localStorage 配置) → gzip → base64 → GitHub Contents API
 *
 * 冲突策略 (多设备同时产生新记录时):
 *   学习记录按自然键做并集合并 (追加式数据双端全保留), 配置按键级三方合并;
 *   合并结果同时写回本地与云端, 因此任何一台设备的数据都不会丢。
 */

async function doSync(direction: SyncDirection): Promise<SyncResult> {
  const config = loadCloudSyncConfig()
  if (!isSyncConfigUsable(config)) {
    return { outcome: 'no-config', message: '请先填写并保存 GitHub 同步配置' }
  }

  if (direction === 'upload') {
    const local = await snapshotLocalData()
    const bytes = await uploadPayload(config, local.payload)
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: local.hash,
      lastSyncedExportedAt: local.payload.exportedAt,
      lastSyncedConfig: local.payload.config,
      localDirty: false,
    })
    return { outcome: 'pushed', message: `已上传 ${formatBytes(bytes)} 到云端` }
  }

  if (direction === 'download') {
    const remote = await ghGetFile(config)
    if (!remote) return { outcome: 'no-remote', message: '云端还没有备份文件，请先点「立即上传」' }
    const payload = await decodePayload(remote.content)
    await applyPayloadToBrowser(payload)
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: hashSnapshot(payload),
      lastSyncedExportedAt: payload.exportedAt,
      lastSyncedConfig: payload.config,
      localDirty: false,
    })
    return { outcome: 'pulled', message: '已用云端数据覆盖本地，建议刷新页面使配置生效' }
  }

  // ---- direction === 'auto': 智能同步 ----
  const state = loadCloudSyncState()
  const remote = await ghGetFile(config)

  if (!remote) {
    const local = await snapshotLocalData()
    const bytes = await uploadPayload(config, local.payload)
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: local.hash,
      lastSyncedExportedAt: local.payload.exportedAt,
      lastSyncedConfig: local.payload.config,
      localDirty: false,
    })
    return { outcome: 'pushed', message: `云端暂无备份，已上传 ${formatBytes(bytes)}` }
  }

  const remotePayload = await decodePayload(remote.content)
  const remoteChanged = remotePayload.exportedAt !== (state?.lastSyncedExportedAt ?? 0)
  const localDirty = state?.localDirty ?? true

  if (!localDirty && !remoteChanged) {
    return { outcome: 'up-to-date', message: '本地与云端已一致' }
  }

  if (!localDirty && remoteChanged) {
    await applyPayloadToBrowser(remotePayload)
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: hashSnapshot(remotePayload),
      lastSyncedExportedAt: remotePayload.exportedAt,
      lastSyncedConfig: remotePayload.config,
      localDirty: false,
    })
    return { outcome: 'pulled', message: '已拉取云端较新的数据，建议刷新页面使配置生效' }
  }

  const local = await snapshotLocalData()
  if (!remoteChanged) {
    const bytes = await uploadPayload(config, local.payload)
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: local.hash,
      lastSyncedExportedAt: local.payload.exportedAt,
      lastSyncedConfig: local.payload.config,
      localDirty: false,
    })
    return { outcome: 'pushed', message: `已上传 ${formatBytes(bytes)} 到云端` }
  }

  // 双端都有变化: 记录级合并, 保证两边的数据都不丢
  const merged: CloudBackupPayload = {
    format: 'qwerty-learner-cloud-backup',
    version: 1,
    exportedAt: Date.now(),
    deviceTag: getDeviceTag(),
    // 首次在新设备上启用时没有 state, 以本地配置为 base → 全部采纳远端配置
    config: mergeConfigMaps(local.payload.config, remotePayload.config, state?.lastSyncedConfig ?? local.payload.config),
    database: mergeDexieExports(local.payload.database as DexieExportJSON, remotePayload.database as DexieExportJSON),
  }
  await applyPayloadToBrowser(merged)
  const bytes = await uploadPayload(config, merged)
  saveCloudSyncState({
    lastSyncedAt: Date.now(),
    lastSyncedHash: hashSnapshot(merged),
    lastSyncedExportedAt: merged.exportedAt,
    lastSyncedConfig: merged.config,
    localDirty: false,
  })
  return { outcome: 'merged', message: `已合并本地与云端的数据并上传 ${formatBytes(bytes)}，建议刷新页面使配置生效` }
}

let inFlight: Promise<SyncResult> | null = null

/** 执行一次同步; 并发调用会共享同一个进行中的 Promise */
export function syncNow(direction: SyncDirection): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = doSync(direction)
    .catch((error): SyncResult => ({ outcome: 'error', message: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** 应用启动时调用: 若开启「启动时自动同步」, 后台执行一次智能同步, 拉取/合并成功后自动刷新页面 */
export function initCloudSyncOnStartup() {
  const config = loadCloudSyncConfig()
  if (!config.enabled || !config.autoDownload) return
  syncNow('auto')
    .then((result) => {
      if (result.outcome === 'pulled' || result.outcome === 'merged') {
        // 同步在页面加载后才完成, 刷新一次让 jotai 配置原子重新读取 localStorage
        window.location.reload()
      } else if (result.outcome !== 'up-to-date' && result.outcome !== 'pushed') {
        console.warn('[cloud-sync] 启动同步失败:', result.outcome, result.message)
      }
    })
    .catch(() => undefined)
}

let autoUploadTimer: number | undefined
let flushListenersReady = false

function flushAutoUpload() {
  if (autoUploadTimer) {
    window.clearTimeout(autoUploadTimer)
    autoUploadTimer = undefined
  }
  syncNow('auto').catch(() => undefined)
}

function ensureFlushListeners() {
  if (flushListenersReady) return
  flushListenersReady = true
  document.addEventListener('visibilitychange', () => {
    // 用户切走标签页/最小化时立即冲刷, 避免数据滞留本地
    if (document.visibilityState === 'hidden' && autoUploadTimer) flushAutoUpload()
  })
  window.addEventListener('beforeunload', () => {
    if (autoUploadTimer) flushAutoUpload()
  })
}

/** 每次完成章节练习后调用: 延迟触发一次自动同步 (期间继续练习会自动顺延) */
export function scheduleAutoUpload() {
  const config = loadCloudSyncConfig()
  if (!config.enabled || !config.autoUpload) return
  markLocalDirty()
  if (autoUploadTimer) window.clearTimeout(autoUploadTimer)
  autoUploadTimer = window.setTimeout(() => {
    autoUploadTimer = undefined
    syncNow('auto').catch(() => undefined)
  }, 30 * 1000)
  ensureFlushListeners()
}

// ---------------------------------------------------------------------------
// GitHub Contents API 传输层
// ---------------------------------------------------------------------------

function contentsUrl(config: CloudSyncConfig): string {
  const path = config.path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`
}

function ghHeaders(config: CloudSyncConfig): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function ghGetFile(config: CloudSyncConfig): Promise<{ sha: string; content: string } | null> {
  const res = await fetch(contentsUrl(config), { headers: ghHeaders(config) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  if (typeof json.content !== 'string' || json.encoding !== 'base64') {
    throw new Error('GitHub 返回的文件内容格式异常')
  }
  return { sha: json.sha as string, content: json.content.replace(/\s/g, '') }
}

async function ghPutFile(config: CloudSyncConfig, base64: string, sha: string | undefined) {
  const body: Record<string, string> = {
    message: `chore(cloud-sync): 备份学习数据 ${new Date().toISOString()}`,
    content: base64,
  }
  if (sha) body.sha = sha
  const res = await fetch(contentsUrl(config), { method: 'PUT', headers: ghHeaders(config), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

async function uploadPayload(config: CloudSyncConfig, payload: CloudBackupPayload): Promise<number> {
  const base64 = await encodePayload(payload)
  const existing = await ghGetFile(config)
  try {
    await ghPutFile(config, base64, existing?.sha)
  } catch (error) {
    // 远端在 GET 与 PUT 之间被其它设备更新过 (sha 失效), 重取 sha 再试一次
    const latest = await ghGetFile(config)
    if (!latest) throw error
    await ghPutFile(config, base64, latest.sha)
  }
  return base64.length
}

function formatBytes(length: number): string {
  if (length < 1024) return `${length} B`
  if (length < 1024 * 1024) return `${(length / 1024).toFixed(1)} KB`
  return `${(length / 1024 / 1024).toFixed(1)} MB`
}
