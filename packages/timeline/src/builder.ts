import type { SilencePreset } from '@storyteller/shared'
import type { StoryMode, ProjectFormat } from '@storyteller/shared'
import type { SoundbiteCandidate } from '@storyteller/shared'
import type { SilenceRegion } from '@storyteller/shared'
import type { Asset, JournalismClipRole, CreatorClipRole } from '@storyteller/shared'
import type { TimelineClip, TimelineSequence, TimelineTrack } from './model.js'
import { silenceThresholdSeconds } from './silence-presets.js'
import { capSourceWindowSeconds, resolveBuilderPacingConfig, type BuilderPacing } from './assembly-pacing.js'

export interface RoughCutInput {
  projectId: string
  mode: StoryMode
  format: ProjectFormat
  primaryAssetId: string
  soundbites: Pick<SoundbiteCandidate, 'id' | 'start_time' | 'end_time' | 'transcript_text'>[]
  silenceRegions: Pick<SilenceRegion, 'start_time' | 'end_time' | 'severity'>[]
  silencePreset?: SilencePreset
  pacingMode?: BuilderPacing
}

/** Collapse long internal silences down to `threshold` seconds (rough-cut v1). */
function trimmedDurationSeconds(
  start: number,
  end: number,
  regions: Pick<SilenceRegion, 'start_time' | 'end_time'>[],
  threshold: number
): number {
  let trim = 0
  for (const r of regions) {
    const s = Math.max(r.start_time, start)
    const e = Math.min(r.end_time, end)
    if (e <= s) continue
    const len = e - s
    if (len > threshold) trim += len - threshold
  }
  return Math.max(0, end - start - trim)
}

/**
 * Deterministic rough-cut: orders ranked soundbites on one video + one audio track.
 */
export function buildRoughCutSequence(input: RoughCutInput): TimelineSequence {
  const pacing = resolveBuilderPacingConfig(input.mode, input.pacingMode, input.silencePreset)
  const threshold = silenceThresholdSeconds(pacing.silencePreset)

  const videoClips: TimelineClip[] = []
  const audioClips: TimelineClip[] = []
  let timelineCursor = 0

  for (const sb of input.soundbites) {
    const sourceOutSeconds = capSourceWindowSeconds(sb.start_time, sb.end_time, pacing.maxClipSeconds)
    const dur = trimmedDurationSeconds(sb.start_time, sourceOutSeconds, input.silenceRegions, threshold)
    const vClip: TimelineClip = {
      id: `clip-${sb.id}`,
      role: 'a-roll',
      assetId: input.primaryAssetId,
      sourceInSeconds: sb.start_time,
      sourceOutSeconds,
      timelineInSeconds: timelineCursor,
      timelineOutSeconds: timelineCursor + dur,
      soundbiteId: sb.id,
      metadata: { soundbiteId: sb.id, silencePreset: pacing.silencePreset, pacingMode: input.pacingMode ?? 'Balanced' }
    }
    const aClip: TimelineClip = {
      ...vClip,
      id: `${vClip.id}-audio`,
      role: 'nat-audio'
    }
    videoClips.push(vClip)
    audioClips.push(aClip)
    timelineCursor = vClip.timelineOutSeconds
  }

  const videoTrack: TimelineTrack = { id: 'v1', name: 'Video 1', clips: videoClips }
  const audioTrack: TimelineTrack = { id: 'a1', name: 'Audio 1', clips: audioClips }

  return {
    id: `seq-${input.projectId}`,
    projectId: input.projectId,
    mode: input.mode,
    format: input.format,
    durationSeconds: timelineCursor,
    videoTracks: [videoTrack],
    audioTracks: [audioTrack],
    textTracks: [{ id: 't1', name: 'Titles', clips: [] }],
    markers: [],
    metadata: { builder: 'rough-cut-v1', silencePreset: pacing.silencePreset, pacingMode: input.pacingMode ?? 'Balanced' }
  }
}

// ---------------------------------------------------------------------------
// Music video builder — beat-synced cuts
// ---------------------------------------------------------------------------

export type BeatsPerCut = 1 | 2 | 4 | 8

export interface MusicVideoCutInput {
  projectId: string
  format: ProjectFormat
  /** The primary video asset — footage that will be cut to the beat. */
  primaryAssetId: string
  /** Total duration of the primary video asset in seconds. */
  primaryDurationSeconds: number
  /**
   * Beat timestamps in seconds, as returned by `analyzeBeat()`.
   * Must be sorted ascending. At least 2 beats are required to produce any clips.
   */
  beatTimestamps: number[]
  /**
   * How many musical beats between each edit cut. Defaults to 4.
   * e.g. at 120 BPM with beatsPerCut=4, cuts happen every ~2 seconds.
   */
  beatsPerCut?: BeatsPerCut
  /**
   * Optional pre-selected video segments to use as source material.
   * When provided, the builder sequences these moments across the beat grid.
   * When absent, the builder slices the primary asset sequentially.
   */
  soundbites?: Pick<SoundbiteCandidate, 'id' | 'start_time' | 'end_time'>[]
  /**
   * Local path of the music file. When provided a music audio track is added.
   * The renderer/exporter must resolve this to an assetId and supply the local path.
   */
  musicAssetId?: string
  musicDurationSeconds?: number
}

/**
 * Build a beat-synced music video cut.
 *
 * Each clip on the timeline starts and ends on a musical beat boundary so
 * the final export — when mixed with the music track — cuts precisely to
 * the beat.
 *
 * Algorithm:
 *   1. Derive "cut points" by sampling the beat array every `beatsPerCut` beats.
 *   2. For each consecutive pair of cut points [tA, tB], create a clip of
 *      duration (tB − tA) placed at timeline position tA.
 *   3. Source material: cycles through soundbites in order; each soundbite
 *      segment contributes min(beatSlotDuration, remainingSourceTime) seconds.
 *      When soundbites are exhausted the builder falls back to the primary
 *      asset sliced sequentially from 0.
 */
export function buildMusicVideoCut(input: MusicVideoCutInput): TimelineSequence {
  const n = input.beatsPerCut ?? 4
  const beats = input.beatTimestamps

  // Sample cut points every n beats (always include the first beat)
  const cutPoints: number[] = []
  for (let i = 0; i < beats.length; i += n) {
    cutPoints.push(beats[i]!)
  }
  // Add a closing point so the last clip has a defined end
  const lastBeat = beats[beats.length - 1]
  if (lastBeat !== undefined && cutPoints[cutPoints.length - 1] !== lastBeat) {
    cutPoints.push(lastBeat)
  }

  const videoClips: TimelineClip[] = []
  const audioClips: TimelineClip[] = []

  // Source material pointer — cycle through soundbites, then fall back to primary
  const soundbites = input.soundbites ?? []
  let sbIndex = 0
  let sbConsumedSeconds = 0  // how many seconds used from current soundbite
  let fallbackCursor = 0     // position in the primary asset when no soundbites

  for (let i = 0; i + 1 < cutPoints.length; i++) {
    const timelineIn = cutPoints[i]!
    const timelineOut = cutPoints[i + 1]!
    const slotDuration = timelineOut - timelineIn
    if (slotDuration <= 0) continue

    let srcIn: number
    let srcOut: number
    let assetId: string

    if (soundbites.length > 0) {
      const sb = soundbites[sbIndex % soundbites.length]!
      const sbRemaining = (sb.end_time - sb.start_time) - sbConsumedSeconds
      srcIn = sb.start_time + sbConsumedSeconds

      if (slotDuration < sbRemaining) {
        // This beat slot fits within the current soundbite
        srcOut = srcIn + slotDuration
        sbConsumedSeconds += slotDuration
      } else {
        // Consume the rest of the soundbite, pad with next if needed (keep it simple: just use what's left)
        srcOut = sb.end_time
        sbIndex++
        sbConsumedSeconds = 0
      }
      assetId = input.primaryAssetId
    } else {
      // No soundbites — slice the primary asset sequentially
      srcIn = fallbackCursor
      srcOut = Math.min(srcIn + slotDuration, input.primaryDurationSeconds)
      fallbackCursor = srcOut >= input.primaryDurationSeconds ? 0 : srcOut // wrap around
      assetId = input.primaryAssetId
    }

    const clipId = `mv-clip-${i}`
    videoClips.push({
      id: clipId,
      role: 'a-roll',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcOut,
      timelineInSeconds: timelineIn,
      timelineOutSeconds: timelineOut,
      soundbiteId: soundbites[sbIndex % soundbites.length]?.id,
      metadata: { builder: 'music-video-v1', beatIndex: i, beatsPerCut: n }
    })
    audioClips.push({
      id: `${clipId}-audio`,
      role: 'nat-audio',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcOut,
      timelineInSeconds: timelineIn,
      timelineOutSeconds: timelineOut,
      metadata: { builder: 'music-video-v1', beatIndex: i, beatsPerCut: n }
    })
  }

  const totalDuration = cutPoints[cutPoints.length - 1] ?? 0

  const videoTracks: TimelineTrack[] = [{ id: 'v1', name: 'Video', clips: videoClips }]
  const audioTracks: TimelineTrack[] = [{ id: 'a1', name: 'Audio', clips: audioClips }]

  // Music track — a single clip spanning the full timeline
  if (input.musicAssetId) {
    const musicDur = input.musicDurationSeconds ?? totalDuration
    audioTracks.push({
      id: 'a-music',
      name: 'Music',
      clips: [{
        id: 'mv-music-track',
        role: 'music',
        assetId: input.musicAssetId,
        sourceInSeconds: 0,
        sourceOutSeconds: musicDur,
        timelineInSeconds: 0,
        timelineOutSeconds: totalDuration,
        metadata: { builder: 'music-video-v1' }
      }]
    })
  }

  return {
    id: `seq-${input.projectId}`,
    projectId: input.projectId,
    mode: 'music_video',
    format: input.format,
    durationSeconds: totalDuration,
    videoTracks,
    audioTracks,
    textTracks: [{ id: 't1', name: 'Titles', clips: [] }],
    markers: beats.map((t, idx) => ({
      id: `beat-${idx}`,
      label: idx % n === 0 ? `Cut` : `Beat`,
      timeSeconds: t,
      color: idx % n === 0 ? '#a855f7' : '#6b21a8',
      metadata: { beatIndex: idx, isCutPoint: idx % n === 0 }
    })),
    metadata: {
      builder: 'music-video-v1',
      bpm: beats.length > 1
        ? Math.round(((beats.length - 1) / (beats[beats.length - 1]! - beats[0]!)) * 60 * 10) / 10
        : 0,
      beatsPerCut: n,
      totalBeats: beats.length,
      cutCount: cutPoints.length - 1
    }
  }
}

// ---------------------------------------------------------------------------
// Journalism package builder
// ---------------------------------------------------------------------------

export interface JournalismAssetInput {
  asset: Pick<Asset, 'id' | 'asset_type' | 'duration_seconds' | 'original_filename'>
  clipRole: JournalismClipRole
  /**
   * Top soundbite candidates for this asset (SOT clips).
   * When provided the builder uses the best-scoring bites instead of the
   * full clip, keeping SOTs tight for broadcast length.
   */
  soundbites?: Pick<SoundbiteCandidate, 'id' | 'start_time' | 'end_time' | 'transcript_text'>[]
}

export interface JournalismPackageInput {
  projectId: string
  format: ProjectFormat
  assets: JournalismAssetInput[]
  /** Soft cap on the assembled package — clips will be trimmed to fit. Default: none. */
  targetDurationSeconds?: number
  /**
   * Max seconds taken from any single SOT clip when soundbites are absent.
   * Default: 20 s — long enough for a good quote, short enough for broadcast.
   */
  maxSotSeconds?: number
}

/**
 * Assemble a broadcast-style news package from field footage with assigned
 * clip roles.
 *
 * Layout produced:
 *   V1 (a-roll)  : [anchor intro?] → [standup open] → SOT clips → [standup close?]
 *   V2 (b-roll)  : B-roll clips covering the VO / nat-sound sections
 *   A1 (nat-audio): mirrors V1 clips
 *   A2 (VO)      : voiceover + nat-sound clips placed after V1 ends
 *
 * The journalist can then rearrange on the full timeline editor.
 */
export function buildJournalismPackage(input: JournalismPackageInput): TimelineSequence {
  const MAX_SOT = input.maxSotSeconds ?? 20
  const TARGET = input.targetDurationSeconds ?? Infinity

  // Partition by role
  const byRole: Record<JournalismClipRole, JournalismAssetInput[]> = {
    anchor: [],
    standup: [],
    sot: [],
    broll: [],
    voiceover: [],
    'nat-sound': [],
    unassigned: []
  }
  for (const a of input.assets) {
    const key = a.clipRole in byRole ? a.clipRole : 'unassigned'
    byRole[key].push(a)
  }

  // Standup: first = open, last = close (same clip if only one)
  const standupOpen = byRole.standup[0] ?? null
  const standupClose =
    byRole.standup.length > 1 ? byRole.standup[byRole.standup.length - 1] : null

  // Build the main a-roll sequence
  const v1Clips: TimelineClip[] = []
  const a1Clips: TimelineClip[] = []
  let cursor = 0

  function pushAroll(assetId: string, srcIn: number, srcOut: number, label: string): void {
    if (TARGET !== Infinity && cursor >= TARGET) return
    const dur = Math.min(srcOut - srcIn, TARGET === Infinity ? Infinity : TARGET - cursor)
    if (dur <= 0) return
    const id = `jn-v-${label}-${assetId}`
    v1Clips.push({
      id,
      role: 'a-roll',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcIn + dur,
      timelineInSeconds: cursor,
      timelineOutSeconds: cursor + dur,
      metadata: { journalismRole: label }
    })
    a1Clips.push({
      id: `${id}-audio`,
      role: 'nat-audio',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcIn + dur,
      timelineInSeconds: cursor,
      timelineOutSeconds: cursor + dur,
      metadata: { journalismRole: label }
    })
    cursor += dur
  }

  // Anchor intro (optional)
  for (const a of byRole.anchor) {
    const dur = Math.min(a.asset.duration_seconds ?? 15, 15)
    pushAroll(a.asset.id, 0, dur, 'anchor-intro')
  }

  // Standup open
  if (standupOpen) {
    const dur = Math.min(standupOpen.asset.duration_seconds ?? 20, 30)
    pushAroll(standupOpen.asset.id, 0, dur, 'standup-open')
  }

  // SOT clips — use top soundbites when available, otherwise head of clip
  for (const sot of byRole.sot) {
    const soundbites = sot.soundbites ?? []
    if (soundbites.length > 0) {
      // Use the first (highest-ranked) soundbite
      const best = soundbites[0]!
      pushAroll(sot.asset.id, best.start_time, Math.min(best.end_time, best.start_time + MAX_SOT), `sot-${sot.asset.id}`)
    } else {
      const dur = Math.min(sot.asset.duration_seconds ?? MAX_SOT, MAX_SOT)
      pushAroll(sot.asset.id, 0, dur, `sot-${sot.asset.id}`)
    }
  }

  // Standup close (only when it's a different clip from the open)
  if (standupClose && standupClose.asset.id !== standupOpen?.asset.id) {
    const dur = Math.min(standupClose.asset.duration_seconds ?? 20, 30)
    pushAroll(standupClose.asset.id, 0, dur, 'standup-close')
  }

  // VO + Nat-sound on A2 — placed after the main a-roll
  const a2Clips: TimelineClip[] = []
  let audioCursor = cursor
  const audioRollAssets = [...byRole.voiceover, ...byRole['nat-sound']]
  for (const vo of audioRollAssets) {
    const dur = vo.asset.duration_seconds ?? 30
    const role = vo.clipRole === 'voiceover' ? 'nat-audio' : 'nat-audio'
    a2Clips.push({
      id: `jn-a2-${vo.clipRole}-${vo.asset.id}`,
      role,
      assetId: vo.asset.id,
      sourceInSeconds: 0,
      sourceOutSeconds: dur,
      timelineInSeconds: audioCursor,
      timelineOutSeconds: audioCursor + dur,
      metadata: { journalismRole: vo.clipRole }
    })
    audioCursor += dur
  }

  // B-roll clips on V2, timed to cover the VO section
  const v2Clips: TimelineClip[] = []
  let brollCursor = cursor // starts where V1 ends
  for (const br of byRole.broll) {
    const dur = br.asset.duration_seconds ?? 8
    v2Clips.push({
      id: `jn-v2-broll-${br.asset.id}`,
      role: 'b-roll',
      assetId: br.asset.id,
      sourceInSeconds: 0,
      sourceOutSeconds: dur,
      timelineInSeconds: brollCursor,
      timelineOutSeconds: brollCursor + dur,
      metadata: { journalismRole: 'broll' }
    })
    brollCursor += dur
  }

  // Unassigned clips appended to V1 at end
  for (const u of byRole.unassigned) {
    const dur = Math.min(u.asset.duration_seconds ?? 10, 20)
    pushAroll(u.asset.id, 0, dur, `unassigned-${u.asset.id}`)
  }

  const totalDuration = Math.max(cursor, audioCursor, brollCursor)

  const videoTrack: TimelineTrack = { id: 'v1', name: 'A-Roll', clips: v1Clips }
  const audioTrack: TimelineTrack = { id: 'a1', name: 'Audio', clips: a1Clips }

  const videoTracks: TimelineTrack[] = [videoTrack]
  const audioTracks: TimelineTrack[] = [audioTrack]

  if (v2Clips.length > 0) {
    videoTracks.push({ id: 'v2', name: 'B-Roll', clips: v2Clips })
  }
  if (a2Clips.length > 0) {
    audioTracks.push({ id: 'a2', name: 'Voiceover', clips: a2Clips })
  }

  return {
    id: `seq-${input.projectId}`,
    projectId: input.projectId,
    mode: 'journalism',
    format: input.format,
    durationSeconds: totalDuration,
    videoTracks,
    audioTracks,
    textTracks: [{ id: 't1', name: 'Titles', clips: [] }],
    markers: [],
    metadata: {
      builder: 'journalism-package-v1',
      sotCount: byRole.sot.length,
      standupCount: byRole.standup.length,
      brollCount: byRole.broll.length,
      voiceoverCount: byRole.voiceover.length
    }
  }
}

// ---------------------------------------------------------------------------
// Creator cut builder
// ---------------------------------------------------------------------------

export interface CreatorAssetInput {
  asset: Pick<Asset, 'id' | 'asset_type' | 'duration_seconds' | 'original_filename'>
  clipRole: CreatorClipRole
  /**
   * Top soundbite candidates for this asset (hero / testimonial clips).
   * When provided the builder uses the best-scoring bite to keep the cut tight.
   */
  soundbites?: Pick<SoundbiteCandidate, 'id' | 'start_time' | 'end_time' | 'transcript_text'>[]
}

export interface CreatorCutInput {
  projectId: string
  format: ProjectFormat
  assets: CreatorAssetInput[]
  /**
   * Short-form targets ≤ 90 s and takes only the best soundbite per hero clip.
   * Long-form uses the full hero clip duration with no cap.
   * Defaults to 'long'.
   */
  targetFormat?: 'short' | 'long'
  /** Soft cap in seconds (honored for short-form only). Default: 90 s. */
  targetDurationSeconds?: number
  /** Max seconds taken from any single hero clip when soundbites are absent. Default: 60 s. */
  maxHeroSeconds?: number
  /**
   * When false, transition-role clips are excluded from the B-roll track.
   * Defaults to true for backward compatibility.
   */
  brollTransitionsEnabled?: boolean
}

/**
 * Assemble a creator-ready cut from tagged footage.
 *
 * Layout produced:
 *   V1 (a-roll)  : [hook] → hero clips → testimonials → [recap]
 *   V2 (b-roll)  : B-roll clips intercut across the full V1 + transition clips
 *   A1 (nat-audio): mirrors V1
 */
export function buildCreatorCut(input: CreatorCutInput): TimelineSequence {
  const isShort = input.targetFormat === 'short'
  const TARGET = isShort ? (input.targetDurationSeconds ?? 90) : Infinity
  const MAX_HERO = input.maxHeroSeconds ?? 60
  const includeTransitions = input.brollTransitionsEnabled !== false

  // Partition by role
  const byRole: Record<CreatorClipRole, CreatorAssetInput[]> = {
    hook: [],
    hero: [],
    broll: [],
    testimonial: [],
    recap: [],
    transition: [],
    unassigned: []
  }
  for (const a of input.assets) {
    const key = a.clipRole in byRole ? a.clipRole : 'unassigned'
    byRole[key].push(a)
  }

  const v1Clips: TimelineClip[] = []
  const a1Clips: TimelineClip[] = []
  let cursor = 0

  function pushAroll(assetId: string, srcIn: number, srcOut: number, label: string): void {
    if (TARGET !== Infinity && cursor >= TARGET) return
    const dur = Math.min(srcOut - srcIn, TARGET === Infinity ? Infinity : TARGET - cursor)
    if (dur <= 0) return
    const id = `cr-v-${label}-${assetId}`
    v1Clips.push({
      id,
      role: 'a-roll',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcIn + dur,
      timelineInSeconds: cursor,
      timelineOutSeconds: cursor + dur,
      metadata: { creatorRole: label }
    })
    a1Clips.push({
      id: `${id}-audio`,
      role: 'nat-audio',
      assetId,
      sourceInSeconds: srcIn,
      sourceOutSeconds: srcIn + dur,
      timelineInSeconds: cursor,
      timelineOutSeconds: cursor + dur,
      metadata: { creatorRole: label }
    })
    cursor += dur
  }

  // 1. Hook — first tagged hook clip (or first few seconds if multiple)
  for (const h of byRole.hook) {
    const dur = Math.min(h.asset.duration_seconds ?? 5, isShort ? 8 : 15)
    pushAroll(h.asset.id, 0, dur, 'hook')
  }

  // 2. Hero clips — use best soundbite in short mode, full clip in long mode
  for (const h of byRole.hero) {
    const soundbites = h.soundbites ?? []
    if (isShort && soundbites.length > 0) {
      const best = soundbites[0]!
      const dur = Math.min(best.end_time - best.start_time, TARGET === Infinity ? MAX_HERO : TARGET - cursor)
      pushAroll(h.asset.id, best.start_time, best.start_time + dur, `hero-${h.asset.id}`)
    } else {
      const dur = Math.min(h.asset.duration_seconds ?? MAX_HERO, MAX_HERO)
      pushAroll(h.asset.id, 0, dur, `hero-${h.asset.id}`)
    }
  }

  // 3. Testimonials
  for (const t of byRole.testimonial) {
    const soundbites = t.soundbites ?? []
    if (soundbites.length > 0) {
      const best = soundbites[0]!
      pushAroll(t.asset.id, best.start_time, best.end_time, `testimonial-${t.asset.id}`)
    } else {
      const dur = Math.min(t.asset.duration_seconds ?? 30, 45)
      pushAroll(t.asset.id, 0, dur, `testimonial-${t.asset.id}`)
    }
  }

  // 4. Recap / CTA
  for (const r of byRole.recap) {
    const dur = Math.min(r.asset.duration_seconds ?? 15, isShort ? 20 : 60)
    pushAroll(r.asset.id, 0, dur, 'recap')
  }

  // 5. Unassigned appended at end
  for (const u of byRole.unassigned) {
    const dur = Math.min(u.asset.duration_seconds ?? 15, 30)
    pushAroll(u.asset.id, 0, dur, `unassigned-${u.asset.id}`)
  }

  // B-roll on V2, spread across the full V1 a-roll span
  const v2Clips: TimelineClip[] = []
  let brollCursor = 0
  const brollAssets = includeTransitions
    ? [...byRole.broll, ...byRole.transition]
    : [...byRole.broll]
  for (const br of brollAssets) {
    const dur = br.asset.duration_seconds ?? 8
    v2Clips.push({
      id: `cr-v2-${br.clipRole}-${br.asset.id}`,
      role: 'b-roll',
      assetId: br.asset.id,
      sourceInSeconds: 0,
      sourceOutSeconds: dur,
      timelineInSeconds: brollCursor,
      timelineOutSeconds: brollCursor + dur,
      metadata: { creatorRole: br.clipRole }
    })
    brollCursor += dur
  }

  const totalDuration = Math.max(cursor, brollCursor)

  const videoTracks: TimelineTrack[] = [{ id: 'v1', name: 'A-Roll', clips: v1Clips }]
  const audioTracks: TimelineTrack[] = [{ id: 'a1', name: 'Audio', clips: a1Clips }]

  if (v2Clips.length > 0) {
    videoTracks.push({ id: 'v2', name: 'B-Roll', clips: v2Clips })
  }

  return {
    id: `seq-${input.projectId}`,
    projectId: input.projectId,
    mode: 'creator',
    format: input.format,
    durationSeconds: totalDuration,
    videoTracks,
    audioTracks,
    textTracks: [{ id: 't1', name: 'Titles', clips: [] }],
    markers: [],
    metadata: {
      builder: 'creator-cut-v1',
      targetFormat: input.targetFormat ?? 'long',
      hookCount: byRole.hook.length,
      heroCount: byRole.hero.length,
      brollCount: byRole.broll.length,
      testimonialCount: byRole.testimonial.length,
      recapCount: byRole.recap.length
    }
  }
}
