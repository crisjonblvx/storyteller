import { describe, it, expect } from 'vitest'
import {
  buildAudioMixPlan,
  buildAmixFilterGraph,
  computeDuckedVolume,
  type AudioMixPlan,
  type DialogueWindow,
} from './audio-mix-plan.js'
import type { SoundAssetResolution } from '@storyteller/audio'
import type { SoundDesignSlot } from '@storyteller/timeline'
import type { AudioDnaDefinition } from '@storyteller/analysis'
import { AUDIO_DNA } from '@storyteller/analysis'

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeSlot(overrides: Partial<SoundDesignSlot> & { id: string }): SoundDesignSlot {
  return {
    id: overrides.id,
    projectId: 'proj-1',
    category: overrides.category ?? 'ambient',
    tags: overrides.tags ?? [],
    timelineStart: overrides.timelineStart ?? 0,
    timelineEnd: overrides.timelineEnd ?? 5,
    intensity: overrides.intensity ?? 0.5,
    status: overrides.status ?? 'accepted',
  }
}

function makeResolution(overrides: Partial<SoundAssetResolution> & { slotId: string }): SoundAssetResolution {
  return {
    slotId: overrides.slotId,
    assetId: overrides.assetId === undefined ? 'asset-1' : overrides.assetId,
    localPath: overrides.localPath === undefined ? '/tmp/sound.mp3' : overrides.localPath,
    confidence: overrides.confidence ?? 0.8,
    reason: overrides.reason ?? 'test',
  }
}

function makePlan(overrides: Partial<AudioMixPlan> = {}): AudioMixPlan {
  return {
    tracks: overrides.tracks ?? [
      {
        localPath: '/tmp/sfx.mp3',
        category: 'ambient',
        timelineStartSeconds: 1,
        timelineEndSeconds: 6,
        volume: 0.105,
      }
    ],
    loudnormTargetLufs: overrides.loudnormTargetLufs ?? -14,
    applyLoudnorm: overrides.applyLoudnorm ?? true,
  }
}

// ─── buildAudioMixPlan ────────────────────────────────────────────────────────

describe('buildAudioMixPlan', () => {
  it('empty resolutions → empty tracks', () => {
    const result = buildAudioMixPlan({
      resolutions: [],
      slots: [makeSlot({ id: 's1' })],
      audioDna: AUDIO_DNA.netflix_documentary,
    })
    expect(result.tracks).toHaveLength(0)
    expect(result.applyLoudnorm).toBe(false)
  })

  it('rejected slots are excluded', () => {
    const slot = makeSlot({ id: 's1', status: 'rejected' })
    const res = makeResolution({ slotId: 's1' })
    const result = buildAudioMixPlan({
      resolutions: [res],
      slots: [slot],
      audioDna: AUDIO_DNA.netflix_documentary,
    })
    expect(result.tracks).toHaveLength(0)
  })

  it('ambient volume uses DNA ambientDensity scaling (netflix_documentary)', () => {
    // netflix_documentary.ambientDensity = 0.7 → 0.15 * 0.7 = 0.105
    const slot = makeSlot({ id: 's1', category: 'ambient' })
    const res = makeResolution({ slotId: 's1' })
    const result = buildAudioMixPlan({
      resolutions: [res],
      slots: [slot],
      audioDna: AUDIO_DNA.netflix_documentary,
    })
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0]!.volume).toBeCloseTo(0.105, 5)
  })

  it('podcast DNA impact volume → 0', () => {
    // podcast.boomIntensity = 0 → 0.70 * 0 = 0
    const slot = makeSlot({ id: 's1', category: 'impact' })
    const res = makeResolution({ slotId: 's1' })
    const result = buildAudioMixPlan({
      resolutions: [res],
      slots: [slot],
      audioDna: AUDIO_DNA.podcast,
    })
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0]!.volume).toBe(0)
  })

  it('null localPath resolutions are skipped', () => {
    const slot = makeSlot({ id: 's1' })
    const res = makeResolution({ slotId: 's1', localPath: null })
    const result = buildAudioMixPlan({
      resolutions: [res],
      slots: [slot],
      audioDna: AUDIO_DNA.netflix_documentary,
    })
    expect(result.tracks).toHaveLength(0)
  })
})

// ─── buildAmixFilterGraph ─────────────────────────────────────────────────────

describe('buildAmixFilterGraph', () => {
  it('single SFX track produces valid filterGraph string', () => {
    const plan = makePlan()
    const { filterGraph } = buildAmixFilterGraph({
      plan,
      dialogueInputIndex: 0,
      sequenceDurationSeconds: 60,
    })
    expect(filterGraph).toContain('adelay')
    expect(filterGraph).toContain('amix')
    expect(filterGraph).toContain('loudnorm')
  })

  it('no SFX → empty filterGraph and no sfxStreamLabels', () => {
    const plan = makePlan({ tracks: [], applyLoudnorm: false })
    const result = buildAmixFilterGraph({
      plan,
      dialogueInputIndex: 0,
      sequenceDurationSeconds: 60,
    })
    expect(result.filterGraph).toBe('')
    expect(result.sfxStreamLabels).toHaveLength(0)
    expect(result.mixedAudioLabel).toBe('')
  })

  it('output label appears in filterGraph', () => {
    const plan = makePlan()
    const { filterGraph, mixedAudioLabel } = buildAmixFilterGraph({
      plan,
      dialogueInputIndex: 0,
      sequenceDurationSeconds: 60,
    })
    expect(mixedAudioLabel).toBeTruthy()
    expect(filterGraph).toContain(mixedAudioLabel)
  })

  it('skips loudnorm when applyLoudnorm is false', () => {
    const plan = makePlan({ applyLoudnorm: false })
    const { filterGraph, mixedAudioLabel } = buildAmixFilterGraph({
      plan,
      dialogueInputIndex: 0,
      sequenceDurationSeconds: 60,
    })
    expect(filterGraph).not.toContain('loudnorm')
    expect(mixedAudioLabel).toBe('premix')
  })
})

// ─── computeDuckedVolume ──────────────────────────────────────────────────────

describe('computeDuckedVolume', () => {
  const dialogueWindows: DialogueWindow[] = [
    { startSeconds: 2, endSeconds: 8 },
  ]

  it('ambient overlapping dialogue gets 50% reduction', () => {
    const result = computeDuckedVolume(0.15, 'ambient', dialogueWindows, 0, 10)
    expect(result).toBeCloseTo(0.075, 5)
  })

  it('impact not affected by dialogue overlap', () => {
    const result = computeDuckedVolume(0.7, 'impact', dialogueWindows, 0, 10)
    expect(result).toBe(0.7)
  })

  it('no overlap returns base volume', () => {
    const result = computeDuckedVolume(0.15, 'ambient', dialogueWindows, 10, 20)
    expect(result).toBe(0.15)
  })
})
