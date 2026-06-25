/**
 * Two-step production pipeline: still (concept-frame) then video (Grok/Gemini I2V).
 * No runFull — approval boundary enforced by separate IPC handlers.
 */
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Asset } from '@storyteller/shared'
import type { ProductionPackage } from '@storyteller/shared'
import { appendBrollMotionAudioPolicy } from '@storyteller/shared'
import { generateMediaViaCapability, type GatewayBrollProgress } from './gateway-media.js'

export type ProductionProgress =
  | { phase: 'still'; detail?: string; progress?: number }
  | { phase: 'still-complete'; stillAssetId: string; localPath: string; jobId: string }
  | { phase: 'video'; detail?: string; progress?: number }
  | { phase: 'complete'; asset: Asset; jobId: string; localPath: string }
  | { phase: 'failed'; error: string }

export type ProductionStillResult =
  | { ok: true; asset: Asset; jobId: string; localPath: string }
  | { ok: false; error: string }

export type ProductionVideoResult =
  | { ok: true; asset: Asset; jobId: string; localPath: string }
  | { ok: false; error: string }

export async function generateProductionStill(params: {
  projectId: string
  slotId: string
  productionPackage: ProductionPackage
  aspectRatio: '16:9' | '9:16' | '1:1'
  accessToken: string | null | undefined
  outputDir: string
  /** When true, skip credit deduction — one free courtesy regen per slot. */
  courtesyRegen?: boolean
  onProgress?: (p: ProductionProgress) => void
}): Promise<ProductionStillResult> {
  const onProgress = params.onProgress
  onProgress?.({ phase: 'still', detail: 'Generating concept still…' })

  const result = await generateMediaViaCapability({
    projectId: params.projectId,
    slotId: params.slotId,
    capability: 'concept-frame',
    creativeMode: 'cinematic_documentary',
    prompt: params.productionPackage.stillImagePrompt,
    aspectRatio: params.aspectRatio,
    accessToken: params.accessToken,
    outputDir: params.outputDir,
    courtesyRegen: params.courtesyRegen,
    metadata: {
      productionPackageId: params.productionPackage.id,
      productionMode: params.productionPackage.mode,
      promptCategory: 'broll-still'
    },
    onProgress: (p: GatewayBrollProgress) => {
      if (p.phase === 'generating') onProgress?.({ phase: 'still', detail: p.detail, progress: p.progress })
      if (p.phase === 'downloading') onProgress?.({ phase: 'still', detail: p.detail })
    }
  })

  if (!result.ok) {
    onProgress?.({ phase: 'failed', error: result.error })
    return result
  }

  onProgress?.({
    phase: 'still-complete',
    stillAssetId: result.asset.id,
    localPath: result.localPath,
    jobId: result.jobId
  })
  return { ok: true, asset: result.asset, jobId: result.jobId, localPath: result.localPath }
}

export async function generateProductionVideo(params: {
  projectId: string
  slotId: string
  motionPrompt: string
  stillLocalPath: string
  referenceImageUrl: string
  durationSeconds: number
  aspectRatio: '16:9' | '9:16' | '1:1'
  accessToken: string | null | undefined
  outputDir: string
  productionPackageId?: string
  onProgress?: (p: ProductionProgress) => void
}): Promise<ProductionVideoResult> {
  const onProgress = params.onProgress
  const ref = params.referenceImageUrl?.trim()
  if (!ref || !/^https?:\/\//i.test(ref)) {
    const err = 'A signed HTTPS URL for the approved still is required before video generation.'
    onProgress?.({ phase: 'failed', error: err })
    return { ok: false, error: err }
  }

  try {
    await readFile(params.stillLocalPath)
  } catch {
    const err = 'Approved still file is missing on disk. Regenerate the still first.'
    onProgress?.({ phase: 'failed', error: err })
    return { ok: false, error: err }
  }

  onProgress?.({ phase: 'video', detail: 'Generating video from approved still…' })

  const dur = Math.min(15, Math.max(6, Math.round(params.durationSeconds || 8)))
  const motionWithPolicy = appendBrollMotionAudioPolicy(params.motionPrompt.trim())
  const result = await generateMediaViaCapability({
    projectId: params.projectId,
    slotId: params.slotId,
    capability: 'video-clip-from-image',
    creativeMode: 'cinematic_documentary',
    prompt: motionWithPolicy,
    referenceImageUrl: ref,
    durationSeconds: dur,
    aspectRatio: params.aspectRatio,
    accessToken: params.accessToken,
    outputDir: params.outputDir,
    metadata: {
      productionPackageId: params.productionPackageId,
      approvedStillPath: params.stillLocalPath
    },
    onProgress: (p: GatewayBrollProgress) => {
      if (p.phase === 'generating') onProgress?.({ phase: 'video', detail: p.detail, progress: p.progress })
      if (p.phase === 'downloading') onProgress?.({ phase: 'video', detail: 'Downloading video…' })
    }
  })

  if (!result.ok) {
    onProgress?.({ phase: 'failed', error: result.error })
    return result
  }

  onProgress?.({
    phase: 'complete',
    asset: result.asset,
    jobId: result.jobId,
    localPath: result.localPath
  })
  return { ok: true, asset: result.asset, jobId: result.jobId, localPath: result.localPath }
}

export function productionOutputDir(userDataPath: string, projectId: string): string {
  return join(userDataPath, 'generated-broll', projectId)
}

export const UPLOADED_STILL_PLACEHOLDER_PROMPT = 'User-uploaded opening frame'

export async function saveUploadedProductionStill(params: {
  projectId: string
  slotId: string
  outputDir: string
  bytes: Uint8Array
  filename?: string
  mimeType?: string
}): Promise<{ ok: true; asset: Asset; localPath: string } | { ok: false; error: string }> {
  const mime = params.mimeType?.trim().toLowerCase() || 'image/png'
  const ext =
    mime === 'image/jpeg' || mime === 'image/jpg'
      ? '.jpg'
      : mime === 'image/webp'
        ? '.webp'
        : mime === 'image/png'
          ? '.png'
          : '.png'

  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return { ok: false, error: 'Unsupported image type — use PNG, JPEG, or WebP.' }
  }

  await mkdir(params.outputDir, { recursive: true })
  const assetId = randomUUID()
  const safeBase =
    (params.filename ?? `uploaded-still-${assetId}`)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.[^.]+$/, '')
      .slice(0, 80) || `uploaded-still-${assetId.slice(0, 8)}`
  const localPath = join(params.outputDir, `${safeBase}-${assetId.slice(0, 8)}${ext}`)

  await writeFile(localPath, params.bytes)

  const createdAt = new Date().toISOString()
  const asset: Asset = {
    id: assetId,
    project_id: params.projectId,
    asset_type: 'image',
    storage_mode: 'local',
    local_path: localPath,
    storage_path: null,
    proxy_path: null,
    media_hash: null,
    is_uploaded: false,
    original_filename: basename(localPath),
    mime_type: mime,
    upload_status: 'not_uploaded',
    probe_status: 'success',
    duration_seconds: null,
    width: null,
    height: null,
    fps: null,
    metadata_json: {
      origin: 'user-upload',
      slotId: params.slotId,
      createdAt
    },
    sort_order: 9000,
    clip_role: null,
    creator_clip_role: null,
    created_at: createdAt
  }

  return { ok: true, asset, localPath }
}
