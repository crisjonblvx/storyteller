import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEFAULT_PORT = 8787

let gatewayChild: ChildProcess | null = null
let startedByDesktop = false

/** `out/main` → monorepo root (`apps/desktop/out/main` → four levels up). */
export function resolveMonorepoRoot(mainBundleDir: string): string {
  return resolve(mainBundleDir, '../../../..')
}

function gatewayPort(): number {
  const raw = process.env.PORT ?? process.env.STORYTELLER_GATEWAY_PORT ?? String(DEFAULT_PORT)
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT
}

function isLocalGatewayUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/**
 * Whether the desktop app should spawn a local gateway child process.
 *
 * - `STORYTELLER_EMBED_GATEWAY=false` — never embed (use remote URL or manual `gateway:dev`).
 * - `STORYTELLER_EMBED_GATEWAY=true` — force embed even when a remote URL is set.
 * - unset — embed in dev when URL is unset or points at localhost; skip in packaged builds.
 */
export function shouldEmbedGateway(isPackaged: boolean): boolean {
  const flag = (process.env.STORYTELLER_EMBED_GATEWAY ?? '').trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'no' || flag === 'off') return false
  if (flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on') return true

  const explicitUrl = process.env.STORYTELLER_GATEWAY_URL?.trim()
  if (explicitUrl && !isLocalGatewayUrl(explicitUrl)) return false

  if (isPackaged) return false
  return true
}

async function gatewayAlreadyHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForGatewayHealthy(port: number, timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await gatewayAlreadyHealthy(port)) return true
    await sleep(400)
  }
  return false
}

function logGatewayStream(stream: NodeJS.ReadableStream | null, label: 'stdout' | 'stderr'): void {
  if (!stream) return
  stream.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        console.log(`[embedded-gateway:${label}]`, line)
      } catch {
        /* EPIPE-safe */
      }
    }
  })
}

/**
 * Start the Storyteller AI Gateway alongside the desktop app when appropriate.
 * Sets `STORYTELLER_GATEWAY_URL` on the main process when unset.
 */
export async function startEmbeddedGateway(opts: {
  mainBundleDir: string
  isPackaged: boolean
}): Promise<{ embedded: boolean; port: number; url: string | null }> {
  const port = gatewayPort()

  if (!shouldEmbedGateway(opts.isPackaged)) {
    return {
      embedded: false,
      port,
      url: process.env.STORYTELLER_GATEWAY_URL?.trim() || null
    }
  }

  const monorepoRoot = resolveMonorepoRoot(opts.mainBundleDir)
  const gatewayDir = join(monorepoRoot, 'apps/ai-gateway')
  const entry = join(gatewayDir, 'src/index.ts')
  const tsxBin = join(monorepoRoot, 'node_modules/.bin/tsx')

  if (!existsSync(entry) || !existsSync(tsxBin)) {
    console.warn(
      '[embedded-gateway] Gateway sources or tsx not found — skipping embed.',
      { gatewayDir, entry, tsxBin }
    )
    return { embedded: false, port, url: process.env.STORYTELLER_GATEWAY_URL?.trim() || null }
  }

  if (await gatewayAlreadyHealthy(port)) {
    const url = process.env.STORYTELLER_GATEWAY_URL?.trim() || `http://127.0.0.1:${port}`
    if (!process.env.STORYTELLER_GATEWAY_URL?.trim()) {
      process.env.STORYTELLER_GATEWAY_URL = url
    }
    console.log('[embedded-gateway] Reusing existing gateway on', url)
    return { embedded: false, port, url }
  }

  const localUrl = `http://127.0.0.1:${port}`
  if (!process.env.STORYTELLER_GATEWAY_URL?.trim()) {
    process.env.STORYTELLER_GATEWAY_URL = localUrl
  }

  gatewayChild = spawn(tsxBin, ['watch', 'src/index.ts'], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV ?? 'development'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  startedByDesktop = true

  logGatewayStream(gatewayChild.stdout, 'stdout')
  logGatewayStream(gatewayChild.stderr, 'stderr')

  gatewayChild.on('exit', (code, signal) => {
    if (startedByDesktop) {
      console.warn('[embedded-gateway] Child exited', { code, signal })
    }
    gatewayChild = null
    startedByDesktop = false
  })

  const healthy = await waitForGatewayHealthy(port)
  if (!healthy) {
    console.error('[embedded-gateway] Gateway did not become healthy in time.', localUrl)
    stopEmbeddedGateway()
    return { embedded: false, port, url: null }
  }

  console.log('[embedded-gateway] Listening at', localUrl)
  return { embedded: true, port, url: localUrl }
}

/** Stop the gateway child we spawned (no-op if reusing an external process). */
export function stopEmbeddedGateway(): void {
  if (!gatewayChild || !startedByDesktop) return
  const child = gatewayChild
  gatewayChild = null
  startedByDesktop = false
  try {
    child.kill('SIGTERM')
  } catch {
    /* already dead */
  }
}
