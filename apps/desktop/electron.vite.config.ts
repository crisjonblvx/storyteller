import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

/** Workspace packages ship TypeScript entrypoints; bundling avoids Node loading `.ts` at runtime. */
const mainBundleWorkspacePkgs = [
  '@storyteller/ai-gateway',
  '@storyteller/exporters',
  '@storyteller/media',
  '@storyteller/transcription',
  '@storyteller/shared',
  '@storyteller/timeline',
  '@storyteller/analysis'
]

/**
 * Pick the closest `.env` for VITE_* vars, in order of preference.
 * The renderer's effective project root is `apps/desktop/src/renderer`, so by
 * default Vite would only see env files there. We bubble up to support
 * `apps/desktop/.env` and the **repo root** `.env` for monorepo convenience.
 */
function resolveRendererEnvDir(): string {
  const candidates = [
    resolve(root, 'src/renderer'),
    resolve(root),
    resolve(root, '../..')
  ]
  for (const dir of candidates) {
    if (existsSync(resolve(dir, '.env')) || existsSync(resolve(dir, '.env.local'))) {
      return dir
    }
  }
  return resolve(root)
}

const sharedEnvDir = resolveRendererEnvDir()

export default defineConfig({
  main: {
    envDir: sharedEnvDir,
    plugins: [
      externalizeDepsPlugin({
        exclude: mainBundleWorkspacePkgs
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    envDir: resolveRendererEnvDir(),
    resolve: {
      alias: {
        '@renderer': resolve(root, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
