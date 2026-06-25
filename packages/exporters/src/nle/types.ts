import type { NleTarget, XmlPackageManifest } from '../xml/types.js'
import type { ExportSummary } from './export-summary.js'

export type { NleTarget } from '../xml/types.js'
export type { ExportSummary } from './export-summary.js'

/** One logical export for a professional NLE — built from canonical timeline JSON + adapters only. */
export interface NleExportPackage {
  target: NleTarget
  /** Human-readable bundle name for zip / folder */
  bundleName: string
  /** Primary interchange document (FCPXML for FCP/Resolve/Premiere, XMEML for Premiere classic, OTIO for the otio target). */
  primaryTimeline: {
    filename: string
    content: string
    format: 'fcpxml' | 'xmeml' | 'otio'
  }
  /** Optional secondary interchange (e.g. FCPXML alongside XMEML for Premiere, or supplemental files). */
  additionalFiles?: Array<{ filename: string; content: string; format: 'fcpxml' | 'xmeml' | 'md' | 'json' }>
  manifest: XmlPackageManifest
  readme: string
  /** Plain-text summary written beside the package — included vs excluded counts for editors. */
  exportSummary: ExportSummary
  exportSummaryText: string
}
