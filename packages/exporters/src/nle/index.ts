import type { NleTarget } from '../xml/types.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'
import { exportForFinalCut } from './final-cut.js'
import { exportForPremiere } from './premiere.js'
import { exportForResolve } from './resolve.js'
import { exportForOtio } from './otio.js'
import { buildExportSummary, formatExportSummaryText } from './export-summary.js'

export type { NleExportPackage } from './types.js'
export type { NleExportInput } from './shared-input.js'
export type { NleTarget } from '../xml/types.js'
export type { ExportSummary } from './export-summary.js'
export { exportForFinalCut } from './final-cut.js'
export { exportForPremiere } from './premiere.js'
export { exportForResolve } from './resolve.js'
export { exportForOtio } from './otio.js'
export { buildXmlPackageManifest } from './manifest.js'
export { buildExportSummary, formatExportSummaryText } from './export-summary.js'
export { groupAssetsByNleBin, nleBinNameForAsset } from './bin-names.js'
export type { NleBinAssetProbe } from './bin-names.js'

function withExportSummary(input: NleExportInput, pkg: Omit<NleExportPackage, 'exportSummary' | 'exportSummaryText'>): NleExportPackage {
  const exportSummary = buildExportSummary({
    sequence: input.sequence,
    assetPathsById: input.assetPathsById,
    targetNle: pkg.target,
    manifest: pkg.manifest,
    projectTitle: input.projectTitle,
    soundDesign: input.soundDesign,
    generatedAt: pkg.manifest.generatedAt
  })
  return {
    ...pkg,
    exportSummary,
    exportSummaryText: formatExportSummaryText(exportSummary)
  }
}

/** Single entry point: canonical timeline → target-specific package (same JSON in, adapter out). */
export function exportForNle(target: NleTarget, input: NleExportInput): NleExportPackage {
  switch (target) {
    case 'final-cut-pro':
      return withExportSummary(input, exportForFinalCut(input))
    case 'premiere-pro':
      return withExportSummary(input, exportForPremiere(input))
    case 'davinci-resolve':
      return withExportSummary(input, exportForResolve(input))
    case 'otio':
      return withExportSummary(input, exportForOtio(input))
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}
