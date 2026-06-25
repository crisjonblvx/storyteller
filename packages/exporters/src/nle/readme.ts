import type { NleTarget } from '../xml/types.js'

export function readmeForNleTarget(
  target: NleTarget,
  params: {
    primaryTimelineFilename: string
    manifestFilename?: string
    additionalFilenames?: string[]
  }
): string {
  const { primaryTimelineFilename, manifestFilename = 'manifest.json', additionalFilenames = [] } = params
  const extra = additionalFilenames.length ? `\n- **Additional:** ${additionalFilenames.map((f) => `\`${f}\``).join(', ')}` : ''

  const relink = `
## Media relink

Use \`${manifestFilename}\` to see **local paths** and **cloud storage keys**. Offline placeholders in XML use \`file:///StorytellerRelink/...\` for cloud-only media — relink in your NLE to the real files.
`

  if (target === 'final-cut-pro') {
    return `# Storyteller → Final Cut Pro (Rough Cut Export — Beta)

This package was generated for **Apple Final Cut Pro** from Storyteller's **canonical timeline JSON** (single source of truth).

**Storyteller edits. Final Cut finishes.** This export preserves editorial decisions, timing, source media, and markers — not layered composites.

## Contents

- **\`${primaryTimelineFilename}\`** — FCPXML 1.9 interchange (import as a Library event or project).
- **\`export-summary.txt\`** — What was exported vs provided in the manifest only (read this first).
- **\`${manifestFilename}\`** — Canonical asset manifest (paths, roles, markers, text overlay refs).${extra}

${relink}

## Import (Final Cut Pro)

1. Read **\`export-summary.txt\`** so you know what's in the interchange vs manifest-only.
2. **File → Import → XML…** and choose \`${primaryTimelineFilename}\`.
3. If clips are offline, **Relink Files** using paths from the manifest (local machine) or the \`media/\` folder in this package.
4. **Markers** and **text overlay timing** are listed in \`${manifestFilename}\` — recreate titles in FCP using Storyteller's \`textOverlayRefs\` if needed.

## What's included (beta)

- Primary A-roll rough cut (spine)
- Source media (when available locally)
- Timeline metadata in \`${manifestFilename}\`

## Not included in FCPXML (by design)

- B-roll overlay tracks
- Title / graphics overlays
- Sound-design lane placements

These remain in \`${manifestFilename}\` for manual finishing while Final Cut XML compatibility continues to improve.

---
Generated for **Final Cut Pro** · Storyteller canonical timeline export
`
  }

  if (target === 'premiere-pro') {
    return `# Storyteller → Adobe Premiere Pro

This package targets **Adobe Premiere Pro** using **FCP 7 XMEML** (\`.xml\`) from Storyteller's **canonical timeline JSON**.

Premiere imports **XMEML** (\`timeline.xml\`) — **not** FCPXML (\`.fcpxml\`). The greyed-out \`.fcpxml\` in Finder is expected; use \`timeline.xml\`.

## Contents

- **\`${primaryTimelineFilename}\`** — XMEML sequence (recommended: **File → Import** in Premiere).
- **\`${manifestFilename}\`** — Asset manifest.${extra}

${relink}

## Import (Premiere Pro)

1. **File → Import…** and select \`${primaryTimelineFilename}\` (Final Cut Pro XML / XMEML).
2. If prompted, map or relink media using paths from \`${manifestFilename}\` or the \`media/\` folder in this package.
3. Rebuild **graphics** from \`textOverlayRefs\` in the manifest if titles do not translate automatically.

---
Generated for **Adobe Premiere Pro** · Storyteller canonical timeline export
`
  }

  if (target === 'davinci-resolve') {
    return `# Storyteller → DaVinci Resolve

This package targets **Blackmagic DaVinci Resolve** (Free or Studio) from Storyteller's **canonical timeline JSON**.

Resolve imports **FCPXML** reliably for rough cuts and relink workflows.

## Contents

- **\`${primaryTimelineFilename}\`** — FCPXML interchange.
- **\`${manifestFilename}\`** — Asset manifest.${extra}

${relink}

## Import (DaVinci Resolve)

1. **File → Import → Timeline** (or **Import AAF/XML/…**) and choose \`${primaryTimelineFilename}\`.
2. **Relink** offline clips using **localPath** or downloaded cloud media from the manifest.
3. **Markers** and **text overlay** hints are in \`${manifestFilename}\`.

---
Generated for **DaVinci Resolve** · Storyteller canonical timeline export
`
  }

  // OTIO target
  return `# Storyteller → OpenTimelineIO (OTIO)

This package exports **OpenTimelineIO** format from Storyteller's **canonical timeline JSON**.

**OpenTimelineIO** is Pixar's open format for editorial timeline interchange, supported by:
- **DaVinci Resolve Studio** (native OTIO import)
- **Adobe Premiere Pro** (via otio-xmeml adapter)
- **Apple Final Cut Pro** (via otio-fcpxml adapter)
- **Nuke, Blender, Maya** (native OTIO support)
- **Custom pipelines** (OTIO Python API)

## Contents

- **\`${primaryTimelineFilename}\`** — OTIO JSON timeline (open interchange format).
- **\`${manifestFilename}\`** — Asset manifest with Storyteller metadata.${extra}

${relink}

## Import via OTIO

### DaVinci Resolve Studio
1. **File → Import → Timeline**
2. Select \`${primaryTimelineFilename}\`
3. Resolve imports all tracks, clips, and markers natively

### Other NLEs (via OTIO adapters)
\`\`\`bash
# Convert to FCPXML for Final Cut Pro
otiocat -a fcpxml -o timeline.fcpxml ${primaryTimelineFilename}

# Convert to XMEML for Premiere
otiocat -a xmeml -o timeline.xml ${primaryTimelineFilename}
\`\`\`

### Storyteller Metadata
The OTIO file includes Storyteller-specific metadata on each clip:
- **role**: a-roll, b-roll, nat-audio, etc.
- **soundbiteId**: Linked soundbite candidate
- **transcriptSegmentIds**: Linked transcript segments
- **brollSlotId**: B-roll generation slot reference

This metadata is preserved through OTIO interchange and available in the manifest.

## OTIO Resources
- **Documentation**: https://opentimelineio.readthedocs.io/
- **Adapters**: https://github.com/AcademySoftwareFoundation/OpenTimelineIO/tree/main/src/py/opentimelineio/adapters
- **Schema Reference**: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-file-format-specification.html

---
Generated for **OpenTimelineIO** · Storyteller canonical timeline export
`
}
