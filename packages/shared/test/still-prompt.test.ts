import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendBrollStillSafetySuffix,
  buildDirectorStillPrompt,
  inferStillPromptCategory,
  shouldRefineStillPrompt
} from '../src/still-prompt.js'

describe('still-prompt', () => {
  it('infers typography category from top layer mode', () => {
    assert.equal(inferStillPromptCategory({ topLayerMode: 'typography' }), 'typography-still')
    assert.equal(inferStillPromptCategory({ promptCategory: 'broll-still' }), 'broll-still')
  })

  it('does not force center framing on b-roll stills', () => {
    const out = appendBrollStillSafetySuffix(
      'Kitchen table at night, couple arguing over bills under a pendant lamp.',
      'broll-still'
    )
    assert.doesNotMatch(out, /center the main subject/i)
  })

  it('allows document props with soft text guidance', () => {
    const out = appendBrollStillSafetySuffix(
      'Man holds a bank statement at the kitchen table, warm pendant light.',
      'broll-still'
    )
    assert.match(out, /documents and papers may appear/i)
  })

  it('enriches thin b-roll prompts with cinematography', () => {
    const out = buildDirectorStillPrompt({
      basePrompt: 'Couple at kitchen table at night with bills.',
      category: 'broll-still'
    })
    assert.match(out, /35mm/i)
    assert.match(out, /full-bleed/i)
  })

  it('requests refine for short b-roll prompts', () => {
    assert.equal(shouldRefineStillPrompt('Kitchen table, two people, bills.', 'broll-still'), true)
    assert.equal(
      shouldRefineStillPrompt(
        'Kitchen table at night, 35mm lens, shallow depth of field, doorway framing, warm documentary color grade, Antoine Fuqua-inspired photoreal realism, couple with bills under pendant lamp, full-bleed 16:9.',
        'broll-still'
      ),
      false
    )
  })
})
