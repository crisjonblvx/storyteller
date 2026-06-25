import { describe, it, expect } from 'vitest'
import {
  normalizeAudioDirectorResponse,
  generateAudioDirectorFallback
} from '../src/openai-audio-director.js'
import { AUDIO_DNA } from '../src/audio-dna.js'

const PROJECT_ID = 'test-project'

const SHORT_SEGMENTS = [
  { id: 'seg-1', text: 'The market crashed overnight.', start_time: 0, end_time: 4.2 },
  { id: 'seg-2', text: 'I remember sitting at my kitchen table.', start_time: 4.2, end_time: 8.1 }
]

const OFFICE_SEGMENTS = [
  { id: 'seg-1', text: 'We were working late in the office.', start_time: 0, end_time: 5.0 },
  { id: 'seg-2', text: 'The meeting had gone on for hours.', start_time: 5.0, end_time: 10.0 }
]

const NEUTRAL_SEGMENTS = [
  { id: 'seg-1', text: 'She talked about her experience.', start_time: 0, end_time: 4.0 },
  { id: 'seg-2', text: 'It was a meaningful conversation.', start_time: 4.0, end_time: 8.0 }
]

describe('generateAudioDirectorFallback', () => {
  it('conservative slot counts — returns <= 8 slots for a short transcript', () => {
    const result = generateAudioDirectorFallback(
      PROJECT_ID,
      AUDIO_DNA.netflix_documentary,
      SHORT_SEGMENTS,
      30
    )
    expect(result.slots.length, `Expected <= 8 slots, got ${result.slots.length}`).toBeLessThanOrEqual(8)
  })

  it('location detection — suggests ambient slot when segments mention office', () => {
    const result = generateAudioDirectorFallback(
      PROJECT_ID,
      AUDIO_DNA.netflix_documentary,
      OFFICE_SEGMENTS,
      10
    )
    const ambientSlots = result.slots.filter(s => s.category === 'ambient')
    expect(ambientSlots.length, 'Expected at least one ambient slot for office context').toBeGreaterThanOrEqual(1)
  })

  it('no false positives — neutral segments produce no ambient slots', () => {
    const result = generateAudioDirectorFallback(
      PROJECT_ID,
      AUDIO_DNA.netflix_documentary,
      NEUTRAL_SEGMENTS,
      8
    )
    const ambientSlots = result.slots.filter(s => s.category === 'ambient')
    expect(ambientSlots.length, 'Expected zero ambient slots for neutral segments').toBe(0)
  })
})

describe('normalizeAudioDirectorResponse', () => {
  it('valid slots — IDs are set, status is suggested, intensity is within range', () => {
    const raw = {
      slots: [
        {
          category: 'ambient',
          tags: ['office', 'hvac'],
          transcriptKeywords: ['office'],
          linkedSegmentIds: ['seg-1'],
          timelineStart: 0.0,
          timelineEnd: 10.0,
          intensity: 0.6,
          reason: 'The speaker is in an office and the ambient bed grounds the scene.'
        }
      ],
      timingNotes: []
    }
    const { slots } = normalizeAudioDirectorResponse(raw, PROJECT_ID)
    expect(slots.length).toBe(1)
    const slot = slots[0]
    expect(typeof slot.id === 'string' && slot.id.length > 0, 'id should be a non-empty string').toBeTruthy()
    expect(slot.status).toBe('suggested')
    expect(slot.projectId).toBe(PROJECT_ID)
    expect(slot.intensity, 'intensity must be in [0, 1]').toBeGreaterThanOrEqual(0)
    expect(slot.intensity, 'intensity must be in [0, 1]').toBeLessThanOrEqual(1)
  })

  it('bad category — drops slots with invalid category', () => {
    const raw = {
      slots: [
        {
          category: 'music',
          tags: ['background'],
          timelineStart: 0.0,
          timelineEnd: 5.0,
          intensity: 0.5,
          reason: 'Some music here.'
        }
      ],
      timingNotes: []
    }
    const { slots } = normalizeAudioDirectorResponse(raw, PROJECT_ID)
    expect(slots.length, 'Slot with invalid category should be dropped').toBe(0)
  })

  it('intensity clamped — intensity: 1.5 comes back as 1.0 when no DNA ceiling', () => {
    const raw = {
      slots: [
        {
          category: 'movement',
          tags: ['foley'],
          timelineStart: 2.0,
          timelineEnd: 3.0,
          intensity: 1.5,
          reason: 'Physical movement implied by the action.'
        }
      ],
      timingNotes: []
    }
    const { slots } = normalizeAudioDirectorResponse(raw, PROJECT_ID)
    expect(slots.length).toBe(1)
    expect(slots[0].intensity, 'Intensity 1.5 should be clamped to 1.0').toBe(1.0)
  })

  it('bad timing note — drops notes with invalid noteType', () => {
    const raw = {
      slots: [],
      timingNotes: [
        {
          transcriptSegmentId: 'seg-1',
          anchorWord: 'crashed',
          noteType: 'random',
          framesAdjustment: 4,
          sfxCategory: 'impact',
          rationale: 'Hold before the word crashed for dramatic effect.'
        }
      ]
    }
    const { timingNotes } = normalizeAudioDirectorResponse(raw, PROJECT_ID)
    expect(timingNotes.length, 'Timing note with invalid noteType should be dropped').toBe(0)
  })

  it('framesAdjustment clamped — value 100 clamps to 12', () => {
    const raw = {
      slots: [],
      timingNotes: [
        {
          transcriptSegmentId: 'seg-1',
          anchorWord: 'crashed',
          noteType: 'cut-on-word',
          framesAdjustment: 100,
          sfxCategory: 'impact',
          rationale: 'Cut on the word crashed for emphasis.'
        }
      ]
    }
    const { timingNotes } = normalizeAudioDirectorResponse(raw, PROJECT_ID)
    expect(timingNotes.length).toBe(1)
    expect(timingNotes[0].framesAdjustment, 'framesAdjustment 100 should clamp to 12').toBe(12)
  })

  it('DNA intensity ceiling — podcast boomIntensity=0 clamps impact intensity to 0', () => {
    const podcastDna = AUDIO_DNA.podcast
    expect(podcastDna.boomIntensity, 'podcast boomIntensity must be 0 for this test').toBe(0)
    const raw = {
      slots: [
        {
          category: 'impact',
          tags: ['boom'],
          timelineStart: 5.0,
          timelineEnd: 5.5,
          intensity: 0.8,
          timingAnchorWord: 'crashed',
          reason: 'A narrative peak requiring an impact accent.'
        }
      ],
      timingNotes: []
    }
    const { slots } = normalizeAudioDirectorResponse(raw, PROJECT_ID, podcastDna)
    expect(slots.length).toBe(1)
    expect(
      slots[0].intensity,
      `Expected impact intensity <= 0 for podcast DNA, got ${slots[0].intensity}`
    ).toBeLessThanOrEqual(0)
  })
})
