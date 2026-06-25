# Transcription (OpenAI Whisper + local FFmpeg)

All transcription requests go through the **Storyteller AI gateway** in the main process (`local` = direct Whisper with dev keys, `proxy` = hosted API). See **`docs/ai-gateway.md`**.

## Requirements

1. **OpenAI API key (local / dev only)** — set **`OPENAI_API_KEY`** in a `.env` file that the Electron **main** process loads when using **`STORYTELLER_AI_MODE=local`** (default). Production builds should use **`STORYTELLER_AI_MODE=proxy`** so users do not supply keys.
2. **Supabase** — needed for **project rows**, `transcript_segments`, and `soundbite_candidates`. **Source media does not need to be in Storage** for local imports; signed URLs are only used when the asset is cloud-backed.

The desktop app loads env from (first match wins):

- `apps/desktop/.env`
- Repository root `.env`
- Paths relative to the built `out/main` folder (see `apps/desktop/src/main/index.ts`)

Example:

```bash
# apps/desktop/.env or Storyteller/.env
OPENAI_API_KEY=sk-...
```

Restart the dev app after changing env vars.

## Flow

1. User imports media **locally** (or uses an uploaded asset with a signed URL).
2. User clicks **Analyze** in the project workspace.
3. **Main process** (`chunked-transcription.ts`):
   - **ffprobe** duration; if the file is small and ≤ ~10 minutes, sends the whole file to Whisper in one request.
   - Otherwise **FFmpeg** extracts **mono 16kHz MP3** segments (~10 minutes each), sends each to Whisper, then **merges** segments with correct timeline offsets.
4. Segments are written to **`transcript_segments`**; **`soundbite_candidates`** are rebuilt from ranked heuristics (mode-aware).

See **`docs/local-chunked-transcription.md`** for chunk defaults, temp directories, and provider abstraction.

## Limits

- Each **HTTP request** to Whisper must stay under **25MB**. Chunked extraction keeps each part under that cap.
- **Total** runtime and cost scale with **duration ÷ chunk length** (default 600s chunks).
- Long chunks can take several minutes per Whisper request. The desktop extends HTTP timeouts (default **15 min** per part) and retries transient network failures automatically. Override with `STORYTELLER_WHISPER_REQUEST_TIMEOUT_MS` and `STORYTELLER_WHISPER_MAX_RETRIES` if needed.

## Troubleshooting

- **`OPENAI_API_KEY is not set`** — add the key to `.env` and restart.
- **403 / 401 from OpenAI** — verify key, billing, and model access.
- **Download failed** (cloud asset) — signed URL expired or Storage policy blocked; re-open the project and retry.
- **`fetch failed` during transcription** — usually a dropped connection or Node's default ~5 minute HTTP timeout on a long Whisper part. Restart the app to pick up timeout/retry fixes, then click **Retry** (completed parts are re-run; no partial resume yet).
- **ffprobe / ffmpeg errors** — ensure `ffprobe-static` / `ffmpeg-static` binaries unpacked (see `electron-builder` `asarUnpack` in `apps/desktop/package.json`).
