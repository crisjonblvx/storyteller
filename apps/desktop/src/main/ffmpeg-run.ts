import { spawn } from 'node:child_process'
import { rename, unlink } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import {
  deliveryDimensionsFromAspect,
  ffmpegCoverCropFilter,
  type DeliveryAspectRatio
} from '@storyteller/shared'
import { runFfprobe } from './ffprobe.js'
import { resolveUnpackedBinary } from './bin-path.js'

export function runFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegPath ? resolveUnpackedBinary(ffmpegPath) : null
  if (!bin) return Promise.reject(new Error('ffmpeg-static binary not found'))
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString().slice(-800)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err || `ffmpeg exited with code ${code}`))
    })
  })
}

/** Remove audio track from a generated B-roll clip (Grok often bakes in unrelated speech). */
export async function stripVideoAudioInPlace(videoPath: string): Promise<void> {
  const tmp = `${videoPath}.silent.mp4`
  await runFfmpeg(['-y', '-i', videoPath, '-c:v', 'copy', '-an', tmp])
  try {
    await unlink(videoPath)
  } catch {
    /* replaced below */
  }
  await rename(tmp, videoPath)
}

/** Scale + center-crop to 1080p delivery (1920×1080 or 1080×1920). */
export async function normalizeImageToDeliverySize(
  imagePath: string,
  aspectRatio: DeliveryAspectRatio
): Promise<{ width: number; height: number }> {
  const { width, height } = deliveryDimensionsFromAspect(aspectRatio)
  const tmp = `${imagePath}.delivery.png`
  await runFfmpeg([
    '-y',
    '-i',
    imagePath,
    '-vf',
    ffmpegCoverCropFilter(width, height),
    '-frames:v',
    '1',
    tmp
  ])
  try {
    await unlink(imagePath)
  } catch {
    /* replaced below */
  }
  await rename(tmp, imagePath)
  return { width, height }
}

/** Re-encode generated B-roll video to exact 1080p delivery dimensions. */
export async function normalizeVideoToDeliverySize(
  videoPath: string,
  aspectRatio: DeliveryAspectRatio,
  fps?: number | null
): Promise<{ width: number; height: number; durationSeconds: number | null }> {
  const { width, height } = deliveryDimensionsFromAspect(aspectRatio)
  const tmp = `${videoPath}.delivery.mp4`
  await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    ffmpegCoverCropFilter(width, height, fps),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    tmp
  ])
  try {
    await unlink(videoPath)
  } catch {
    /* replaced below */
  }
  await rename(tmp, videoPath)
  const probed = await runFfprobe(videoPath)
  return {
    width,
    height,
    durationSeconds: probed.ok ? (probed.data.durationSeconds ?? null) : null
  }
}
