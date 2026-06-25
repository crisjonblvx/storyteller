import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import ffprobeStatic from 'ffprobe-static'
import { parseFfprobeJson } from '@storyteller/media'
import type { MediaProbeResult } from '@storyteller/media'

const ffprobePath = ffprobeStatic.path

export type ProbeOk = { ok: true; data: MediaProbeResult }
export type ProbeErr = {
  ok: false
  error: string
  code?: 'INVALID_PATH' | 'SOURCE_FILE_MISSING'
}
export type ProbeResult = ProbeOk | ProbeErr

export function runFfprobe(filePath: string): Promise<ProbeResult> {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return Promise.resolve({ ok: false, error: 'Invalid path', code: 'INVALID_PATH' })
  }
  const normalized = filePath.trim()
  if (!existsSync(normalized)) {
    return Promise.resolve({
      ok: false,
      error: 'File not found',
      code: 'SOURCE_FILE_MISSING'
    })
  }
  const args = [
    '-v',
    'quiet',
    '-probesize',
    '50M',
    '-analyzeduration',
    '50M',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    normalized
  ]

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const child = spawn(ffprobePath, args, { windowsHide: true })
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', () => {})
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: err.message || 'Failed to spawn ffprobe' })
    })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `ffprobe exited with code ${code ?? 'unknown'} (is ffprobe available?)`
        })
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const raw: unknown = JSON.parse(text)
        const data = parseFfprobeJson(raw)
        resolve({ ok: true, data })
      } catch (e) {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : 'Failed to parse ffprobe JSON'
        })
      }
    })
  })
}
