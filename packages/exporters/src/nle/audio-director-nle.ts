import type { SoundDesignSlot, SoundDesignSlotCategory } from '@storyteller/timeline'
import type { SoundAssetResolution } from '@storyteller/audio'
import type { AudioDnaDefinition } from '@storyteller/analysis'
import type { XmlManifestClipRef } from '../xml/types.js'

/** One NLE-ready audio clip derived from a resolved SoundDesignSlot */
export interface SfxNleClip {
  id: string
  /** Slot id from SoundDesignSlot */
  slotId: string
  /** Asset id from SoundAssetResolution */
  assetId: string
  /** Absolute local path to the audio file */
  localPath: string
  /** NLE display name: "<assetName> — <reason truncated to 60 chars>" */
  clipName: string
  category: SoundDesignSlotCategory
  /** Named track this clip lands on, e.g. "Ambient", "Impact" */
  trackName: string
  /** NLE track id for grouping, e.g. "a-sfx-ambient" */
  trackId: string
  timelineInSeconds: number
  timelineOutSeconds: number
  /** Source audio: play from 0 to (timelineOut - timelineIn) */
  sourceInSeconds: number
  sourceOutSeconds: number
  /** Final amplitude [0–1] for this clip — inlined into NLE volume metadata */
  volume: number
  /** DNA-aware category description for manifest/readme */
  categoryLabel: string
}

/** All SFX clips grouped by category track, ready for NLE injection */
export interface SfxNleTrackGroup {
  trackId: string
  trackName: string
  category: SoundDesignSlotCategory
  clips: SfxNleClip[]
}

const CATEGORY_TRACK_NAMES: Record<SoundDesignSlotCategory, string> = {
  ambient:    'Ambient',
  movement:   'Movement',
  impact:     'Impact',
  transition: 'Transition',
  silence:    'Silence',
}

const CATEGORY_TRACK_IDS: Record<SoundDesignSlotCategory, string> = {
  ambient:    'a-sfx-ambient',
  movement:   'a-sfx-movement',
  impact:     'a-sfx-impact',
  transition: 'a-sfx-transition',
  silence:    'a-sfx-silence',
}

const CATEGORY_VOLUME_DEFAULTS: Record<SoundDesignSlotCategory, number> = {
  ambient:    0.15,
  movement:   0.40,
  impact:     0.70,
  transition: 0.50,
  silence:    0.00,
}

const CATEGORY_ORDER: SoundDesignSlotCategory[] = [
  'ambient',
  'movement',
  'impact',
  'transition',
  'silence',
]

const CATEGORY_LABELS: Record<SoundDesignSlotCategory, string> = {
  ambient:    'Ambient — room tone, environmental background',
  movement:   'Movement — footsteps, foley, physical presence',
  impact:     'Impact — cinematic booms, emotional accents',
  transition: 'Transition — whooshes, swells between segments',
  silence:    'Silence — intentional audio removal',
}

function getDnaScale(category: SoundDesignSlotCategory, audioDna: AudioDnaDefinition): number {
  switch (category) {
    case 'ambient':    return audioDna.ambientDensity
    case 'impact':     return audioDna.boomIntensity
    case 'transition': return audioDna.transitionProminence
    default:           return 1
  }
}

export function buildSfxNleTracks(params: {
  slots: SoundDesignSlot[]
  resolutions: SoundAssetResolution[]
  audioDna: AudioDnaDefinition
  /** Asset name lookup by assetId — optional, used for clip display name */
  assetNamesById?: Record<string, string>
}): SfxNleTrackGroup[] {
  const { slots, resolutions, audioDna, assetNamesById } = params

  const resolutionBySlotId = new Map(resolutions.map((r) => [r.slotId, r]))
  const groupMap = new Map<SoundDesignSlotCategory, SfxNleClip[]>()

  for (const slot of slots) {
    if (slot.status !== 'accepted') continue

    const resolution = resolutionBySlotId.get(slot.id)
    if (!resolution) continue
    if (!resolution.localPath || !resolution.assetId) continue

    const category = slot.category
    const dnaScale = getDnaScale(category, audioDna)
    const rawVolume = CATEGORY_VOLUME_DEFAULTS[category] * dnaScale
    const volume = Math.min(1, Math.max(0, rawVolume))

    const assetName = assetNamesById?.[resolution.assetId] ?? resolution.assetId
    const reason = (slot.metadata?.reason as string | undefined) ?? ''
    const clipName = `${assetName} — ${reason.slice(0, 60)}`

    const timelineIn = slot.timelineStart
    const timelineOut = slot.timelineEnd

    const clip: SfxNleClip = {
      id: `sfx-${slot.id}`,
      slotId: slot.id,
      assetId: resolution.assetId,
      localPath: resolution.localPath,
      clipName,
      category,
      trackName: CATEGORY_TRACK_NAMES[category],
      trackId: CATEGORY_TRACK_IDS[category],
      timelineInSeconds: timelineIn,
      timelineOutSeconds: timelineOut,
      sourceInSeconds: 0,
      sourceOutSeconds: timelineOut - timelineIn,
      volume,
      categoryLabel: CATEGORY_LABELS[category],
    }

    const list = groupMap.get(category) ?? []
    list.push(clip)
    groupMap.set(category, list)
  }

  const groups: SfxNleTrackGroup[] = []
  for (const category of CATEGORY_ORDER) {
    const clips = groupMap.get(category)
    if (!clips || clips.length === 0) continue
    clips.sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    groups.push({
      trackId: CATEGORY_TRACK_IDS[category],
      trackName: CATEGORY_TRACK_NAMES[category],
      category,
      clips,
    })
  }

  return groups
}

export function sfxTrackGroupsToManifestTracks(
  groups: SfxNleTrackGroup[]
): Array<{ id: string; name: string; kind: 'audio'; clipCount: number }> {
  return groups.map((g) => ({
    id: g.trackId,
    name: g.trackName,
    kind: 'audio' as const,
    clipCount: g.clips.length,
  }))
}

export function sfxClipsToManifestClipRefs(groups: SfxNleTrackGroup[]): XmlManifestClipRef[] {
  const refs: XmlManifestClipRef[] = []
  for (const group of groups) {
    for (const clip of group.clips) {
      refs.push({
        id: clip.id,
        trackId: clip.trackId,
        trackKind: 'audio',
        role: `sfx-${clip.category}`,
        assetId: clip.assetId,
        sourceInSeconds: clip.sourceInSeconds,
        sourceOutSeconds: clip.sourceOutSeconds,
        timelineInSeconds: clip.timelineInSeconds,
        timelineOutSeconds: clip.timelineOutSeconds,
      })
    }
  }
  return refs
}
