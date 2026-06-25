import type { AssetType } from '@storyteller/shared'

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'])
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff'])

const VIDEO_MIME = /^video\//
const AUDIO_MIME = /^audio\//
const IMAGE_MIME = /^image\//

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

/**
 * Classify user media into Storyteller asset types. Prefer MIME, fall back to extension.
 */
export function classifyAssetType(mimeType: string, filename: string): AssetType | null {
  const ext = extOf(filename)
  if (mimeType) {
    if (VIDEO_MIME.test(mimeType)) return 'video'
    if (AUDIO_MIME.test(mimeType)) return 'audio'
    if (IMAGE_MIME.test(mimeType)) return 'photo'
  }
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (PHOTO_EXT.has(ext)) return 'photo'
  return null
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-()+ ]+/g, '_').replace(/\s+/g, ' ').trim() || 'file'
}
