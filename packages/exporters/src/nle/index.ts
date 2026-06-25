import type { NleTarget } from '../xml/types.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'
import { exportForFinalCut } from './final-cut.js'
import { exportForPremiere } from './premiere.js'
import { exportForResolve } from './resolve.js'
import { exportForOtio } from './otio.js'

export type { NleExportPackage } from './types.js'
export type { NleExportInput } from './shared-input.js'
export type { NleTarget } from '../xml/types.js'
export { exportForFinalCut } from './final-cut.js'
export { exportForPremiere } from './premiere.js'
export { exportForResolve } from './resolve.js'
export { exportForOtio } from './otio.js'
export { buildXmlPackageManifest } from './manifest.js'
export { groupAssetsByNleBin, nleBinNameForAsset } from './bin-names.js'
export type { NleBinAssetProbe } from './bin-names.js'

/** Single entry point: canonical timeline → target-specific package (same JSON in, adapter out). */
export function exportForNle(target: NleTarget, input: NleExportInput): NleExportPackage {
  switch (target) {
    case 'final-cut-pro':
      return exportForFinalCut(input)
    case 'premiere-pro':
      return exportForPremiere(input)
    case 'davinci-resolve':
      return exportForResolve(input)
    case 'otio':
      return exportForOtio(input)
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}
