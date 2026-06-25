import type { ProjectFormat } from '@storyteller/shared'
import type { TimelineClip, TimelineMarker, TimelineSequence } from '@storyteller/timeline'
import { buildRoughCutSequence } from '@storyteller/timeline'
import type { NleExportInput } from '../src/nle/shared-input.js'

export const FIXED_GENERATED_AT = '2026-06-25T12:00:00.000Z'

const BASE_FORMAT: ProjectFormat = {
  aspectRatio: '16:9',
  workingResolution: { width: 1920, height: 1080 },
  exportResolution: { width: 1920, height: 1080 },
  fps: 30
}

export const PRIMARY_ASSET_ID = 'asset-primary-001'
export const SECONDARY_ASSET_ID = 'asset-secondary-002'

function fileUri(path: string): string {
  const n = path.replace(/\\/g, '/')
  const body = n.startsWith('/') ? n.slice(1) : n
  return `file:///${body.split('/').map(encodeURIComponent).join('/')}`
}

export function baseAssets() {
  return [
    {
      id: PRIMARY_ASSET_ID,
      local_path: '/Volumes/Media/interview-a-roll.mov',
      storage_path: 'projects/demo/interview-a-roll.mov',
      asset_type: 'video' as const,
      width: 1920,
      height: 1080,
      fps: 30,
      duration_seconds: 3600,
      original_filename: 'interview-a-roll.mov',
      clip_role: null,
      creator_clip_role: null,
      metadata_json: null
    },
    {
      id: SECONDARY_ASSET_ID,
      local_path: '/Volumes/Media/broll-cutaway.mov',
      storage_path: 'projects/demo/broll-cutaway.mov',
      asset_type: 'video' as const,
      width: 1920,
      height: 1080,
      fps: 30,
      duration_seconds: 120,
      original_filename: 'broll-cutaway.mov',
      clip_role: null,
      creator_clip_role: null,
      metadata_json: null
    }
  ]
}

export function baseAssetPaths(): Record<string, string> {
  return {
    [PRIMARY_ASSET_ID]: fileUri('/Volumes/Media/interview-a-roll.mov'),
    [SECONDARY_ASSET_ID]: fileUri('/Volumes/Media/broll-cutaway.mov')
  }
}

function singleClipSequence(): TimelineSequence {
  const clip: TimelineClip = {
    id: 'clip-single',
    role: 'a-roll',
    assetId: PRIMARY_ASSET_ID,
    sourceInSeconds: 10,
    sourceOutSeconds: 25,
    timelineInSeconds: 0,
    timelineOutSeconds: 15
  }
  return {
    id: 'seq-single',
    projectId: 'proj-single',
    mode: 'story',
    format: BASE_FORMAT,
    durationSeconds: 15,
    videoTracks: [{ id: 'v1', name: 'Video 1', clips: [clip] }],
    audioTracks: [{ id: 'a1', name: 'Audio 1', clips: [] }],
    textTracks: [{ id: 't1', name: 'Titles', clips: [] }],
    markers: [],
    metadata: { builder: 'test-fixture' }
  }
}

function interviewCutsSequence(): TimelineSequence {
  return buildRoughCutSequence({
    projectId: 'proj-interview',
    mode: 'story',
    format: BASE_FORMAT,
    primaryAssetId: PRIMARY_ASSET_ID,
    soundbites: [
      { id: 'sb-1', start_time: 12, end_time: 28, transcript_text: 'Opening hook.' },
      { id: 'sb-2', start_time: 45, end_time: 72, transcript_text: 'Middle beat.' },
      { id: 'sb-3', start_time: 120, end_time: 148, transcript_text: 'Closing thought.' }
    ],
    silenceRegions: []
  })
}

function withMarkers(sequence: TimelineSequence, markers: TimelineMarker[]): TimelineSequence {
  return { ...sequence, markers }
}

function withBroll(sequence: TimelineSequence): TimelineSequence {
  const brollClip: TimelineClip = {
    id: 'clip-broll-1',
    role: 'b-roll',
    assetId: SECONDARY_ASSET_ID,
    sourceInSeconds: 0,
    sourceOutSeconds: 4,
    timelineInSeconds: 5,
    timelineOutSeconds: 9
  }
  return {
    ...sequence,
    videoTracks: [
      ...sequence.videoTracks,
      { id: 'v-broll', name: 'B-roll', clips: [brollClip] }
    ],
    overlayEvents: [
      {
        id: 'overlay-1',
        kind: 'text',
        timelineInSeconds: 2,
        timelineOutSeconds: 5,
        content: 'Debt free'
      }
    ],
    soundDesignSlots: [
      {
        id: 'sfx-1',
        projectId: sequence.projectId,
        tags: [],
        timelineStart: 1,
        timelineEnd: 3,
        intensity: 0.5,
        category: 'impact',
        status: 'accepted'
      }
    ]
  }
}

function longFormSequence(): TimelineSequence {
  const soundbites = Array.from({ length: 24 }, (_, i) => ({
    id: `sb-long-${i + 1}`,
    start_time: i * 120,
    end_time: i * 120 + 45,
    transcript_text: `Segment ${i + 1}`
  }))
  return buildRoughCutSequence({
    projectId: 'proj-podcast',
    mode: 'journalism',
    format: BASE_FORMAT,
    primaryAssetId: PRIMARY_ASSET_ID,
    soundbites,
    silenceRegions: []
  })
}

export type GoldenScenario = {
  id: string
  projectTitle: string
  sequence: TimelineSequence
  assetPathsById: Record<string, string>
  assets: NleExportInput['assets']
  textOverlayRefs: NleExportInput['textOverlayRefs']
}

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'single-clip',
    projectTitle: 'Single Clip',
    sequence: singleClipSequence(),
    assetPathsById: baseAssetPaths(),
    assets: baseAssets(),
    textOverlayRefs: []
  },
  {
    id: 'interview-cuts',
    projectTitle: 'Interview Cuts',
    sequence: interviewCutsSequence(),
    assetPathsById: baseAssetPaths(),
    assets: baseAssets(),
    textOverlayRefs: []
  },
  {
    id: 'interview-markers',
    projectTitle: 'Interview Markers',
    sequence: withMarkers(interviewCutsSequence(), [
      { id: 'm1', label: 'Cold open', timeSeconds: 1, color: 'blue' },
      { id: 'm2', label: 'Payoff', timeSeconds: 20, color: 'green' }
    ]),
    assetPathsById: baseAssetPaths(),
    assets: baseAssets(),
    textOverlayRefs: []
  },
  {
    id: 'interview-missing-media',
    projectTitle: 'Interview Missing Media',
    sequence: interviewCutsSequence(),
    assetPathsById: { ...baseAssetPaths(), [PRIMARY_ASSET_ID]: 'MISSING_MEDIA' },
    assets: baseAssets(),
    textOverlayRefs: []
  },
  {
    id: 'interview-cloud-assets',
    projectTitle: 'Interview Cloud Assets',
    sequence: interviewCutsSequence(),
    assetPathsById: {
      ...baseAssetPaths(),
      [PRIMARY_ASSET_ID]: 'file:///StorytellerRelink/projects/demo/interview-a-roll.mov'
    },
    assets: baseAssets(),
    textOverlayRefs: []
  },
  {
    id: 'long-form-podcast',
    projectTitle: 'Long Form Podcast',
    sequence: longFormSequence(),
    assetPathsById: baseAssetPaths(),
    assets: baseAssets(),
    textOverlayRefs: []
  }
]

/** Scenario with overlays for export-summary counts (not a separate golden file). */
export function interviewWithLayersScenario(): GoldenScenario {
  return {
    id: 'interview-layers-summary',
    projectTitle: 'Interview Layers',
    sequence: withBroll(interviewCutsSequence()),
    assetPathsById: baseAssetPaths(),
    assets: baseAssets(),
    textOverlayRefs: [{ id: 'ref-1', textEventId: 'evt-1', timelineInSeconds: 2, timelineOutSeconds: 5 }]
  }
}
