import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import RunwayML, { TaskFailedError } from '@runwayml/sdk'
import type { Asset } from '@storyteller/shared'
import { storytellerAiFileBase } from '@storyteller/shared'
import { runFfprobe } from './ffprobe.js'

export type RunwayBrollProgress =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; taskId: string }
  | { phase: 'failed'; error: string }

function runwayApiKey(): string | null {
  const k = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET
  return k && k.trim().length > 0 ? k.trim() : null
}

/**
 * Text-to-video via Runway, download to disk, probe — for B-roll slots (desktop).
 */
export async function generateRunwayBrollToDisk(params: {
  projectId: string
  slotId: string
  promptText: string
  ratio: '1280:720' | '720:1280'
  /** 2–10 for gen4.5 */
  durationSeconds: number
  outputDir: string
  audit: {
    provider: 'runway'
    promptUsed: string
    slotId: string
    stylePackId?: string
    promptCategory?: string
  }
  onProgress?: (p: RunwayBrollProgress) => void
}): Promise<
  | {
      ok: true
      asset: Asset
      taskId: string
      localPath: string
      outputUrls: string[]
    }
  | { ok: false; error: string }
> {
  const apiKey = runwayApiKey()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Runway is not configured. Set RUNWAY_API_KEY or RUNWAYML_API_SECRET in .env for local development.'
    }
  }

  const duration = Math.min(10, Math.max(2, Math.round(params.durationSeconds)))
  const promptText = params.promptText.trim().slice(0, 1000)
  if (!promptText) return { ok: false, error: 'Prompt is empty.' }

  await mkdir(params.outputDir, { recursive: true })
  const fileBase = storytellerAiFileBase({ kind: 'motion', slotId: params.slotId })
  const localPath = join(params.outputDir, `${fileBase}.mp4`)

  const onProgress = params.onProgress
  onProgress?.({ phase: 'queued', detail: 'Submitting to Runway…' })

  const model = 'gen4.5' as const
  let task: Awaited<ReturnType<ReturnType<RunwayML['textToVideo']['create']>['waitForTaskOutput']>>
  try {
    const client = new RunwayML({ apiKey })
    onProgress?.({ phase: 'generating', detail: 'Generating in Runway…' })

    /**
     * `waitForTaskOutput()` resolves with `Succeeded` only; failures throw
     * `TaskFailedError`. Don't try to inspect a `FAILED` status here.
     */
    task = await client.textToVideo
      .create({
        model,
        promptText,
        ratio: params.ratio,
        duration
      })
      .waitForTaskOutput()
  } catch (e) {
    if (e instanceof TaskFailedError) {
      const td = e.taskDetails
      const reason =
        ('failure' in td && td.failure) ||
        ('status' in td && td.status) ||
        'Runway generation failed.'
      const code = 'failureCode' in td && td.failureCode ? ` (${td.failureCode})` : ''
      const msg = `Runway generation failed: ${reason}${code}`
      onProgress?.({ phase: 'failed', error: msg })
      return { ok: false, error: msg }
    }
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  }

  try {
    const outputUrls = task.output
    if (!outputUrls?.length) return { ok: false, error: 'Runway returned no output URLs.' }

    const url = outputUrls[0]!
    onProgress?.({ phase: 'downloading', detail: 'Downloading clip…' })
    const res = await fetch(url)
    if (!res.ok) return { ok: false, error: `Download failed (${res.status})` }
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(localPath, buf)

    onProgress?.({ phase: 'probing', detail: 'Probing media…' })
    const probed = await runFfprobe(localPath)
    if (!probed.ok) {
      return { ok: false, error: probed.error || 'ffprobe failed on generated clip.' }
    }

    const assetId = randomUUID()
    const createdAt = new Date().toISOString()
    const asset: Asset = {
      id: assetId,
      project_id: params.projectId,
      asset_type: 'video',
      storage_mode: 'local',
      local_path: localPath,
      storage_path: null,
      proxy_path: null,
      media_hash: null,
      is_uploaded: false,
      original_filename: `${fileBase}.mp4`,
      mime_type: 'video/mp4',
      upload_status: 'not_uploaded',
      probe_status: 'success',
      duration_seconds: probed.data.durationSeconds ?? duration,
      width: probed.data.width ?? null,
      height: probed.data.height ?? null,
      fps: probed.data.fps ?? null,
      metadata_json: {
        origin: 'runway-broll',
        runwayTaskId: task.id,
        provider: 'runway',
        promptUsed: params.audit.promptUsed.slice(0, 4000),
        slotId: params.audit.slotId,
        stylePackId: params.audit.stylePackId ?? null,
        promptCategory: params.audit.promptCategory ?? null,
        createdAt,
        model,
        durationRequested: duration,
        outputUrls: outputUrls.slice(0, 3)
      },
      sort_order: 9000,
      created_at: createdAt
    }

    onProgress?.({ phase: 'complete', localPath, taskId: task.id })
    return { ok: true, asset, taskId: task.id, localPath, outputUrls }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  }
}
