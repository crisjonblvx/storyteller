# Media ingestion (Storage + ffprobe)

For the **local-first / hybrid** model (default on desktop), see [local-first-architecture.md](./local-first-architecture.md). Source files are usually **not** uploaded on import; Storage remains optional for backup or small projects.

## Environment

In `apps/desktop/.env` (copy from `apps/desktop/.env.example`):

- `VITE_SUPABASE_URL` — Project URL from the Supabase dashboard.
- `VITE_SUPABASE_ANON_KEY` — Project **anon** key (public). The desktop app uses it in the renderer with the user’s session for RLS-safe inserts and Storage uploads.

## Database

Apply migrations (includes `assets` columns and the `project-media` storage bucket + policies):

```bash
supabase db push
```

Or run SQL from `supabase/migrations` in the Supabase SQL editor.

## Storage bucket

Migration `20250322100000_assets_upload_and_storage.sql` creates a **private** bucket:

- **Bucket id / name:** `project-media`

Object keys follow:

`projects/{projectId}/assets/{assetId}-{sanitizedFilename}`

Policies allow authenticated users to read/write/delete only when they own the `projects` row referenced in the path (`split_part(name, '/', 2)`).

## ffprobe binary

The Electron **main** process runs **`ffprobe-static`** (bundled dependency). Production builds **unpack** it via `asarUnpack` in `apps/desktop/package.json` so the binary is executable outside `app.asar`.

If probing fails (missing binary, corrupt file, unsupported container), the asset row is still saved when possible; the UI shows **probe** status as `error` or `skipped` instead of crashing.

## Flow summary (desktop, default)

1. User picks files via Electron (`media:pick`) or drag-drop; each file must expose an absolute `path` (no full-file read for import).
2. Renderer inserts an `assets` row with `storage_mode: 'local'`, `local_path`, `storage_path` null, `upload_status: 'not_uploaded'`.
3. Main process runs ffprobe on `local_path` (`media:probe` IPC).
4. Optional cloud sync (future / explicit action) uploads bytes to `project-media` and updates `storage_path`, `is_uploaded`, and `upload_status`.

Thumbnails: cloud images use signed URLs; local images may use `file:` URLs where the renderer allows it.
