import { describe, it, expect } from 'vitest'
import { exportForNle } from '../src/nle/index.js'
import { buildExportSummary, formatExportSummaryText } from '../src/nle/export-summary.js'
import {
  FIXED_GENERATED_AT,
  GOLDEN_SCENARIOS,
  interviewWithLayersScenario
} from './golden-fixtures.js'

function normalizeManifest(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== 'object') return manifest
  return {
    ...(manifest as Record<string, unknown>),
    generatedAt: FIXED_GENERATED_AT
  }
}

function normalizeFcpxml(xml: string): string {
  return xml.replace(/\r\n/g, '\n').trim()
}

describe('golden NLE export — Final Cut rough cut', () => {
  for (const scenario of GOLDEN_SCENARIOS) {
    it(`${scenario.id} — fcpxml + manifest snapshot`, () => {
      const pkg = exportForNle('final-cut-pro', {
        projectTitle: scenario.projectTitle,
        sequence: scenario.sequence,
        assetPathsById: scenario.assetPathsById,
        assets: scenario.assets,
        textOverlayRefs: scenario.textOverlayRefs
      })

      const fcpxml = normalizeFcpxml(pkg.primaryTimeline.content)
      const manifest = normalizeManifest(pkg.manifest)

      expect(fcpxml).toMatchSnapshot(`${scenario.id} fcpxml`)
      expect(manifest).toMatchSnapshot(`${scenario.id} manifest`)
    })
  }
})

describe('export summary — editorial contract messaging', () => {
  it('reports included vs excluded layers for interview with b-roll', () => {
    const scenario = interviewWithLayersScenario()
    const summary = buildExportSummary({
      sequence: scenario.sequence,
      assetPathsById: scenario.assetPathsById,
      targetNle: 'final-cut-pro',
      manifest: {
        version: 1,
        targetNle: 'final-cut-pro',
        manifestSchemaVersion: 1,
        projectId: scenario.sequence.projectId,
        sequenceId: scenario.sequence.id,
        generatedAt: FIXED_GENERATED_AT,
        assets: [],
        tracks: [],
        clips: [],
        textOverlayRefs: [],
        markers: []
      },
      projectTitle: scenario.projectTitle,
      generatedAt: FIXED_GENERATED_AT
    })

    expect(summary.included.aRollClips).toBeGreaterThan(0)
    expect(summary.excluded.bRollClips).toBe(1)
    expect(summary.excluded.titleOverlays).toBeGreaterThan(0)
    expect(summary.excluded.soundEffectPlacements).toBe(1)

    const text = formatExportSummaryText(summary)
    expect(text).toContain('Final Cut Pro — Rough Cut Export (Beta)')
    expect(text).toContain('Not included in interchange timeline:')
    expect(text).toMatchSnapshot('interview-layers export-summary')
  })
})

describe('editorial accuracy invariants', () => {
  it('timeline duration and clip order preserved in fcpxml spine', () => {
    const scenario = GOLDEN_SCENARIOS.find((s) => s.id === 'interview-cuts')!
    const pkg = exportForNle('final-cut-pro', {
      projectTitle: scenario.projectTitle,
      sequence: scenario.sequence,
      assetPathsById: scenario.assetPathsById,
      assets: scenario.assets,
      textOverlayRefs: []
    })

    const spineBody = pkg.primaryTimeline.content.match(/<spine>([\s\S]*?)<\/spine>/)?.[1] ?? ''
    const spineClips = scenario.sequence.videoTracks[0]!.clips.filter((c) => c.role !== 'pause-gap')
    const assetClipMatches = [...spineBody.matchAll(/<asset-clip\b/g)]
    expect(assetClipMatches.length).toBe(spineClips.length)

    const durationMatch = pkg.primaryTimeline.content.match(/<sequence\b[^>]*\bduration="([^"]+)"/)
    expect(durationMatch).toBeTruthy()
  })
})
