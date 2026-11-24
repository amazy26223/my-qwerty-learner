import react from '@vitejs/plugin-react'
import { promises as fs } from 'fs'
import { getLastCommit } from 'git-last-commit'
import jotaiDebugLabel from 'jotai/babel/plugin-debug-label'
import jotaiReactRefresh from 'jotai/babel/plugin-react-refresh'
import path from 'node:path'
import { visualizer } from 'rollup-plugin-visualizer'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vite'
import type { PluginOption } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const latestCommitHash = await new Promise<string>((resolve) => {
    return getLastCommit((err, commit) => (err ? 'unknown' : resolve(commit.shortHash)))
  })
  return {
    plugins: [
      react({ babel: { plugins: [jotaiDebugLabel, jotaiReactRefresh] } }),
      visualizer() as PluginOption,
      Icons({
        compiler: 'jsx',
        jsx: 'react',
        customCollections: {
          'my-icons': {
            xiaohongshu: () => fs.readFile('./src/assets/xiaohongshu.svg', 'utf-8'),
          },
        },
      }),
    ],
    build: {
      minify: true,
      outDir: 'build',
      sourcemap: false,
      rollupOptions: {
        output: {
          /**
           * 拆分第三方依赖, 避免产出单个 ~1.6MB 的入口包。
           * 原因: GitHub Pages 在国内网络下大文件下载容易被中断(ERR_CONNECTION_CLOSED → 白屏),
           * 拆成多个小包后浏览器可并行下载, 单个包中断也只影响局部, 且配合 index.html 的重试脚本能自愈。
           */
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            const rest = id.split('node_modules/')[1] ?? ''
            const pkg = rest.startsWith('@') ? rest.split('/').slice(0, 2).join('/') : rest.split('/')[0]

            if (['react', 'react-dom', 'scheduler'].includes(pkg)) return 'react-vendor'
            if (pkg.startsWith('@radix-ui') || pkg.startsWith('@headlessui') || pkg.startsWith('@floating-ui')) return 'ui-vendor'
            if (['howler', 'use-sound'].includes(pkg)) return 'audio-vendor'
            if (['mixpanel-browser'].includes(pkg)) return 'analytics-vendor'
            if (['dexie', 'dexie-export-import', 'dexie-react-hooks', 'pako', 'file-saver'].includes(pkg)) return 'data-vendor'
            return 'vendor'
          },
        },
      },
    },
    esbuild: {
      drop: mode === 'development' ? [] : ['console', 'debugger'],
    },
    define: {
      REACT_APP_DEPLOY_ENV: JSON.stringify(process.env.REACT_APP_DEPLOY_ENV),
      LATEST_COMMIT_HASH: JSON.stringify(latestCommitHash + (process.env.NODE_ENV === 'production' ? '' : ' (dev)')),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
  }
})
