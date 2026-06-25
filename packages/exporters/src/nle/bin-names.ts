import type { Asset, AssetType, CreatorClipRole, JournalismClipRole, StoryMode } from '@storyteller/shared'

export type NleBinAssetProbe = Pick<
  Asset,
  'id' | 'asset_type' | 'clip_role' | 'creator_clip_role' | 'original_filename' | 'metadata_json'
>

const JOURNALISM_BIN: Record<JournalismClipRole, string> = {
  sot: 'A-Roll / SOT',
  standup: 'A-Roll / Standup',
  broll: 'B-Roll',
  voiceover: 'Audio / Voiceover',
  'nat-sound': 'Audio / Nat Sound',
  anchor: 'A-Roll / Anchor',
  unassigned: 'Uncategorized'
}

const CREATOR_BIN: Record<CreatorClipRole, string> = {
  hook: 'A-Roll / Hook',
  hero: 'A-Roll / Hero',
  broll: 'B-Roll',
  testimonial: 'A-Roll / Testimonial',
  recap: 'A-Roll / Recap',
  transition: 'B-Roll / Transitions',
  unassigned: 'Uncategorized'
}

function binForAssetType(assetType: AssetType): string {
  if (assetType === 'audio') return 'Audio / Music'
  if (assetType === 'image' || assetType === 'photo') return 'Stills / Graphics'
  return 'Uncategorized'
}

/** Map a Storyteller asset to an NLE bin label for handoff packages. */
export function nleBinNameForAsset(
  asset: NleBinAssetProbe,
  mode?: StoryMode | null
): string {
  const meta = asset.metadata_json as { aiGenerated?: boolean; provider?: string } | null | undefined
  if (meta?.aiGenerated || meta?.provider) return 'B-Roll / AI Generated'

  if (mode === 'journalism' && asset.clip_role) {
    return JOURNALISM_BIN[asset.clip_role] ?? binForAssetType(asset.asset_type)
  }
  if (mode === 'creator' && asset.creator_clip_role) {
    return CREATOR_BIN[asset.creator_clip_role] ?? binForAssetType(asset.asset_type)
  }

  if (asset.asset_type === 'audio') return 'Audio / Music'
  if (asset.asset_type === 'video') return 'B-Roll'
  return binForAssetType(asset.asset_type)
}

export function groupAssetsByNleBin(
  assets: NleBinAssetProbe[],
  mode?: StoryMode | null
): Map<string, NleBinAssetProbe[]> {
  const bins = new Map<string, NleBinAssetProbe[]>()
  for (const asset of assets) {
    const name = nleBinNameForAsset(asset, mode)
    const list = bins.get(name) ?? []
    list.push(asset)
    bins.set(name, list)
  }
  return bins
}
