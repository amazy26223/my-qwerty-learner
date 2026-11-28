# AGENTS.md

本仓库是 Qwerty Learner 的个人定制版（含云端同步）。**任何接手的新会话先读 [`docs/HANDOFF.md`](./docs/HANDOFF.md)**，里面有完整背景、已踩过的坑、待开发功能与验收标准。

## 三条硬约束

1. 改完代码必须 `npx tsc --noEmit` 通过（0 错误）
2. 任何云同步相关改动，必须保证"只做并集合并、不覆盖、不丢记录"
3. push `master` 会自动部署 GitHub Pages；必须轮询 Actions 到 success 并打开线上地址确认页脚 `Build` 为新 commit

## 关键路径

- 云同步实现：`src/utils/cloud-sync/`
- 云同步 UI：`src/pages/Typing/components/Setting/DataSetting.tsx`
- 部署基路径：`src/utils/deployBase.ts`（上游写死 `/qwerty-learner` 的坑已修，勿回退）
- 构建拆包：`vite.config.ts` 的 `manualChunks`
- 数据库：`src/utils/db/index.ts`（RecordDB，v4 起含 `practiceSessions`）
- 学习记录（会话 + 时长统计）：`src/utils/practice/`（切分/回填/记录器/聚合）+ `src/pages/Records/`（`/records` 页面）

## 线上

- 主站：https://amazy26223.github.io/my-qwerty-learner/
- 数据备份仓库：https://github.com/amazy26223/qwerty-learner-backup （private）
