import type { SoundDesignSlotCategory } from '@storyteller/timeline'
import type { AudioDnaId } from '@storyteller/analysis'

export type { SoundDesignSlotCategory }
export type { AudioDnaId }

export type SoundAssetFormat = 'mp3' | 'wav' | 'ogg' | 'aac'
export type SoundAssetProvider = 'local' | 'soundsnap' | 'epidemic' | 'elevenlabs' | 'custom'

export interface SoundAsset {
  id: string
  name: string
  /** One of the 5 SoundDesignSlotCategory values */
  category: SoundDesignSlotCategory
  /** Searchable descriptive tags */
  tags: string[]
  /** Transcript keywords this asset works well with */
  worksWith: string[]
  /** 0–1: energy level — 0 is dead quiet, 1 is maximum impact */
  energy: number
  /** 0–1: how cinematic (vs. functional/literal) this sound is */
  cinematic: number
  /** True if appropriate for corporate/professional contexts */
  corporate: boolean
  /** Duration of the primary sound in seconds */
  durationSeconds: number
  /** Tail: reverb/decay after the main event (seconds) */
  tailLengthSeconds: number
  /** Audio DNA ids this asset is recommended for */
  recommendedForDna: AudioDnaId[]
  /** Audio DNA ids this asset should NOT be used for */
  excludedFromDna: AudioDnaId[]
  provider: SoundAssetProvider
  /** For local assets: relative path from the package root (e.g. 'assets/ambience/office-hvac.mp3') */
  localPath?: string
  /** For remote assets: the external asset id for the provider */
  externalId?: string
  format: SoundAssetFormat
  /** Mono (1) or stereo (2) */
  channels: 1 | 2
  /** Sample rate in Hz */
  sampleRate: number
}

export type SoundAssetResolution = {
  slotId: string
  assetId: string | null
  localPath: string | null
  confidence: number
  reason: string
}
