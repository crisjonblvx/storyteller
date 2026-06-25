import { describe, it, expect } from 'vitest'
import {
  buildSfxNleTracks,
  sfxTrackGroupsToManifestTracks,
  sfxClipsToManifestClipRefs,
} from './audio-director-nle.js'
import type { SoundDesignSlot } from '@storyteller/timeline'
import type { SoundAssetResolution } from '@storyteller/audio'
import type { AudioDnaDefinition } from '@storyteller/analysis'

function makeSlot(overrides: Partial<SoundDesignSlot> & Pick<SoundDesignSlot, 'category' | 'status'>): SoundDesignSlot {
  return {
    id: 'slot-1',
    projectId: 'proj-1',
    tags: [],
    timelineStart: 0,
    timelineEnd: 5,
    intensity: 0.5,
    ...overrides,
  }
}

function makeResolution(overrides: Partial<SoundAssetResolution> & Pick<SoundAssetResolution, 'slotId'>): SoundAssetResolution {
  return {
    assetId: 'asset-1',
    localPath: '/sounds/test.mp3',
    confidence: 0.9,
    reason: 'Good match',
    ...overrides,
  }
}

const baseDna: AudioDnaDefinition = {
  id: 'netflix_documentary',
  label: 'Netflix Documentary',
  philosophy: '',
  ambientApproach: '',
  impactPhilosophy: '',
  transitionStyle: '',
  silenceValue: '',
  boomIntensity: 0.3,
  ambientDensity: 0.7,
  transitionProminence: 0.15,
  exampleMoments: [],
}

const podcastDna: AudioDnaDefinition = {
  ...baseDna,
  id: 'podcast',
  label: 'Podcast',
  boomIntensity: 0.0,
  ambientDensity: 0.2,
  transitionProminence: 0.05,
}

describe('buildSfxNleTracks: only accepted slots are included', () => {
  it('excludes rejected and suggested slots', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'ambient', status: 'accepted' }),
      makeSlot({ id: 'slot-b', category: 'ambient', status: 'rejected' }),
      makeSlot({ id: 'slot-c', category: 'ambient', status: 'suggested' }),
      makeSlot({ id: 'slot-d', category: 'ambient', status: 'empty' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a-1', localPath: '/a.mp3' }),
      makeResolution({ slotId: 'slot-b', assetId: 'a-2', localPath: '/b.mp3' }),
      makeResolution({ slotId: 'slot-c', assetId: 'a-3', localPath: '/c.mp3' }),
      makeResolution({ slotId: 'slot-d', assetId: 'a-4', localPath: '/d.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.clips).toHaveLength(1)
    expect(groups[0]!.clips[0]!.slotId).toBe('slot-a')
  })
})

describe('buildSfxNleTracks: null localPath skipped', () => {
  it('skips resolution with null localPath', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'impact', status: 'accepted' }),
      makeSlot({ id: 'slot-b', category: 'impact', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a-1', localPath: null }),
      makeResolution({ slotId: 'slot-b', assetId: 'a-2', localPath: '/b.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    const impactGroup = groups.find((g) => g.category === 'impact')
    expect(impactGroup?.clips).toHaveLength(1)
    expect(impactGroup?.clips[0]!.slotId).toBe('slot-b')
  })
})

describe('buildSfxNleTracks: groups in canonical order', () => {
  it('ambient group appears before impact group', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-i', category: 'impact', status: 'accepted' }),
      makeSlot({ id: 'slot-a', category: 'ambient', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-i', assetId: 'ai', localPath: '/i.mp3' }),
      makeResolution({ slotId: 'slot-a', assetId: 'aa', localPath: '/a.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    expect(groups.length).toBeGreaterThanOrEqual(2)
    const ambientIdx = groups.findIndex((g) => g.category === 'ambient')
    const impactIdx = groups.findIndex((g) => g.category === 'impact')
    expect(ambientIdx).toBeLessThan(impactIdx)
  })
})

describe('buildSfxNleTracks: volume DNA scaling', () => {
  it('podcast DNA with boomIntensity=0 produces volume 0 for impact clips', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-i', category: 'impact', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-i', assetId: 'ai', localPath: '/i.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: podcastDna })
    const impactGroup = groups.find((g) => g.category === 'impact')
    expect(impactGroup?.clips[0]!.volume).toBe(0)
  })
})

describe('buildSfxNleTracks: clipName truncation', () => {
  it('reason longer than 60 chars is truncated in clipName', () => {
    const longReason = 'A'.repeat(80)
    const slots: SoundDesignSlot[] = [
      makeSlot({
        id: 'slot-a',
        category: 'ambient',
        status: 'accepted',
        metadata: { reason: longReason },
      }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'asset-x', localPath: '/a.mp3' }),
    ]
    const groups = buildSfxNleTracks({
      slots,
      resolutions,
      audioDna: baseDna,
      assetNamesById: { 'asset-x': 'My Sound' },
    })
    const clip = groups[0]!.clips[0]!
    expect(clip.clipName).toBe(`My Sound — ${'A'.repeat(60)}`)
  })
})

describe('buildSfxNleTracks: source duration', () => {
  it('sourceOutSeconds equals timelineOutSeconds minus timelineInSeconds', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'ambient', status: 'accepted', timelineStart: 3, timelineEnd: 8 }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a1', localPath: '/a.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    const clip = groups[0]!.clips[0]!
    expect(clip.sourceInSeconds).toBe(0)
    expect(clip.sourceOutSeconds).toBe(5)
  })
})

describe('sfxTrackGroupsToManifestTracks: correct kind', () => {
  it('returned tracks have kind: "audio"', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'ambient', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a1', localPath: '/a.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    const tracks = sfxTrackGroupsToManifestTracks(groups)
    expect(tracks.length).toBeGreaterThan(0)
    for (const t of tracks) {
      expect(t.kind).toBe('audio')
    }
  })
})

describe('sfxClipsToManifestClipRefs: correct trackKind', () => {
  it('returned refs have trackKind: "audio"', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'impact', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a1', localPath: '/a.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    const refs = sfxClipsToManifestClipRefs(groups)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(r.trackKind).toBe('audio')
    }
  })
})

describe('buildSfxNleTracks: empty groups not returned', () => {
  it('if all ambient slots are rejected, no ambient group appears', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-a', category: 'ambient', status: 'rejected' }),
      makeSlot({ id: 'slot-b', category: 'impact', status: 'accepted' }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-a', assetId: 'a1', localPath: '/a.mp3' }),
      makeResolution({ slotId: 'slot-b', assetId: 'b1', localPath: '/b.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    expect(groups.find((g) => g.category === 'ambient')).toBeUndefined()
    expect(groups.find((g) => g.category === 'impact')).toBeDefined()
  })
})

describe('buildSfxNleTracks: clips sorted by timelineInSeconds', () => {
  it('two ambient clips appear in ascending timeline order', () => {
    const slots: SoundDesignSlot[] = [
      makeSlot({ id: 'slot-late', category: 'ambient', status: 'accepted', timelineStart: 10, timelineEnd: 15 }),
      makeSlot({ id: 'slot-early', category: 'ambient', status: 'accepted', timelineStart: 1, timelineEnd: 5 }),
    ]
    const resolutions: SoundAssetResolution[] = [
      makeResolution({ slotId: 'slot-late', assetId: 'a-late', localPath: '/late.mp3' }),
      makeResolution({ slotId: 'slot-early', assetId: 'a-early', localPath: '/early.mp3' }),
    ]
    const groups = buildSfxNleTracks({ slots, resolutions, audioDna: baseDna })
    const ambientGroup = groups.find((g) => g.category === 'ambient')!
    expect(ambientGroup.clips[0]!.slotId).toBe('slot-early')
    expect(ambientGroup.clips[1]!.slotId).toBe('slot-late')
  })
})
