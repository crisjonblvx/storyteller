# Desktop export — MP4 and NLE handoff packages

The Storyteller **desktop app** writes real files to disk. The web UI alone cannot save packages; use **Electron** for production export.

## Canonical source

All exports use the same **canonical timeline JSON** (`TimelineSequence`). Resolution presets (1080p / 4K) adjust **output width and height** via `sequenceForExportDimensions` — one edit, multiple delivery sizes.

## MP4 (FFmpeg)

1. Choose **1080p** or **4K** and confirm the deliverable size line (horizontal vs vertical follows the project working format).
2. Click **Export MP4** and pick a save path (native save dialog).
3. Progress: preparing → rendering per clip → finalizing → complete.

FFmpeg scales and pads to the sequence dimensions; order and trims follow the timeline.

**Limitations:** Requires **local file paths** for source media. Cloud-only assets without a resolvable local path fail with a clear error.

## NLE handoff folder

1. Choose the editor target (**Final Cut Pro**, **Premiere Pro**, or **DaVinci Resolve**).
2. Click **Export for …** and choose a **parent folder** (native folder picker).
3. Storyteller creates a subfolder named like `{slug}-{nle}-{timestamp}` and writes:

| File | Purpose |
|------|---------|
| `timeline.fcpxml` | Main FCPXML sequence (FCP, Resolve import; Premiere can import FCPXML too). |
| `timeline.xml` | Premiere XMEML (only when exporting for Premiere). |
| `manifest.json` | Asset manifest: local paths, clips, markers, text overlay refs. |
| `README.txt` | Import steps, relink notes, and what each file is for. |

Optional **Preview** buttons in the Exports tab still show excerpts; they are secondary to the on-disk package.

## 4K presets

Horizontal and vertical presets map to standard sizes, for example:

- 1080p horizontal: 1920×1080  
- 4K horizontal: 3840×2160  
- 1080p vertical: 1080×1920  
- 4K vertical: 2160×3840  

See `packages/exporters/src/export-presets.ts` for the exact matrix.

## Related

- `docs/export-architecture.md` — adapter model (FCPXML, XMEML, manifest).
- `docs/local-first-architecture.md` — local vs cloud paths in manifests.
