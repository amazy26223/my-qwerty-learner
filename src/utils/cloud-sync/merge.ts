import type { DexieExportJSON, DexieExportRow, DexieExportTableData, DexieExportTableMeta } from './types'

/**
 * 云同步的合并逻辑 (纯函数, 不依赖浏览器/Dexie, 便于独立测试)
 *
 * 处理的是 dexie-export-import 的真实导出结构:
 *   { formatName, formatVersion, data: { databaseName, databaseVersion,
 *     tables: [ {name, schema, rowCount} ],   ← 表元数据
 *     data:   [ {tableName, inbound, rows} ]  ← 各表行数据
 *   } }
 *
 * 学习记录是追加式数据 (append-only):
 *   - wordRecords / chapterRecords / reviewRecords 按「自然键 + 同侧出现次序」做并集,
 *     两台设备各自练习产生的记录全部保留, 不会互相覆盖;
 *   - chapterRecord.wordRecordIds 是对 wordRecords 的跨表引用, 分两阶段重编址:
 *     ① 每张表合并时记录「本侧旧 id → 合并后行号」映射;
 *     ② 章节表合并完成后, 用 wordRecords 的映射重编址它的 wordRecordIds;
 *   - 未知的新表 (未来版本引入) 退化为「按整行内容去重的并集」, 保证向前兼容;
 *   - 行上的 $types 类型标注按普通字段一起复制, 不做解释。
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function naturalKeyOf(tableName: string, row: DexieExportRow): string {
  switch (tableName) {
    case 'wordRecords':
      return `w|${String(row.word ?? '')}|${String(row.dict ?? '')}|${String(row.chapter ?? '')}|${String(row.timeStamp ?? '')}`
    case 'chapterRecords':
      return `c|${String(row.dict ?? '')}|${String(row.chapter ?? '')}|${String(row.timeStamp ?? '')}`
    case 'reviewRecords':
      return `r|${String(row.dict ?? '')}|${String(row.createTime ?? '')}`
    default: {
      const { id: _id, ...rest } = row
      return `g|${stableStringify(rest)}`
    }
  }
}

type MergeSide = 'local' | 'remote'

type MergeEntry = {
  row: DexieExportRow
  source: MergeSide
  index: number
}

type TableMerge = {
  /** 每一行来自哪一侧 (用于跨表引用重编址时选择对应侧的 id 映射) */
  sources: MergeSide[]
  /** 本侧旧 id → 合并后行号 (0-based) */
  localIdMap: Map<unknown, number>
  remoteIdMap: Map<unknown, number>
  rows: DexieExportRow[]
}

function mergeRows(tableName: string, localRows: DexieExportRow[] | undefined, remoteRows: DexieExportRow[] | undefined): TableMerge {
  const byKey = new Map<string, MergeEntry>()
  const ordered: MergeEntry[] = []
  const remoteIdMap = new Map<unknown, number>()
  const localIdMap = new Map<unknown, number>()

  const processSide = (rows: DexieExportRow[] | undefined, source: MergeSide, idMap: Map<unknown, number>) => {
    if (!rows) return
    const occurrence = new Map<string, number>()
    for (const row of rows) {
      const baseKey = naturalKeyOf(tableName, row)
      const next = (occurrence.get(baseKey) ?? 0) + 1
      occurrence.set(baseKey, next)
      const key = `${baseKey}#${next}`

      const existing = byKey.get(key)
      if (existing) {
        // 同一条记录两边都有 (来自此前的同步传播): 内容一致, 以本地为准
        if (source === 'local') {
          existing.row = row
          existing.source = 'local'
        }
        idMap.set(row.id, existing.index)
      } else {
        const entry: MergeEntry = { row, source, index: ordered.length }
        byKey.set(key, entry)
        ordered.push(entry)
        idMap.set(row.id, entry.index)
      }
    }
  }

  processSide(remoteRows, 'remote', remoteIdMap)
  processSide(localRows, 'local', localIdMap)

  return {
    sources: ordered.map((entry) => entry.source),
    localIdMap,
    remoteIdMap,
    rows: ordered.map((entry, index) => ({ ...entry.row, id: index + 1 })),
  }
}

function idMapForSide(merge: TableMerge, side: MergeSide): Map<unknown, number> {
  return side === 'remote' ? merge.remoteIdMap : merge.localIdMap
}

/** 合并两份 Dexie 全库导出: 表按名字取并集, 双端同名表按自然键合并行 */
export function mergeDexieExports(local: DexieExportJSON, remote: DexieExportJSON): DexieExportJSON {
  const localData = local.data
  const remoteData = remote.data

  // 表名并集 (保持先本地后远端的顺序)
  const names: string[] = []
  const seenTables = new Set<string>()
  for (const meta of (localData?.tables ?? []).concat(remoteData?.tables ?? [])) {
    if (!seenTables.has(meta.name)) {
      seenTables.add(meta.name)
      names.push(meta.name)
    }
  }

  const localRowsByName = new Map<string, DexieExportRow[]>()
  for (const tableData of localData?.data ?? []) localRowsByName.set(tableData.tableName, tableData.rows ?? [])
  const remoteRowsByName = new Map<string, DexieExportRow[]>()
  for (const tableData of remoteData?.data ?? []) remoteRowsByName.set(tableData.tableName, tableData.rows ?? [])
  const localTableByName = new Map<string, DexieExportTableData>()
  for (const tableData of localData?.data ?? []) localTableByName.set(tableData.tableName, tableData)
  const remoteTableByName = new Map<string, DexieExportTableData>()
  for (const tableData of remoteData?.data ?? []) remoteTableByName.set(tableData.tableName, tableData)
  const localMetaByName = new Map<string, DexieExportTableMeta>()
  for (const meta of localData?.tables ?? []) localMetaByName.set(meta.name, meta)
  const remoteMetaByName = new Map<string, DexieExportTableMeta>()
  for (const meta of remoteData?.tables ?? []) remoteMetaByName.set(meta.name, meta)

  const mergedMeta: DexieExportTableMeta[] = []
  const mergedData: DexieExportTableData[] = []
  const mergedByName = new Map<string, TableMerge>()

  for (const name of names) {
    const localRows = localRowsByName.get(name)
    const remoteRows = remoteRowsByName.get(name)
    const meta = localMetaByName.get(name) ?? remoteMetaByName.get(name) ?? { name, schema: '++id' }

    if (localRows !== undefined && remoteRows !== undefined) {
      const merge = mergeRows(name, localRows, remoteRows)
      mergedByName.set(name, merge)
      mergedMeta.push({ ...meta, rowCount: merge.rows.length })
      mergedData.push({ tableName: name, inbound: localTableByName.get(name)?.inbound ?? true, rows: merge.rows })
    } else if (localRows !== undefined) {
      // 只在本地存在的表: 原样保留 (行与 id 不变)
      const merge = mergeRows(name, localRows, [])
      mergedByName.set(name, merge)
      mergedMeta.push({ ...meta, rowCount: merge.rows.length })
      mergedData.push(localTableByName.get(name) ?? { tableName: name, inbound: true, rows: merge.rows })
    } else {
      // 只在远端存在的表: 原样保留
      const merge = mergeRows(name, [], remoteRows ?? [])
      mergedByName.set(name, merge)
      mergedMeta.push({ ...meta, rowCount: merge.rows.length })
      mergedData.push(remoteTableByName.get(name) ?? { tableName: name, inbound: true, rows: merge.rows })
    }
  }

  // 第二阶段: 章节表的 wordRecordIds 是对 wordRecords 的跨表引用,
  // 用 wordRecords 合并时产生的「本侧旧 id → 新行号」映射重编址
  const wordMerge = mergedByName.get('wordRecords')
  const chapterMerge = mergedByName.get('chapterRecords')
  if (wordMerge && chapterMerge) {
    const chapterTable = mergedData.find((tableData) => tableData.tableName === 'chapterRecords')
    if (chapterTable?.rows) {
      chapterTable.rows.forEach((row, index) => {
        const ids = row.wordRecordIds
        if (!Array.isArray(ids)) return
        const idMap = idMapForSide(wordMerge, chapterMerge.sources[index] ?? 'local')
        row.wordRecordIds = ids.map((oldId) => {
          const newIndex = idMap.get(oldId)
          return newIndex === undefined ? oldId : newIndex + 1
        })
      })
    }
  }

  const base = (localData?.databaseVersion ?? 0) >= (remoteData?.databaseVersion ?? 0) ? local : remote
  return {
    ...base,
    data: {
      ...base.data,
      databaseVersion: Math.max(localData?.databaseVersion ?? 0, remoteData?.databaseVersion ?? 0),
      tables: mergedMeta,
      data: mergedData,
    },
  }
}

/**
 * 键级三方合并 localStorage 配置:
 *   base = 上次同步时的配置快照
 *   - 本地与 base 相同 → 采纳远端 (本设备没动过这个配置)
 *   - 远端与 base 相同 → 保留本地
 *   - 双端都动过 → 保留本地 (当前设备正在使用的值)
 */
export function mergeConfigMaps(
  local: Record<string, string>,
  remote: Record<string, string>,
  base: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {}
  const seen = new Set<string>()
  for (const key of Object.keys(local).concat(Object.keys(remote))) {
    if (seen.has(key)) continue
    seen.add(key)
    const localValue = local[key]
    const remoteValue = remote[key]
    if (localValue === undefined) merged[key] = remoteValue as string
    else if (remoteValue === undefined) merged[key] = localValue
    else if (localValue === base[key]) merged[key] = remoteValue
    else merged[key] = localValue
  }
  return merged
}

/** FNV-1a 32bit + 长度, 用于判断「本地自上次同步后是否有变化」 */
export function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return `${h.toString(16)}-${input.length.toString(16)}`
}
