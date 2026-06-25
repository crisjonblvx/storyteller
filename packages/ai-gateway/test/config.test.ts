import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAiGatewayConfig } from '../src/config.js'

describe('resolveAiGatewayConfig', () => {
  it('returns `unconfigured` when no gateway URL and no explicit mode', () => {
    const cfg = resolveAiGatewayConfig({})
    assert.equal(cfg.mode, 'unconfigured')
    assert.equal(cfg.apiBaseUrl, null)
    assert.equal(cfg.gatewayUrl, null)
    assert.equal(cfg.localOptedIn, false)
    assert.equal(cfg.reason, 'auto-unconfigured')
  })

  it('auto-picks proxy when STORYTELLER_GATEWAY_URL is set', () => {
    const cfg = resolveAiGatewayConfig({
      STORYTELLER_GATEWAY_URL: 'https://api.example.com'
    })
    assert.equal(cfg.mode, 'proxy')
    assert.equal(cfg.apiBaseUrl, 'https://api.example.com')
    assert.equal(cfg.gatewayUrl, 'https://api.example.com')
    assert.equal(cfg.reason, 'auto-proxy')
  })

  it('strips trailing slashes from gateway URL', () => {
    const cfg = resolveAiGatewayConfig({
      STORYTELLER_GATEWAY_URL: 'https://api.example.com///'
    })
    assert.equal(cfg.apiBaseUrl, 'https://api.example.com')
  })

  it('honors STORYTELLER_AI_MODE=proxy even without a URL (caller decides what to do)', () => {
    const cfg = resolveAiGatewayConfig({ STORYTELLER_AI_MODE: 'proxy' })
    assert.equal(cfg.mode, 'proxy')
    assert.equal(cfg.apiBaseUrl, null)
    assert.equal(cfg.reason, 'explicit-proxy')
  })

  it('honors STORYTELLER_AI_MODE=local (dev opt-in)', () => {
    const cfg = resolveAiGatewayConfig({ STORYTELLER_AI_MODE: 'local' })
    assert.equal(cfg.mode, 'local')
    assert.equal(cfg.localOptedIn, true)
    assert.equal(cfg.reason, 'explicit-local')
  })

  it('STORYTELLER_AI_MODE=local takes precedence even when a gateway URL is configured', () => {
    const cfg = resolveAiGatewayConfig({
      STORYTELLER_AI_MODE: 'local',
      STORYTELLER_GATEWAY_URL: 'https://api.example.com'
    })
    assert.equal(cfg.mode, 'local')
    assert.equal(cfg.gatewayUrl, 'https://api.example.com')
    assert.equal(cfg.localOptedIn, true)
  })

  it('STORYTELLER_AI_MODE is case-insensitive', () => {
    assert.equal(resolveAiGatewayConfig({ STORYTELLER_AI_MODE: 'PROXY' }).mode, 'proxy')
    assert.equal(resolveAiGatewayConfig({ STORYTELLER_AI_MODE: 'Local' }).mode, 'local')
    assert.equal(
      resolveAiGatewayConfig({
        STORYTELLER_AI_MODE: 'AUTO',
        STORYTELLER_GATEWAY_URL: 'https://api.example.com'
      }).mode,
      'proxy'
    )
  })

  it('falls back to STORYTELLER_API_BASE_URL when STORYTELLER_GATEWAY_URL is unset', () => {
    const cfg = resolveAiGatewayConfig({
      STORYTELLER_API_BASE_URL: 'https://legacy.example.com'
    })
    assert.equal(cfg.mode, 'proxy')
    assert.equal(cfg.apiBaseUrl, 'https://legacy.example.com')
  })

  it('picks up STORYTELLER_PROXY_TOKEN when present', () => {
    const cfg = resolveAiGatewayConfig({
      STORYTELLER_GATEWAY_URL: 'https://api.example.com',
      STORYTELLER_PROXY_TOKEN: 'service-token-123'
    })
    assert.equal(cfg.proxyToken, 'service-token-123')
  })

  it('does NOT auto-fall-back to local mode when no gateway URL is configured', () => {
    // Critical guard: auto mode must surface as `unconfigured`, not silently
    // try to call providers using developer keys on a user's machine.
    const cfg = resolveAiGatewayConfig({
      OPENAI_API_KEY: 'sk-test'
    })
    assert.equal(cfg.mode, 'unconfigured')
    assert.equal(cfg.localOptedIn, false)
  })
})
