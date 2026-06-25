import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateAnalyzeCost,
  estimateCredits,
  estimateImageToVideoCredits,
  stubAnalyzeMeteringEstimate
} from '../src/credit-costs.js'

describe('estimateAnalyzeCost', () => {
  it('returns episode_pass credits for episode mode', () => {
    const est = estimateAnalyzeCost(3600, 'episode')
    assert.equal(est.meteringIntent, 'episode_pass')
    assert.equal(est.credits, 170)
    assert.equal(est.exceedsUnitLimit, false)
  })

  it('flags episode duration over 90 minutes', () => {
    const est = estimateAnalyzeCost(91 * 60, 'episode')
    assert.equal(est.exceedsUnitLimit, true)
  })

  it('returns clip_batch credits for clip_batch mode', () => {
    const est = estimateAnalyzeCost(600, 'clip_batch')
    assert.equal(est.meteringIntent, 'clip_batch')
    assert.equal(est.credits, 60)
    assert.equal(est.exceedsUnitLimit, false)
  })

  it('flags clip batch duration over 10×5 min', () => {
    const est = estimateAnalyzeCost(51 * 60, 'clip_batch')
    assert.equal(est.exceedsUnitLimit, true)
  })
})

describe('estimateCredits — AI video', () => {
  it('charges ~100 credits for broll_text_to_video', () => {
    assert.equal(estimateCredits('broll_text_to_video'), 100)
  })
})

describe('estimateImageToVideoCredits — tiers', () => {
  it('charges 100 credits for 6–8s', () => {
    assert.equal(estimateImageToVideoCredits(6), 100)
    assert.equal(estimateImageToVideoCredits(8), 100)
  })

  it('charges 110 credits for 9–12s', () => {
    assert.equal(estimateImageToVideoCredits(9), 110)
    assert.equal(estimateImageToVideoCredits(12), 110)
  })

  it('charges 120 credits for 13–15s', () => {
    assert.equal(estimateImageToVideoCredits(13), 120)
    assert.equal(estimateImageToVideoCredits(15), 120)
  })
})

describe('stubAnalyzeMeteringEstimate', () => {
  it('returns estimate with stub note', () => {
    const stub = stubAnalyzeMeteringEstimate(120, 'clip_batch')
    assert.equal(stub.credits, 60)
    assert.match(stub.note, /not wired/i)
  })
})
