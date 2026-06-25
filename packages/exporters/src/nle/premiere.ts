import { timelineToFcpxml } from '../xml/fcpxml.js'
import { timelineToXmeml } from '../xml/xmeml.js'
import { buildXmlPackageManifest } from './manifest.js'
import { buildSfxNleTracks } from './audio-director-nle.js'
import { readmeForNleTarget } from './readme.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'

export function exportForPremiere(input: NleExportInput): NleExportPackage {
  const sfxGroups = input.soundDesign ? buildSfxNleTracks(input.soundDesign) : undefined

  const manifest = buildXmlPackageManifest({
    sequence: input.sequence,
    assets: input.assets,
    textOverlayRefs: input.textOverlayRefs,
    targetNle: 'premiere-pro',
    soundDesign: input.soundDesign,
  })

  const xmeml = timelineToXmeml(input.sequence, input.assetPathsById, input.assets, sfxGroups)
  const fcpxml = timelineToFcpxml(input.sequence, input.assetPathsById, input.assets, sfxGroups)
  const xmemlName = 'timeline.xml'
  const fcpxmlName = 'Storyteller_Sequence.fcpxml'

  return {
    target: 'premiere-pro',
    bundleName: 'storyteller-export-premiere-pro',
    primaryTimeline: {
      filename: xmemlName,
      content: xmeml,
      format: 'xmeml'
    },
    additionalFiles: [{ filename: fcpxmlName, content: fcpxml, format: 'fcpxml' }],
    manifest,
    readme: readmeForNleTarget('premiere-pro', {
      primaryTimelineFilename: xmemlName,
      additionalFilenames: [fcpxmlName]
    })
  }
}
