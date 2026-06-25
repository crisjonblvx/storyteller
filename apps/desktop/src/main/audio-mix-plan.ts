import type { SoundDesignSlot, SoundDesignSlotCategory } from '@storyteller/timeline'
import type { SoundAssetResolution } from '@storyteller/audio'
import type { AudioDnaDefinition } from '@storyteller/analysis'

export interface SfxTrackEntry {
  localPath: string
  category: SoundDesignSlotCategory
  timelineStartSeconds: number
  timelineEndSeconds: number
  /** Final amplitude multiplier [0–1] after category defaults + DNA scaling */
  volume: number
}

export interface AudioMixPlan {
  tracks: SfxTrackEntry[]
  /** LUFS target for loudnorm pass */
  loudnormTargetLufs: number
  /** True when loudnorm pass should run */
  applyLoudnorm: boolean
}

export interface DialogueWindow {
  startSeconds: number
  endSeconds: number
}

const CATEGORY_VOLUME_DEFAULTS: Record<SoundDesignSlotCategory, number> = {
  ambient:    0.15,
  movement:   0.40,
  impact:     0.70,
  transition: 0.50,
  silence:    0.00,
}

function getDnaScale(category: SoundDesignSlotCategory, audioDna: AudioDnaDefinition): number {
  switch (category) {
    case 'ambient':    return audioDna.ambientDensity
    case 'impact':     return audioDna.boomIntensity
    case 'transition': return audioDna.transitionProminence
    default:           return 1
  }
}

export function buildAudioMixPlan(params: {
  resolutions: SoundAssetResolution[]
  slots: SoundDesignSlot[]
  audioDna: AudioDnaDefinition
  /** LUFS target — default -14 (YouTube). Use -23 for broadcast. */
  targetLufs?: number
}): AudioMixPlan {
  const { resolutions, slots, audioDna, targetLufs = -14 } = params

  const slotById = new Map(slots.map(s => [s.id, s]))

  const tracks: SfxTrackEntry[] = []

  for (const res of resolutions) {
    if (!res.localPath || !res.assetId) continue
    const slot = slotById.get(res.slotId)
    if (!slot) continue
    if (slot.status === 'rejected') continue

    const base = CATEGORY_VOLUME_DEFAULTS[slot.category]
    const dnaScale = getDnaScale(slot.category, audioDna)
    const volume = Math.min(1, Math.max(0, base * dnaScale))

    tracks.push({
      localPath: res.localPath,
      category: slot.category,
      timelineStartSeconds: slot.timelineStart,
      timelineEndSeconds: slot.timelineEnd,
      volume,
    })
  }

  tracks.sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds)

  const applyLoudnorm = tracks.some(t => t.volume > 0)

  return {
    tracks,
    loudnormTargetLufs: targetLufs,
    applyLoudnorm,
  }
}

export function buildAmixFilterGraph(params: {
  plan: AudioMixPlan
  /** FFmpeg input index for the base video (dialogue audio = [N:a]) */
  dialogueInputIndex: number
  /** Total duration of the sequence — used to clamp adelay/apad */
  sequenceDurationSeconds: number
}): {
  filterGraph: string
  /** Labels of all intermediate audio streams to merge */
  sfxStreamLabels: string[]
  /** Final mixed audio output label */
  mixedAudioLabel: string
} {
  const { plan, dialogueInputIndex } = params

  if (plan.tracks.length === 0) {
    return { filterGraph: '', sfxStreamLabels: [], mixedAudioLabel: '' }
  }

  const parts: string[] = []
  const sfxStreamLabels: string[] = []

  for (let i = 0; i < plan.tracks.length; i++) {
    const track = plan.tracks[i]!
    const inputIdx = dialogueInputIndex + i + 1
    const ms = Math.round(track.timelineStartSeconds * 1000)
    const label = `[sfx${i}]`
    parts.push(
      `[${inputIdx}:a]adelay=${ms}|${ms},atrim=end=${track.timelineEndSeconds},volume=${track.volume}${label}`
    )
    sfxStreamLabels.push(label)
  }

  const totalInputs = plan.tracks.length + 1
  const dialogueLabel = `[${dialogueInputIndex}:a]`
  parts.push(
    `${dialogueLabel}${sfxStreamLabels.join('')}amix=inputs=${totalInputs}:duration=first:normalize=0[premix]`
  )

  let mixedAudioLabel: string
  if (plan.applyLoudnorm) {
    parts.push(`[premix]loudnorm=I=${plan.loudnormTargetLufs}:TP=-1.5:LRA=11[mixout]`)
    mixedAudioLabel = 'mixout'
  } else {
    mixedAudioLabel = 'premix'
  }

  return {
    filterGraph: parts.join(';'),
    sfxStreamLabels,
    mixedAudioLabel,
  }
}

/**
 * Simple volume ducking for ambient tracks during dialogue windows.
 * Ambient tracks get 50% of their volume when they overlap any dialogue window.
 * Other categories are unaffected. Exported for testing and future use.
 */
export function computeDuckedVolume(
  baseVolume: number,
  category: SoundDesignSlotCategory,
  dialogueWindows: DialogueWindow[],
  trackStart: number,
  trackEnd: number
): number {
  if (category !== 'ambient') return baseVolume

  const overlaps = dialogueWindows.some(
    w => trackStart < w.endSeconds && trackEnd > w.startSeconds
  )

  return overlaps ? baseVolume * 0.5 : baseVolume
}
