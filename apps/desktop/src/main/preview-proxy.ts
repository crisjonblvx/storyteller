import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runFfprobe } from './ffprobe.js'
import { getFfmpegPath } from './ffmpeg-audio.js'

/**
 * Chromium ships H.264, VP8/9, and AV1 decoders only — no HEVC, no ProRes,
 * no DNxHR, no MPEG-2. When `<video>` rejects a source with `MediaError
 * code = 4`, we generate a baseline H.264 + AAC `.mp4` sidecar in the user
 * data dir and serve *that* to the player. The original file is never
 * touched and remains canonical for export; the proxy is a disposable
 * preview asset.
 *
 * Cache key: sha1(absolutePath + size + mtime). That hits 100% on
 * unchanged sources and re-encodes automatically if the user replaces the
 * file at the same path. Mismatched proxies (older size/mtime) are
 * orphaned, not cleaned — the directory is small (200kbps preview-grade
 * H.264) so we let it accumulate until we add a janitor pass.
 *
 * Codec policy:
 *   - If source video is already H.264/VP9/AV1 AND audio is AAC/Opus/MP3,
 *     we skip transcoding and return the original path. The renderer then
 *     plays the original directly with no quality loss.
 *   - Otherwise, transcode video to H.264 yuv420p (baseline-friendly
 *     pixel format Chromium will always decode), audio to AAC LC. Capped
 *     at 720p long-edge to keep proxies small — this is *preview* quality.
 *   - `+faststart` so the moov atom is at the front; `<video>` can start
 *     playing before the file is fully read, which we need because the
 *     stream comes in via `storyteller-media://` Range requests.
 */

const PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis'])

const TARGET_LONG_EDGE = 1280
const TARGET_VIDEO_BITRATE = '1500k'
const TARGET_AUDIO_BITRATE = '128k'

const inflight = new Map<string, Promise<EnsureProxyResult>>()

/**
 * Accept any of: an absolute disk path, a `file://` URI, or a
 * `storyteller-media://media/...` URL, and return a real disk path that
 * Node's `fs` can read. We normalize at the boundary so callers can pass
 * whichever form they have without thinking about it — and so a wrong
 * form fails loudly with a useful error rather than silently `existsSync`
 * → false.
 */
function normalizeToDiskPath(raw: string): string {
  if (raw.startsWith('storyteller-media://')) {
    try {
      const u = new URL(raw)
      // host is "media", pathname carries the absolute disk path (URI-encoded)
      return decodeURIComponent(u.pathname)
    } catch {
      return raw
    }
  }
  if (raw.startsWith('file://')) {
    try {
      const u = new URL(raw)
      return decodeURIComponent(u.pathname)
    } catch {
      // crude fallback for malformed URIs
      return decodeURIComponent(raw.replace(/^file:\/+/, '/'))
    }
  }
  return raw
}

export type EnsureProxyOk = {
  ok: true
  /** Absolute path to the playable file — may be the source if already supported. */
  playablePath: string
  /** True when the source was already playable; false when a proxy was used. */
  usedSource: boolean
  /** Absolute path to the proxy file (same as playablePath when usedSource is false). */
  proxyPath: string | null
  /** ms it took to satisfy this request; 0 when served from cache. */
  durationMs: number
  /** "cache" | "transcoded" | "skipped" — useful for renderer telemetry. */
  outcome: 'cache' | 'transcoded' | 'skipped'
  /** Original codec info we probed before deciding. */
  source: {
    codecVideo: string | null
    codecAudio: string | null
  }
}

export type EnsureProxyErr = {
  ok: false
  error: string
  code:
    | 'INVALID_PATH'
    | 'SOURCE_MISSING'
    | 'PROBE_FAILED'
    | 'FFMPEG_FAILED'
    | 'PROXY_DIR_FAILED'
}

export type EnsureProxyResult = EnsureProxyOk | EnsureProxyErr

function getProxyDir(): string {
  return join(app.getPath('userData'), 'preview-proxies')
}

async function ensureProxyDir(): Promise<string> {
  const dir = getProxyDir()
  await mkdir(dir, { recursive: true })
  return dir
}

function cacheKeyFor(absPath: string): string {
  const st = statSync(absPath)
  const h = createHash('sha1')
  h.update(absPath)
  h.update('|')
  h.update(String(st.size))
  h.update('|')
  h.update(String(Math.floor(st.mtimeMs)))
  return h.digest('hex').slice(0, 20)
}

async function fileLooksValid(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile() && s.size > 1024
  } catch {
    return false
  }
}

export async function ensurePreviewProxy(absPath: string): Promise<EnsureProxyResult> {
  if (typeof absPath !== 'string' || absPath.trim().length === 0) {
    console.warn('[preview-proxy] called with invalid path', { received: absPath })
    return { ok: false, error: 'Invalid path', code: 'INVALID_PATH' }
  }
  const sourcePath = normalizeToDiskPath(absPath.trim())
  if (!existsSync(sourcePath)) {
    console.warn('[preview-proxy] source file not found', {
      requested: absPath,
      normalized: sourcePath,
      length: sourcePath.length
    })
    return {
      ok: false,
      error: `Source file not found at ${sourcePath}`,
      code: 'SOURCE_MISSING'
    }
  }

  const existing = inflight.get(sourcePath)
  if (existing) return existing

  const work = (async (): Promise<EnsureProxyResult> => {
    const t0 = Date.now()
    const probed = await runFfprobe(sourcePath)
    if (!probed.ok) {
      return { ok: false, error: probed.error, code: 'PROBE_FAILED' }
    }
    const codecVideo = (probed.data.codecVideo || '').toLowerCase()
    const codecAudio = (probed.data.codecAudio || '').toLowerCase()

    const videoOk = !probed.data.hasVideoStream || PLAYABLE_VIDEO.has(codecVideo)
    const audioOk = !probed.data.hasAudioStream || PLAYABLE_AUDIO.has(codecAudio)
    if (videoOk && audioOk) {
      return {
        ok: true,
        playablePath: sourcePath,
        usedSource: true,
        proxyPath: null,
        durationMs: Date.now() - t0,
        outcome: 'skipped',
        source: { codecVideo: codecVideo || null, codecAudio: codecAudio || null }
      }
    }

    let dir: string
    try {
      dir = await ensureProxyDir()
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message || 'Failed to create proxy directory',
        code: 'PROXY_DIR_FAILED'
      }
    }
    const key = cacheKeyFor(sourcePath)
    const proxyPath = join(dir, `${key}.mp4`)

    if (await fileLooksValid(proxyPath)) {
      return {
        ok: true,
        playablePath: proxyPath,
        usedSource: false,
        proxyPath,
        durationMs: Date.now() - t0,
        outcome: 'cache',
        source: { codecVideo: codecVideo || null, codecAudio: codecAudio || null }
      }
    }

    const tmpPath = `${proxyPath}.partial`
    const transcodeRes = await runTranscode(sourcePath, tmpPath, probed.data)
    if (!transcodeRes.ok) {
      return { ok: false, error: transcodeRes.error, code: 'FFMPEG_FAILED' }
    }

    try {
      await stat(tmpPath)
    } catch {
      return { ok: false, error: 'ffmpeg produced no output file', code: 'FFMPEG_FAILED' }
    }
    const fs = await import('node:fs/promises')
    try {
      await fs.rename(tmpPath, proxyPath)
    } catch (e) {
      try {
        await fs.copyFile(tmpPath, proxyPath)
        await fs.unlink(tmpPath).catch(() => {})
      } catch {
        return {
          ok: false,
          error: (e as Error).message || 'Failed to finalize proxy file',
          code: 'FFMPEG_FAILED'
        }
      }
    }

    return {
      ok: true,
      playablePath: proxyPath,
      usedSource: false,
      proxyPath,
      durationMs: Date.now() - t0,
      outcome: 'transcoded',
      source: { codecVideo: codecVideo || null, codecAudio: codecAudio || null }
    }
  })()

  inflight.set(sourcePath, work)
  try {
    const result = await work
    return result
  } finally {
    inflight.delete(sourcePath)
  }
}

async function runTranscode(
  sourcePath: string,
  outputPath: string,
  probe: { width: number | null; height: number | null; hasVideoStream: boolean; hasAudioStream: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ffmpeg = (() => {
    try {
      return getFfmpegPath()
    } catch {
      return null
    }
  })()
  if (!ffmpeg) {
    return { ok: false, error: 'ffmpeg-static did not provide a binary path' }
  }

  const wantsScale =
    probe.hasVideoStream &&
    typeof probe.width === 'number' &&
    typeof probe.height === 'number' &&
    Math.max(probe.width, probe.height) > TARGET_LONG_EDGE
  const scaleFilter = wantsScale
    ? `scale='if(gt(iw,ih),min(${TARGET_LONG_EDGE},iw),-2)':'if(gt(ih,iw),min(${TARGET_LONG_EDGE},ih),-2)'`
    : null

  const args: string[] = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    sourcePath
  ]

  if (probe.hasVideoStream) {
    args.push(
      '-map',
      '0:v:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      TARGET_VIDEO_BITRATE,
      '-maxrate',
      TARGET_VIDEO_BITRATE,
      '-bufsize',
      '3000k',
      '-profile:v',
      'main',
      '-level',
      '4.0'
    )
    if (scaleFilter) args.push('-vf', scaleFilter)
  } else {
    args.push('-vn')
  }

  if (probe.hasAudioStream) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', TARGET_AUDIO_BITRATE, '-ac', '2', '-ar', '44100')
  } else {
    args.push('-an')
  }

  args.push('-movflags', '+faststart', '-f', 'mp4', outputPath)

  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString()
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: e.message || 'Failed to spawn ffmpeg' })
    })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: err.trim().slice(-2000) || `ffmpeg exited with code ${code ?? 'unknown'}`
        })
      } else {
        resolve({ ok: true })
      }
    })
  })
}
