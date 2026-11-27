import type { CloudBackupPayload, CloudSyncConfig, CloudSyncState, SyncDirection, SyncResult } from './types'
import { isSyncConfigUsable, loadCloudSyncConfig, loadCloudSyncState, markLocalDirty, saveCloudSyncState } from './storage'
import { applyPayloadToBrowser, decodePayload, encodePayload, getDeviceTag, hashSnapshot, snapshotLocalData } from './engine'
import { mergeConfigMaps, mergeDexieExports, stableHash } from './merge'
import { showSyncNotice } from './notice'
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

function hashDatabase(payload: CloudBackupPayload): string {
  return stableHash(JSON.stringify(payload.database))
}

/** 合并本地与云端快照 (记录并集 + 配置键级三方合并) */
function buildMergedPayload(
  local: CloudBackupPayload,
  remote: CloudBackupPayload,
  state: CloudSyncState | undefined,
): CloudBackupPayload {
  return {
    format: 'qwerty-learner-cloud-backup',
    version: 1,
    exportedAt: Date.now(),
    deviceTag: getDeviceTag(),
    // 首次在新设备上启用时没有 state, 以本地配置为 base → 全部采纳远端配置
    config: mergeConfigMaps(local.config, remote.config, state?.lastSyncedConfig ?? local.config),
    database: mergeDexieExports(local.database as DexieExportJSON, remote.database as DexieExportJSON),
  }
}

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
    const local = await snapshotLocalData()
    // 始终做并集合并而不是直接覆盖: 万一本地存在"未标记上传"的记录(例如状态标记异常/被清理),
    // 直接覆盖会把这些记录抹掉。合并是幂等的, 本地为空时结果与直接拉取等价。
    const merged = buildMergedPayload(local.payload, remotePayload, state)
    await applyPayloadToBrowser(merged)

    const localHadExtra = hashDatabase(merged) !== hashDatabase(remotePayload)
    if (localHadExtra) {
      // 本地含云端没有的记录, 把合并结果回传, 避免这些记录只停留在本机
      await uploadPayload(config, merged)
    }

    const effective = localHadExtra ? merged : remotePayload
    saveCloudSyncState({
      lastSyncedAt: Date.now(),
      lastSyncedHash: hashSnapshot(effective),
      lastSyncedExportedAt: effective.exportedAt,
      lastSyncedConfig: effective.config,
      localDirty: false,
    })
    return { outcome: 'pulled', message: '已拉取云端较新的数据，建议刷新页面使配置生效' }
  }

  const local = await snapshotLocalData()
  if (!remoteChanged) {
    // 内容与上次同步完全相同(例如脏标记来自合并/导入本身), 不重复上传,
    // 避免制造大量无意义的提交历史, 也减少与其它页面撞车的机会
    if (state?.lastSyncedHash && state.lastSyncedHash === local.hash) {
      saveCloudSyncState({
        lastSyncedAt: Date.now(),
        lastSyncedHash: local.hash,
        lastSyncedExportedAt: state.lastSyncedExportedAt,
        lastSyncedConfig: state.lastSyncedConfig,
        localDirty: false,
      })
      return { outcome: 'up-to-date', message: '本地与云端已一致' }
    }

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
  const merged = buildMergedPayload(local.payload, remotePayload, state)
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

const SYNC_LOCK_KEY = 'cloudSyncLock'
const SYNC_LOCK_TTL = 15 * 1000

/**
 * 跨标签页互斥锁: 同一个浏览器的多个标签页共用 localStorage,
 * 用它保证同一时刻只有一个页面在同步, 避免两个标签页同时上传同一文件而被 GitHub 判为冲突(409)。
 */
function acquireSyncLock(): boolean {
  try {
    const raw = localStorage.getItem(SYNC_LOCK_KEY)
    const now = Date.now()
    if (raw) {
      const startedAt = Number(raw)
      if (Number.isFinite(startedAt) && now - startedAt < SYNC_LOCK_TTL) return false
    }
    localStorage.setItem(SYNC_LOCK_KEY, String(now))
    return true
  } catch {
    // 隐私模式下 localStorage 不可写时退化为不加锁
    return true
  }
}

function releaseSyncLock() {
  try {
    localStorage.removeItem(SYNC_LOCK_KEY)
  } catch {
    // 忽略
  }
}

/** 执行一次同步; 同一页面并发调用共享同一个 Promise, 跨标签页用锁串行化 */
let networkRetryTimer: number | undefined
let networkFailureStreak = 0

/** 网络类失败(连不上/超时)自动再试, 成功则清零; 连续失败 2 次才打扰用户 */
function scheduleNetworkRetry(direction: SyncDirection) {
  if (networkRetryTimer) return
  networkRetryTimer = window.setTimeout(() => {
    networkRetryTimer = undefined
    syncNow(direction).catch(() => undefined)
  }, 8000)
}

/** 执行一次同步; 同一页面并发调用共享同一个 Promise, 跨标签页用锁串行化 */
export function syncNow(direction: SyncDirection): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = (async (): Promise<SyncResult> => {
    if (!acquireSyncLock()) {
      // 另一个标签页正在同步, 稍等再试一次; 仍被占用则跳过本次(不打扰用户)
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      if (!acquireSyncLock()) {
        return { outcome: 'up-to-date', message: '另一处正在同步，本次已跳过' }
      }
    }
    try {
      return await doSync(direction)
    } finally {
      releaseSyncLock()
    }
  })()
    .catch((error): SyncResult => ({ outcome: 'error', message: error instanceof Error ? error.message : String(error) }))
    .then((result) => {
      if (result.outcome === 'error') {
        const isNetwork = /无法连接 GitHub|连接 GitHub 超时|GitHub 服务端错误/.test(result.message)
        if (isNetwork && networkFailureStreak < 1) {
          // 网络抖动很常见: 先静默重试一次, 仍失败才提示
          networkFailureStreak += 1
          console.warn(`[cloud-sync] 网络异常, 8 秒后自动重试:`, result.message)
          scheduleNetworkRetry(direction)
        } else {
          showSyncNotice(`云同步失败：${result.message}`)
        }
      } else if (result.outcome === 'no-config') {
        networkFailureStreak = 0
        showSyncNotice('云同步未配置：请到「设置 → 数据设置 → 云端同步」填写 Owner / Repo / Token 并保存')
      } else {
        // 只要有一次成功就清空计数
        networkFailureStreak = 0
      }
      return result
    })
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
let focusListenersReady = false

// 用户最近一次按键时间, 用于避免在打字过程中刷新页面
let lastUserKeyAt = 0

/**
 * 页面重新获得焦点/重新可见时自动拉取云端数据。
 *
 * 场景: 在平板/手机上练完并上传后, 电脑上已经开着的页面不会自己更新(原先只在启动时拉取一次),
 * 看起来就像"没同步"。这里在切回页面时静默检查一次, 有更新则等用户停手后再刷新。
 */
export function initCloudSyncOnFocus() {
  if (focusListenersReady) return
  focusListenersReady = true

  window.addEventListener('keydown', () => { lastUserKeyAt = Date.now() }, { passive: true, capture: true })

  let lastFocusSyncAt = 0
  const syncOnReturn = () => {
    if (document.visibilityState === 'hidden') return
    const config = loadCloudSyncConfig()
    if (!config.enabled || !config.autoDownload) return
    // 60 秒内不重复检查, 避免频繁切换窗口造成请求过多
    if (Date.now() - lastFocusSyncAt < 60 * 1000) return
    lastFocusSyncAt = Date.now()

    syncNow('auto')
      .then((result) => {
        if (result.outcome === 'pulled' || result.outcome === 'merged') {
          // 用户可能正在打字, 等其停顿后再刷新, 避免打断当前练习
          const idleWait = Math.max(0, 4000 - (Date.now() - lastUserKeyAt))
          window.setTimeout(() => window.location.reload(), 800 + idleWait)
        }
      })
      .catch(() => undefined)
  }

  window.addEventListener('focus', syncOnReturn)
  document.addEventListener('visibilitychange', syncOnReturn)
}

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

function contentsUrl(config: CloudSyncConfig, cacheBuster?: number): string {
  const path = config.path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`
  // 查询串变化即可让浏览器重新走网络, 拿到最新的 sha。
  // 只加一个 GitHub 不认识的 _ 参数(会被忽略), 不写死 ref=main, 以免默认分支改名后失效。
  return cacheBuster ? `${base}?_=${cacheBuster}` : base
}

function ghHeaders(config: CloudSyncConfig): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** 把 GitHub 的状态码翻译成用户能照着处理的话 */
function describeGitHubError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, ' ').slice(0, 200)
  switch (status) {
    case 401:
      return 'Token 无效或已过期，请到 GitHub 重新生成后更新配置'
    case 403:
      return `权限不足或触发限流（需要该仓库的 Contents: Read and write 权限）：${detail}`
    case 404:
      return '仓库或备份路径不存在，或 Token 未授权访问该仓库'
    case 409:
      return '云端文件正被另一处同步写入（另一个标签页或设备）'
    case 422:
      return `备份文件被 GitHub 拒绝：${detail}`
    default:
      return `GitHub API ${status}：${detail}`
  }
}

function githubError(status: number, body: string): Error {
  return new Error(`${describeGitHubError(status, body)}（HTTP ${status}）`)
}

class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * 带超时与重试的 fetch。
 *
 * 国内网络访问 api.github.com 会偶发连接被重置/超时, 表现为 fetch 抛
 * TypeError("Failed to fetch"); 单次失败不该让整次同步报错, 这里自动重试。
 * 4xx 是业务错误(令牌/权限), 不重试; 5xx 与网络错误重试。
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3, timeoutMs = 25000): Promise<Response> {
  let lastError: unknown
  let lastServerStatus = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      if (res.status >= 500 && attempt < attempts - 1) {
        lastServerStatus = res.status
        lastError = new NetworkError(`GitHub 服务端错误 ${res.status}`)
      } else {
        return res
      }
    } catch (error) {
      lastError = error
    } finally {
      window.clearTimeout(timer)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 600 + attempt * 900 + Math.random() * 400))
  }

  if (lastServerStatus) {
    throw new NetworkError(`GitHub 服务端错误 ${lastServerStatus}，稍后自动重试`)
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new NetworkError(
    /abort/i.test(detail)
      ? '连接 GitHub 超时（网络较慢，可稍后重试或开启代理）'
      : '无法连接 GitHub（网络被拦截或不通，建议开启代理后重试）',
  )
}

/**
 * 读取云端备份文件 (含版本号 sha)。
 *
 * 必须避免用到浏览器的过期缓存: GitHub API 的响应带 max-age=60 缓存头, 上传成功后的
 * 60 秒内再次同步会命中缓存、拿到**过期的 sha**, 用它提交会被判冲突(HTTP 409),
 * 这正是"偶尔提示被其他设备占用、但其实只有一台设备"的根因。
 *
 * 不能用 Cache-Control / Pragma 请求头来绕缓存: 它们不在 GitHub 的 CORS 允许头列表中,
 * 会被预检(OPTIONS)拦下并表现为 "Failed to fetch"。这里改用变化的查询参数(cache buster)。
 */
async function ghGetFile(config: CloudSyncConfig): Promise<{ sha: string; content: string } | null> {
  const res = await fetchWithRetry(contentsUrl(config, Date.now()), {
    cache: 'no-store',
    headers: ghHeaders(config),
  })
  if (res.status === 404) return null
  if (!res.ok) throw githubError(res.status, await res.text())
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
  const res = await fetchWithRetry(contentsUrl(config), {
    method: 'PUT',
    headers: ghHeaders(config),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw githubError(res.status, await res.text())
}

async function uploadPayload(config: CloudSyncConfig, payload: CloudBackupPayload): Promise<number> {
  const base64 = await encodePayload(payload)

  // GitHub 的"更新文件"接口要求带上当前文件的版本号(sha)。若两个同步并发写同一文件,
  // 后提交者会拿到 409 Conflict。这里最多重试 3 次, 每次重新取 sha 并做短暂退避。
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await ghGetFile(config)
    try {
      await ghPutFile(config, base64, existing?.sha)
      return base64.length
    } catch (error) {
      lastError = error
      if (!isConflictError(error)) throw error
      // 400ms, 900ms 的退避 + 抖动, 避免两个页面继续同步撞车
      await new Promise((resolve) => window.setTimeout(resolve, 400 + attempt * 500 + Math.random() * 300))
    }
  }

  throw new Error(
    `云端备份文件版本与本地不一致（可能有其它客户端同时在同步）。本次未上传成功，稍后会自动重试，数据不会丢失。${
      lastError instanceof Error ? `（${lastError.message}）` : ''
    }`,
  )
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && /HTTP 409|409/.test(error.message)
}

function formatBytes(length: number): string {
  if (length < 1024) return `${length} B`
  if (length < 1024 * 1024) return `${(length / 1024).toFixed(1)} KB`
  return `${(length / 1024 / 1024).toFixed(1)} MB`
}
