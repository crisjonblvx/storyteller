import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { runFfmpeg } from './ffmpeg-run.js'

export function thumbnailCacheDir(): string {
  return join(app.getPath('userData'), 'asset-thumbnails')
}

export function thumbnailPathForAsset(assetId: string): string {
  return join(thumbnailCacheDir(), `${assetId}.jpg`)
}

/**
 * Extract a single JPEG frame near the start of a media file for library cards.
 */
export async function extractAssetThumbnail(
  sourcePath: string,
  assetId: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const outPath = thumbnailPathForAsset(assetId)
  try {
    const st = await stat(sourcePath)
    if (!st.isFile()) return { ok: false, error: 'Source is not a file' }
  } catch {
    return { ok: false, error: 'Source file not found' }
  }

  await mkdir(dirname(outPath), { recursive: true })

  try {
    await runFfmpeg([
      '-y',
      '-ss',
      '0.5',
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      outPath
    ])
    return { ok: true, path: outPath }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
