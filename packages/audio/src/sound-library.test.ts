import { describe, it, expect } from 'vitest'
import {
  SOUND_LIBRARY,
  getAssetsByCategory,
} from './sound-library.js'
import {
  scoreAssetForSlot,
  resolveSoundDesignSlots,
} from './resolve-sound-assets.js'
import type { SoundDesignSlot } from '@storyteller/timeline'
import type { SoundAsset } from './sound-assets.js'

function makeSlot(overrides: Partial<SoundDesignSlot> & Pick<SoundDesignSlot, 'category'>): SoundDesignSlot {
  return {
    id: 'slot-test',
    projectId: 'proj-test',
    tags: [],
    timelineStart: 0,
    timelineEnd: 10,
    intensity: 0.5,
    status: 'suggested',
    ...overrides,
  }
}

describe('Library completeness', () => {
  it('SOUND_LIBRARY has at least 30 assets', () => {
    expect(SOUND_LIBRARY.length).toBeGreaterThanOrEqual(30)
  })

  it('all 5 categories are represented', () => {
    const categories = new Set(SOUND_LIBRARY.map(a => a.category))
    expect(categories.has('ambient')).toBe(true)
    expect(categories.has('movement')).toBe(true)
    expect(categories.has('impact')).toBe(true)
    expect(categories.has('transition')).toBe(true)
    expect(categories.has('silence')).toBe(true)
  })

  it('no duplicate IDs', () => {
    const ids = SOUND_LIBRARY.map(a => a.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

describe('scoreAssetForSlot', () => {
  it('tag match — office+HVAC slot against office+HVAC+quiet asset scores high', () => {
    const asset: SoundAsset = SOUND_LIBRARY.find(a => a.id === 'ambient-office-hvac-steady')!
    const slot = makeSlot({ category: 'ambient', tags: ['office', 'HVAC'] })
    const score = scoreAssetForSlot(asset, slot, 'netflix_documentary')
    expect(score).toBeGreaterThan(0.5)
  })

  it('energy alignment — intensity 0.8 against energy 0.8 gives energyScore near 1', () => {
    const asset: SoundAsset = {
      ...SOUND_LIBRARY[0],
      energy: 0.8,
    }
    const slot = makeSlot({ category: 'ambient', tags: [], intensity: 0.8 })
    const score = scoreAssetForSlot(asset, slot, 'netflix_documentary')
    const energyScore = 1 - Math.abs(0.8 - 0.8)
    const expectedMin = energyScore * 0.3
    expect(score).toBeGreaterThanOrEqual(expectedMin - 0.01)
  })

  it('DNA recommended bonus — recommended DNA scores higher than non-recommended', () => {
    const asset = SOUND_LIBRARY.find(a => a.id === 'impact-heavy-cinematic-boom-espn')!
    const slot = makeSlot({ category: 'impact', tags: ['boom'], intensity: 0.95 })
    const scoreRecommended = scoreAssetForSlot(asset, slot, 'espn_sports')
    const scoreNeutral = scoreAssetForSlot(asset, slot, 'crime_documentary')
    expect(scoreRecommended).toBeGreaterThan(scoreNeutral)
  })
})

describe('resolveSoundDesignSlots', () => {
  it('DNA exclusion — all impact assets excluded from podcast returns confidence 0', () => {
    const slot = makeSlot({ category: 'impact', tags: ['boom'], intensity: 0.5 })
    const results = resolveSoundDesignSlots({ slots: [slot], audioDnaId: 'podcast' })
    expect(results[0].confidence).toBe(0)
    expect(results[0].assetId).toBeNull()
  })

  it('returns one resolution per slot', () => {
    const slots = [
      makeSlot({ id: 'slot-1', category: 'ambient', tags: ['office'] }),
      makeSlot({ id: 'slot-2', category: 'movement', tags: ['footsteps'] }),
      makeSlot({ id: 'slot-3', category: 'transition', tags: ['whoosh'] }),
    ]
    const results = resolveSoundDesignSlots({ slots, audioDnaId: 'netflix_documentary' })
    expect(results).toHaveLength(3)
    expect(results[0].slotId).toBe('slot-1')
    expect(results[1].slotId).toBe('slot-2')
    expect(results[2].slotId).toBe('slot-3')
  })

  it('DNA recommended bonus — recommended DNA resolution scores higher than neutral', () => {
    const slot = makeSlot({ category: 'impact', tags: ['boom'], intensity: 0.95 })
    const recommendedResults = resolveSoundDesignSlots({ slots: [slot], audioDnaId: 'espn_sports' })
    const neutralResults = resolveSoundDesignSlots({ slots: [slot], audioDnaId: 'netflix_documentary' })
    expect(recommendedResults[0].confidence).toBeGreaterThan(neutralResults[0].confidence)
  })

  it('no match returns null assetId when all candidates excluded', () => {
    const slot = makeSlot({ category: 'impact', tags: ['nonexistent_xyz_tag'], intensity: 0.5 })
    const results = resolveSoundDesignSlots({ slots: [slot], audioDnaId: 'podcast' })
    expect(results[0].assetId).toBeNull()
    expect(results[0].confidence).toBe(0)
  })

  it('no match returns null assetId when composite score is below threshold', () => {
    const slot = makeSlot({ category: 'silence', tags: ['boom', 'explosion', 'crash'], intensity: 1.0 })
    const results = resolveSoundDesignSlots({ slots: [slot], audioDnaId: 'espn_sports' })
    expect(results[0].assetId).toBeNull()
    expect(results[0].confidence).toBe(0)
  })
})

describe('getAssetsByCategory', () => {
  it('returns only assets matching the given category', () => {
    const ambientAssets = getAssetsByCategory('ambient')
    expect(ambientAssets.length).toBeGreaterThan(0)
    expect(ambientAssets.every(a => a.category === 'ambient')).toBe(true)
  })
})
