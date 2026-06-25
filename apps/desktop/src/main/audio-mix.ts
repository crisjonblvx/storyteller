import type { SoundAssetResolution } from '@storyteller/audio'
import type { SoundDesignSlot } from '@storyteller/timeline'
import type { AudioDnaDefinition } from '@storyteller/analysis'
import { buildAudioMixPlan, buildAmixFilterGraph } from './audio-mix-plan.js'
import ffmpegPath from 'ffmpeg-static'
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

export type AudioMixProgress =
  | { phase: 'mixing_sfx'; detail?: string }
  | { phase: 'normalizing'; detail?: string }
  | { phase: 'complete' }
  | { phase: 'skipped'; reason: string }
  | { phase: 'failed'; error: string }

export async function mixAudioDirectorPass(params: {
  inputVideoPath: string
  outputVideoPath: string
  resolutions: SoundAssetResolution[]
  slots: SoundDesignSlot[]
  audioDna: AudioDnaDefinition
  sequenceDurationSeconds: number
  targetLufs?: number
  onProgress?: (p: AudioMixProgress) => void
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    inputVideoPath,
    outputVideoPath,
    resolutions,
    slots,
    audioDna,
    sequenceDurationSeconds,
    targetLufs,
    onProgress,
  } = params

  const plan = buildAudioMixPlan({ resolutions, slots, audioDna, targetLufs })

  if (plan.tracks.length === 0) {
    onProgress?.({ phase: 'skipped', reason: 'No resolved SFX tracks to mix.' })
    await copyFile(inputVideoPath, outputVideoPath)
    return { ok: true }
  }

  const validTracks = plan.tracks.filter(t => {
    const exists = existsSync(t.localPath)
    if (!exists) console.warn(`[audio-mix] SFX file not on disk, skipping: ${t.localPath}`)
    return exists
  })

  if (validTracks.length === 0) {
    onProgress?.({ phase: 'skipped', reason: 'No SFX files found on disk.' })
    await copyFile(inputVideoPath, outputVideoPath)
    return { ok: true }
  }

  const effectivePlan = { ...plan, tracks: validTracks }

  const { filterGraph, mixedAudioLabel } = buildAmixFilterGraph({
    plan: effectivePlan,
    dialogueInputIndex: 0,
    sequenceDurationSeconds,
  })

  onProgress?.({ phase: 'mixing_sfx', detail: `Mixing ${validTracks.length} SFX track(s)…` })

  if (plan.applyLoudnorm) {
    onProgress?.({ phase: 'normalizing', detail: `Loudnorm ${plan.loudnormTargetLufs} LUFS…` })
  }

  const sfxInputs = validTracks.flatMap(t => ['-i', t.localPath])

  const args = [
    '-y',
    '-i', inputVideoPath,
    ...sfxInputs,
    '-filter_complex', filterGraph,
    '-map', '0:v',
    '-map', `[${mixedAudioLabel}]`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    outputVideoPath,
  ]

  return new Promise((resolve) => {
    const bin = ffmpegPath
    if (!bin) {
      const error = 'ffmpeg-static binary not found'
      onProgress?.({ phase: 'failed', error })
      resolve({ ok: false, error })
      return
    }

    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString().slice(-800)
    })
    child.on('error', (err) => {
      const error = err.message
      onProgress?.({ phase: 'failed', error })
      resolve({ ok: false, error })
    })
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.({ phase: 'complete' })
        resolve({ ok: true })
      } else {
        const error = stderr || `ffmpeg exited with code ${code}`
        onProgress?.({ phase: 'failed', error })
        resolve({ ok: false, error })
      }
    })
  })
}
