import type { NleTarget, XmlPackageManifest } from '../xml/types.js'

export type { NleTarget } from '../xml/types.js'

/** One logical export for a professional NLE — built from canonical timeline JSON + adapters only. */
export interface NleExportPackage {
  target: NleTarget
  /** Human-readable bundle name for zip / folder */
  bundleName: string
  /** Primary interchange document (FCPXML for FCP/Resolve/Premiere, OTIO for the otio target). */
  primaryTimeline: {
    filename: string
    content: string
    format: 'fcpxml' | 'otio'
  }
  /** Optional secondary interchange (e.g. XMEML for Premiere classic workflow). */
  additionalFiles?: Array<{ filename: string; content: string; format: 'xmeml' | 'md' | 'json' }>
  manifest: XmlPackageManifest
  readme: string
}
