/** 云同步 (GitHub 私有仓库方案) 的共享类型定义 */

export type CloudSyncConfig = {
  /** 总开关 */
  enabled: boolean
  /** GitHub 用户名 */
  owner: string
  /** 私有仓库名 */
  repo: string
  /** 备份文件在仓库中的路径 */
  path: string
  /** Fine-grained PAT, 仅授权该仓库的 Contents 读写权限 */
  token: string
  /** 完成章节练习后自动上传 */
  autoUpload: boolean
  /** 应用启动时自动拉取/合并 */
  autoDownload: boolean
}

export type CloudSyncState = {
  /** 最近一次成功同步的时间 (epoch ms) */
  lastSyncedAt: number
  /** 最近一次同步时本地快照的哈希, 用于判断本地是否有变化 */
  lastSyncedHash: string
  /** 最近一次同步 payload 的 exportedAt, 用于判断云端是否有变化 */
  lastSyncedExportedAt: number
  /** 最近一次同步时的配置快照, 作为三方合并的 base */
  lastSyncedConfig: Record<string, string>
  /** 自上次同步后本地学习记录是否发生变化 */
  localDirty: boolean
}

/** dexie-export-import 导出的 JSON 行 (可能附带 $types 类型标注字段) */
export type DexieExportRow = Record<string, unknown> & { id?: unknown }

/** 表元数据 (数据库 schema 描述) */
export type DexieExportTableMeta = {
  name: string
  schema: string
  rowCount?: number
}

/** 表行数据 (实际记录) */
export type DexieExportTableData = {
  tableName: string
  inbound: boolean
  rows?: DexieExportRow[]
}

/** dexie-export-import 的全库导出结构 */
export type DexieExportJSON = {
  formatName: string
  formatVersion: number
  data: {
    databaseName: string
    databaseVersion: number
    /** 表元数据列表 */
    tables: DexieExportTableMeta[]
    /** 每张表的行数据列表 */
    data: DexieExportTableData[]
    [key: string]: unknown
  }
}

/** 上传到云端的一份完整备份 */
export type CloudBackupPayload = {
  format: 'qwerty-learner-cloud-backup'
  version: 1
  /** 快照生成时间 (epoch ms) */
  exportedAt: number
  /** 产生这份快照的浏览器标识, 仅用于 commit message 追溯 */
  deviceTag: string
  /** localStorage 配置快照 (key → 原始字符串值) */
  config: Record<string, string>
  /** RecordDB 的完整 Dexie 导出 */
  database: DexieExportJSON
}

export type SyncDirection = 'auto' | 'upload' | 'download'

export type SyncOutcome = 'pushed' | 'pulled' | 'merged' | 'up-to-date' | 'no-remote' | 'no-config' | 'error'

export type SyncResult = {
  outcome: SyncOutcome
  message: string
}
