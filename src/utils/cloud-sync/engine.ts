import { db } from '@/utils/db'
import type { CloudBackupPayload, CloudSyncState, DexieExportJSON } from './types'
import { CLOUD_SYNC_CONFIG_KEY, CLOUD_SYNC_STATE_KEY, DEVICE_TAG_KEY, markLocalDirty } from './storage'
import { stableHash } from './merge'

/**
 * 快照引擎: 负责本地数据的采集、编码与应用
 * (Dexie 全库导出/导入 + localStorage 配置快照 + gzip/base64 编解码)
 */

const SKIPPED_LOCAL_STORAGE_KEYS = new Set([CLOUD_SYNC_CONFIG_KEY, CLOUD_SYNC_STATE_KEY, DEVICE_TAG_KEY])

export function collectLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || SKIPPED_LOCAL_STORAGE_KEYS.has(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) result[key] = value
  }
  return result
}

export function getDeviceTag(): string {
  let tag = localStorage.getItem(DEVICE_TAG_KEY)
  if (!tag) {
    tag = Math.random().toString(36).slice(2, 10)
    try {
      localStorage.setItem(DEVICE_TAG_KEY, tag)
    } catch {
      // 隐私模式下 localStorage 不可写入时, 退化为空标签
      tag = 'unknown'
    }
  }
  return tag
}

export type LocalSnapshot = {
  payload: CloudBackupPayload
  hash: string
}

export function hashSnapshot(payload: CloudBackupPayload): string {
  return `${stableHash(JSON.stringify(payload.database))}:${stableHash(JSON.stringify(payload.config))}`
}

export async function snapshotLocalData(): Promise<LocalSnapshot> {
  await import('dexie-export-import')
  const blob = await db.export()
  const database = JSON.parse(await blob.text()) as DexieExportJSON
  const payload: CloudBackupPayload = {
    format: 'qwerty-learner-cloud-backup',
    version: 1,
    exportedAt: Date.now(),
    deviceTag: getDeviceTag(),
    config: collectLocalStorage(),
    database,
  }
  return { payload, hash: hashSnapshot(payload) }
}

export async function applyPayloadToBrowser(payload: CloudBackupPayload) {
  for (const [key, value] of Object.entries(payload.config)) {
    if (SKIPPED_LOCAL_STORAGE_KEYS.has(key)) continue
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      // 单个配置项写入失败不阻塞数据导入
      console.warn('[cloud-sync] 配置项写入失败:', key, error)
    }
  }

  await import('dexie-export-import')
  const blob = new Blob([JSON.stringify(payload.database)])
  await db.import(blob, {
    acceptVersionDiff: true,
    acceptMissingTables: true,
    acceptNameDiff: false,
    acceptChangedPrimaryKey: false,
    overwriteValues: true,
    clearTablesBeforeImport: true,
  })
}

// ---------------------------------------------------------------------------
// gzip + base64 编解码 (与手动导出功能同款的 pako 依赖)
// ---------------------------------------------------------------------------

export async function encodePayload(payload: CloudBackupPayload): Promise<string> {
  const pako = await import('pako')
  const compressed = pako.gzip(JSON.stringify(payload))
  return bytesToBase64(compressed)
}

export async function decodePayload(base64: string): Promise<CloudBackupPayload> {
  const pako = await import('pako')
  const json = pako.ungzip(base64ToBytes(base64), { to: 'string' }) as unknown as string
  const payload = JSON.parse(json) as CloudBackupPayload
  if (payload?.format !== 'qwerty-learner-cloud-backup' || !payload?.database) {
    throw new Error('云端文件不是有效的 Qwerty Learner 云同步备份')
  }
  return payload
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = Array.from(bytes.subarray(i, i + chunkSize))
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// 脏标记: 监听所有 Dexie 表的写入, 本地数据一变就标记需要上传
// ---------------------------------------------------------------------------

let dirtyHooksInstalled = false

export function installDirtyHooks() {
  if (dirtyHooksInstalled) return
  dirtyHooksInstalled = true
  try {
    for (const table of db.tables) {
      const mark = () => markLocalDirty()
      table.hook('creating', mark)
      table.hook('updating', mark)
      table.hook('deleting', mark)
    }
  } catch (error) {
    console.warn('[cloud-sync] 安装写入钩子失败, 自动同步将退化为每次全量对比', error)
  }
}

installDirtyHooks()

export type { CloudSyncState }
