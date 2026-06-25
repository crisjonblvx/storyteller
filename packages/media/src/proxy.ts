/**
 * Proxy Generation for Storyteller
 *
 * Generates lightweight H.264/AAC proxies for:
 * - Efficient preview playback in the editor
 * - Whisper-sized audio chunks for transcription
 * - Network-efficient uploads when cloud sync is enabled
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, basename, extname } from 'node:path'
import { existsSync } from 'node:fs'

/** Proxy generation settings */
export interface ProxySettings {
  /** Target video width (height calculated to maintain aspect) */
  width: number
  /** Video bitrate in kbps */
  videoBitrateKbps: number
  /** Audio bitrate in kbps */
  audioBitrateKbps: number
  /** Frame rate (0 = same as source) */
  fps: number
}

/** Default proxy settings optimized for preview + transcription */
export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  width: 1280,           // 720p width - good balance of quality/size
  videoBitrateKbps: 2500, // 2.5 Mbps - smooth playback
  audioBitrateKbps: 128,  // AAC 128kbps - good for speech
  fps: 0                   // Preserve original frame rate
}

/** Lightweight proxy settings for very large files or slow connections */
export const LIGHTWEIGHT_PROXY_SETTINGS: ProxySettings = {
  width: 854,             // 480p width
  videoBitrateKbps: 1000, // 1 Mbps
  audioBitrateKbps: 96,   // AAC 96kbps
  fps: 30                 // Cap at 30fps
}

/** Result of proxy generation */
export interface ProxyResult {
  /** Path to the generated proxy file */
  proxyPath: string | null
  /** Error message if generation failed */
  error?: string
  /** Metadata about the proxy */
  metadata?: {
    width: number
    height: number
    bitrate: number
    fileSize: number
  }
}

/** Get the proxy path for a given source file */
export function getProxyPath(sourcePath: string, proxyDir?: string): string {
  const dir = proxyDir || join(dirname(sourcePath), '.storyteller-proxies')
  const base = basename(sourcePath, extname(sourcePath))
  return join(dir, `${base}.proxy.mp4`)
}

/** Check if a valid proxy exists for the source file */
export function hasValidProxy(sourcePath: string, proxyPath: string): boolean {
  if (!existsSync(proxyPath)) return false

  // TODO: Check proxy creation time against source modification time
  // For now, just check existence
  return true
}

/**
 * Generate proxy settings based on source file properties
 */
export function getOptimalProxySettings(
  sourceWidth: number,
  sourceHeight: number,
  sourceDuration: number
): ProxySettings {
  // For very long files (> 30 min), use lighter settings
  if (sourceDuration > 1800) {
    return LIGHTWEIGHT_PROXY_SETTINGS
  }

  // For 4K+ sources, definitely downscale
  if (sourceWidth >= 3840 || sourceHeight >= 2160) {
    return {
      ...DEFAULT_PROXY_SETTINGS,
      width: 1280,
      videoBitrateKbps: 3000
    }
  }

  // For 1080p sources, moderate downscale
  if (sourceWidth >= 1920 || sourceHeight >= 1080) {
    return DEFAULT_PROXY_SETTINGS
  }

  // For smaller sources, keep closer to original
  return {
    ...DEFAULT_PROXY_SETTINGS,
    width: Math.min(sourceWidth, 1280),
    videoBitrateKbps: 2000
  }
}

/**
 * Build FFmpeg arguments for proxy generation
 */
function buildProxyFFmpegArgs(
  inputPath: string,
  outputPath: string,
  settings: ProxySettings
): string[] {
  const args: string[] = [
    '-y',                       // Overwrite output
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,           // Input
    '-vf', `scale=${settings.width}:-2:flags=lanczos`, // Lanczos scaling for quality
    '-c:v', 'libx264',        // H.264 video codec
    '-preset', 'fast',        // Balance of speed/quality
    '-crf', '23',             // Quality setting (lower = better)
    '-maxrate', `${settings.videoBitrateKbps}k`,
    '-bufsize', `${settings.videoBitrateKbps * 2}k`,
    '-c:a', 'aac',            // AAC audio codec
    '-b:a', `${settings.audioBitrateKbps}k`,
    '-ar', '48000',           // 48kHz sample rate (standard)
    '-ac', '2',               // Stereo
    '-movflags', '+faststart', // Web-optimized
    '-pix_fmt', 'yuv420p'     // Compatibility
  ]

  // Only set FPS if specified (0 = preserve source)
  if (settings.fps > 0) {
    args.push('-r', String(settings.fps))
  }

  args.push(outputPath)

  return args
}

/**
 * Generate a lightweight H.264/AAC proxy for the given source file.
 *
 * This is the main entry point for proxy generation. It:
 * 1. Determines the optimal proxy path
 * 2. Checks if a valid proxy already exists
 * 3. Generates the proxy using FFmpeg
 * 4. Returns the proxy path
 *
 * @param sourcePath - Path to the source media file
 * @param ffmpegPath - Path to the FFmpeg binary
 * @param options - Optional proxy settings and proxy directory
 * @returns Promise resolving to the proxy result
 */
export async function generateProxy(
  sourcePath: string,
  ffmpegPath: string,
  options?: {
    settings?: ProxySettings
    proxyDir?: string
    onProgress?: (percent: number) => void
  }
): Promise<ProxyResult> {
  const proxyPath = getProxyPath(sourcePath, options?.proxyDir)

  // Check if proxy already exists
  if (hasValidProxy(sourcePath, proxyPath)) {
    return { proxyPath }
  }

  // Ensure proxy directory exists
  try {
    await mkdir(dirname(proxyPath), { recursive: true })
  } catch (e) {
    return {
      proxyPath: null,
      error: `Failed to create proxy directory: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // Get settings
  const settings = options?.settings || DEFAULT_PROXY_SETTINGS

  // Build FFmpeg command
  const args = buildProxyFFmpegArgs(sourcePath, proxyPath, settings)

  // Run FFmpeg
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (err) => {
      resolve({
        proxyPath: null,
        error: `FFmpeg spawn error: ${err.message}`
      })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          proxyPath: null,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`
        })
        return
      }

      // Success
      resolve({ proxyPath })
    })
  })
}

/**
 * Legacy placeholder function - now calls real implementation.
 * Kept for backward compatibility.
 */
export async function generateProxyPlaceholder(
  localPath: string,
  ffmpegPath?: string,
  options?: { proxyDir?: string }
): Promise<ProxyResult> {
  if (!ffmpegPath) {
    return {
      proxyPath: null,
      error: 'FFmpeg path required for proxy generation. Pass ffmpeg-static path.'
    }
  }

  return generateProxy(localPath, ffmpegPath, {
    proxyDir: options?.proxyDir
  })
}

/**
 * Batch generate proxies for multiple files.
 * Useful for project import workflows.
 */
export async function generateProxies(
  sourcePaths: string[],
  ffmpegPath: string,
  options?: {
    settings?: ProxySettings
    proxyDir?: string
    concurrency?: number
    onFileComplete?: (path: string, result: ProxyResult) => void
    onProgress?: (completed: number, total: number) => void
  }
): Promise<Map<string, ProxyResult>> {
  const results = new Map<string, ProxyResult>()
  const concurrency = options?.concurrency || 2 // Process 2 at a time by default

  // Process in batches
  for (let i = 0; i < sourcePaths.length; i += concurrency) {
    const batch = sourcePaths.slice(i, i + concurrency)
    const batchPromises = batch.map(async (path) => {
      const result = await generateProxy(path, ffmpegPath, {
        settings: options?.settings,
        proxyDir: options?.proxyDir
      })
      results.set(path, result)
      options?.onFileComplete?.(path, result)
      return result
    })

    await Promise.all(batchPromises)
    options?.onProgress?.(Math.min(i + concurrency, sourcePaths.length), sourcePaths.length)
  }

  return results
}
