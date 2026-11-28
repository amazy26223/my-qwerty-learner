/**
 * cloud-sync 记录合并逻辑的独立测试 (纯函数, 无浏览器/Dexie 依赖)
 *
 * 使用 dexie-export-import 的真实导出结构:
 *   { formatName, formatVersion, data: { databaseName, databaseVersion,
 *     tables: [{name, schema, rowCount}], data: [{tableName, inbound, rows}] } }
 *
 * 运行方式:
 *   npx esbuild scripts/test-cloud-sync-merge.ts --bundle --platform=node --format=cjs --target=es2020 --outfile=.tmp-merge-test.cjs
 *   node .tmp-merge-test.cjs
 */
import { mergeConfigMaps, mergeDexieExports } from '../src/utils/cloud-sync/merge'
import type { DexieExportJSON, DexieExportRow } from '../src/utils/cloud-sync/types'

let failures = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeExport(version: number, tables: Record<string, unknown[]>) {
  const names = Object.keys(tables)
  return {
    formatName: 'dexie',
    formatVersion: 1,
    data: {
      databaseName: 'RecordDB',
      databaseVersion: version,
      tables: names.map((name) => ({ name, schema: '++id', rowCount: tables[name].length })),
      data: names.map((name) => ({
        tableName: name,
        inbound: true,
        rows: (tables[name] as DexieExportRow[]).map((row, i) => ({ ...row, id: i + 1 })),
      })),
    },
  } as unknown as DexieExportJSON
}

function rowsOf(exportJSON: DexieExportJSON, tableName: string): DexieExportRow[] {
  return exportJSON.data.data.find((t) => t.tableName === tableName)?.rows ?? []
}

console.log('场景 1: 双端各自练习了不同记录 → 合并后两边记录全保留')

const localExport1 = makeExport(3, {
  wordRecords: [
    { word: 'apple', dict: 'cet4', chapter: 1, timeStamp: 1000, wrongCount: 1, timing: [80, 90] },
    { word: 'banana', dict: 'cet4', chapter: 1, timeStamp: 1001, wrongCount: 0, timing: [70] },
  ],
  chapterRecords: [{ dict: 'cet4', chapter: 1, timeStamp: 1000, time: 60, wordRecordIds: [1, 2] }],
  reviewRecords: [{ dict: 'cet4', createTime: 900, isFinished: false }],
})

const remoteExport1 = makeExport(3, {
  wordRecords: [
    { word: 'cherry', dict: 'cet4', chapter: 2, timeStamp: 2000, wrongCount: 2, timing: [99] },
    { word: 'banana', dict: 'cet4', chapter: 1, timeStamp: 1001, wrongCount: 0, timing: [70] },
  ],
  chapterRecords: [{ dict: 'cet4', chapter: 2, timeStamp: 2000, time: 90, wordRecordIds: [1, 2] }],
  reviewRecords: [{ dict: 'cet4', createTime: 950, isFinished: false }],
})

const merged1 = mergeDexieExports(localExport1, remoteExport1)
const words1 = rowsOf(merged1, 'wordRecords')
const chapters1 = rowsOf(merged1, 'chapterRecords')
const reviews1 = rowsOf(merged1, 'reviewRecords')

check('词记录 = 本地 apple + 去重 banana + 远端 cherry', words1.length === 3, `实际 ${words1.length}`)
check('banana 只保留一份', words1.filter((row) => row.word === 'banana').length === 1)
check(
  'apple/banana/cherry 全部存在',
  ['apple', 'banana', 'cherry'].every((w) => words1.some((row) => row.word === w)),
)
check('章节记录两条都在', chapters1.length === 2, `实际 ${chapters1.length}`)
check('复习记录两条都在', reviews1.length === 2, `实际 ${reviews1.length}`)
check(
  '表元数据 rowCount 同步更新',
  merged1.data.tables.every((t) => t.rowCount === rowsOf(merged1, t.name).length),
)

console.log('场景 1 附带校验: chapterRecord.wordRecordIds 重编址后指向正确')

const wordIds1 = new Map(words1.map((row) => [row.id as number, row.word as string]))
const chapter1Local = chapters1.find((row) => row.chapter === 1)
const chapter1Remote = chapters1.find((row) => row.chapter === 2)
check(
  '本地章节 (chapter=1) 的 wordRecordIds 指向 apple+banana',
  Array.isArray(chapter1Local?.wordRecordIds) &&
    (chapter1Local!.wordRecordIds as number[])
      .map((id) => wordIds1.get(id))
      .sort()
      .join(',') === 'apple,banana',
  JSON.stringify(chapter1Local?.wordRecordIds),
)
check(
  '远端章节 (chapter=2) 的 wordRecordIds 指向 cherry+banana (含双端共有的 banana)',
  Array.isArray(chapter1Remote?.wordRecordIds) &&
    (chapter1Remote!.wordRecordIds as number[])
      .map((id) => wordIds1.get(id))
      .sort()
      .join(',') === 'banana,cherry',
  JSON.stringify(chapter1Remote?.wordRecordIds),
)
check('合并后的 id 连续且无重复', words1.map((r) => r.id).join(',') === '1,2,3')

console.log('场景 2: 同一侧存在相同自然键 (同一秒内同一单词错两次) → 两条都保留')

const localExport2 = makeExport(3, {
  wordRecords: [
    { word: 'apple', dict: 'cet4', chapter: 1, timeStamp: 1000, wrongCount: 1, timing: [80] },
    { word: 'apple', dict: 'cet4', chapter: 1, timeStamp: 1000, wrongCount: 2, timing: [90] },
  ],
  chapterRecords: [],
  reviewRecords: [],
})
const merged2 = mergeDexieExports(localExport2, makeExport(3, { wordRecords: [], chapterRecords: [], reviewRecords: [] }))
const words2 = rowsOf(merged2, 'wordRecords')
check('本地重复自然键的两条记录都保留了', words2.length === 2, `实际 ${words2.length}`)
check('两条记录内容未被互相覆盖', words2.map((r) => r.wrongCount).join(',') === '1,2')

console.log('场景 3: 表只在单侧存在 (未来版本新增表) → 原样保留, 不丢数据')

const localExport3 = makeExport(3, {
  wordRecords: [{ word: 'apple', dict: 'cet4', chapter: 1, timeStamp: 1000, timing: [] }],
  someFutureTable: [{ extra: 'value', nested: { a: 1 } }],
  chapterRecords: [],
  reviewRecords: [],
})
const merged3 = mergeDexieExports(localExport3, makeExport(3, { wordRecords: [], chapterRecords: [], reviewRecords: [] }))
check('只在本地存在的未来表被保留', rowsOf(merged3, 'someFutureTable').length === 1)
const merged3b = mergeDexieExports(makeExport(3, { wordRecords: [], chapterRecords: [], reviewRecords: [] }), localExport3)
check('只在远端存在的未来表也被保留', rowsOf(merged3b, 'someFutureTable').length === 1)

console.log('场景 4: 未知表按整行内容去重 (同步传播产生的完全相同行只保留一份)')

const remoteExport4 = makeExport(3, {
  mysteryTable: [{ extra: 'value', nested: { a: 1 } }, { extra: 'other' }],
  wordRecords: [],
  chapterRecords: [],
  reviewRecords: [],
})
const localExport4 = makeExport(3, {
  mysteryTable: [{ nested: { a: 1 }, extra: 'value' }, { extra: 'local-only' }],
  wordRecords: [],
  chapterRecords: [],
  reviewRecords: [],
})
const merged4 = mergeDexieExports(localExport4, remoteExport4)
const mystery = rowsOf(merged4, 'mysteryTable')
check('未知表合并后 3 条 (内容相同行去重)', mystery.length === 3, `实际 ${mystery.length}: ${JSON.stringify(mystery)}`)

console.log('场景 5: 行上的 $types 类型标注字段随行一起保留')

const localExport5 = makeExport(3, {
  wordRecords: [
    { word: 'apple', dict: 'cet4', chapter: 1, timeStamp: 1000, timing: [80], $types: { '': 'userObject', timing: 'arrayNonindexKeys' } },
  ],
  chapterRecords: [],
  reviewRecords: [],
})
const merged5 = mergeDexieExports(localExport5, makeExport(3, { wordRecords: [], chapterRecords: [], reviewRecords: [] }))
check(
  '$types 被完整保留',
  JSON.stringify(rowsOf(merged5, 'wordRecords')[0].$types) === JSON.stringify({ '': 'userObject', timing: 'arrayNonindexKeys' }),
)

console.log('场景 6: 配置的三方合并')

const base = { pronunciation: '{"dict":"en","isOpen":true}', fontsize: '{"size":"md"}' }
const local6 = { ...base, fontSizeLocalOnly: 'x' }
const remote6 = { ...base, pronunciation: '{"dict":"us","isOpen":true}', remoteOnly: 'y' }

const merged6a = mergeConfigMaps(local6, remote6, base)
check('本地没动的配置 → 采纳远端新值', merged6a.pronunciation === remote6.pronunciation)
check('远端没动的配置 → 保留本地', merged6a.fontsize === base.fontsize)
check('本地独有配置保留', merged6a.fontSizeLocalOnly === 'x')
check('远端独有配置带入', merged6a.remoteOnly === 'y')

const local6b = { ...base, pronunciation: '{"dict":"au","isOpen":false}' }
const merged6b = mergeConfigMaps(local6b, remote6, base)
check('双端都改了同一配置 → 保留本地 (当前设备正在使用的值)', merged6b.pronunciation === local6b.pronunciation)

const merged6c = mergeConfigMaps(local6, remote6, local6)
check('首次在新设备启用 (base=本地) → 全部采纳远端', merged6c.pronunciation === remote6.pronunciation && merged6c.remoteOnly === 'y')

console.log('场景 7: databaseVersion 取较大者, 保持 schema 前向兼容')

const localExport7 = makeExport(3, { wordRecords: [], chapterRecords: [], reviewRecords: [] })
const remoteExport7 = makeExport(4, { wordRecords: [], chapterRecords: [], reviewRecords: [], newV4Table: [] })
check('合并后 databaseVersion = 4', mergeDexieExports(localExport7, remoteExport7).data.databaseVersion === 4)

console.log('场景 8: 学习会话 (practiceSessions) 按开始时间做并集, 同会话保留本地较新版本')

const localExport8 = makeExport(4, {
  wordRecords: [],
  chapterRecords: [],
  reviewRecords: [],
  practiceSessions: [
    { startTime: 1000, endTime: 1600, activeSeconds: 500, wordCount: 20, endedBy: 'idle' },
    { startTime: 5000, endTime: 5400, activeSeconds: 300, wordCount: 12, endedBy: 'live' },
  ],
})
const remoteExport8 = makeExport(4, {
  wordRecords: [],
  chapterRecords: [],
  reviewRecords: [],
  practiceSessions: [
    // 与本地第一条同一个会话(开始时间相同), 但内容更旧(落库时的中间态)
    { startTime: 1000, endTime: 1200, activeSeconds: 100, wordCount: 5, endedBy: 'live' },
    // 云端独有的一次会话(另一台设备练的)
    { startTime: 9000, endTime: 9300, activeSeconds: 250, wordCount: 18, endedBy: 'idle' },
  ],
})
const sessions8 = rowsOf(mergeDexieExports(localExport8, remoteExport8), 'practiceSessions')
check('会话并集后 3 条 (同开始时间只留一条)', sessions8.length === 3, `实际 ${sessions8.length}`)
check('同开始时间保留本地较新内容', sessions8.filter((row) => row.startTime === 1000)[0]?.wordCount === 20)
check(
  '云端独有会话被保留',
  sessions8.some((row) => row.startTime === 9000),
)
check('会话行 id 连续且无重复', sessions8.map((row) => row.id).join(',') === '1,2,3')

console.log('')

if (failures > 0) {
  console.error(`✗ 共 ${failures} 项断言失败`)
  process.exit(1)
} else {
  console.log('✓ 全部通过')
}
