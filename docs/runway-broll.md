# Runway B-roll — slots and generation

## Overview

Storyteller maps **B-roll prompt cards** to **timeline slots** on the canonical `TimelineSequence`, then lets you call **Runway** text-to-video **per slot** (no automatic batch generation).

## Flow

1. Build an **intro** or rough cut so source time ranges can map to **timeline seconds**.
2. On **B-roll Prompts**, click **Map prompts to timeline slots** — creates `brollSlots[]` and a `v-broll` video track.
3. For each card, click **Generate with Runway** — one API job at a time.
4. The clip is saved under the app user data folder (`generated-broll/{projectId}/`), registered as a **local `Asset`**, and the slot moves to **ready** with a **b-roll** clip on `v-broll`.
5. **MP4 export** composites those overlays on top of the A-roll (primary audio stays from the interview track). **NLE manifest** lists all video clips including B-roll.

## Configuration

- **API key:** set `RUNWAY_API_KEY` or `RUNWAYML_API_SECRET` in `.env` (local dev). The Runway SDK uses model **`gen4.5`** with ratio **1280×720** (horizontal) or **720×1280** (vertical) from the project working format.
- **Audit metadata** on each generated asset: `metadata_json` includes `runwayTaskId`, `promptUsed`, `slotId`, `createdAt`, `model`, and `durationRequested`.

## Kling

Kling is **not** wired yet; the UI shows “Kling (soon)”. The abstraction is **slot + provider** on the timeline JSON so a second provider can reuse the same slots.

## Limitations (v1)

- **FCPXML spine** still reflects **primary video** only; full multi-track FCPXML is a follow-up. The **manifest** (`manifest.json`) includes **all** clips and tracks for relinking in Resolve / Premiere / FCP.
- Runway output URLs expire (24–48h); Storyteller **downloads immediately** to local disk.

See also: `docs/desktop-export.md`, `docs/export-architecture.md`.
