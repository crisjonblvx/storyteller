# Quick Reel audit

Audit date: 2026-06-18. Scope: `QuickReelPage.tsx`, related IPC, comparison to Project Workspace Analyze, pricing alignment, bugs, and recommendations.

## Summary

Quick Reel is a **3-step wizard** (Story → Moments → Reel) for fast vertical/horizontal social cuts. It is **local-first** and mostly **heuristic** — it does **not** run grounded AI review. Upload and record paths **always transcribe** via Whisper (chunked on-device in hosted gateway mode). Paste and type paths are **free** (local text ranker only). MP4 export is **free** (local FFmpeg). There is **no metering integration** today.

**Pricing recommendation:** map **new transcribe** on upload/record to **Clip Batch**; keep assembly, re-pick, re-order, and export **free** once transcript exists. Target persona: **Reel Creator** plan.

---

## UX flow

| Step | User actions | Backend / AI |
|------|--------------|--------------|
| **1 — Story** | Upload video, drag-drop, record voice, paste transcript, type idea | Upload/record → `transcribeMedia` (Whisper). Paste/type → `rankTextAsMoments` (local heuristics, no AI) |
| **2 — Moments** | Pick/reorder moments, set 30/45/60s target | Local `quick-reel-ranker` scores only |
| **3 — Reel** | Orientation, burn captions, export MP4, open in pro workspace | `buildIntroSequence` + `exportMp4` (local). Text-only drafts cannot export video |

Navigation: step pills lock until draft exists. Assistant sidebar gives contextual tips. “Make a Reel in 60 Seconds” CTA jumps to story or reel step.

---

## IPC and preload surface

| Bridge method | IPC channel | Main-process behavior |
|---------------|-------------|------------------------|
| `transcribeMedia` | `transcription:transcribe` | `getStorytellerAiGateway().transcribe()` → chunked FFmpeg + Whisper (local in dev/proxy modes) |
| `writeTempMedia` | `media:writeTempFile` | Saves MediaRecorder blob to OS temp dir |
| `probeMedia` | (optional) | Duration probe before transcribe |
| `exportMp4` | `export:mp4` | Local FFmpeg concat + optional caption burn |
| `saveVideoDialog` | `dialog:saveVideo` | Native save dialog |
| `pickMediaFiles` | file picker | Desktop-only file selection |

Quick Reel does **not** call:

- `analyzeGroundedReview` / grounded review capability
- `generateMedia` / AI video capabilities
- Supabase transcript persistence (unless user later opens pro workspace signed in)

---

## Comparison: Quick Reel vs Project Workspace Analyze

| Dimension | Quick Reel | Project Workspace Analyze |
|-----------|------------|---------------------------|
| Entry | Standalone `/quick-reel` route | In-project **Analyze** on imported assets |
| Transcription | Yes — every upload/record | Yes — per transcribable asset |
| Soundbite extraction | Heuristic segment scoring (`rankSegmentsAsMoments`) | Full pipeline: `extractClipCandidatesPipeline` + `rankSoundbiteCandidates` |
| Grounded AI review | **No** | **Yes** — `analyzeGroundedReview` when prompt pack available |
| Persistence | Ephemeral in-page state; optional local project on export | Supabase or `local-analysis` store |
| Re-cut from transcript | Not exposed (would re-transcribe on new upload) | `refreshSoundbitesFromExistingTranscript` — free re-review |
| Export | MP4 only (intro-style sequence) | NLE, MP4, full timeline |
| `media_hash` | Always `null` on asset insert | Usually `null` (same gap) |

Quick Reel is a **lightweight subset** of Analyze: transcribe + cheap local ranking, no editorial AI layer.

---

## AI costs triggered today

| Input mode | Whisper | Grounded review | AI video | Notes |
|------------|---------|-----------------|----------|-------|
| Upload video | **Yes** (every time) | No | No | Chunked local transcription even when gateway URL set |
| Record voice | **Yes** (via temp file) | No | No | Same path as upload after `writeTempMedia` |
| Paste transcript | No | No | No | Pure local heuristics |
| Type idea | No | No | No | Synthetic timings for preview |
| Export MP4 | No | No | No | Local FFmpeg |
| Re-pick moments | No | No | No | In-memory only |
| Open in pro workspace | No* | No* | No | *Unless user runs Analyze there |

**Cost profile:** one Whisper run per upload/record. No gateway credit reserve is called from Quick Reel. In dev `STORYTELLER_AI_MODE=local`, Whisper uses developer `OPENAI_API_KEY` directly.

---

## Gaps vs pricing model

| Pricing principle | Quick Reel today | Gap |
|-------------------|------------------|-----|
| Charge **Clip Batch** for new short-form analyze | Transcribe runs unmetered | No `estimateAnalyzeCost(..., 'clip_batch')` or allowance check |
| Free assembly from **already-analyzed** content | No concept of cached transcript / fingerprint | Re-upload same file re-transcribes |
| Free re-cuts from existing transcript | Not available in Quick Reel | No “reuse transcript” path |
| Episode Pass for long-form | N/A (Quick Reel targets short clips) | Long uploads (>50 min batch ceiling) should warn or split |
| Free MP4 export | Correct — export is free | None |
| Never re-charge Whisper for unchanged media | `media_hash: null`, no fingerprint | Must add fingerprint + cache (see `source-media-fingerprint.ts`) |

**Clip Batch applicability:** **Yes** — upload/record should consume one Clip Batch (or partial) when metering is wired. Paste/type should remain free. Moment picking and export should remain free.

---

## Bugs and inconsistencies

1. **Project reuse bug** — `ensureProject()` finds the first project whose id starts with `quickreel-` and reuses it. Comment says “create fresh per run” but code reuses. Multiple sessions collide.
2. **No transcript persistence in Quick Reel** — leaving the page loses work unless user exports or opens pro workspace.
3. **Re-transcribe on repeat upload** — no fingerprint or transcript cache; same file uploaded twice pays Whisper twice.
4. **`media_hash` always null** — asset rows never store dedupe fingerprint.
5. **Dead branch in drop handler** — audio vs video both call `handleVideoFromPath` identically (harmless but confusing).
6. **Text path UX** — moments step works for pasted text, but reel step blocks export (by design). Users may not understand until step 3.
7. **No duration guard** — very long uploads run full chunked transcribe with no Clip Batch / Episode Pass messaging.
8. **Grounded review gap** — moment quality is weaker than pro Analyze; no path to upgrade a Quick Reel draft to full review without re-running Analyze in workspace.
9. **Account / metering UI absent** — Quick Reel page does not surface allowances or Clip Batch consumption.

---

## Recommendation: Quick Reel × Clip Batch × Reel Creator

### Product mapping

- **Meter upload/record** as **1 Clip Batch** when duration ≤ 50 min (10 × 5 min) and clip is short-form intent.
- **Overage:** if duration exceeds batch ceiling, prompt for second batch or suggest Project Workspace (Episode Pass).
- **Free forever:** paste/type, moment editing, re-order, target duration changes, MP4 export, open in pro workspace (without re-analyze).
- **Optional upsell:** “Upgrade moments with AI review” → consumes grounded review from an Episode/Clip allowance when wired.

### Persona

**Reel Creator ($59/mo)** — 12 Clip Batches, 20 AI Videos, 4 Episode Passes — matches high-volume short-form creators using Quick Reel weekly. Starter users get 1 Clip Batch to try the flow.

### Engineering next steps (ordered)

1. Fix `ensureProject()` to always create a fresh `quickreel-{uuid}` project per session.
2. On upload/record: probe duration → `estimateAnalyzeCost(duration, 'clip_batch')` → show allowance UI → gateway reserve (when wired).
3. Persist transcript + `SourceMediaFingerprint` on device; skip Whisper when fingerprint matches cached segments.
4. Add “Paste transcript from previous export” / import cached Quick Reel session.
5. Optional: lightweight grounded review toggle (consumes review portion of Clip Batch or separate credit).
6. Surface Reel Creator plan CTA when Clip Batch exhausted.

---

## Files reviewed

- `apps/desktop/src/renderer/src/pages/QuickReelPage.tsx`
- `apps/desktop/src/renderer/src/lib/quick-reel-ranker.ts`
- `apps/desktop/src/preload/index.ts` (transcribe, writeTempMedia, exportMp4)
- `apps/desktop/src/main/ipc.ts` (handlers)
- `apps/desktop/src/main/storyteller-ai-gateway.ts` (transcribe routing)
- `apps/desktop/src/renderer/src/lib/transcription-pipeline.ts` (full Analyze reference)

See [pricing.md](./pricing.md) for the full metering model.
