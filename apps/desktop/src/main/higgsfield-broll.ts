/**
 * Higgsfield image-to-video runner — desktop main process.
 *
 * Higgsfield's API is async + image-to-video: you POST an `image_url` plus a
 * motion `prompt` to a model endpoint, get back a `request_id`, then poll
 * `/requests/{id}/status` until `status === "completed"` (or one of the
 * terminal statuses `failed` / `nsfw` — both refunded by Higgsfield).
 *
 * BYOK: credentials are loaded from the OS keychain (`safeStorage`), not
 * environment variables — Higgsfield is the user's own paid account, not
 * Storyteller's. See `higgsfield-secrets.ts` for the storage layer.
 *
 * Reference image:
 *   The renderer is responsible for getting a publicly-fetchable HTTPS URL
 *   (typically a Supabase Storage signed URL with ≥ 1 hour TTL) and passing
 *   it in via `referenceImageUrl`. Doing the upload in the renderer keeps
 *   the user's Supabase auth session inside its boundary — main never sees
 *   the service-role key. If the renderer ever can't sign the URL (offline
 *   project, asset only on disk), it should bail with a clear UX message
 *   rather than try to upload from main.
 *
 * Modeled on `runway-broll.ts` so the IPC contract stays consistent: the
 * caller gets `{ ok: true, asset, requestId, localPath }` on success and the
 * resulting `Asset` is registered exactly the same way (auto-attached to the
 * slot by the renderer's `attachGeneratedBrollClip`).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset } from '@storyteller/shared'
import { storytellerAiFileBase } from '@storyteller/shared'
import { runFfprobe } from './ffprobe.js'
import { getHiggsfieldCredentials } from './higgsfield-secrets.js'

export type HiggsfieldBrollProgress =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; requestId: string }
  | { phase: 'failed'; error: string }

const HIGGSFIELD_API = 'https://platform.higgsfield.ai'
const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 8 * 60 * 1000 /* 8 min — Higgsfield can queue under load */

function authHeader(key: string, secret: string): string {
  return `Key ${key}:${secret}`
}

/**
 * Submit one image-to-video request, poll until terminal, download the
 * resulting MP4, probe it, and return an `Asset` ready for the renderer
 * to attach to the slot. All Higgsfield-specific quirks are quarantined
 * to this file — the IPC handler treats it identically to Runway.
 */
export async function generateHiggsfieldBrollToDisk(params: {
  projectId: string
  slotId: string
  promptText: string
  /**
   * Optional. Publicly-fetchable HTTPS URL of the reference image. Renderer
   * is responsible for surfacing it (signed URL, public CDN, etc.). When
   * omitted, the runner submits a text-to-video request — make sure the
   * `modelId` you pass is one of Higgsfield's text-to-video SKUs.
   */
  referenceImageUrl?: string
  /**
   * Higgsfield model id, e.g. `bytedance/seedance/v1/pro/image-to-video` for
   * I2V or `bytedance/seedance/v1/pro/text-to-video` for T2V. Required — no
   * implicit default in the runner so the IPC layer always makes the choice
   * deliberate and auditable.
   */
  modelId: string
  /** "1280:720" → 16:9, "720:1280" → 9:16. Higgsfield infers from image when image-mode. */
  ratio: '1280:720' | '720:1280'
  /** 4-10s typical for Higgsfield models. */
  durationSeconds: number
  outputDir: string
  audit: {
    promptUsed: string
    slotId: string
    stylePackId?: string
    promptCategory?: string
  }
  onProgress?: (p: HiggsfieldBrollProgress) => void
}): Promise<
  | {
      ok: true
      asset: Asset
      requestId: string
      localPath: string
      videoUrl: string
    }
  | { ok: false; error: string }
> {
  const onProgress = params.onProgress

  const creds = getHiggsfieldCredentials()
  if (!creds) {
    return {
      ok: false,
      error:
        'Higgsfield is not configured. Open Project Settings → B-roll Providers and paste your Higgsfield API key + secret.'
    }
  }

  const promptText = params.promptText.trim().slice(0, 2000)
  if (!promptText) return { ok: false, error: 'Prompt is empty.' }

  /**
   * Reference image is optional. If provided, validate the URL shape so the
   * Higgsfield API doesn't reject the submit with an opaque 400. If not
   * provided, we fall through to text-to-video mode and the submit body
   * simply omits `image_url`.
   */
  const referenceImageUrl = params.referenceImageUrl?.trim() ?? ''
  if (referenceImageUrl && !/^https?:\/\//i.test(referenceImageUrl)) {
    return {
      ok: false,
      error: 'Reference image URL is not http(s). Re-upload the reference image and try again.'
    }
  }
  const isTextToVideo = referenceImageUrl === ''

  const duration = Math.min(10, Math.max(4, Math.round(params.durationSeconds)))

  await mkdir(params.outputDir, { recursive: true })
  const fileBase = storytellerAiFileBase({ kind: 'motion', slotId: params.slotId })
  const localPath = join(params.outputDir, `${fileBase}.mp4`)

  /**
   * Submit. Higgsfield returns 200 with `status: "queued"` plus a `request_id`
   * we can poll. Failures here are usually auth (401) or rate-limit (429) —
   * surface the body verbatim so the user can fix it.
   */
  onProgress?.({
    phase: 'queued',
    detail: isTextToVideo ? 'Submitting (text-to-video) to Higgsfield…' : 'Submitting to Higgsfield…'
  })
  let requestId: string
  try {
    /**
     * Build the body conditionally: T2V requests must NOT carry an `image_url`
     * field (some Higgsfield models reject the request as malformed when both
     * `image_url` and a T2V model id are present). I2V passes the URL through
     * verbatim.
     */
    const submitBody: Record<string, unknown> = {
      prompt: promptText,
      duration,
      aspect_ratio: params.ratio === '720:1280' ? '9:16' : '16:9'
    }
    if (!isTextToVideo) {
      submitBody.image_url = referenceImageUrl
    }
    const submitRes = await fetch(`${HIGGSFIELD_API}/${params.modelId}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(creds.apiKey, creds.apiSecret),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(submitBody)
    })
    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => '')
      return {
        ok: false,
        error: `Higgsfield submit failed (${submitRes.status}): ${errText.slice(0, 400)}`
      }
    }
    const submitJson = (await submitRes.json()) as {
      request_id?: string
      status?: string
    }
    if (!submitJson.request_id) {
      return { ok: false, error: 'Higgsfield response missing request_id.' }
    }
    requestId = submitJson.request_id
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Higgsfield submit threw: ${msg}` }
  }

  /**
   * Step 3: poll. Higgsfield's terminal statuses: `completed`, `failed`,
   * `nsfw`. Anything else (`queued`, `in_progress`) means keep waiting.
   * `nsfw` is a real failure mode that gets refunded — surface it
   * specifically so the user knows to rewrite the prompt.
   */
  onProgress?.({ phase: 'generating', detail: 'Generating in Higgsfield…' })
  const pollStart = Date.now()
  let videoUrl: string | null = null
  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    let status: { status?: string; video?: { url?: string }; error?: string }
    try {
      const statusRes = await fetch(`${HIGGSFIELD_API}/requests/${requestId}/status`, {
        headers: { Authorization: authHeader(creds.apiKey, creds.apiSecret) }
      })
      if (!statusRes.ok) {
        const errText = await statusRes.text().catch(() => '')
        return {
          ok: false,
          error: `Higgsfield status poll failed (${statusRes.status}): ${errText.slice(0, 400)}`
        }
      }
      status = (await statusRes.json()) as {
        status?: string
        video?: { url?: string }
        error?: string
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `Higgsfield poll threw: ${msg}` }
    }

    if (status.status === 'completed') {
      videoUrl = status.video?.url ?? null
      break
    }
    if (status.status === 'failed') {
      return { ok: false, error: `Higgsfield failed: ${status.error ?? 'no detail provided'}` }
    }
    if (status.status === 'nsfw') {
      return {
        ok: false,
        error: 'Higgsfield rejected the shot for content moderation (credits refunded). Try rewording the prompt.'
      }
    }
  }
  if (!videoUrl) {
    return { ok: false, error: `Higgsfield timed out after ${POLL_TIMEOUT_MS / 1000}s — request ${requestId} may still finish; try Reset slot then re-poll.` }
  }

  /**
   * Step 4: download, write to disk, ffprobe, register as Asset.
   * Mirrors the Runway runner so the renderer attach path is identical.
   */
  onProgress?.({ phase: 'downloading', detail: 'Downloading clip…' })
  try {
    const dlRes = await fetch(videoUrl)
    if (!dlRes.ok) return { ok: false, error: `Download failed (${dlRes.status})` }
    const buf = Buffer.from(await dlRes.arrayBuffer())
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
        origin: 'higgsfield-broll',
        higgsfieldRequestId: requestId,
        higgsfieldModelId: params.modelId,
        provider: 'higgsfield',
        promptUsed: params.audit.promptUsed.slice(0, 4000),
        slotId: params.audit.slotId,
        stylePackId: params.audit.stylePackId ?? null,
        promptCategory: params.audit.promptCategory ?? null,
        createdAt,
        durationRequested: duration,
        videoUrl
      },
      sort_order: 9000,
      created_at: createdAt
    }

    onProgress?.({ phase: 'complete', localPath, requestId })
    return { ok: true, asset, requestId, localPath, videoUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  }
}
