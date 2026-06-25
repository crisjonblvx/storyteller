import type { Asset } from '@storyteller/shared'
import type { TimelineClip, TimelineSequence } from '@storyteller/timeline'
import type { NleTarget, XmlManifestClipRef, XmlPackageManifest } from '../xml/types.js'
import type { NleExportInput } from './shared-input.js'
import { buildSfxNleTracks, sfxTrackGroupsToManifestTracks, sfxClipsToManifestClipRefs } from './audio-director-nle.js'

function kindForAsset(t: string): 'video' | 'audio' | 'image' {
  if (t === 'audio') return 'audio'
  if (t === 'photo' || t === 'image') return 'image'
  return 'video'
}

function collectClipRefs(sequence: TimelineSequence): XmlManifestClipRef[] {
  const out: XmlManifestClipRef[] = []

  const pushTrack = (kind: 'video' | 'audio' | 'text', track: { id: string; clips: TimelineClip[] }) => {
    for (const c of track.clips) {
      const meta = (c.metadata ?? {}) as { soundbiteId?: string; introRole?: string }
      const sb =
        typeof c.soundbiteId === 'string'
          ? c.soundbiteId
          : typeof meta.soundbiteId === 'string'
            ? meta.soundbiteId
            : undefined
      const introRole = typeof meta.introRole === 'string' ? meta.introRole : undefined
      out.push({
        id: c.id,
        trackId: track.id,
        trackKind: kind,
        role: c.role,
        assetId: c.assetId,
        sourceInSeconds: c.sourceInSeconds,
        sourceOutSeconds: c.sourceOutSeconds,
        timelineInSeconds: c.timelineInSeconds,
        timelineOutSeconds: c.timelineOutSeconds,
        transcriptSegmentIds: c.transcriptSegmentIds,
        soundbiteId: sb,
        introRole
      })
    }
  }

  for (const t of sequence.videoTracks) pushTrack('video', t)
  for (const t of sequence.audioTracks) pushTrack('audio', t)
  for (const t of sequence.textTracks) {
    for (const c of t.clips) {
      const meta = (c.metadata ?? {}) as { textEventId?: string }
      out.push({
        id: c.id,
        trackId: t.id,
        trackKind: 'text',
        role: c.role,
        assetId: c.assetId,
        sourceInSeconds: c.sourceInSeconds,
        sourceOutSeconds: c.sourceOutSeconds,
        timelineInSeconds: c.timelineInSeconds,
        timelineOutSeconds: c.timelineOutSeconds,
        textEventId: typeof meta.textEventId === 'string' ? meta.textEventId : undefined
      })
    }
  }

  return out
}

export function buildXmlPackageManifest(params: {
  sequence: TimelineSequence
  assets: Pick<Asset, 'id' | 'local_path' | 'storage_path' | 'asset_type'>[]
  textOverlayRefs: XmlPackageManifest['textOverlayRefs']
  targetNle: NleTarget
  soundDesign?: NleExportInput['soundDesign']
}): XmlPackageManifest {
  const { sequence, assets, textOverlayRefs, targetNle, soundDesign } = params
  const clips = collectClipRefs(sequence)

  const sfxGroups = soundDesign
    ? buildSfxNleTracks({
        slots: soundDesign.slots,
        resolutions: soundDesign.resolutions,
        audioDna: soundDesign.audioDna,
        assetNamesById: soundDesign.assetNamesById,
      })
    : []

  return {
    version: 1,
    targetNle,
    manifestSchemaVersion: 1,
    projectId: sequence.projectId,
    sequenceId: sequence.id,
    generatedAt: new Date().toISOString(),
    assets: assets.map((a) => ({
      id: a.id,
      storagePath: a.storage_path,
      localPath: a.local_path,
      kind: kindForAsset(a.asset_type)
    })),
    tracks: [
      ...sequence.videoTracks.map((t) => ({ id: t.id, name: t.name, kind: 'video' as const, clipCount: t.clips.length })),
      ...sequence.audioTracks.map((t) => ({ id: t.id, name: t.name, kind: 'audio' as const, clipCount: t.clips.length })),
      ...sequence.textTracks.map((t) => ({ id: t.id, name: t.name, kind: 'text' as const, clipCount: t.clips.length })),
      ...sfxTrackGroupsToManifestTracks(sfxGroups),
    ],
    clips: [...clips, ...sfxClipsToManifestClipRefs(sfxGroups)],
    textOverlayRefs,
    markers: sequence.markers.map((m) => ({
      id: m.id,
      label: m.label,
      timeSeconds: m.timeSeconds,
      color: m.color
    }))
  }
}
