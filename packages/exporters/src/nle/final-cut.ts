import { timelineToFcpxml } from '../xml/fcpxml.js'
import { buildXmlPackageManifest } from './manifest.js'
import { readmeForNleTarget } from './readme.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'

export function exportForFinalCut(input: NleExportInput): NleExportPackage {
  const manifest = buildXmlPackageManifest({
    sequence: input.sequence,
    assets: input.assets,
    textOverlayRefs: input.textOverlayRefs,
    targetNle: 'final-cut-pro'
  })

  const fcpxml = timelineToFcpxml(input.sequence, input.assetPathsById, input.assets)
  const primaryName = 'Storyteller_Sequence.fcpxml'

  return {
    target: 'final-cut-pro',
    bundleName: 'storyteller-export-final-cut-pro',
    primaryTimeline: {
      filename: primaryName,
      content: fcpxml,
      format: 'fcpxml'
    },
    manifest,
    readme: readmeForNleTarget('final-cut-pro', { primaryTimelineFilename: primaryName })
  }
}
