# Storyteller v1 architecture

## Monorepo layout

- `apps/desktop` — Electron + React (Vite) UI and shell.
- `packages/shared` — Domain types, modes, pacing presets, entity shapes.
- `packages/timeline` — Canonical `TimelineSequence` model and rough-cut builder (single source of truth for preview + exports).
- `packages/media` — FFmpeg/ffprobe and sync analysis hooks (stubs → main process).
- `packages/analysis` — Transcription, silence detection, soundbite ranking, story plans, B-roll prompts (heuristic/LLM-ready).
- `packages/exporters` — MP4 (FFmpeg stub) and XML package (FCPXML scaffold + manifest + README).
- `packages/text-fx` — Text preset packs and render mode metadata (Remotion-ready).
- `supabase/migrations` — Postgres schema + RLS.

## Data flow

1. Ingest assets → `assets` rows + Storage paths.
2. Transcript + silence → `transcript_segments`, `silence_regions`.
3. Rank soundbites + mode-aware story plan → `soundbite_candidates`, `story_plans`, `broll_prompts`.
4. Build **one** `TimelineSequence` → persist in `timelines.timeline_json`.
5. Preview, MP4, and XML package all read the same JSON via `packages/exporters` and `packages/timeline`.

## Desktop state

- **Zustand** — client-only state: auth session, UI state, local asset cache.
- **TanStack Query** — server state management: projects, assets, transcripts, timelines.
  - Located in `apps/desktop/src/renderer/src/hooks/`
  - Query client config: `apps/desktop/src/renderer/src/lib/query-client.ts`
  - Provider: `apps/desktop/src/renderer/src/components/QueryProvider.tsx`
  - Optimistic updates, caching, and background refetching out of the box

## Media ingestion

- **Renderer** — `AssetUploadZone` + `UploadedAssetsPanel`; uploads via Supabase Storage bucket `project-media`; rows in `public.assets` with `storage_path` keys `projects/{projectId}/assets/{assetId}-{filename}`.
- **Main (Electron)** — IPC `media:probe` / `media:readFile` / `media:pick`; ffprobe via `ffprobe-static`, parsing in `@storyteller/media` (`parseFfprobeJson`).
- See `docs/media-ingestion.md` for env vars, bucket setup, and ffprobe notes.

## Transcription & soundbites

- **Main** — IPC `transcription:transcribe`: downloads media via signed URL, calls OpenAI **Whisper** (`verbose_json` segments). Requires **`OPENAI_API_KEY`** in `.env` (loaded by dotenv in main).
- **Renderer** — `runTranscriptionAnalysis` in `lib/transcription-pipeline.ts` writes `transcript_segments`, then ranks and inserts `soundbite_candidates` using `@storyteller/analysis` (`rankSoundbiteCandidates`, mode-aware).
- See `docs/transcription.md`.
