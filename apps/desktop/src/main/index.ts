const { app, BrowserWindow, protocol } = await import('electron')
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { autoUpdater } from 'electron-updater'
import { registerIpc } from './ipc.js'
import { startEmbeddedGateway, stopEmbeddedGateway } from './embedded-gateway.js'
import {
  registerMediaProtocolHandler,
  registerMediaProtocolSchemes
} from './media-protocol.js'

registerMediaProtocolSchemes()

/**
 * macOS + Chromium crash the GPU process (exit_code=15 / SIGTERM) during
 * Metal/GPU driver initialization on some hardware. Disable hardware
 * acceleration entirely so the GPU process is never spawned; this prevents
 * the cascade of Audio/Network/renderer kills seen at startup.
 * Must be called before app.whenReady().
 */
if (process.platform === 'darwin') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-accelerated-video-decode')
  app.commandLine.appendSwitch('disable-gpu')
  // macOS screenshot (Cmd+Shift+4 etc.) fires a display notification to all windows.
  // Even with disable-gpu set, Chromium's compositor path can engage and kill the GPU
  // process (exit_code=15). disable-gpu-compositing prevents the compositor from
  // activating, and in-process-gpu keeps the GPU thread inside the main process so a
  // crash there cannot cascade into the renderer.
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  // Force all GL operations through SwiftShader (CPU-based software renderer).
  // Even with disable-gpu set, Chromium's media pipeline can still reach into
  // Metal/OpenGL hardware paths when a <video> element starts playback — this is
  // what kills the Audio/Network services (exitCode=15) on the cascade. SwiftShader
  // is the single most reliable fix: it replaces the entire GL backend with a
  // software path so no hardware GPU context is ever created.
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
  // Disable remaining hardware decode/encode paths that survive disable-gpu:
  //   VaapiVideoDecoder/Encoder  — Linux VA-API hardware codec (harmless on macOS but
  //                                included for completeness in packaged builds)
  //   VideoToolboxVideoDecoder   — macOS-specific hardware decoder; this is the path
  //                                most likely responsible for the Audio Service crash
  //   HardwareMediaKeyHandling   — prevents media key events from touching hardware
  //   UseSkiaRenderer            — forces the legacy raster compositor instead of Skia
  //                                GPU renderer, removing another GPU activation point
  //   AudioServiceOutOfProcess   — keeps the audio service in-process so a crash there
  //                                cannot cascade into the Network Service + renderer
  app.commandLine.appendSwitch(
    'disable-features',
    'VaapiVideoDecoder,VaapiVideoEncoder,VideoToolboxVideoDecoder,HardwareMediaKeyHandling,UseSkiaRenderer,AudioServiceOutOfProcess'
  )
}

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * On some environments (especially when launched from wrappers or when stdio
 * pipes are closed), `console.log/error` can throw `EPIPE`. Main-process
 * diagnostics must never crash the app, so we guard dev logging.
 */
function safeConsole(
  method: 'log' | 'error',
  ...args: unknown[]
): void {
  try {
    console[method](...args)
  } catch (err) {
    const code =
      (typeof err === 'object' && err !== null && 'code' in err && err.code) || 'unknown'
    if (code !== 'ERR_MODULE_NOT_FOUND') {
      // swallow EPIPE, module not found during dev, etc
    }
  }
}

/**
 * Load .env from the app dir and the repo root (monorepo convenience).
 * A bare `dotenv.config()` only reads from cwd, which varies by launcher —
 * resolve against this bundle's location (out/main) so it works everywhere.
 * dotenv never overrides already-set vars, so app-local values win.
 */
dotenv.config({ path: resolve(__dirname, '../../.env') })
dotenv.config({ path: resolve(__dirname, '../../../../.env') })
dotenv.config()

/**
 * In packaged builds, fall back to the production AI gateway if no explicit URL
 * is configured. Replace this URL once you have deployed `apps/ai-gateway`.
 * Developers override this via STORYTELLER_GATEWAY_URL in their local .env.
 */
const PRODUCTION_GATEWAY_URL = 'https://storyteller-api.contentcreators.life'
if (app.isPackaged && !process.env.STORYTELLER_GATEWAY_URL?.trim()) {
  process.env.STORYTELLER_GATEWAY_URL = PRODUCTION_GATEWAY_URL
}


const embeddedGateway = await startEmbeddedGateway({
  mainBundleDir: __dirname,
  isPackaged: app.isPackaged
})
if (embeddedGateway.url) {
  safeConsole('log', '[storyteller] AI gateway URL:', embeddedGateway.url)
}

registerIpc()

app.on('child-process-gone', (_event, details) => {
  safeConsole('error', '[electron] child process gone', details)
})

app.on('render-process-gone', (_event, _webContents, details) => {
  safeConsole('error', '[electron] render process gone', details)
})

app.on('before-quit', () => {
  stopEmbeddedGateway()
})

// Start the app and open a window...
;(async () => {
  await app.whenReady()

  registerMediaProtocolHandler()

  protocol.handle('storyteller', async (request) => {
    const path = request.url.slice('storyteller://'.length)
    const response = await fetch(`http://localhost:5173/${path}`)
    const data = await response.arrayBuffer()
    return new Response(data, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    })
  })

  // electron-vite injects ELECTRON_RENDERER_URL when running `electron-vite dev`.
  // Fall back to probing the default dev-server port for robustness.
  let devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (!devServerUrl) {
    try {
      const response = await fetch('http://localhost:5173/src/main.tsx', { method: 'HEAD' })
      if (response.ok || response.status === 405) {
        devServerUrl = 'http://localhost:5173/'
      }
    } catch {
      // dev server not running — production mode
    }
  }

  const mainWindow = new BrowserWindow({
    webPreferences: {
      // ESM preloads (.mjs) require sandbox:false; contextIsolation still protects the renderer.
      sandbox: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.mjs')
    },
    // Opaque background prevents a blank-flash repaint during macOS display events
    // (screenshots, display sleep/wake) that can otherwise tickle the compositor path.
    backgroundColor: '#000000',
    icon: resolve(__dirname, '../../src/logo.png')
  })

  // Prevent Chromium from throttling or suspending the compositor when the window
  // loses visibility briefly — this is what happens during macOS screenshot overlays.
  mainWindow.webContents.setBackgroundThrottling(false)

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL('storyteller://index.html')
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Recreate window...
    }
  })

  // Auto-updater: only runs in packaged builds, silently checks for updates.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify()
  }
})().catch(safeConsole.bind(null, 'error'))
