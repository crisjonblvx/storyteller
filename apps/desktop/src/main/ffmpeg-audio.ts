import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { resolveUnpackedBinary } from './bin-path.js'

export function getFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not provide a binary path')
  }
  return resolveUnpackedBinary(ffmpegPath)
}

/**
 * Extract a slice of source media as mono 16kHz MP3 (speech-friendly, bounded size for Whisper).
 * `hasVideo` true → strip video (`-vn`); false for pure audio sources.
 */
export async function extractChunkToMp3(params: {
  sourcePath: string
  outputPath: string
  startSec: number
  durationSec: number
  hasVideo: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ffmpeg = getFfmpegPath()
  const common = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-probesize',
    '50M',
    '-analyzeduration',
    '50M',
    '-ss',
    String(params.startSec),
    '-i',
    params.sourcePath,
    '-t',
    String(params.durationSec),
    '-vn',
    '-dn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '64k',
    params.outputPath
  ] as const

  const attempts: string[][] = [
    [...common.slice(0, 14), '-map', '0:a:0?', ...common.slice(14)],
    [...common],
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-probesize',
      '50M',
      '-analyzeduration',
      '50M',
      '-i',
      params.sourcePath,
      '-ss',
      String(params.startSec),
      '-t',
      String(params.durationSec),
      '-vn',
      '-dn',
      '-map',
      '0:a:0?',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      params.outputPath
    ]
  ]

  let lastError = 'Unknown ffmpeg error'
  for (const args of attempts) {
    const result = await spawnFfmpeg(ffmpeg, args)
    if (result.ok) return result
    lastError = result.error
  }
  return {
    ok: false,
    error: `${lastError} (source: ${params.sourcePath})`
  }
}

function spawnFfmpeg(
  ffmpeg: string,
  args: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
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
        return
      }
      resolve({ ok: true })
    })
  })
}
