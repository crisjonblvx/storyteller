# Storyteller pricing model

Storyteller is **local-first**. Editing, NLE export, intro builder, MP4 export, Quick Reel assembly from **already-analyzed** content, and unlimited re-cuts from an existing transcript are **free forever**.

We charge for **new media understanding** (Analyze / transcribe + grounded review) and optional **AI video generation**.

## User-facing units

| Unit | What it covers | Limits | Internal credits | Typical COGS |
|------|----------------|--------|------------------|--------------|
| **Episode Pass** | Long-form analyze — Whisper transcribe + grounded AI review | Up to 90 min | ~170 | ~$0.70–1.00 |
| **Clip Batch** | Short-form batch analyze + soundbite pass | Up to 10 clips, 5 min each | ~60 | ~$0.40–0.60 |
| **AI Video** | 8s B-roll / concept / motion generation | Per clip | 100–120 | ~$0.40–0.64 |

Credits remain an **internal ledger** for the gateway. Customers see passes, batches, and AI videos in product UI and on invoices (once Stripe lands).

## Plans (monthly)

| Plan | Price | Episode Passes | Clip Batches | AI Videos |
|------|-------|----------------|--------------|-----------|
| **Student** | $9/mo | 1 | 1 | 2 |
| **Starter** | $19/mo | 2 | 1 | 3 |
| **Intro Pro** | $39/mo | 10 | 2 | 10 |
| **Reel Creator** | $59/mo | 4 | 12 | 20 |
| **Studio** | $99/mo | 20 | 30 | 50 |

Student tier requires a `.edu` email or course discount code (enforcement is manual for now).

Plan definitions live in `packages/ai-gateway/src/plans.ts` as `STORYTELLER_PLANS`.

## Overage (informational)

| Add-on | Price |
|--------|-------|
| Extra Episode Pass | $4 |
| Extra Clip Batch | $3 |
| 5-pack AI Videos | $8 |

Defined in `packages/ai-gateway/src/metering-types.ts` as `OVERAGE_PRICING_USD`.

## What is free

- Timeline editing and re-ordering
- NLE export packages (Premiere, DaVinci, etc.)
- Intro builder assembly from existing soundbites
- MP4 export (local FFmpeg)
- Quick Reel **assembly and export** when transcript/moments already exist
- **Re-cuts / re-ranking** from an unchanged transcript (`refreshSoundbitesFromExistingTranscript`) — no second Whisper charge

## What is metered

| Action | Metering unit |
|--------|---------------|
| Project Workspace **Analyze** (new source media) | Episode Pass (long-form) |
| Quick Reel **upload / record** (new transcribe) | Clip Batch |
| Grounded AI review on new analyze | Included in pass/batch |
| B-roll / motion / image-to-video generation | AI Video |

## Transcript reuse (no re-charge)

When source media is unchanged, Whisper must not run again for billing purposes.

Fingerprint concept (`packages/ai-gateway/src/source-media-fingerprint.ts`):

- Prefer **content hash** when available
- Fall back to **path + size + mtime** for cheap dedupe
- Persist fingerprint → transcript mapping in gateway or Supabase (not wired yet)

Desktop hook: `transcription-pipeline.ts` (TODO comments at transcribe call site).

## Implementation status

| Area | Status |
|------|--------|
| Types + plan definitions | Done |
| `CREDIT_COSTS` for AI video (~100) | Done |
| `estimateAnalyzeCost()` stub | Done |
| Source media fingerprint types | Done |
| Gateway reserve/commit for analyze | **Not wired** |
| Allowance ledger (passes/batches/videos) | **Not wired** |
| Stripe products / checkout | **Done** — `POST /v1/billing/checkout` + `POST /v1/webhooks/stripe` |
| Allowance ledger (passes/batches/videos) | **Done** — `gateway_user_allowances` table + `try_consume_allowance()` RPC |
| Gateway reserve/commit for analyze | **Done** — transcribe route gates on allowance before calling Whisper |
| AI Video allowance gate | **Done** — media-generate route checks `ai_video` allowance |
| Quick Reel Clip Batch gate in UI | **Not wired** — send `meteringUnit=clip_batch` in transcribe multipart |

## Code references

- Plans: `packages/ai-gateway/src/plans.ts`
- Metering units: `packages/ai-gateway/src/metering-types.ts`
- Credit costs + analyze estimate: `packages/ai-gateway/src/credit-costs.ts`
- Fingerprints: `packages/ai-gateway/src/source-media-fingerprint.ts`
- Gateway account API: `GET /v1/capabilities/account` (returns `monthlyAllowances`)

See also [ai-gateway.md](./ai-gateway.md) for hosted service architecture.
