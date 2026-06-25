import { timelineToFcpxml } from '../xml/fcpxml.js'
import { buildXmlPackageManifest } from './manifest.js'
import { buildSfxNleTracks } from './audio-director-nle.js'
import { readmeForNleTarget } from './readme.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'

export function exportForResolve(input: NleExportInput): NleExportPackage {
  const sfxGroups = input.soundDesign ? buildSfxNleTracks(input.soundDesign) : undefined

  const manifest = buildXmlPackageManifest({
    sequence: input.sequence,
    assets: input.assets,
    textOverlayRefs: input.textOverlayRefs,
    targetNle: 'davinci-resolve',
    soundDesign: input.soundDesign,
  })

  const fcpxml = timelineToFcpxml(input.sequence, input.assetPathsById, input.assets, sfxGroups)
  const primaryName = 'Storyteller_Sequence.fcpxml'

  return {
    target: 'davinci-resolve',
    bundleName: 'storyteller-export-davinci-resolve',
    primaryTimeline: {
      filename: primaryName,
      content: fcpxml,
      format: 'fcpxml'
    },
    manifest,
    readme: readmeForNleTarget('davinci-resolve', { primaryTimelineFilename: primaryName })
  }
}
