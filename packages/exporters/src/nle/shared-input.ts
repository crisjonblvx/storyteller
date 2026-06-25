import type { Asset } from '@storyteller/shared'
import type { TimelineSequence, SoundDesignSlot } from '@storyteller/timeline'
import type { SoundAssetResolution } from '@storyteller/audio'
import type { AudioDnaDefinition } from '@storyteller/analysis'
import type { XmlPackageManifest } from '../xml/types.js'

/** Shared input for all NLE adapters — canonical timeline + resolved asset paths + optional project assets. */
export interface NleExportInput {
  /** Display name for export-summary.txt and README context. */
  projectTitle?: string
  sequence: TimelineSequence
  /** Resolved `file:` URIs or relink placeholders; same map used by every translator. */
  assetPathsById: Record<string, string>
  assets: Pick<
    Asset,
    | 'id'
    | 'local_path'
    | 'storage_path'
    | 'asset_type'
    | 'width'
    | 'height'
    | 'fps'
    | 'duration_seconds'
    | 'original_filename'
    | 'clip_role'
    | 'creator_clip_role'
    | 'metadata_json'
  >[]
  textOverlayRefs: XmlPackageManifest['textOverlayRefs']
  soundDesign?: {
    slots: SoundDesignSlot[]
    resolutions: SoundAssetResolution[]
    audioDna: AudioDnaDefinition
    /** Asset name by id — used for clip display names */
    assetNamesById?: Record<string, string>
  }
}
