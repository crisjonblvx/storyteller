import type { SoundDesignSlot } from '@storyteller/timeline'
import type { AudioDnaId } from '@storyteller/analysis'
import type { SoundAsset, SoundAssetResolution } from './sound-assets.js'
import { SOUND_LIBRARY } from './sound-library.js'

export type ResolveSoundDesignSlotsParams = {
  slots: SoundDesignSlot[]
  audioDnaId: AudioDnaId
  library?: SoundAsset[]
}

export function scoreAssetForSlot(
  asset: SoundAsset,
  slot: SoundDesignSlot,
  audioDnaId: AudioDnaId
): number {
  const allTerms = [...asset.tags, ...asset.worksWith].map(t => t.toLowerCase())
  const slotTags = slot.tags.map(t => t.toLowerCase())
  const matches = slotTags.filter(t => allTerms.includes(t)).length
  const tagScore = matches / Math.max(slot.tags.length, 1)

  const dnaBonus = asset.recommendedForDna.includes(audioDnaId) ? 0.25 : 0

  const energyScore = Math.max(0, 1 - Math.abs(asset.energy - slot.intensity))

  const composite = (tagScore * 0.5) + (energyScore * 0.3) + (dnaBonus * 0.2)
  return Math.min(1, Math.max(0, composite))
}

export function resolveSoundDesignSlots(
  params: ResolveSoundDesignSlotsParams
): SoundAssetResolution[] {
  const { slots, audioDnaId, library = SOUND_LIBRARY } = params

  return slots.map(slot => {
    const candidates = library
      .filter(a => a.category === slot.category)
      .filter(a => !a.excludedFromDna.includes(audioDnaId))

    if (candidates.length === 0) {
      return {
        slotId: slot.id,
        assetId: null,
        localPath: null,
        confidence: 0,
        reason: 'No candidates after category and DNA exclusion filters',
      }
    }

    let best: SoundAsset | null = null
    let bestScore = 0

    for (const asset of candidates) {
      const score = scoreAssetForSlot(asset, slot, audioDnaId)
      if (score > bestScore) {
        bestScore = score
        best = asset
      }
    }

    if (!best || bestScore < 0.1) {
      return {
        slotId: slot.id,
        assetId: null,
        localPath: null,
        confidence: 0,
        reason: 'No asset scored above minimum threshold (0.1)',
      }
    }

    const asset = best
    const allTerms = [...asset.tags, ...asset.worksWith].map(t => t.toLowerCase())
    const slotTags = slot.tags.map(t => t.toLowerCase())
    const matchedTags = slotTags.filter(t => allTerms.includes(t))
    const tagStr = matchedTags.length > 0
      ? `Tags matched: ${matchedTags.join(', ')} (${matchedTags.length}/${slot.tags.length})`
      : `Tags matched: none (0/${slot.tags.length})`

    const dnaStr = asset.recommendedForDna.includes(audioDnaId) ? 'recommended' : 'neutral'
    const energyScore = Math.max(0, 1 - Math.abs(asset.energy - slot.intensity))
    const energyStr = `Energy match: ${energyScore.toFixed(2)}`

    const reason = `${tagStr} | DNA fit: ${dnaStr} | ${energyStr}`

    return {
      slotId: slot.id,
      assetId: asset.id,
      localPath: resolveLocalPath(asset),
      confidence: Math.min(1, Math.max(0, bestScore)),
      reason,
    }
  })
}

export function resolveLocalPath(asset: SoundAsset): string | null {
  if (asset.provider !== 'local' || !asset.localPath) return null
  // Relative catalog paths — absolute resolution happens in the Electron main process at export time.
  return asset.localPath
}
