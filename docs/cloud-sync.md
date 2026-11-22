# 云端同步使用说明（GitHub 私有仓库方案）

Qwerty Learner 的学习记录原本**只保存在浏览器本地**（IndexedDB + localStorage），换设备、换浏览器或清理浏览器数据都会丢进度。本项目内置了「云端同步」功能：把你的学习记录与全部配置自动备份到**你自己的 GitHub 私有仓库**，多设备间自动同步，数据始终保留。

## 一次性配置（约 5 分钟）

### 1. 创建私有仓库

在 GitHub 上新建一个 **Private** 仓库（例如 `qwerty-learner-backup`），不需要勾选任何初始化文件。私有仓库只有你自己可见，学习数据不会公开。

### 2. 创建 Fine-grained Token

打开 [GitHub Settings → Developer settings → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new)：

- **Token name**：随意，如 `qwerty-learner-sync`
- **Expiration**：按需（到期后需重新生成并更新）
- **Repository access**：选择 **Only select repositories**，勾选刚才那个私有仓库
- **Permissions → Repository permissions → Contents**：设为 **Read and write**（其它权限一律不勾）

生成后复制 `github_pat_...` 开头的 Token。

### 3. 在应用中填写

启动应用 → 打开 **设置 → 数据设置 → 云端同步**，填入：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| Owner | GitHub 用户名 | `RealKai42` |
| Repo | 私有仓库名 | `qwerty-learner-backup` |
| 备份文件路径 | 数据文件在仓库中的位置 | `qwerty-learner-backup/data.gz` |
| Token | 上一步生成的 Token | `github_pat_...` |

打开「开启云端同步」开关，点「保存设置」，然后点「**立即同步**」即可完成首次上传。Token 只保存在本浏览器的 localStorage 中，**不会**包含在云端备份文件里。

## 日常使用

配置完成后完全无需手动操作：

- **启动应用时**：自动拉取云端较新的数据（下载完成后页面会自动刷新一次，使配置生效）
- **完成章节练习后**：约 30 秒后自动上传（期间继续练习会自动顺延；切走标签页时立即上传）
- **多设备都有新记录时**：自动做**记录级合并**——两台设备各自练的词都会保留，不会互相覆盖；配置按键级三方合并

也可以随时在设置里手动点「立即同步」（智能判断方向）、「仅上传」（用本地覆盖云端）或「仅下载」（用云端覆盖本地，慎用）。

## 数据说明

- 备份文件内容：RecordDB 全库（wordRecords / chapterRecords / reviewRecords 等）+ localStorage 配置快照，gzip 压缩后以 base64 存为仓库中的一个文件
- 每次上传都是一次 Git commit，**历史版本全部保留**——即使某次同步出了问题，也可以在仓库的 commit 历史里找回任意旧版本
- 同步状态（上次同步时间、哈希）保存在本地，用于判断本地/云端哪边有变化

## 新设备接入

在新电脑/新浏览器上部署同一份应用（见下），打开设置填入**同样的** GitHub 配置，开启同步后首次启动会自动把云端数据完整拉下来。

## 常见问题

- **官方在线站能用这个功能吗？** 不能，官方站没有部署这份改动。需要自己部署：`docker compose up`（仓库自带 `docker-compose.yaml`，端口 8990），或一键部署到 Vercel（README 中的 Deploy 按钮），或本地 `yarn && yarn dev` 后访问 `localhost:5173`。
- **Token 泄露了怎么办？** 到 GitHub Settings 里 Revoke 该 Token 并重新生成；数据仓库本身建议保持 Private。
- **两台设备同时练习会丢数据吗？** 不会。双端都有新记录时自动走记录级合并，两边的记录全部保留。
- **想彻底重置云端数据？** 直接删除仓库中的备份文件（或删掉整个仓库重建），然后在新设备上点「仅上传」。
- **移动端页面呢？** 启动时自动拉取对移动端同样生效；移动端页面暂未接入练习完成后的自动上传，可手动在桌面版触发。

## 与原有「数据导出/导入」的关系

原有的手动导出（`.gz` 文件下载）功能保持不变，适合一次性迁移或离线备份；云端同步是它的自动化替代，两者可以共存。
