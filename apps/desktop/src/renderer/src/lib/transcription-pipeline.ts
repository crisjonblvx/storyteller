import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, StoryMode, SoundbiteCandidate, TranscriptSegment } from '@storyteller/shared'
import {
  buildSourceMediaFingerprint,
  estimateAnalyzeCost,
  type SourceMediaFingerprint
} from '@storyteller/ai-gateway'
import { buildProductionOffersFromAiReview, isTranscribableMediaAsset } from '@storyteller/shared'
import {
  extractClipCandidatesPipeline,
  rankSoundbiteCandidates,
  type ExtractedClipCandidate,
  type PromptPackDefinition
} from '@storyteller/analysis'
import { getSignedAssetUrl } from '@renderer/lib/storage-assets'
import { ensureCloudSyncForTranscription } from '@renderer/lib/asset-upload'
import { getGatewayAccessToken } from '@renderer/lib/gateway-auth'
import { useLocalAnalysisStore } from '@renderer/stores/local-analysis'

/** Mirrors main-process `transcription:progress` payloads (see preload). */
type MainTranscriptionProgress = {
  phase: 'preparing' | 'chunking' | 'transcribing_chunk' | 'merging' | 'done'
  detail?: string
  chunkIndex?: number
  chunkTotal?: number
  chunksCompleted?: number
  estimatedSecondsRemaining?: number
}

type Bridge = {
  transcribeMedia?: (p: {
    signedUrl?: string
    localPath?: string
    filename: string
    assetType?: string
  }) => Promise<TranscribeResponse>
  verifyLocalMediaPath?: (path: string) => Promise<{
    ok: true
    exists: boolean
    path: string
    code: string
  }>
  analyzeGroundedReview?: (payload: {
    candidates: ExtractedClipCandidate[]
    segments?: Array<{
      id: string
      start: number
      end: number
      text: string
      speaker_label?: string | null
    }>
    subjectProfile: unknown
    promptPack: unknown
    directionText: string
    mode: string
    targetCount?: number
    shotDurationSeconds?: number
  }) => Promise<
    | {
        ok: true
        review: {
          rankedIds: string[]
          viralIds: string[]
          introIds: string[]
          graphIds: string[]
          trailerArc: string[]
          items: Array<{
            candidateId: string
            narrativeRole?:
              | 'cold-open'
              | 'transformation'
              | 'teaser'
              | 'emotional-low'
              | 'gut-punch'
              | 'viral-hook'
              | 'quotable-shift'
              | 'tension-setup'
              | 'payoff'
              | 'mission-close'
              | 'context'
            purpose?: string
            overallScore: number
            viralScore: number
            emotionalScore: number
            introScore: number
            graphScore: number
            labels: string[]
            rationale?: string
          whyBullets: string[]
          sectionReasons?: {
            viral?: string
            intro?: string
            graph?: string
          }
          graphicsPackage?: {
            graphImagePrompt?: string
            overlayTextImagePrompt?: string
            motionPromptFromImage?: string
            styleTags?: string[]
            style?: {
              referenceStyle?: string
              palette?: string[]
              typography?: string
              layout?: string
              tone?: string
              durationSeconds?: number
            }
          }
            brollIdeas: Array<{
              style: 'literal' | 'emotional' | 'symbolic'
              prompt: string
              why?: string
            }>
            graphIdea?: {
              chartType: 'bar' | 'line' | 'counter' | 'comparison' | 'text'
              title: string
              why?: string
              dataText?: string
              visualTreatment?: string
            }
          }>
        }
        candidates?: ExtractedClipCandidate[]
        source: 'ai' | 'fallback'
        reason?: string
      }
    | { ok: false; error: string }
  >
  onTranscriptionProgress?: (handler: (p: MainTranscriptionProgress) => void) => () => void
}

type GroundedReviewBridgeSuccess = Extract<
  Awaited<ReturnType<NonNullable<Bridge['analyzeGroundedReview']>>>,
  { ok: true }
>

const GROUNDED_REVIEW_VERSION = 23
const DEFAULT_RANKED_SOUND_BITE_MIN = 12
const DEFAULT_RANKED_SOUND_BITE_MAX = 15
const DEFAULT_MAX_EXPORTED_AI_ROWS = 18
const MAX_STANDALONE_SOUND_BITE_DURATION_SEC = 32
const MAX_GRAPH_SOUND_BITE_DURATION_SEC = 40

export type TranscribeResponse =
  | { ok: true; segments: Array<{ start: number; end: number; text: string }>; duration?: number; language?: string }
  | { ok: false; error: string }

/**
 * TODO(metering): Before calling Whisper, compute a {@link SourceMediaFingerprint}
 * from local stat (path + size + mtime) or content hash. If the gateway or local
 * cache already holds a transcript for the same fingerprint, skip transcribe billing
 * and reuse segments. Wire `estimateAnalyzeCost(durationSec, 'episode' | 'clip_batch')`
 * + gateway reserve when analyze metering lands.
 */
export type { SourceMediaFingerprint }

function getBridge(): Bridge {
  return (typeof window !== 'undefined' && window.storyteller) || {}
}

function mapMainProgress(
  msg: MainTranscriptionProgress,
  onProgress?: (p: AnalysisProgress) => void
): void {
  if (!onProgress) return
  switch (msg.phase) {
    case 'preparing':
      onProgress({ phase: 'preparing_audio', detail: msg.detail ?? 'Preparing audio…' })
      break
    case 'chunking':
      onProgress({ phase: 'chunking_audio', detail: msg.detail ?? 'Chunking audio…' })
      break
    case 'transcribing_chunk': {
      const eta =
        msg.estimatedSecondsRemaining != null && msg.estimatedSecondsRemaining > 0
          ? ` · ~${msg.estimatedSecondsRemaining}s remaining`
          : ''
      const detail = msg.detail ?? 'Transcribing…'
      const detailHasProgress = /\bfinished \d+\/\d+\b/i.test(detail) || /\bretrying part\b/i.test(detail)
      const done =
        !detailHasProgress && msg.chunksCompleted != null && msg.chunkTotal != null
          ? ` (${msg.chunksCompleted}/${msg.chunkTotal} parts done)`
          : ''
      onProgress({
        phase: 'transcribing_chunk',
        detail:
          msg.chunkIndex != null && msg.chunkTotal != null
            ? `Transcribing part ${msg.chunkIndex} of ${msg.chunkTotal}${done}${eta}${detail ? ` — ${detail}` : ''}`
            : detail
      })
      break
    }
    case 'merging':
      onProgress({ phase: 'merging_transcript', detail: msg.detail ?? 'Merging transcript…' })
      break
    case 'done':
      break
    default:
      break
  }
}

export type AnalysisProgress = {
  phase:
    | 'clearing'
    | 'preparing_audio'
    | 'chunking_audio'
    | 'transcribing_chunk'
    | 'merging_transcript'
    | 'scoring'
    | 'done'
  detail?: string
}

function buildHeuristicRows(params: {
  projectId: string
  ranked: ReturnType<typeof rankSoundbiteCandidates>
  createdAt: string
  maxRows: number
}): SoundbiteCandidate[] {
  const { projectId, ranked, createdAt, maxRows } = params
  return ranked.slice(0, maxRows).map((r) => ({
    id: crypto.randomUUID(),
    project_id: projectId,
    start_time: r.start_time,
    end_time: r.end_time,
    transcript_text: r.transcript_text,
    score_social: r.score_social,
    score_emotional: r.score_emotional,
    score_clarity: r.score_clarity,
    tags_json: {
      ...(r.tags_json ?? {}),
      composite: r.composite,
      segment_id: r.segment_id
    },
    created_at: createdAt
  }))
}

function desiredSoundbiteTargetCount(durationSec: number, directionText?: string): number {
  let target = 12
  if (durationSec >= 8 * 60) target = 14
  if (durationSec >= 15 * 60) target = 16
  if (durationSec >= 25 * 60) target = 18
  if (durationSec >= 40 * 60) target = 20
  if ((directionText ?? '').trim().toLowerCase().startsWith('cinematic intro / story')) target += 2
  return Math.max(12, Math.min(22, target))
}

function isLikelyPromotionalLine(text: string, clipType?: string): boolean {
  const lower = text.trim().toLowerCase()
  const isTitleLikePromo =
    /\b(stop living paycheck to paycheck|the proven path to|break free from consumer debt|build real wealth|live free on any income)\b/i.test(
      text
    )
  return (
    String(clipType ?? '').toUpperCase() === 'CTA' ||
    isTitleLikePromo ||
    /\b(show description|link is inside|forward slash|get the book|this book|inside the book|anthonyoneal|anthony o'?neill|buy the book|download|subscribe|share it|consultation|go to|free bonuses?|bonus(?:es)?|first chapter|money challenge|masterclass|early access|pre[\s-]?order(?:ing)?|order from amazon|barnes and noble|book launch team|two-minute quiz|personalized plan)\b/i.test(
      lower
    ) ||
    /\b(in the black|coach in your pocket|number one coach|i built one|my brand|specifically i built|utilizing ai to help you|utilizing the tools|tools that is that we have|help you get out of debt within)\b/i.test(
      lower
    ) ||
    (/\b(ai app|ai tool|ai coach)\b/i.test(lower) && /\b(debt|wealth|download|sign up|get out of)\b/i.test(lower))
  )
}

function isSameClipWindow(
  a: { start: number; end: number; text: string },
  b: { start: number; end: number; text: string }
): boolean {
  if (Math.abs(a.start - b.start) <= 0.75 && Math.abs(a.end - b.end) <= 0.75) return true
  return sameIdeaFamily(a, b)
}

function dedupeCandidateIdList(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>
): string[] {
  const kept: string[] = []
  for (const id of ids) {
    const candidate = byId.get(id)
    if (!candidate) continue
    if (
      kept.some((existingId) => {
        const existing = byId.get(existingId)
        return existing ? isSameClipWindow(existing, candidate) : false
      })
    ) {
      continue
    }
    kept.push(id)
  }
  return kept
}

/** Audience-survey/option-poll questions and self-correcting filler lines (weak standalone bites). */
function isWeakConversationalLine(text: string): boolean {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  if (/\b(are|do)\s+you\b/.test(lower) && /\b(under|over|above|below|less than|more than)\b[^?]*\bor\b/.test(lower)) {
    return true
  }
  if (/\b(under|over)\s*\$?\d+\s*k?\b[^?]*\b(over|under)\s*\$?\d+\s*k?\b/.test(lower)) return true
  if (/\b(if you're watching this|stay with me|stick with me|hear me out|watch this all the way|don't go anywhere)\b/.test(lower)) {
    return true
  }
  if (/^(oh yeah|yeah|yep|okay|ok|alright|so yeah|and yeah|um|uh|well,|i mean|i would say)\b/.test(lower)) return true
  if (/^(rewind|again|like i said|as i said|in other words|let me say (?:it|that) again|let me say one more time|so again|repeat)\b/.test(lower)) {
    return true
  }
  if (/\bcool\.?\s+great man\b/.test(lower)) return true
  const fillerHits = (lower.match(/\b(i would say|i mean|you know|kind of|sort of|like i said|oh yeah|uh|um)\b/g) ?? [])
    .length
  if (fillerHits >= 2) return true
  if (/\b(\w+(?:\s+\w+){0,2})\b[\s,]+\1\b/.test(lower)) return true
  if (/,\s*(right|okay|ok|you know|you feel me)\?\s*$/.test(lower) && fillerHits >= 1) return true
  if (/,\s*(okay|ok|right)\?\s*$/.test(lower) && trimmed.split(/\s+/).length <= 11) return true
  return false
}

function isPrayerLikeOrDevotionalLine(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return /\b(god|lord jesus|pray|prayer|good steward|hopefully you see my heart|give me something creative)\b/i.test(
    lower
  )
}

function isOverlongStandaloneCandidate(
  candidate: { end: number; start: number; clipType?: string },
  context: 'soundbite' | 'graph' = 'soundbite'
): boolean {
  const duration = Math.max(0, candidate.end - candidate.start)
  const maxDuration = context === 'graph' ? MAX_GRAPH_SOUND_BITE_DURATION_SEC : MAX_STANDALONE_SOUND_BITE_DURATION_SEC
  return duration > maxDuration
}

const RESTATEMENT_CUE = /^\s*(rewind|again|like i said|as i said|in other words|let me say (?:it|that) again|so again|repeat)\b[\s,:-]*/i

function stripRestatementCue(text: string): string {
  return text.replace(RESTATEMENT_CUE, '').trim()
}

const IDEA_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'here', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'let', 'like',
  'me', 'my', 'now', 'of', 'on', 'or', 'our', 'say', 'so', 'that', 'the', 'their', 'this',
  'to', 'was', 'we', 'were', 'what', 'with', 'you', 'your'
])

function normalizeIdeaToken(token: string): string {
  if (!token || token === 'num') return token
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function normalizedIdeaText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:like i said earlier|from the very beginning of the show|get straight to it)\b/g, ' ')
    .replace(/\b(?:here s the thing|let me say this|you see|i wanna|i want to|watch this|all right|alright|family)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' num ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantIdeaTokens(text: string): string[] {
  return normalizedIdeaText(text)
    .split(' ')
    .map((token) => normalizeIdeaToken(token))
    .filter((token) => token.length >= 3 && !IDEA_STOPWORDS.has(token))
}

function tokenOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const bSet = new Set(b)
  let shared = 0
  for (const token of new Set(a)) {
    if (bSet.has(token)) shared += 1
  }
  return shared / Math.min(new Set(a).size, new Set(b).size)
}

function commonPrefixTokenCount(a: string, b: string): number {
  const aTokens = a.split(' ').filter(Boolean)
  const bTokens = b.split(' ').filter(Boolean)
  const length = Math.min(aTokens.length, bTokens.length)
  let count = 0
  for (let i = 0; i < length; i += 1) {
    if (aTokens[i] !== bTokens[i]) break
    count += 1
  }
  return count
}

function sameIdeaFamily(
  a: { text: string; start: number; end: number },
  b: { text: string; start: number; end: number }
): boolean {
  if (overlapRatioByWindow(a, b) >= 0.5) return true
  const aIdea = normalizedIdeaText(stripRestatementCue(a.text))
  const bIdea = normalizedIdeaText(stripRestatementCue(b.text))
  if (!aIdea || !bIdea) return false
  if (commonPrefixTokenCount(aIdea, bIdea) >= 4 && Math.abs(a.start - b.start) <= 35) return true
  if ((aIdea.includes(bIdea) && bIdea.length >= 24) || (bIdea.includes(aIdea) && aIdea.length >= 24)) return true
  const overlap = tokenOverlapRatio(
    significantIdeaTokens(stripRestatementCue(a.text)),
    significantIdeaTokens(stripRestatementCue(b.text))
  )
  if (overlap >= 0.8) return true
  if (overlap >= 0.6 && Math.abs(a.start - b.start) <= 30) return true
  // Back-to-back restatements (one line literally re-says the previous).
  const isRestatement = RESTATEMENT_CUE.test(a.text) || RESTATEMENT_CUE.test(b.text)
  if (Math.abs(a.start - b.start) <= 20 && overlap >= 0.5) return true
  return isRestatement && overlap >= 0.4 && Math.abs(a.start - b.start) <= 60
}

function overlapRatioByWindow(
  a: { start: number; end: number },
  b: { start: number; end: number }
): number {
  const overlapStart = Math.max(a.start, b.start)
  const overlapEnd = Math.min(a.end, b.end)
  const overlap = Math.max(0, overlapEnd - overlapStart)
  if (overlap <= 0) return 0
  return overlap / Math.min(Math.max(0.01, a.end - a.start), Math.max(0.01, b.end - b.start))
}

function buildAiRows(params: {
  projectId: string
  createdAt: string
  candidates: ExtractedClipCandidate[]
  review: GroundedReviewBridgeSuccess['review']
  reviewSource: 'ai' | 'fallback'
  rankedMin: number
  rankedMax: number
  exportedMax: number
}): SoundbiteCandidate[] {
  const { projectId, createdAt, candidates, review, reviewSource, rankedMin, rankedMax, exportedMax } = params
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const itemById = new Map(review.items.map((item) => [item.candidateId, item]))
  const trailerArc = dedupeCandidateIdList(review.trailerArc ?? [], byId)
  const rankedIds = dedupeCandidateIdList(
    review.rankedIds.filter((candidateId) => {
    const candidate = byId.get(candidateId)
    return candidate
      ? !isLikelyPromotionalLine(candidate.text, candidate.clipType) &&
          !isWeakConversationalLine(candidate.text) &&
          !isPrayerLikeOrDevotionalLine(candidate.text) &&
          !isOverlongStandaloneCandidate(candidate, 'soundbite')
      : false
  }),
    byId
  )
  if (rankedIds.length < rankedMin) {
    const pickedCandidates: ExtractedClipCandidate[] = rankedIds
      .map((candidateId) => byId.get(candidateId))
      .filter((candidate): candidate is ExtractedClipCandidate => Boolean(candidate))
    for (const candidate of [...candidates].sort((a, b) => b.heuristicComposite - a.heuristicComposite)) {
      if (isLikelyPromotionalLine(candidate.text, candidate.clipType)) continue
      if (isWeakConversationalLine(candidate.text)) continue
      if (isPrayerLikeOrDevotionalLine(candidate.text)) continue
      if (isOverlongStandaloneCandidate(candidate, 'soundbite')) continue
      if (pickedCandidates.some((picked) => sameIdeaFamily(picked, candidate))) {
        continue
      }
      if (!rankedIds.includes(candidate.id)) rankedIds.push(candidate.id)
      pickedCandidates.push(candidate)
      if (rankedIds.length >= rankedMax) break
    }
  }

  const viralIds = dedupeCandidateIdList(
    review.viralIds.filter((candidateId) => {
    const candidate = byId.get(candidateId)
    return candidate
      ? !isLikelyPromotionalLine(candidate.text, candidate.clipType) &&
          !isWeakConversationalLine(candidate.text) &&
          !isPrayerLikeOrDevotionalLine(candidate.text) &&
          !isOverlongStandaloneCandidate(candidate, 'soundbite')
      : false
  }),
    byId
  )
  const introIds = dedupeCandidateIdList(
    review.introIds.filter((candidateId) => {
    const candidate = byId.get(candidateId)
    return candidate
      ? !isLikelyPromotionalLine(candidate.text, candidate.clipType) &&
          !isWeakConversationalLine(candidate.text) &&
          !isPrayerLikeOrDevotionalLine(candidate.text) &&
          !isOverlongStandaloneCandidate(candidate, 'soundbite')
      : false
  }),
    byId
  )
  const graphIds = dedupeCandidateIdList(
    review.graphIds.filter((candidateId) => {
    const candidate = byId.get(candidateId)
    return candidate
      ? !isLikelyPromotionalLine(candidate.text, candidate.clipType) &&
          !isWeakConversationalLine(candidate.text) &&
          !isPrayerLikeOrDevotionalLine(candidate.text) &&
          !isOverlongStandaloneCandidate(candidate, 'graph')
      : false
  }),
    byId
  )

  const selectedIds = dedupeCandidateIdList(
    [...new Set([...rankedIds, ...viralIds, ...introIds, ...graphIds])].filter(
    (candidateId) => {
      const candidate = byId.get(candidateId)
      return candidate
        ? !isLikelyPromotionalLine(candidate.text, candidate.clipType) &&
            !isWeakConversationalLine(candidate.text) &&
            !isPrayerLikeOrDevotionalLine(candidate.text) &&
            !isOverlongStandaloneCandidate(
              candidate,
              graphIds.includes(candidateId) ? 'graph' : 'soundbite'
            )
        : false
    }
    ),
    byId
  )
  const dedupedSelectedIds: string[] = []
  for (const candidateId of selectedIds) {
    const candidate = byId.get(candidateId)
    if (!candidate) continue
    if (
      dedupedSelectedIds.some((existingId) => {
        const existing = byId.get(existingId)
        return existing ? isSameClipWindow(existing, candidate) : false
      })
    ) {
      continue
    }
    dedupedSelectedIds.push(candidateId)
  }

  const placementOf = (ids: string[], candidateId: string): number | null => {
    const index = ids.indexOf(candidateId)
    return index >= 0 ? index + 1 : null
  }

  return dedupedSelectedIds.slice(0, exportedMax).flatMap((candidateId, idx) => {
    const candidate = byId.get(candidateId)
    if (!candidate) return []
    const ai = itemById.get(candidateId)
    const placements = {
      ranked: placementOf(rankedIds, candidateId),
      viral: placementOf(viralIds, candidateId),
      intro: placementOf(introIds, candidateId),
      graph: placementOf(graphIds, candidateId),
      arc: placementOf(trailerArc, candidateId)
    }
    const lower = candidate.text.toLowerCase()
    const isMissionCloseLine =
      /\b(you'?re late|positioned to participate|wealth transfer is not coming|ai wealth transfer)\b/i.test(lower)
    let narrativeRole = ai?.narrativeRole
    let purpose = ai?.purpose
    if (placements.arc === 1) {
      narrativeRole = 'cold-open'
      purpose = 'Instant relatability — establishes the stakes in the first seconds.'
    } else if (placements.arc === trailerArc.length && trailerArc.length >= 2 && isMissionCloseLine) {
      narrativeRole = 'mission-close'
      purpose = 'Powerful close — the reason the whole piece exists.'
    }
    const labels = new Set<string>([
      candidate.clipType.toLowerCase(),
      ...(ai?.labels ?? [])
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean)
    ])
    if (viralIds.includes(candidateId)) labels.add('viral')
    if (introIds.includes(candidateId)) labels.add('intro')
    if (graphIds.includes(candidateId)) labels.add('data')
    if ((ai?.emotionalScore ?? candidate.heuristicScores.emotionalIntensity) >= 0.28) labels.add('emotional')
    if ((candidate.heuristicScores.consequence ?? 0) >= 0.24) labels.add('motivational')

    return [
      {
        id: crypto.randomUUID(),
        project_id: projectId,
        start_time: candidate.start,
        end_time: candidate.end,
        transcript_text: candidate.text,
        score_social: ai?.viralScore ?? candidate.heuristicScores.viralPriority,
        score_emotional: ai?.emotionalScore ?? candidate.heuristicScores.emotionalIntensity,
        score_clarity: candidate.heuristicScores.clarityOfMessage,
        tags_json: {
          label: `Moment #${idx + 1}`,
          composite: ai?.overallScore ?? candidate.heuristicComposite,
          segment_id: candidate.sourceSegmentIds[0] ?? candidate.id,
          clipType: candidate.clipType,
          type: candidate.clipType,
          viral: placements.viral != null,
          introPick: placements.intro != null,
          graphPick: placements.graph != null,
          secondaryTags: [...labels],
          editorialScores: {
            ...candidate.heuristicScores
          },
          viralPriority: ai?.viralScore ?? candidate.heuristicScores.viralPriority,
          heuristicComposite: candidate.heuristicComposite,
          heuristicWithinTypeRank: candidate.heuristicWithinTypeRank,
          sourceSegmentIds: candidate.sourceSegmentIds,
          aiReview: {
            version: GROUNDED_REVIEW_VERSION,
            source: reviewSource,
            narrativeRole,
            purpose,
            overallScore: ai?.overallScore ?? candidate.heuristicComposite,
            viralScore: ai?.viralScore ?? candidate.heuristicScores.viralPriority,
            emotionalScore: ai?.emotionalScore ?? candidate.heuristicScores.emotionalIntensity,
            introScore:
              ai?.introScore ??
              Math.max(candidate.heuristicScores.scrollStopPotential, candidate.heuristicScores.viralPriority),
            graphScore: ai?.graphScore ?? (candidate.heuristicScores.dataAuthority ?? 0),
            labels: [...labels],
            rationale: ai?.rationale,
            whyBullets: ai?.whyBullets ?? [],
            sectionReasons: ai?.sectionReasons,
            graphicsPackage: ai?.graphicsPackage,
            placements,
            brollIdeas: ai?.brollIdeas ?? [],
            graphIdea: ai?.graphIdea,
            productionOffers: buildProductionOffersFromAiReview({
              soundbiteId: candidate.id,
              brollIdeas: ai?.brollIdeas ?? [],
              graphicsPackage: ai?.graphicsPackage,
              graphScore: ai?.graphScore ?? (candidate.heuristicScores.dataAuthority ?? 0),
              hasGraphIdea: Boolean(ai?.graphIdea)
            })
          }
        },
        created_at: createdAt
      }
    ]
  })
}

async function buildSoundbiteRowsFromSegments(params: {
  projectId: string
  projectMode: StoryMode
  segs: Array<{ id: string; start_time: number; end_time: number; text: string; speaker_label: string | null }>
  directionText?: string
  subjectProfile?: unknown
  promptPack?: PromptPackDefinition
  onProgress?: (p: AnalysisProgress) => void
}): Promise<SoundbiteCandidate[]> {
  const { projectId, projectMode, segs, directionText, subjectProfile, promptPack, onProgress } = params
  const bridge = getBridge()
  const createdAt = new Date().toISOString()
  const sourceDurationSec = segs.reduce((max, segment) => Math.max(max, segment.end_time), 0)
  const targetCount = desiredSoundbiteTargetCount(sourceDurationSec, directionText)
  const rankedMin = Math.max(10, targetCount - 3)
  const exportedMax = Math.min(targetCount + 6, 28)
  const ranked = rankSoundbiteCandidates(projectMode, segs, {
    directionText,
    minSoundBites: rankedMin,
    maxSoundBites: targetCount
  })
  let candidateRows = buildHeuristicRows({ projectId, ranked, createdAt, maxRows: targetCount })

  if (bridge.analyzeGroundedReview && promptPack) {
    onProgress?.({ phase: 'scoring', detail: 'Running grounded AI review on the strongest transcript moments…' })
    const groundedCandidates = await extractClipCandidatesPipeline(
      segs.map((segment) => ({
        id: segment.id,
        start: segment.start_time,
        end: segment.end_time,
        text: segment.text,
        speaker_label: segment.speaker_label
      })),
      {
        // Wider pool so punchy/emotional lines that score lower on raw composite
        // (but are editorial gold) still reach the LLM reranker.
        maxCandidates: 120,
        mode: projectMode
      }
    )

    if (groundedCandidates.length > 0) {
      const accessToken = await getGatewayAccessToken()
      const grounded = await bridge.analyzeGroundedReview({
        candidates: groundedCandidates,
        segments: segs.map((segment) => ({
          id: segment.id,
          start: segment.start_time,
          end: segment.end_time,
          text: segment.text,
          speaker_label: segment.speaker_label
        })),
        subjectProfile: subjectProfile ?? {},
        promptPack,
        directionText: directionText ?? '',
        mode: projectMode,
        targetCount,
        shotDurationSeconds: 8,
        accessToken: accessToken ?? undefined
      })
      if (grounded.ok && grounded.review.rankedIds.length > 0) {
        const aiRows = buildAiRows({
          projectId,
          createdAt,
          candidates: grounded.candidates && grounded.candidates.length > 0 ? grounded.candidates : groundedCandidates,
          review: grounded.review,
          reviewSource: grounded.source,
          rankedMin,
          rankedMax: targetCount,
          exportedMax
        })
        if (aiRows.length >= Math.min(rankedMin, 8)) {
          candidateRows = aiRows
        }
      }
    }
  }

  return candidateRows
}

/**
 * Transcribe each video/audio asset via Whisper (main process: FFmpeg extract → chunk → API),
 * store transcript segments + soundbites in Supabase when signed in, otherwise in local device storage.
 */
export async function runTranscriptionAnalysis(params: {
  supabase: SupabaseClient | null
  projectId: string
  projectTitle: string
  projectMode: StoryMode
  assets: Asset[]
  /** Optional user intent — keyword boosts for soundbite ranking. */
  directionText?: string
  subjectProfile?: unknown
  promptPack?: PromptPackDefinition
  onProgress?: (p: AnalysisProgress) => void
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, projectId, projectTitle, projectMode, assets, directionText, subjectProfile, promptPack, onProgress } =
    params
  const bridge = getBridge()
  if (!bridge.transcribeMedia) {
    return { ok: false, error: 'Transcription bridge unavailable (Electron preload missing).' }
  }

  const targets = assets.filter(isTranscribableMediaAsset)
  if (targets.length === 0) {
    return {
      ok: false,
      error: 'Import at least one video or audio file (local or uploaded) with successful probe first.'
    }
  }

  const clearLocal = useLocalAnalysisStore.getState().clearProject
  const setLocal = useLocalAnalysisStore.getState().setProjectData

  onProgress?.({ phase: 'clearing', detail: 'Removing previous transcript & soundbites…' })
  clearLocal(projectId)
  if (supabase) {
    await supabase.from('soundbite_candidates').delete().eq('project_id', projectId)
    await supabase.from('transcript_segments').delete().eq('project_id', projectId)
  }

  const localSegmentsAccum: TranscriptSegment[] = []

  for (const asset of targets) {
    const name = asset.original_filename ?? `${asset.id}.mp4`
    const unsub = bridge.onTranscriptionProgress?.((msg) => mapMainProgress(msg, onProgress))

    try {
      let raw: TranscribeResponse
      const trimmedLocal = typeof asset.local_path === 'string' ? asset.local_path.trim() : ''
      let localPathForTranscribe: string | undefined
      let signedUrlForTranscribe: string | undefined

      if (trimmedLocal.length > 0) {
        const verify = bridge.verifyLocalMediaPath
        if (verify) {
          const v = await verify(trimmedLocal)
          if (v.exists && v.path) {
            localPathForTranscribe = v.path
          }
        } else {
          localPathForTranscribe = trimmedLocal
        }

        if (!localPathForTranscribe) {
          if (supabase && asset.storage_path && asset.is_uploaded) {
            const signed = await getSignedAssetUrl(supabase, asset.storage_path, 3600)
            if (!signed) {
              return {
                ok: false,
                error: `We couldn't find "${name}" on this computer, and cloud download isn't available. Re-import the file or check your connection.`
              }
            }
            signedUrlForTranscribe = signed
          } else {
            return {
              ok: false,
              error: `We couldn't find "${name}" on disk (it may have been moved or deleted). Go back to Upload and add the file again.`
            }
          }
        }
      } else if (supabase && asset.storage_path && asset.is_uploaded) {
        const signed = await getSignedAssetUrl(supabase, asset.storage_path, 3600)
        if (!signed) {
          return { ok: false, error: 'Could not create signed URL for an asset — check Storage policies or upload status.' }
        }
        signedUrlForTranscribe = signed
      } else {
        return {
          ok: false,
          error: `No local file path for "${name}" and no cloud copy to download. Re-import media in the Storyteller app.`
        }
      }

      // TODO(metering): resolve fingerprint from asset.media_hash or filesystem stat;
      // skip transcribe + billing when transcript exists for unchanged source media.
      if (localPathForTranscribe) {
        void buildSourceMediaFingerprint({
          localPath: localPathForTranscribe,
          sizeBytes: 0,
          mtimeMs: 0,
          contentHash: asset.media_hash ?? undefined
        })
        void estimateAnalyzeCost(asset.duration_seconds ?? 0, 'episode')
      }

      raw = await bridge.transcribeMedia!({
        localPath: localPathForTranscribe,
        signedUrl: signedUrlForTranscribe,
        filename: name,
        assetType: asset.asset_type
      })

      if (!raw.ok) {
        return { ok: false, error: raw.error }
      }

      const created = new Date().toISOString()
      const rows: TranscriptSegment[] = raw.segments.map((s) => ({
        id: crypto.randomUUID(),
        project_id: projectId,
        asset_id: asset.id,
        speaker_label: null,
        start_time: s.start,
        end_time: s.end,
        text: s.text,
        confidence: null,
        created_at: created
      }))

      if (rows.length === 0) continue

      if (supabase) {
        const synced = await ensureCloudSyncForTranscription(supabase, {
          projectId,
          projectTitle,
          projectMode,
          asset
        })
        if (!synced.ok) {
          return { ok: false, error: synced.error }
        }

        const { error: insErr } = await supabase.from('transcript_segments').insert(
          rows.map((r) => ({
            id: r.id,
            project_id: r.project_id,
            asset_id: r.asset_id,
            speaker_label: r.speaker_label,
            start_time: r.start_time,
            end_time: r.end_time,
            text: r.text,
            confidence: r.confidence
          }))
        )
        if (insErr) {
          return { ok: false, error: insErr.message }
        }
      } else {
        localSegmentsAccum.push(...rows)
      }
    } finally {
      unsub?.()
    }
  }

  let segs: Array<{ id: string; start_time: number; end_time: number; text: string; speaker_label: string | null }>
  if (supabase) {
    const { data: allSegs, error: segErr } = await supabase
      .from('transcript_segments')
      .select('id, start_time, end_time, text, speaker_label')
      .eq('project_id', projectId)
      .order('start_time', { ascending: true })

    if (segErr) return { ok: false, error: segErr.message }
    segs = (allSegs ?? []) as Array<{
      id: string
      start_time: number
      end_time: number
      text: string
      speaker_label: string | null
    }>
  } else {
    segs = localSegmentsAccum.map((s) => ({
      id: s.id,
      start_time: s.start_time,
      end_time: s.end_time,
      text: s.text,
      speaker_label: s.speaker_label
    }))
  }

  if (segs.length === 0) {
    return { ok: false, error: 'Transcription returned no segments.' }
  }

  onProgress?.({ phase: 'scoring', detail: 'Generating soundbites from transcript…' })
  const candidateRows = await buildSoundbiteRowsFromSegments({
    projectId,
    projectMode,
    segs,
    directionText,
    subjectProfile,
    promptPack,
    onProgress
  })

  if (supabase) {
    const { error: sbErr } = await supabase.from('soundbite_candidates').insert(
      candidateRows.map((c) => ({
        id: c.id,
        project_id: c.project_id,
        start_time: c.start_time,
        end_time: c.end_time,
        transcript_text: c.transcript_text,
        score_social: c.score_social,
        score_emotional: c.score_emotional,
        score_clarity: c.score_clarity,
        tags_json: c.tags_json
      }))
    )
    if (sbErr) return { ok: false, error: sbErr.message }
  } else {
    setLocal(projectId, localSegmentsAccum, candidateRows)
  }

  onProgress?.({ phase: 'done', detail: 'Done' })
  return { ok: true }
}

export async function refreshSoundbitesFromExistingTranscript(params: {
  supabase: SupabaseClient | null
  projectId: string
  projectMode: StoryMode
  segments: TranscriptSegment[]
  directionText?: string
  subjectProfile?: unknown
  promptPack?: PromptPackDefinition
  onProgress?: (p: AnalysisProgress) => void
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, projectId, projectMode, segments, directionText, subjectProfile, promptPack, onProgress } = params
  const setLocal = useLocalAnalysisStore.getState().setProjectData

  const segs = segments.map((segment) => ({
    id: segment.id,
    start_time: segment.start_time,
    end_time: segment.end_time,
    text: segment.text,
    speaker_label: segment.speaker_label
  }))

  if (segs.length === 0) {
    return { ok: false, error: 'No transcript segments available for grounded review.' }
  }

  onProgress?.({ phase: 'scoring', detail: 'Refreshing saved moments with grounded AI review…' })
  const candidateRows = await buildSoundbiteRowsFromSegments({
    projectId,
    projectMode,
    segs,
    directionText,
    subjectProfile,
    promptPack,
    onProgress
  })

  if (supabase) {
    const { error: delErr } = await supabase.from('soundbite_candidates').delete().eq('project_id', projectId)
    if (delErr) return { ok: false, error: delErr.message }
    const { error: insErr } = await supabase.from('soundbite_candidates').insert(
      candidateRows.map((c) => ({
        id: c.id,
        project_id: c.project_id,
        start_time: c.start_time,
        end_time: c.end_time,
        transcript_text: c.transcript_text,
        score_social: c.score_social,
        score_emotional: c.score_emotional,
        score_clarity: c.score_clarity,
        tags_json: c.tags_json
      }))
    )
    if (insErr) return { ok: false, error: insErr.message }
  } else {
    setLocal(projectId, segments, candidateRows)
  }

  onProgress?.({ phase: 'done', detail: 'Done' })
  return { ok: true }
}
