# Storyteller AI Gateway

Storyteller is **local-first**. The desktop owns projects, media, timelines, exports, and NLE handoff. The **Storyteller AI Gateway** is a hosted service that brokers AI generation (Runway, Higgsfield, OpenAI) so end users never paste provider API keys.

The gateway does **not** store full projects, own the timeline, or become the long-term media library. It returns temporary provider or signed result URLs; the desktop downloads assets into the project folder and `TimelineSequence` references **local paths**.

## Architecture

```text
Storyteller Desktop
  ↓ POST /v1/media/generate  (Supabase JWT)
Storyteller AI Gateway  (apps/ai-gateway)
  ↓ Runway / Higgsfield / OpenAI
Generation completes
  ↓ GET /v1/media/jobs/:jobId
Desktop downloads result → userData/generated-broll/{projectId}/
Desktop creates local Asset + attaches B-roll slot
TimelineSequence → local file path (not cloud URL)
```

## Packages and apps

| Path | Role |
|------|------|
| `packages/ai-gateway` | Shared types, provider router, credit estimates, `StorytellerGatewayClient`, legacy LLM proxy client |
| `apps/ai-gateway` | Hosted Fastify service (media API) |
| `apps/desktop/src/main/gateway-media.ts` | Poll gateway, download locally, build `Asset` |
| `apps/desktop/src/main/storyteller-ai-gateway.ts` | Transcription / prompt LLM routing (local vs proxy) |

## Environment variables

### Gateway service (`apps/ai-gateway/.env`)

```bash
STORYTELLER_GATEWAY_URL=http://localhost:8787
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

RUNWAY_API_KEY=
HIGGSFIELD_API_KEY=
HIGGSFIELD_API_SECRET=
OPENAI_API_KEY=

ENABLE_BYOK=false
ENABLE_KLING=false
NODE_ENV=development
PORT=8787
```

Provider keys live **only** on the gateway host.

### Desktop

```bash
STORYTELLER_GATEWAY_URL=http://localhost:8787
STORYTELLER_AI_MODE=auto           # default; auto-routes review/transcription to gateway when URL is set
STORYTELLER_PROXY_TOKEN=           # optional

ENABLE_BYOK=false                  # internal dev only — Higgsfield keychain UI
ENABLE_KLING=false                 # hides Kling from UI and IPC
```

`STORYTELLER_AI_MODE` resolves as follows:

| Value | Behavior |
|-------|----------|
| `proxy` (explicit) | Always call the hosted gateway. Errors out clearly if `STORYTELLER_GATEWAY_URL` is unset. |
| `local` (explicit) | **Dev-only.** Uses the developer's own `OPENAI_API_KEY` from `.env` for transcription / review / B-roll prompts. Refused in packaged builds — the desktop returns a clean configuration error to the renderer instead. Never silently falls through to provider keys on an end user's machine. |
| `auto` / unset (default) | Picks `proxy` whenever `STORYTELLER_GATEWAY_URL` is set; otherwise reports `unconfigured` and surfaces a clear error in the renderer. There is **no implicit local-provider fallback**. |

The desktop never embeds provider keys in packaged builds. Local mode exists only so internal developers can iterate on prompts without round-tripping through a hosted gateway.

## Capability media API (preferred)

New media-generation call sites should use the capability endpoints. The
desktop describes **what** it wants; the gateway decides **how** (which
provider/model). The capability response never includes the resolved
provider name.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/capabilities/media-generate` | Start a job (`GenerateMediaCapabilityRequest`) |
| `GET` | `/v1/capabilities/media-jobs/:jobId` | Poll `MediaCapabilityJobStatus` (no provider field) |
| `POST` | `/v1/capabilities/media-jobs/:jobId/cancel` | Cancel and refund |

Capabilities:

| `capability` | Intent it maps to |
|--------------|-------------------|
| `video-clip-from-text` | `broll_text_to_video` |
| `video-clip-from-image` | `image_to_video` (requires `referenceImageUrl`) |
| `concept-frame` | `concept_frame` |
| `storyboard-frame` | `storyboard_frame` |
| `motion-graphic` | `motion_graphic` |
| `refine-prompt` | `prompt_refine` |

Example:

```http
POST /v1/capabilities/media-generate
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "projectId": "proj_123",
  "slotId": "broll_2",
  "capability": "video-clip-from-text",
  "creativeMode": "cinematic_documentary",
  "prompt": "A drone sweep over redwood canopy at golden hour."
}
```

```json
{
  "jobId": "...",
  "status": "running",
  "estimatedCredits": 5,
  "message": "Generation started. Poll GET /v1/media/jobs/:jobId for status."
}
```

Note: no `provider` key in the capability response or job status.

### Legacy media API (backwards compatible)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/media/generate` | Provider-aware request (`GenerateMediaRequest`); response includes `provider` |
| `GET` | `/v1/media/jobs/:jobId` | Provider-aware job status |
| `POST` | `/v1/media/jobs/:jobId/cancel` | Cancel and refund reserved credits |
| `POST` | `/v1/media/webhooks/runway` | Runway webhook (optional; polling is authoritative) |
| `POST` | `/v1/media/webhooks/higgsfield` | Higgsfield webhook (optional) |

Auth: `Authorization: Bearer <supabase_access_token>` on all endpoints.

### Provider routing (`selectProvider`, gateway-internal)

| Intent | Default provider |
|--------|------------------|
| `broll_text_to_video` | Runway |
| `image_to_video` | Higgsfield |
| `concept_frame` | OpenAI |
| `storyboard_frame` | OpenAI |
| `prompt_refine` | OpenAI |
| `motion_graphic` | Runway (OpenAI if `quality: draft`) |

The capability endpoint does **not** accept `providerPreference`. The legacy
endpoint still honors it (only when the provider supports the intent), but
the desktop should not set it for new code.

### Credits (first pass)

`credits.reserve` → submit job → `credits.commit` on success / `credits.refund` on failure or cancel. Default implementation is in-memory (`InMemoryCreditsService`); swap for Supabase-backed balances in production.

User-facing **Episode Pass**, **Clip Batch**, and **AI Video** allowances are defined in `packages/ai-gateway/src/plans.ts`. See [pricing.md](./pricing.md) for the full model. Analyze metering (`estimateAnalyzeCost`) is stubbed; gateway reserve for transcribe/review is not wired yet.

## Desktop client

```ts
import { StorytellerGatewayClient } from '@storyteller/ai-gateway'

const client = new StorytellerGatewayClient({
  baseUrl: process.env.STORYTELLER_GATEWAY_URL!,
  accessToken: session.access_token
})

// Capability-first (preferred):
await client.generateMediaCapability({
  projectId: 'proj_123',
  slotId: 'broll_2',
  capability: 'video-clip-from-text',
  creativeMode: 'cinematic_documentary',
  prompt: 'Aerial view of a coral reef.'
})
```

The Electron main process exposes a matching `window.storyteller.generateMedia` bridge:

```ts
const result = await window.storyteller.generateMedia({
  projectId,
  slotId,
  capability: 'video-clip-from-text',
  prompt: 'A wide angle of a desert sunset.',
  accessToken: session.access_token
})
```

Progress streams on `window.storyteller.onMediaProgress(handler)`.

IPC handlers in `gateway-media.ts` wrap the HTTP client: capability call → poll
`/v1/capabilities/media-jobs/:jobId` → download → local `Asset` with `local_path`.

The renderer routes all B-roll and motion-overlay generation through
`generateVideoClip()` in `apps/desktop/src/renderer/src/lib/media-generation.ts`.
When `STORYTELLER_GATEWAY_URL` is set, that helper calls `generateMedia` (capability
API). Otherwise it falls back to legacy per-provider IPCs for local dev / BYOK.

Legacy IPC handlers (`broll:runwayGenerate`, etc.) remain for direct main-process
callers but are no longer used from the project workspace UI when the hosted gateway
is enabled.

## Running locally

**Default (integrated):** starting Storyteller also starts the gateway.

```bash
cp apps/ai-gateway/.env.example apps/ai-gateway/.env
# Fill RUNWAY_API_KEY, SUPABASE_JWT_SECRET, etc. (repo root .env is also loaded)
npm run dev
```

The Electron main process spawns `apps/ai-gateway` on `http://127.0.0.1:8787` when:

- the build is **not** packaged (dev),
- `STORYTELLER_GATEWAY_URL` is unset or points at localhost, and
- `STORYTELLER_EMBED_GATEWAY` is not `false`.

If a gateway is already listening on that port, Storyteller reuses it instead of
starting a second process. On quit, Storyteller stops only the child it started.

**Manual gateway (optional):**

```bash
# Terminal 1
npm run gateway:dev

# Terminal 2 — disable auto-embed if you prefer a separate terminal
STORYTELLER_EMBED_GATEWAY=false npm run dev
```

## Tests

The gateway has integration tests around capability endpoints and config
resolution. They use `node --test` with the `tsx` loader (no extra test
framework dependencies) and Fastify's in-process `app.inject()` helper.

```bash
# Capability endpoints + legacy alias compat + auth/validation
npm run gateway:test

# Shared config resolution (auto / proxy / local / unconfigured)
npm run ai-gateway:test

# Both
npm run test:gateway
```

The integration suite asserts that:

- `/v1/capabilities/grounded-review` and the legacy `/v1/review/grounded` alias
  reach the same handler.
- `/v1/capabilities/media-generate` validates required fields, requires auth,
  and never includes the resolved provider name in its response.
- `/v1/capabilities/media-jobs/:jobId` returns a sanitized status payload
  (no `provider` field) for jobs created via the capability endpoint.
- `resolveAiGatewayConfig` never auto-falls-back to local mode when no
  gateway URL is configured.

## Capability LLM API

Desktop AI flows should call stable capabilities. Provider/model selection stays server-side in gateway env/config.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/capabilities/transcribe` | Multipart audio or `signedUrl` → transcription (single-shot, ~24MB cap) |
| `POST` | `/v1/capabilities/broll-prompts` | Director package + flattened B-roll prompt rows |
| `POST` | `/v1/capabilities/broll-prompts-from-beats` | Beat-anchored prompt writer |
| `POST` | `/v1/capabilities/grounded-review` | Grounded clip review ranking |

Legacy aliases are still supported for backwards compatibility:

- `/v1/transcribe`
- `/v1/broll/prompts`
- `/v1/broll/prompts-from-beats`
- `/v1/review/grounded`

All require `Authorization: Bearer <supabase_access_token>`. Provider/model choice and fallback strategy are gateway-owned implementation details. The renderer is shown a sanitized fallback message — never the underlying provider error text.

## Supabase persistence

When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set on the gateway, jobs and credits persist to Postgres:

- `generation_jobs` — job status, provider ids, result/error JSON
- `gateway_user_credits` — per-user balance (default 1000 on first use)
- `gateway_credit_reservations` — hold credits until commit/refund

Apply migration: `supabase/migrations/20250530130000_gateway_credits_jobs.sql`

Without Supabase env vars, the gateway falls back to in-memory stores (dev only).

`GET /health` reports `persistence: "supabase" | "memory"`.

## Admin observability

Password-protected operator dashboard (UI at `contentcreators.life/storyteller/admin`) backed by admin API routes on the gateway. Admin auth uses a **separate** short-lived JWT signed with `STORYTELLER_ADMIN_PASSWORD` — not Supabase user sessions.

### Gateway env (server-only)

```bash
STORYTELLER_ADMIN_PASSWORD=   # or STORYTELLER_ADMIN_SECRET — never expose via VITE_*
```

### Admin routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/admin/login` | `{ password }` body | Returns `{ token, expiresIn }` (12h JWT) |
| `GET` | `/v1/admin/overview` | Admin bearer | MTD users, jobs, credits, estimated USD, breakdowns |
| `GET` | `/v1/admin/users` | Admin bearer | User table with plan, balance, allowances, MTD spend |
| `GET` | `/v1/admin/activity` | Admin bearer | Paginated cross-user job feed (`?limit=&offset=`) |
| `GET` | `/v1/admin/users/:userId` | Admin bearer | User drill-down + recent jobs |

USD estimates use rough COGS from [pricing.md](./pricing.md) — observability only, not billing.

Beta user setup: see [admin-beta-setup.sql](./admin-beta-setup.sql).

## Policies

- **No BYOK** for normal users (`ENABLE_BYOK=false`). Higgsfield key UI is hidden when the hosted gateway is enabled.
- **No Kling** in production (`ENABLE_KLING=false`). Kling IPC returns an error unless explicitly enabled for dev.
- **No provider keys** in renderer or packaged client code.

## Why local-first?

- Users keep editorial control and offline project folders.
- Cloud only brokers generation and metering.
- Exports and NLE handoff stay on the desktop.
