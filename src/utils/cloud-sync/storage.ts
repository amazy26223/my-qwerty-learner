import type { CloudSyncConfig, CloudSyncState } from './types'

export const CLOUD_SYNC_CONFIG_KEY = 'cloudSyncConfig'
export const CLOUD_SYNC_STATE_KEY = 'cloudSyncState'
export const DEVICE_TAG_KEY = 'cloudSyncDeviceTag'

export const DEFAULT_CLOUD_SYNC_CONFIG: CloudSyncConfig = {
  enabled: false,
  owner: '',
  repo: '',
  path: 'qwerty-learner-backup/data.gz',
  token: '',
  autoUpload: true,
  autoDownload: true,
}

export function loadCloudSyncConfig(): CloudSyncConfig {
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CLOUD_SYNC_CONFIG }
    const parsed = JSON.parse(raw) as Partial<CloudSyncConfig>
    return { ...DEFAULT_CLOUD_SYNC_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CLOUD_SYNC_CONFIG }
  }
}

export function saveCloudSyncConfig(config: CloudSyncConfig) {
  localStorage.setItem(CLOUD_SYNC_CONFIG_KEY, JSON.stringify(config))
}

export function isSyncConfigUsable(config: CloudSyncConfig): boolean {
  return (
    config.enabled &&
    config.owner.trim().length > 0 &&
    config.repo.trim().length > 0 &&
    config.path.trim().length > 0 &&
    config.token.trim().length > 0
  )
}

export function loadCloudSyncState(): CloudSyncState | undefined {
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_STATE_KEY)
    return raw ? (JSON.parse(raw) as CloudSyncState) : undefined
  } catch {
    return undefined
  }
}

export function saveCloudSyncState(state: CloudSyncState) {
  localStorage.setItem(CLOUD_SYNC_STATE_KEY, JSON.stringify(state))
}

/** 标记本地学习记录自上次同步后发生了变化 (由 Dexie 写入钩子/导入功能调用) */
export function markLocalDirty() {
  try {
    const state = loadCloudSyncState()
    if (state?.localDirty) return
    saveCloudSyncState(
      state
        ? { ...state, localDirty: true }
        : { lastSyncedAt: 0, lastSyncedHash: '', lastSyncedExportedAt: 0, lastSyncedConfig: {}, localDirty: true },
    )
  } catch (error) {
    console.warn('[cloud-sync] 无法写入同步状态', error)
  }
}

export function getCloudSyncStateLastSyncedAt(): number | undefined {
  const state = loadCloudSyncState()
  return state && state.lastSyncedAt > 0 ? state.lastSyncedAt : undefined
}
