import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { mapWithConcurrency } from '@storyteller/shared'
import {
  computeWhisperChunkDurationSec,
  mergeChunkTranscripts,
  planAudioChunks,
  type ChunkTranscriptionResult
} from '@storyteller/transcription'
import { runFfprobe } from './ffprobe.js'
import { extractChunkToMp3 } from './ffmpeg-audio.js'
import { whisperFromBytes, type WhisperSegment } from './openai-whisper.js'

const WHISPER_MAX_BYTES = 25 * 1024 * 1024
const SAFE_SINGLE_FILE_BYTES = 24 * 1024 * 1024
/** Single-shot Whisper when the whole file is under size cap and not longer than this (seconds). */
const SINGLE_SHOT_MAX_DURATION_SEC = 600

function whisperConcurrency(): number {
  const raw = Number(process.env.STORYTELLER_WHISPER_CONCURRENCY)
  if (Number.isFinite(raw) && raw >= 1) return Math.min(10, Math.floor(raw))
  return 6
}

export type TranscriptionProgressPayload = {
  phase: 'preparing' | 'chunking' | 'transcribing_chunk' | 'merging' | 'done'
  detail?: string
  chunkIndex?: number
  chunkTotal?: number
  /** Completed parts (Whisper parallel pipeline). */
  chunksCompleted?: number
  /** Rolling ETA for remaining parts (seconds). */
  estimatedSecondsRemaining?: number
}

export type TranscribeResult =
  | { ok: true; segments: WhisperSegment[]; duration?: number; language?: string }
  | { ok: false; error: string }

function sendProgress(
  onProgress: ((p: TranscriptionProgressPayload) => void) | undefined,
  p: TranscriptionProgressPayload
): void {
  onProgress?.(p)
}

async function streamDownloadToFile(url: string, dest: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ok: false, error: `Download failed: HTTP ${res.status}` }
    }
    const body = res.body
    if (!body) {
      return { ok: false, error: 'Empty response body' }
    }
    const nodeReadable = Readable.fromWeb(body as import('stream/web').ReadableStream<Uint8Array>)
    await pipeline(nodeReadable, createWriteStream(dest))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function inferHasVideo(assetType: string | undefined, probeHasVideo: boolean): boolean {
  if (assetType === 'audio') return false
  if (assetType === 'video') return true
  return probeHasVideo
}

export async function transcribeAsset(params: {
  signedUrl?: string
  localPath?: string
  filename: string
  assetType?: string
  onProgress?: (p: TranscriptionProgressPayload) => void
}): Promise<TranscribeResult> {
  const { signedUrl, localPath, filename, assetType, onProgress } = params
  const workDir = join(app.getPath('userData'), 'transcription-work', randomUUID())

  try {
    sendProgress(onProgress, { phase: 'preparing', detail: 'Preparing media…' })
    await mkdir(workDir, { recursive: true })

    let inputPath: string
    if (localPath) {
      inputPath = localPath
    } else if (signedUrl) {
      inputPath = join(workDir, `source-${sanitizeFilename(filename)}`)
      const dl = await streamDownloadToFile(signedUrl, inputPath)
      if (!dl.ok) {
        return { ok: false, error: dl.error }
      }
    } else {
      return { ok: false, error: 'Provide localPath or signedUrl' }
    }

    const probe = await runFfprobe(inputPath)
    if (!probe.ok) {
      if (probe.code === 'SOURCE_FILE_MISSING' || probe.error === 'File not found') {
        return {
          ok: false,
          error:
            'SOURCE_FILE_MISSING: The media file could not be found on disk. Reselect it in Storyteller (Upload step) and try again.'
        }
      }
      return { ok: false, error: `Media analysis failed: ${probe.error}` }
    }

    const durationSec = probe.data.durationSeconds ?? 0
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return { ok: false, error: 'Could not read media duration. File may be corrupt or unsupported.' }
    }
    const hasVideo = inferHasVideo(assetType, probe.data.hasVideoStream)

    const st = await stat(inputPath)
    const canTrySingleShot =
      st.size <= SAFE_SINGLE_FILE_BYTES && durationSec <= SINGLE_SHOT_MAX_DURATION_SEC + 1e-3

    if (canTrySingleShot) {
      sendProgress(onProgress, {
        phase: 'transcribing_chunk',
        chunkIndex: 1,
        chunkTotal: 1,
        detail: filename
      })
      // Always normalize through FFmpeg before Whisper — raw MP4/MOV containers (e.g. Grok exports)
      // often use codecs OpenAI cannot decode even when ffprobe reports a valid audio stream.
      const normalizedPath = join(workDir, 'normalized-single.mp3')
      const normalized = await extractChunkToMp3({
        sourcePath: inputPath,
        outputPath: normalizedPath,
        startSec: 0,
        durationSec,
        hasVideo
      })
      if (!normalized.ok) {
        return {
          ok: false,
          error: `Could not extract audio for transcription: ${normalized.error}`
        }
      }
      const normalizedStat = await stat(normalizedPath)
      if (normalizedStat.size <= 0) {
        return {
          ok: false,
          error:
            'Could not extract any audio from this file. If you can hear sound in the clip, try re-exporting it as MP4 or MOV from your editor, then re-import.'
        }
      }
      const buf = await readFile(normalizedPath)
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      const w = await whisperFromBytes(bytes, 'normalized-single.mp3')
      if (!w.ok) {
        return { ok: false, error: w.error }
      }
      sendProgress(onProgress, { phase: 'merging', detail: 'Normalizing transcript…' })
      const segments: WhisperSegment[] = w.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text
      }))
      sendProgress(onProgress, { phase: 'done' })
      return { ok: true, segments, duration: w.duration ?? durationSec, language: w.language }
    }

    const chunkDurationSec = computeWhisperChunkDurationSec(durationSec)
    const plans = planAudioChunks(durationSec, {
      chunkDurationSec,
      overlapSec: 0
    })
    if (plans.length === 0) {
      return { ok: false, error: 'Could not determine media duration for chunking.' }
    }

    const conc = whisperConcurrency()
    sendProgress(onProgress, {
      phase: 'chunking',
      detail: `Splitting into ${plans.length} part(s) (~${Math.round(chunkDurationSec / 60)} min each, up to ${conc} parallel)…`,
      chunkTotal: plans.length
    })

    const languages: (string | undefined)[] = []
    const chunkDurationsSec: number[] = []
    let finished = 0

    let chunkResults: ChunkTranscriptionResult[]
    try {
      chunkResults = await mapWithConcurrency(
      plans,
      conc,
      async (plan) => {
        const chunkPath = join(workDir, `chunk-${String(plan.index).padStart(4, '0')}.mp3`)
        const t0 = Date.now()
        const ex = await extractChunkToMp3({
          sourcePath: inputPath,
          outputPath: chunkPath,
          startSec: plan.startSec,
          durationSec: plan.durationSec,
          hasVideo
        })
        if (!ex.ok) {
          throw new Error(`Audio extract failed (part ${plan.index + 1}/${plans.length}): ${ex.error}`)
        }

        const chunkStat = await stat(chunkPath)
        if (chunkStat.size > WHISPER_MAX_BYTES) {
          throw new Error(`Chunk ${plan.index + 1} exceeds API size limit (${chunkStat.size} bytes).`)
        }

        const chunkBuf = await readFile(chunkPath)
        const chunkBytes = new Uint8Array(chunkBuf.buffer, chunkBuf.byteOffset, chunkBuf.byteLength)
        const w = await whisperFromBytes(chunkBytes, `chunk-${plan.index}.mp3`, (retry) => {
          sendProgress(onProgress, {
            phase: 'transcribing_chunk',
            chunkIndex: plan.index + 1,
            chunkTotal: plans.length,
            chunksCompleted: finished,
            estimatedSecondsRemaining: undefined,
            detail: `${filename} — retrying part ${plan.index + 1} (${retry.attempt}/${retry.maxAttempts})…`
          })
        })
        if (!w.ok) {
          throw new Error(`Transcription failed on part ${plan.index + 1}/${plans.length}: ${w.error}`)
        }

        languages.push(w.language)

        const elapsedSec = (Date.now() - t0) / 1000
        chunkDurationsSec.push(elapsedSec)
        finished++
        const recent = chunkDurationsSec.slice(-8)
        const avg =
          recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : elapsedSec
        const remaining = Math.max(0, plans.length - finished)
        const etaSec = Math.round(remaining * avg)

        sendProgress(onProgress, {
          phase: 'transcribing_chunk',
          chunkIndex: plan.index + 1,
          chunkTotal: plans.length,
          chunksCompleted: finished,
          estimatedSecondsRemaining: remaining > 0 ? etaSec : 0,
          detail: `${filename} — finished ${finished}/${plans.length}${remaining > 0 ? ` · ~${etaSec}s left` : ''}`
        })

        return {
          chunkIndex: plan.index,
          offsetSec: plan.startSec,
          segments: w.segments
        }
      }
    )
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    const lastLanguage = languages.find((l) => typeof l === 'string' && l.length > 0)

    sendProgress(onProgress, { phase: 'merging', detail: 'Merging transcript…' })
    const merged = mergeChunkTranscripts(chunkResults, { overlapSec: 0 })
    const segments: WhisperSegment[] = merged.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text
    }))

    sendProgress(onProgress, { phase: 'done' })
    return {
      ok: true,
      segments,
      duration: durationSec || undefined,
      language: lastLanguage
    }
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {
      /* ignore cleanup errors */
    }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'media.bin'
}
