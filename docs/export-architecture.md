# Export architecture — canonical timeline → NLE adapters

Storyteller uses **one canonical timeline JSON** (`TimelineSequence` in `@storyteller/timeline`) as the single source of truth for:

- Source media references (`assetId`, source in/out, timeline in/out)
- Track ordering (video, audio, text)
- Markers, roles, optional transcript/soundbite linkage via clip metadata
- Text overlay references (sidecar manifest)

**No separate timeline logic per editor.** Instead, `@storyteller/exporters` builds a **canonical manifest** first, then **translators** turn the same sequence + manifest into target-specific interchange files:

| Target | API | Logical filenames (exporter) | On disk (desktop handoff) |
|--------|-----|------------------------------|---------------------------|
| **Final Cut Pro** | `exportForFinalCut` | `Storyteller_Sequence.fcpxml` | `timeline.fcpxml` |
| **Adobe Premiere Pro** | `exportForPremiere` | FCPXML + XMEML | `timeline.fcpxml` + `timeline.xml` (XMEML) |
| **DaVinci Resolve** | `exportForResolve` | `Storyteller_Sequence.fcpxml` | `timeline.fcpxml` |

The desktop app also writes **`export-summary.txt`**, **`manifest.json`**, and **`README.txt`** next to the timeline files. See `docs/desktop-export.md`.

**Final Cut Pro:** FCPXML uses Apple-style **resource ids** (`r1` = format, `r2`… = assets); Storyteller asset UUIDs are stored on `asset/@uid`. `sequence/@format` and `asset/@format` reference `r1`. `asset-clip/@ref` references `r2`… (not UUIDs). Media duration includes a **one-frame** pad past max source-out so the last edit is valid. Paths use percent-encoded `file:` URIs.

Unified entry: **`exportForNle(target, input)`** with `NleTarget = 'final-cut-pro' | 'premiere-pro' | 'davinci-resolve'`.

Each package includes:

- **Timeline** in the appropriate format(s)
- **`XmlPackageManifest`** (`buildXmlPackageManifest`) — assets (local + cloud keys), **tracks**, **clips** (roles, transcript/soundbite ids when present), **markers**, **textOverlayRefs**
- **README** (`readmeForNleTarget`) — import and relink steps per NLE

Interchange formats:

- **FCPXML** — shared translator `timelineToFcpxml` (markers + clip `role` attributes)
- **XMEML** — `timelineToXmeml` (primary video track; Premiere-oriented)

Legacy helper **`buildXmlPackage`** delegates to **`exportForResolve`** (same files as Resolve export).

See also: `docs/local-first-architecture.md` for local path vs cloud keys in manifests.

See also: **`docs/desktop-export.md`** for MP4 + NLE disk export, 4K presets, and limitations.

See also: **`docs/runway-broll.md`** for AI B-roll slots and Runway clip handoff.
