# Local chunked transcription pipeline

Storyteller v1 transcribes **long local media** without uploading source files to the cloud. The Electron **main** process:

1. Runs **ffprobe** (already used at import) to read duration.
2. Chooses **single-shot** Whisper only when the file is small enough and short enough (≤ ~24MB and ≤ 10 minutes) to stay under the OpenAI **25MB** request limit.
3. Otherwise uses **FFmpeg** (`ffmpeg-static`, unpacked from `asar`) to extract **mono 16kHz MP3** slices (~64kbps) per time window.
4. **Chunks** default to **600 seconds (10 minutes)** with **no overlap** (simple, deterministic merge).
5. Sends each chunk to **`/v1/audio/transcriptions`** with `whisper-1` and `verbose_json`.
6. **Merges** segment timestamps by adding each chunk’s start offset in the source timeline (`@storyteller/transcription` `mergeChunkTranscripts`).
7. Deletes working files under **`{userData}/transcription-work/{uuid}/`** after the IPC handler finishes (successful or not). Failed runs may leave partial files until the next successful cleanup if removal throws — see cleanup policy below.

## Provider abstraction

- **Interface:** `packages/transcription/src/provider-types.ts` — `TranscriptionProvider` with `transcribeAudioChunk`.
- **Current implementation:** `apps/desktop/src/main/openai-whisper.ts` — `whisperFromBytes` (OpenAI REST). Swap-in points: replace or branch inside the main-process pipeline to call local Whisper, Deepgram, etc.

## Progress events (UI)

Main sends `transcription:progress` with phases: `preparing` → `chunking` → `transcribing_chunk` (with `chunkIndex` / `chunkTotal`) → `merging` → `done`. The renderer maps these to the Analyze status line.

## Temp files & cleanup

| Location | Contents |
|----------|----------|
| `{userData}/transcription-work/{uuid}/` | Downloaded cloud copy (if using signed URL), per-chunk `chunk-0000.mp3`, etc. |

**Policy:** Remove the whole job directory in a `finally` block after transcription completes. Do not delete the user’s **source** file (`local_path`); only files under `transcription-work` are removed.

## Chunk sizing

Default **600s** chunks at **64kbps** mono MP3 yield ~2.9MB per chunk — well under 25MB. To tune, change `DEFAULT_CHUNK_DURATION_SEC` in `apps/desktop/src/main/chunked-transcription.ts` and optionally add overlap in `planAudioChunks` + `mergeChunkTranscripts` (`overlapSec`).

## Error handling

If **one chunk** fails, the pipeline returns an error that includes **part index / total**; earlier chunks are not persisted (transcript rows are cleared at the start of Analyze). Retrying Analyze re-runs the full pipeline. Partial persistence could be added later.

## Known limitations

- **Diarization** is not implemented; speaker labels stay `null`.
- **OpenAI** limits and pricing apply per chunk.
- **Very long jobs** may take a long time and many API calls; monitor costs.

## Related docs

- `docs/transcription.md` — env vars and overview.
- `docs/local-first-architecture.md` — why local-first storage matters.
