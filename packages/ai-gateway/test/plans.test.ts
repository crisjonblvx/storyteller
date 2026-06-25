import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getPlanDefinition, STORYTELLER_PLANS } from '../src/plans.js'

describe('STORYTELLER_PLANS', () => {
  it('defines five tiers with allowances', () => {
    assert.equal(Object.keys(STORYTELLER_PLANS).length, 5)
    assert.equal(STORYTELLER_PLANS.student.priceUsdMonthly, 9)
    assert.equal(STORYTELLER_PLANS.starter.priceUsdMonthly, 19)
    assert.equal(STORYTELLER_PLANS.reel_creator.allowances.clipBatches, 12)
    assert.equal(STORYTELLER_PLANS.studio.allowances.episodePasses, 20)
  })

  it('maps legacy creator plan id to intro_pro', () => {
    const plan = getPlanDefinition('creator')
    assert.equal(plan.id, 'intro_pro')
    assert.equal(plan.label, 'Intro Pro')
  })

  it('defaults unknown plan ids to starter', () => {
    assert.equal(getPlanDefinition('unknown').id, 'starter')
  })
})
