# Local-first / hybrid media architecture

Storyteller targets **professional desktop** workflows: long interviews, podcasts, and multi-camera footage can be **many gigabytes**. The app must not require uploading source media to Supabase Storage before you can register a project, probe metadata, or drive the UI.

## Principles

1. **Local source files are first-class.** On import (Electron file picker or drag-drop), we create an `assets` row with `storage_mode: 'local'`, `local_path` set to an absolute path, and `storage_path` left null until an explicit cloud sync exists.
2. **ffprobe runs on disk** in the main process (`media:probe`) so duration, resolution, and frame rate are available without reading the whole file into memory or uploading it.
3. **Supabase** holds project intelligence: projects, assets metadata, transcripts, soundbites, timelines, export metadata. **Heavy media bytes** stay local by default.
4. **Optional cloud upload** remains possible (student or lightweight projects): `storage_mode` / `is_uploaded` / `upload_status` describe sync state; upload is never implicit on import.
5. **Proxies** (`proxy_path`) are reserved for future preview or chunked pipelines; see `packages/media/src/proxy.ts`.

## Transcription and large files

Transcription uses the OpenAI Whisper API from the **Electron main** process with **FFmpeg-based chunking** so each request stays under the **~25MB** limit. Long-form local video/audio is **sliced to mono MP3 segments** (~10 minutes by default), transcribed, and merged. See **`docs/local-chunked-transcription.md`** for chunk sizing, temp file layout, and provider hooks.

## XML / Resolve export

`buildXmlPackage` + `timelinePathsFromAssets` emit FCPXML-style paths:

- **Local assets:** real `file:` URIs from `local_path` (macOS, Windows-safe).
- **Cloud-only assets:** placeholder `file:///StorytellerRelink/...` URIs in XML; **`asset-manifest.json`** lists `storagePath` and `localPath` for relinking or downloading from Supabase.

The package README explains relinking in DaVinci Resolve.

## Related code

- Migration: `supabase/migrations/20250323120000_assets_hybrid_local_first.sql`
- Shared types: `packages/shared/src/entities.ts`, `asset-helpers.ts`
- Import: `apps/desktop/src/renderer/src/lib/asset-upload.ts`
- Probing: `apps/desktop/src/main/` (IPC `media:probe`)
- Export: `packages/exporters/src/xml/package.ts`
