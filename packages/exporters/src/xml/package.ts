import type { Asset } from '@storyteller/shared'
import type { TimelineSequence } from '@storyteller/timeline'
import type { XmlPackageManifest } from './types.js'
import { exportForResolve } from '../nle/resolve.js'
import { toEncodedFileUri } from './fcpxml.js'

export interface XmlPackageFiles {
  sequenceXml: string
  manifest: XmlPackageManifest
  readme: string
}

function localDiskPathToFileUri(absPath: string): string {
  return toEncodedFileUri(absPath)
}

/**
 * Paths for timeline translators — local assets use real `file:` URIs; cloud-only rows use a relink placeholder
 * (see `asset-manifest.json` for `storagePath` / download).
 */
export function timelinePathsFromAssets(
  assets: Pick<Asset, 'id' | 'local_path' | 'storage_path' | 'asset_type'>[],
  projectId?: string
): Record<string, string> {
  const out: Record<string, string> = {}
  const pid = projectId ?? 'project'
  for (const a of assets) {
    if (a.local_path) {
      out[a.id] = localDiskPathToFileUri(a.local_path)
    } else if (a.storage_path) {
      const name = a.storage_path.split('/').pop() ?? 'media'
      out[a.id] = `file:///StorytellerRelink/${pid}/${a.id}/${name}`
    }
  }
  return out
}

/**
 * @deprecated Prefer `exportForNle('davinci-resolve', input)` — same output; kept for backward compatibility.
 * Builds Resolve-oriented package from canonical timeline (FCPXML interchange + manifest + README).
 */
export function buildXmlPackage(
  sequence: TimelineSequence,
  assetPathsById: Record<string, string>,
  textOverlayRefs: XmlPackageManifest['textOverlayRefs'],
  detailAssets?: Asset[]
): XmlPackageFiles {
  const assets = detailAssets ?? []
  const pkg = exportForResolve({
    sequence,
    assetPathsById,
    assets,
    textOverlayRefs
  })
  return {
    sequenceXml: pkg.primaryTimeline.content,
    manifest: pkg.manifest,
    readme: pkg.readme
  }
}
