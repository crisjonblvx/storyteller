import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tryConcreteFallbackScene } from '../src/broll-providers.js'

describe('tryConcreteFallbackScene', () => {
  it('returns a rocket pad scene for space industry lines', () => {
    const scene = tryConcreteFallbackScene(
      "Is that there's something happening in space. That's everything from commercial space travel to satellite access for defense companies, telecommunications.",
      8
    )
    assert.ok(scene)
    assert.match(scene!.stillImagePrompt, /rocket|satellite|mission control|telemetry|orbital|launch/i)
    assert.match(scene!.motionPrompt, /diegetic ambient/i)
    assert.match(scene!.motionPrompt, /no music/i)
  })

  it('varies the scene across different lines in the same topic', () => {
    const lines = [
      'The rocket launch and satellite access changes everything in space.',
      'Commercial space and telecommunications orbit infrastructure is booming.',
      'SpaceX went public and became one of the largest space companies.',
      'There is something happening in space with defense and satellites.'
    ]
    const distinct = new Set(
      lines.map((line) => tryConcreteFallbackScene(line, 8)?.stillImagePrompt)
    )
    assert.ok(distinct.size >= 2, `expected varied scenes, got ${distinct.size}`)
  })

  it('matches education and futuristic-tech topics', () => {
    const school = tryConcreteFallbackScene(
      'Schools are burdened to ensure students can pass tests, and educators lack the information.',
      8
    )
    assert.ok(school)
    assert.match(school!.motionPrompt, /diegetic ambient/i)

    const tech = tryConcreteFallbackScene(
      'Iron Man, Tony Stark ran a weapons company; Anduril is literally like Stark Enterprises going public.',
      8
    )
    assert.ok(tech)
    assert.match(tech!.motionPrompt, /no music/i)
  })

  it('returns null for unmatched generic narration', () => {
    const scene = tryConcreteFallbackScene('We had a great conversation about life in general.', 8)
    assert.equal(scene, null)
  })
})
