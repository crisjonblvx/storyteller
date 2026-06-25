import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProductionOffersFromAiReview,
  isTemplateBrollPrompt,
  pickRecommendedOffer
} from '../src/production-mapper.js'

describe('buildProductionOffersFromAiReview', () => {
  it('uses explicit stillImagePrompt and motionPrompt when present', () => {
    const offers = buildProductionOffersFromAiReview({
      soundbiteId: 'sb-1',
      brollIdeas: [
        {
          style: 'literal',
          prompt: 'Unified paragraph fallback.',
          stillImagePrompt: 'Falcon Heavy on pad at blue hour, steam venting.',
          motionPrompt: 'Slow crane rise, 8 seconds, single continuous take, photoreal.'
        }
      ]
    })
    assert.equal(offers.length, 1)
    assert.match(offers[0]!.stillImagePrompt, /Falcon Heavy/)
    assert.match(offers[0]!.motionPrompt, /Slow crane rise/)
    assert.doesNotMatch(offers[0]!.stillImagePrompt, /Unified paragraph/)
  })

  it('splits unified prompt heuristically when still/motion omitted', () => {
    const offers = buildProductionOffersFromAiReview({
      brollIdeas: [
        {
          style: 'literal',
          prompt:
            'Copper coin on a walnut desk beside a seedling, warm window light. Slow push-in as the seedling unfurls, 8 seconds, photoreal.'
        }
      ]
    })
    assert.match(offers[0]!.stillImagePrompt, /Copper coin/)
    assert.match(offers[0]!.motionPrompt, /push-in|Slow motivated/i)
  })

  it('accepts ideas with only still + motion and no legacy prompt field', () => {
    const offers = buildProductionOffersFromAiReview({
      brollIdeas: [
        {
          style: 'symbolic',
          prompt: '',
          stillImagePrompt: 'Fork in a rain-slick road, green tickers left, red envelopes right.',
          motionPrompt: 'Handheld drift toward the fork, 8 seconds, photoreal.'
        }
      ]
    })
    assert.equal(offers.length, 1)
    assert.match(offers[0]!.stillImagePrompt, /Fork in a rain-slick road/)
  })

  it('prefers explicit still/motion over template fallback when picking recommended', () => {
    const offers = buildProductionOffersFromAiReview({
      brollIdeas: [
        {
          style: 'literal',
          prompt:
            'Premium cinematic B-roll grounded in this exact soundbite: "Space travel". Show the real-world subject or visible stakes implied by the line through environment, props, light, and motion.'
        },
        {
          style: 'symbolic',
          prompt: 'Fallback unified.',
          stillImagePrompt: 'Falcon Heavy on pad at blue hour, steam venting.',
          motionPrompt: 'Slow crane rise, 8 seconds, single continuous take, photoreal.'
        }
      ]
    })
    const recommended = pickRecommendedOffer(offers)
    assert.match(recommended!.stillImagePrompt, /Falcon Heavy/)
    assert.equal(recommended!.offerRole, 'recommended')
  })

  it('detects template fallback boilerplate', () => {
    assert.equal(
      isTemplateBrollPrompt(
        'Build a cinematic human moment around the feeling, pressure, ambition, loss, relief, or realization implied by the line.'
      ),
      true
    )
    assert.equal(isTemplateBrollPrompt('Falcon Heavy on pad at blue hour, steam venting.'), false)
  })
})
