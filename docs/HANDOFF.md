# 交接文档（HANDOFF）

> 这份文档给「接手本项目的新会话」看。读完再动手，可以不问用户任何背景问题。

## 0. 一句话定位

这是 [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner) 的**个人定制版**：
在保留原功能的基础上，加装了**云端同步（GitHub 私有仓库）**，并修复了上游若干部署与音频缺陷。
当前已上线，用户每天在用它练 CET-6。

## 1. 工作区与仓库

| 项 | 值 |
| --- | --- |
| 本地工作区（本目录） | `E:\Workspace\Projects\qwerty-learner` |
| 代码仓库 | https://github.com/amazy26223/my-qwerty-learner （public，GitHub Pages 需要） |
| 数据备份仓库 | https://github.com/amazy26223/qwerty-learner-backup （**private**，存 `qwerty-learner-backup/data.gz`） |
| 线上地址（主用，免代理） | https://amazy26223.github.io/my-qwerty-learner/ |
| 线上地址（备用，需代理） | https://my-qwerty-learner-rosy.vercel.app/ |
| 上游基线 | `RealKai42/qwerty-learner` master，提交 `1d77c45` |

分支：`master`。推送 `master` 会**自动触发 GitHub Pages 构建部署**（约 1~2 分钟）。

## 2. 技术栈与常用命令

- React 18 + TypeScript + Vite 4 + Tailwind + jotai + Dexie(IndexedDB) + howler
- 安装：`npm install`（仓库里有 `yarn.lock`，但环境里常用 npm；node_modules 已就绪）
- 类型检查：`npx tsc --noEmit`（**改完代码必须跑，要求 0 错误**）
- 本地开发：`npm run dev` → http://localhost:5173
- 构建（GitHub Pages 口径）：`REACT_APP_DEPLOY_ENV=pages npx vite build --base=./` → 产物在 `build/`
- 构建（Vercel 口径）：`npm run build`（`vercel.json` 已指定 outputDirectory=build）

## 3. 对上游做过的改动（按文件）

### 3.1 云同步（核心新增）
| 文件 | 作用 |
| --- | --- |
| `src/utils/cloud-sync/index.ts` | 同步编排：智能方向判断、上传/拉取/合并、GitHub Contents API、跨标签页锁、网络重试、错误文案中文化 |
| `src/utils/cloud-sync/engine.ts` | 快照引擎：Dexie 全库导出 + localStorage 配置 → gzip → base64；Dexie 写钩子做脏标记 |
| `src/utils/cloud-sync/merge.ts` | 记录级合并：wordRecords/chapterRecords/reviewRecords 按自然键并集；`wordRecordIds` 跨表引用重编址；配置键级三方合并 |
| `src/utils/cloud-sync/storage.ts` | 配置/状态持久化（localStorage）、脏标记 |
| `src/utils/cloud-sync/notice.ts` | 顶部红色/绿色提示横幅 |
| `src/utils/cloud-sync/types.ts` | 类型定义 |
| `src/pages/Typing/components/Setting/DataSetting.tsx` | 「设置 → 数据设置 → 云端同步」UI |
| `docs/cloud-sync.md` | 用户文档（配置步骤、FAQ、排障） |

### 3.2 部署与构建
| 文件 | 改动 |
| --- | --- |
| `.github/workflows/deploy-pages.yml` | 换成免密钥的 `actions/deploy-pages@v4` 流程 |
| `.github/workflows/e2e.yml` | 改为 `workflow_dispatch`（上游 e2e 在本仓库必失败，避免红色噪音） |
| `vercel.json` | 指定 `outputDirectory: build` |
| `src/utils/deployBase.ts` | **按实际访问路径推导基路径**，取代上游写死的 `/qwerty-learner`（否则换仓库名部署会词典 404、路由失效） |
| `src/utils/wordListFetcher.ts` / `src/resources/soundResource.ts` | 改用 `getDeployBasePath()` |
| `vite.config.ts` | `manualChunks` 拆分第三方依赖（入口包从 1.6MB 降到 331KB，抗网络中断） |
| `index.html` | 脚本加载失败自动重试一次（防白屏）+ 长尾 SEO 保留 |

### 3.3 音频
| 文件 | 改动 |
| --- | --- |
| `src/hooks/usePronunciation.ts` | 弃用 Howler，改原生 `Audio` + LRU 缓存 + 预取共用缓存 + 失败重试；修复「偶发无声、手动点才有声」 |
| `src/pages/Typing/components/WordPanel/components/Word/index.tsx` | 换词自动播放去重（避免同一词触发两次互相打断） |

## 4. 云同步机制要点（修改前必读，这些坑都踩过）

1. **数据流**：本地 Dexie 全库 + localStorage 配置 → gzip → base64 → GitHub Contents API 单文件
2. **冲突策略**：记录级并集合并（不是覆盖），配置文件级三方合并
3. **脏标记**：Dexie 三个写钩子（creating/updating/deleting）标记 `localDirty`
4. **触发点**：应用启动（`initCloudSyncOnStartup`）、切回页面（`initCloudSyncOnFocus`）、章节完成后 30 秒防抖（`scheduleAutoUpload`）
5. **踩过的坑（勿回退）**：
   - GitHub API 响应带 `max-age=60` 缓存 → 命中缓存会拿到**过期 sha** → PUT 409。修复：URL 追加变化参数 `?_=<时间戳>` 做 cache buster
   - **不要**用 `Cache-Control`/`Pragma` 请求头绕缓存：不在 GitHub CORS 白名单，预检失败 → `Failed to fetch`
   - 需要跨标签页互斥锁（localStorage 锁），否则多页面同时写会撞 409
   - 网络类失败要自动重试（`fetchWithRetry`，3 次退避 + 25s 超时），且**静默重试一次仍失败**才提示用户
   - 内容与上次同步哈希一致时不要重复上传（避免刷提交历史）

## 5. 数据现状（2026-11-28 备份实测，供功能设计参考）

- 词记录 **1865** 条 / 章节记录 **92** 条 / 复习记录 **0** 条，全部 `cet6`
- 4 天练习（11-24、25、27、28；11-26 断练），10 个会话，单会话 4~28 分钟，集中在晚间 20:30–23:30
- WPM 趋势 16.6 → 20.0 → 19.4 → **23.1**；每章错键 4.0 → **2.4**；按键正确率 97.2% → **98.6%**
- 进度：练到第 50 章（约 118 章的 42%），接触 441 个不同词（全书 18.8%），平均每词练 4.2 次
- 复习间隔中位数 **18.3 小时**，`>3 天` 为 0（复习节奏健康）
- **41% 的词出过错**（181/441），但错题本复习 0 次
- 易错字母：`e`(54) `a`(44) `i`(39)；典型错按 `e→i` 14 次、`a→e` 8 次、`e→a` 8 次 → **元音混淆**为主
- 长单词极慢：`inherit` 单次 9976ms、`paralyze` 8071ms（中位章节 61 秒/20 词）

## 6. 待开发功能（已与用户确认的范围）

### A. 会话记录 + 时长统计（P0，必需）
- 新 Dexie 表 `practiceSessions`（DB 升到 version 4），**随云同步自动备份**（全库导出已覆盖）
- 字段：`startTime, endTime, activeSeconds, totalSeconds, chapterCount, wordCount, uniqueWordCount, correctCount, wrongCount, dicts[], chapters[], avgWpm, accuracy, endedBy`
- 切分规则：相邻记录间隔 **> 5 分钟**断开
- 双口径：`activeSeconds = Σ min(间隔, 60s)`；`totalSeconds = 末 − 首`
- 历史回填：用现有 `wordRecords`/`chapterRecords` 的 `timeStamp` 一次性重建（不改动原始记录）
- UI：**新建独立页面 `/records`**，顶部工具栏加图标入口（挨着「查看数据统计」）
- 页面内容：今日/本周/累计卡片 + 连续天数、近 14 天活跃时长柱状图、按天分组的会话列表

### B. 键位错误热图（P1）
- 现有 `Analysis` 页的「按键错误次数排行」统计的是**按错的键的绝对次数**（`e/a/i` 天然高频，误导），需重做指标
- 新指标：**错误率** = 该字母出错次数 ÷ 该字母出现总次数（分母由所有词记录字母频次得出）
- 混淆矩阵：`目标字母 → 实际按成什么`（TOP 榜）
- 键盘热图：QWERTY 三行布局，5 档配色，悬停显示详情
- 数据源：`wordRecords.mistakes`（结构 `{ [字母索引]: [按错的键...] }`）

### 暂缓（用户明确说先不做）
- 每日目标 + 达成率
- 错词掌握度 + 间隔重复复习队列
- 单词档案页、学习日历打卡

## 7. 代码约定与验收标准

- **TypeScript 零错误**：改完 `npx tsc --noEmit` 必须 exit 0
- **不引入新依赖**（除非确有必要）：图表用纯 CSS/div 或已有 echarts
- **新建表/改 schema**：记得 Dexie `this.version(N).stores({...})` 递增，并确认云同步导出/导入能带上
- **改完必须部署验证**：push 后轮询 GitHub Actions 到 `conclusion=success`，再打开线上地址（可在 URL 加 `?v=<commit>` 绕缓存）确认页脚 Build = 新 commit
- **数据安全**：任何同步逻辑改动都要保证「不覆盖、不丢记录」，合并只做并集

## 8. 常用排查手段

| 场景 | 做法 |
| --- | --- |
| 同步失败 | 页面顶部横幅有具体原因；控制台 `__qwertyAudio` 是音频统计，同步状态看 `localStorage.cloudSyncState` |
| 确认是否上传成功 | 查备份仓库提交历史，每次成功都有 `chore(cloud-sync): 备份学习数据 <时间>` 提交 |
| 解析备份内容 | `pako.ungzip` 解 gzip → JSON，结构是 dexie-export-import 格式：`payload.database.data.tables`(元数据) / `payload.database.data.data`(行数据) |
| 线上加载不出来 | 先看是不是 `build/` 产物路径或 basename 问题；`deployBase.ts` 负责子路径 |

## 9. 用户偏好（重要）

- 中文交流；结论先行，给可验证的证据（抓包/文件/实测），不要只说"应该可以"
- 用户会用截图报障，但当前环境**读图能力不稳定**（modlens 常失败），优先用日志/文件/命令自行取证
- 改完要告诉用户**具体怎么验收**（打开哪个地址、看哪里的数字、按哪个键刷新）
