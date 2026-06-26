import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
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
  '@storyteller/analysis',
  '@storyteller/audio'
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

/**
 * Load all env vars (no prefix filter) from the repo .env at build time so
 * non-VITE_ keys like OPENAI_API_KEY can be baked into the main-process
 * bundle via `define`. In a packaged Electron app the .env file is never
 * present on disk, so dotenv.config() in index.ts finds nothing — the only
 * reliable way to deliver secrets is to embed them at compile time.
 */
const buildEnv = loadEnv('production', sharedEnvDir, '')
const bake = (key: string): string =>
  JSON.stringify(process.env[key] ?? buildEnv[key] ?? '')

export default defineConfig({
  main: {
    envDir: sharedEnvDir,
    define: {
      'process.env.OPENAI_API_KEY': bake('OPENAI_API_KEY'),
      'process.env.OPENAI_MODEL': bake('OPENAI_MODEL'),
      'process.env.STORYTELLER_REVIEW_MODEL': bake('STORYTELLER_REVIEW_MODEL'),
      'process.env.STORYTELLER_REVIEW_PROVIDER': bake('STORYTELLER_REVIEW_PROVIDER'),
      'process.env.STORYTELLER_AI_MODE': bake('STORYTELLER_AI_MODE'),
      'process.env.STORYTELLER_WHISPER_CONCURRENCY': bake('STORYTELLER_WHISPER_CONCURRENCY'),
      'process.env.STORYTELLER_DIRECTOR_MAX_CANDIDATES': bake('STORYTELLER_DIRECTOR_MAX_CANDIDATES'),
      'process.env.STORYTELLER_BUILD_SHA': bake('STORYTELLER_BUILD_SHA'),
    },
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
