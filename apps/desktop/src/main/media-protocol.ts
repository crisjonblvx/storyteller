import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** Inverse of preload `toMediaUrl` — `storyteller-media://media/...` → disk path. */
export function mediaUrlToDiskPath(raw: string): string {
  if (!raw.startsWith('storyteller-media://')) return raw
  try {
    const u = new URL(raw)
    let disk = u.pathname
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/')
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(disk)) {
      disk = disk.slice(1)
    }
    return disk
  } catch {
    return raw
  }
}

function contentTypeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function parseRange(rangeHeader: string, total: number): { start: number; end: number } | null {
  const m = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim())
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] !== '' ? Number(m[2]) : total - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return null
  }
  return { start, end: Math.min(end, total - 1) }
}

/** Must run before `app.whenReady()`. */
export function registerMediaProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'storyteller-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true
      }
    }
  ])
}

/** Must run after `app.whenReady()`. */
export function registerMediaProtocolHandler(): void {
  protocol.handle('storyteller-media', async (request) => {
    const filePath = mediaUrlToDiskPath(request.url)
    if (!filePath || !existsSync(filePath)) {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' })
    }

    let total: number
    try {
      total = statSync(filePath).size
    } catch {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' })
    }

    const contentType = contentTypeFor(filePath)
    const rangeHeader = request.headers.get('Range')
    const range = rangeHeader ? parseRange(rangeHeader, total) : null

    if (range) {
      const { start, end } = range
      const length = end - start + 1
      const nodeStream = createReadStream(filePath, { start, end })
      const body = Readable.toWeb(nodeStream) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(length),
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${total}`
        }
      })
    }

    const nodeStream = createReadStream(filePath)
    const body = Readable.toWeb(nodeStream) as ReadableStream
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
