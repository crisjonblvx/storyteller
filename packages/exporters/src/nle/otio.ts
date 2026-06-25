import { timelineToOtio, serializeOtio } from '../otio/converter.js'
import { buildXmlPackageManifest } from './manifest.js'
import { readmeForNleTarget } from './readme.js'
import type { NleExportPackage } from './types.js'
import type { NleExportInput } from './shared-input.js'

/**
 * Export timeline to OpenTimelineIO (OTIO) format.
 *
 * OTIO is Pixar's open interchange format that works with:
 * - Final Cut Pro (via otio-fcpxml adapter)
 * - Adobe Premiere Pro (via otio-xmeml adapter)
 * - DaVinci Resolve (native OTIO import in Studio version)
 * - Nuke, Blender, and many other tools
 *
 * This export includes:
 * - `.otio` file (JSON format)
 * - `manifest.json` (Storyteller asset manifest)
 * - `README.txt` (import instructions)
 */
export function exportForOtio(input: NleExportInput): NleExportPackage {
  const manifest = buildXmlPackageManifest({
    sequence: input.sequence,
    assets: input.assets,
    textOverlayRefs: input.textOverlayRefs,
    targetNle: 'otio',
    soundDesign: input.soundDesign,
  })

  // Convert to OTIO format
  const otioDocument = timelineToOtio(input.sequence, input.assetPathsById, {
    includeTranscriptMetadata: true,
    includeSoundbiteMetadata: true,
    includeBrollMetadata: true
  })

  const otioJson = serializeOtio(otioDocument)
  const primaryName = 'Storyteller_Sequence.otio'

  return {
    target: 'otio',
    bundleName: 'storyteller-export-otio',
    primaryTimeline: {
      filename: primaryName,
      content: otioJson,
      format: 'otio'
    },
    manifest,
    readme: readmeForNleTarget('otio', { primaryTimelineFilename: primaryName })
  }
}
