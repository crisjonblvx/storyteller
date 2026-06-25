import type { Asset } from '@storyteller/shared'
import type { TimelineSequence } from '@storyteller/timeline'
import type { XmlPackageManifest } from '../xml/types.js'

/** Shared input for all NLE adapters — canonical timeline + resolved asset paths + optional project assets. */
export interface NleExportInput {
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
}
