import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset } from '@storyteller/shared'
import { storytellerAiFileBase } from '@storyteller/shared'
import { runFfprobe } from './ffprobe.js'

export type KlingBrollProgress =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; taskId: string }
  | { phase: 'failed'; error: string }

/** Kling API configuration from environment */
function klingApiKey(): string | null {
  const k = process.env.KLING_API_KEY || process.env.KLING_API_SECRET
  return k && k.trim().length > 0 ? k.trim() : null
}

function klingApiBase(): string {
  return process.env.KLING_API_BASE || 'https://api.klingai.com'
}

/** Kling API response types */
interface KlingTaskResponse {
  code: number
  message: string
  data?: {
    task_id: string
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
    task_result?: {
      videos?: Array<{
        url: string
        duration?: number
      }>
      images?: Array<{
        url: string
      }>
    }
  }
}

/**
 * Submit a text-to-video generation task to Kling API
 */
async function submitKlingTask(params: {
  prompt: string
  negativePrompt?: string
  duration: number // 5 or 10 seconds
  ratio: '16:9' | '9:16' | '1:1'
  apiKey: string
}): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const baseUrl = klingApiBase()
  const duration = params.duration <= 5 ? 5 : 10

  try {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${params.apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'kling-v1',
        prompt: params.prompt,
        negative_prompt: params.negativePrompt || 'blurry, low quality, distorted, watermark, text',
        aspect_ratio: params.ratio,
        duration: duration,
        mode: 'std' // standard quality
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        ok: false,
        error: `Kling API error (${response.status}): ${errorText.slice(0, 200)}`
      }
    }

    const result: KlingTaskResponse = await response.json()

    if (result.code !== 0 || !result.data?.task_id) {
      return {
        ok: false,
        error: `Kling submission failed: ${result.message || 'Unknown error'}`
      }
    }

    return { ok: true, taskId: result.data.task_id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Kling submit failed: ${msg}` }
  }
}

/**
 * Poll Kling task status until completion or timeout
 */
async function pollKlingTask(
  taskId: string,
  apiKey: string,
  onProgress?: (p: KlingBrollProgress) => void,
  timeoutMs: number = 10 * 60 * 1000 // 10 minutes
): Promise<{ ok: true; videoUrls: string[] } | { ok: false; error: string }> {
  const baseUrl = klingApiBase()
  const startTime = Date.now()
  const pollInterval = 5000 // 5 seconds

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/v1/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          ok: false,
          error: `Kling poll error (${response.status}): ${errorText.slice(0, 200)}`
        }
      }

      const result: KlingTaskResponse = await response.json()

      if (result.code !== 0) {
        return {
          ok: false,
          error: `Kling task query failed: ${result.message || 'Unknown error'}`
        }
      }

      const status = result.data?.task_status

      switch (status) {
        case 'succeed': {
          const videos = result.data?.task_result?.videos
          if (!videos?.length) {
            return { ok: false, error: 'Kling task succeeded but no video URLs returned' }
          }
          return { ok: true, videoUrls: videos.map((v) => v.url) }
        }
        case 'failed':
          return { ok: false, error: `Kling generation failed: ${result.message || 'Task failed'}` }
        case 'submitted':
          onProgress?.({ phase: 'queued', detail: 'Waiting in Kling queue…' })
          break
        case 'processing':
          onProgress?.({ phase: 'generating', detail: 'Generating in Kling…' })
          break
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `Kling poll exception: ${msg}` }
    }
  }

  return { ok: false, error: `Kling polling timed out after ${timeoutMs / 1000}s` }
}

/**
 * Download video from URL to local path
 */
async function downloadVideo(url: string, localPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { ok: false, error: `Download failed: ${response.status} ${response.statusText}` }
    }

    const buffer = await response.arrayBuffer()
    await writeFile(localPath, new Uint8Array(buffer))
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Download error: ${msg}` }
  }
}

/**
 * Text-to-video via Kling API, download to disk, probe — for B-roll slots (desktop).
 *
 * Kling provides competitive video generation with strong motion coherence.
 * This integration follows the same pattern as Runway for consistency.
 */
export async function generateKlingBrollToDisk(params: {
  projectId: string
  slotId: string
  promptText: string
  ratio: '16:9' | '9:16' | '1:1'
  /** 5 or 10 seconds */
  durationSeconds: number
  outputDir: string
  negativePrompt?: string
  audit: {
    provider: 'kling'
    promptUsed: string
    slotId: string
    stylePackId?: string
    promptCategory?: string
  }
  onProgress?: (p: KlingBrollProgress) => void
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
  const apiKey = klingApiKey()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Kling is not configured. Set KLING_API_KEY in .env for local development.'
    }
  }

  const duration = params.durationSeconds <= 5 ? 5 : 10
  const promptText = params.promptText.trim().slice(0, 1000)
  if (!promptText) return { ok: false, error: 'Prompt is empty.' }

  await mkdir(params.outputDir, { recursive: true })
  const fileBase = storytellerAiFileBase({ kind: 'motion', slotId: params.slotId })
  const localPath = join(params.outputDir, `${fileBase}.mp4`)

  const onProgress = params.onProgress
  onProgress?.({ phase: 'queued', detail: 'Submitting to Kling…' })

  // Submit task
  const submitResult = await submitKlingTask({
    prompt: promptText,
    negativePrompt: params.negativePrompt,
    duration,
    ratio: params.ratio,
    apiKey
  })

  if (!submitResult.ok) {
    onProgress?.({ phase: 'failed', error: submitResult.error })
    return { ok: false, error: submitResult.error }
  }

  const taskId = submitResult.taskId

  // Poll for completion
  const pollResult = await pollKlingTask(taskId, apiKey, onProgress)
  if (!pollResult.ok) {
    onProgress?.({ phase: 'failed', error: pollResult.error })
    return { ok: false, error: pollResult.error }
  }

  // Download video
  onProgress?.({ phase: 'downloading', detail: 'Downloading from Kling…' })
  const downloadResult = await downloadVideo(pollResult.videoUrls[0]!, localPath)
  if (!downloadResult.ok) {
    onProgress?.({ phase: 'failed', error: downloadResult.error })
    return { ok: false, error: downloadResult.error }
  }

  // Probe the downloaded file
  onProgress?.({ phase: 'probing', detail: 'Analyzing downloaded file…' })
  const probe = await runFfprobe(localPath)
  if (!probe.ok) {
    onProgress?.({ phase: 'failed', error: `Probe failed: ${probe.error}` })
    return { ok: false, error: `Downloaded file probe failed: ${probe.error}` }
  }

  const assetId = randomUUID()
  const audit = {
    ...params.audit,
    klingTaskId: taskId,
    createdAt: new Date().toISOString(),
    model: 'kling-v1',
    durationRequested: duration,
    durationProbed: probe.data.duration_seconds ?? duration,
    ratio: params.ratio
  }

  const asset: Asset = {
    id: assetId,
    project_id: params.projectId,
    asset_type: 'video',
    storage_mode: 'local',
    local_path: localPath,
    storage_path: null,
    is_uploaded: false,
    upload_status: 'not_uploaded',
    original_filename: `${fileBase}.mp4`,
    duration_seconds: probe.data.duration_seconds ?? duration,
    width: probe.data.width ?? (params.ratio === '9:16' ? 720 : 1280),
    height: probe.data.height ?? (params.ratio === '9:16' ? 1280 : 720),
    fps: probe.data.fps ?? 30,
    probe_metadata: probe.data.raw ?? {},
    metadata_json: audit,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  onProgress?.({ phase: 'complete', localPath, taskId })
  return { ok: true, asset, taskId, localPath, outputUrls: pollResult.videoUrls }
}
