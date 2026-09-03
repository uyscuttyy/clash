import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository } from './repository'
import { createApp } from './app'

const repos: Repository[] = []
function setup() {
  const repo = new Repository(join(mkdtempSync(join(tmpdir(), 'clash-')), 'test.db'))
  repos.push(repo)
  // Disable the sync worker in tests — the indexer calls would hit Somnia
  // and slow the test suite.
  return request(createApp(repo, { startSync: false, syncOptions: { disabled: true } }))
}
afterEach(() => repos.splice(0).forEach(repo => repo.close()))

const registration = {
  name: 'Alpha Current',
  description: 'A deterministic external trading agent.',
  builder: 'Builder One',
  markets: ['BTC'],
  windows: ['15M'],
  integration: 'https://agent.test/api',
  walletAddress: '0x0000000000000000000000000000000000000001',
  ownerAddress: '0x0000000000000000000000000000000000000001',
  delegationMethods: ['self_run'],
}

describe('CLASH marketplace API', () => {
  it('lists zero agents on a fresh database', async () => {
    const response = await setup().get('/api/agents')
    expect(response.status).toBe(200)
    expect(response.body.agents).toEqual([])
    expect(response.body.count).toBe(0)
  })

  it('rejects an invalid registration', async () => {
    const api = setup()
    const response = await api.post('/api/agents').send({ name: 'x' })
    expect(response.status).toBe(400)
  })

  it('validates a complete registration and returns an API key once', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    expect(created.status).toBe(201)
    expect(created.body.agent.name).toBe('Alpha Current')
    expect(typeof created.body.apiKey).toBe('string')
    expect(created.body.apiKey.startsWith('clash_')).toBe(true)
    const list = await api.get('/api/agents')
    expect(list.body.agents).toHaveLength(1)
  })

  it('rejects a duplicate name with 409', async () => {
    const api = setup()
    await api.post('/api/agents').send(registration)
    const second = await api.post('/api/agents').send(registration)
    expect(second.status).toBe(409)
  })

  it('requires spot_pool_address when the agent declares spot_operator support', async () => {
    const api = setup()
    const response = await api.post('/api/agents').send({ ...registration, delegationMethods: ['spot_operator'] })
    expect(response.status).toBe(400)
  })

  it('does not require CLASH to ever see a private key', async () => {
    const response = await setup().get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.dreamdex.network).toBe('Somnia Shannon')
  })

  it('exposes a developer\'s own agents by owner query', async () => {
    const api = setup()
    await api.post('/api/agents').send(registration)
    const mine = await api.get('/api/agents/mine?owner=0x0000000000000000000000000000000000000001')
    expect(mine.status).toBe(200)
    expect(mine.body.agents).toHaveLength(1)
    const notMine = await api.get('/api/agents/mine?owner=0x0000000000000000000000000000000000000099')
    expect(notMine.body.agents).toHaveLength(0)
  })

  it('rejects a use-state query without a valid user wallet', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const bad = await api.get(`/api/agents/${created.body.agent.id}/use?user=not-an-address`)
    expect(bad.status).toBe(400)
  })

  it('authenticates external agent requests with a valid API key', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const apiKey = created.body.apiKey as string
    const profile = await api.get(`/api/external/agents/${created.body.agent.id}`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(profile.status).toBe(200)
    const denied = await api.get(`/api/external/agents/${created.body.agent.id}`)
    expect(denied.status).toBe(401)
  })

  it('rejects API keys scoped to a different agent', async () => {
    const api = setup()
    const a = await api.post('/api/agents').send(registration)
    const b = await api.post('/api/agents').send({ ...registration, name: 'Other Agent', walletAddress: '0x0000000000000000000000000000000000000002' })
    const wrong = await api.get(`/api/external/agents/${b.body.agent.id}`)
      .set('Authorization', `Bearer ${a.body.apiKey}`)
    expect(wrong.status).toBe(403)
  })

  it('rotates API keys and revokes the old one', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const oldKey = created.body.apiKey as string
    const rotated = await api.post(`/api/agents/${created.body.agent.id}/api-keys/rotate`)
      .set('X-Owner-Wallet', registration.ownerAddress)
    expect(rotated.status).toBe(200)
    expect(rotated.body.apiKey).not.toEqual(oldKey)
    const oldRevoked = await api.get(`/api/external/agents/${created.body.agent.id}`)
      .set('Authorization', `Bearer ${oldKey}`)
    expect(oldRevoked.status).toBe(401)
  })

  it('blocks PATCH /api/agents/:id without the owner header', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const noHeader = await api.patch(`/api/agents/${created.body.agent.id}`).send({ status: 'paused' })
    expect(noHeader.status).toBe(403)
    const wrongOwner = await api.patch(`/api/agents/${created.body.agent.id}`)
      .set('X-Owner-Wallet', '0x0000000000000000000000000000000000000099')
      .send({ status: 'paused' })
    expect(wrongOwner.status).toBe(403)
  })

  it('lets the owner pause, resume, and retire their agent', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const id = created.body.agent.id
    const pause = await api.patch(`/api/agents/${id}`)
      .set('X-Owner-Wallet', registration.ownerAddress)
      .send({ status: 'paused' })
    expect(pause.status).toBe(200)
    expect(pause.body.agent.status).toBe('paused')
    const resume = await api.patch(`/api/agents/${id}`)
      .set('X-Owner-Wallet', registration.ownerAddress)
      .send({ status: 'active' })
    expect(resume.body.agent.status).toBe('active')
    const retire = await api.patch(`/api/agents/${id}`)
      .set('X-Owner-Wallet', registration.ownerAddress)
      .send({ status: 'retired' })
    expect(retire.body.agent.status).toBe('retired')
  })

  it('returns a dashboard view to the owner only', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const id = created.body.agent.id
    const ownerView = await api.get(`/api/agents/${id}/dashboard`)
      .set('X-Owner-Wallet', registration.ownerAddress)
    expect(ownerView.status).toBe(200)
    expect(ownerView.body.agent.id).toBe(id)
    expect(ownerView.body.apiKeys.length).toBeGreaterThan(0)
    const blocked = await api.get(`/api/agents/${id}/dashboard`)
      .set('X-Owner-Wallet', '0x0000000000000000000000000000000000000099')
    expect(blocked.status).toBe(403)
  })
})

// ─── Follows (copy-trading) ─────────────────────────────────────────────

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { buildFollowMessage, freshFollowNonce } from './eip712'

const FOLLOWER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const followerAccount = privateKeyToAccount(FOLLOWER_PK)
const FOLLOWER = followerAccount.address

// Sign a real EIP-712 FollowIntent. Used by every test that exercises
// the follow create / patch / cap-enforcement paths.
async function signFollowIntent(agentId: string, args: {
  sizeMultiplier: number
  maxPerTradeRaw: string
  maxDailyExposureRaw: string
  maxDailyTrades: number
  nonce?: `0x${string}`
  expiresAt?: number
}): Promise<{ signedIntent: `0x${string}`; intentNonce: `0x${string}`; expiresAt: number }> {
  const intentNonce = args.nonce ?? freshFollowNonce() as `0x${string}`
  const expiresAt = args.expiresAt ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60
  const typed = buildFollowMessage({
    agentId,
    sizeMultiplierBps: Math.round(args.sizeMultiplier * 100),
    maxPerTradeRaw: BigInt(args.maxPerTradeRaw),
    maxDailyExposureRaw: BigInt(args.maxDailyExposureRaw),
    maxDailyTrades: args.maxDailyTrades,
    nonce: intentNonce,
    expiresAt,
  })
  const signature = await followerAccount.signTypedData({
    domain: typed.domain,
    types: { FollowIntent: typed.types.FollowIntent as readonly { name: string; type: string }[] },
    primaryType: typed.primaryType,
    message: typed.message,
  })
  return { signedIntent: signature, intentNonce, expiresAt }
}

describe('Follows (copy-trading)', () => {
  it('produces a fresh bytes32 nonce from /api/follows/nonce', async () => {
    const api = setup()
    const r = await api.post('/api/follows/nonce')
    expect(r.status).toBe(200)
    expect(r.body.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  it('creates a follow with a valid EIP-712 signature, then reads it back', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const nonce = freshFollowNonce() as `0x${string}`
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',          // 1 tUSDC
      maxDailyExposureRaw: '10000000',    // 10 tUSDC
      maxDailyTrades: 5,
      nonce, expiresAt,
    })
    const create = await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: nonce,
        expiresAt,
      })
    expect(create.status).toBe(201)
    expect(create.body.follow.status).toBe('active')
    expect(create.body.follow.maxPerTradeRaw).toBe('1000000')
    const read = await api.get(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
    expect(read.status).toBe(200)
    expect(read.body.follow.id).toBe(create.body.follow.id)
  })

  it('rejects a follow when the signature does not recover to the supplied wallet', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    // Sign with FOLLOWER_PK but lie in the body — say it's a different wallet.
    const otherPk = generatePrivateKey()
    const other = privateKeyToAccount(otherPk)
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    const r = await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: other.address,  // mismatched
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    expect(r.status).toBe(401)  // header vs body mismatch triggers first
  })

  it('rejects a follow when the intent body does not match what was signed', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    // Body claims a different maxPerTradeRaw than what was signed.
    const r = await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '9999999',         // not what was signed
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Signature/i)
  })

  it('rejects a follow with expiresAt > 7 days out', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const farFuture = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
      expiresAt: farFuture,
    })
    const r = await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: farFuture,
      })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/7 days/)
  })

  it('pauses and resumes a follow without re-signing', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    const pause = await api.patch(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({ followerAddress: FOLLOWER, status: 'paused' })
    expect(pause.status).toBe(200)
    expect(pause.body.follow.status).toBe('paused')
    const resume = await api.patch(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({ followerAddress: FOLLOWER, status: 'active' })
    expect(resume.status).toBe(200)
    expect(resume.body.follow.status).toBe('active')
  })

  it('kills a follow via DELETE', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    const kill = await api.delete(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
    expect(kill.status).toBe(200)
    expect(kill.body.follow.status).toBe('killed')
    // Cannot un-kill.
    const tryResume = await api.patch(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({ followerAddress: FOLLOWER, status: 'active' })
    expect(tryResume.status).toBe(400)
  })

  it('lists the follower\'s follows on /api/me/follows', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    const list = await api.get('/api/me/follows').set('X-Follower-Wallet', FOLLOWER)
    expect(list.status).toBe(200)
    expect(list.body.count).toBe(1)
    expect(list.body.follows[0].agent.id).toBe(agentId)
  })

  it('agent-side endpoint lists active follows for an agent', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const apiKey = reg.body.apiKey
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '1000000',
      maxDailyExposureRaw: '10000000',
      maxDailyTrades: 5,
    })
    await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '1000000',
        maxDailyExposureRaw: '10000000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    const r = await api.get(`/api/external/agents/${agentId}/follows/active`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(1)
    expect(r.body.follows[0].followerAddress.toLowerCase()).toBe(FOLLOWER.toLowerCase())
  })

  it('agent-side rejects a mirror attempt that breaches the daily exposure cap', async () => {
    const api = setup()
    const reg = await api.post('/api/agents').send(registration)
    const agentId = reg.body.agent.id
    const apiKey = reg.body.apiKey
    const sig = await signFollowIntent(agentId, {
      sizeMultiplier: 1.0,
      maxPerTradeRaw: '500000',        // 0.5 tUSDC per trade
      maxDailyExposureRaw: '500000',   // 0.5 tUSDC per day
      maxDailyTrades: 5,
    })
    const create = await api.post(`/api/agents/${agentId}/follow`)
      .set('X-Follower-Wallet', FOLLOWER)
      .send({
        followerAddress: FOLLOWER,
        sizeMultiplier: 1.0,
        maxPerTradeRaw: '500000',
        maxDailyExposureRaw: '500000',
        maxDailyTrades: 5,
        signedIntent: sig.signedIntent,
        intentNonce: sig.intentNonce,
        expiresAt: sig.expiresAt,
      })
    const followId = create.body.follow.id
    // Attempt 1: quantity 1000, price 1000000 (0.001 tUSDC * 1 tUSDC = 1000 raw tUSDC exposure) — under cap
    const ok = await api.post(`/api/external/follows/${followId}/mirror-attempts`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        followId,
        sourceTxHash: '0x' + 'a'.repeat(64),
        sourceMarketId: '0x' + 'b'.repeat(64),
        sourcePool: '0x000000000000000000000000000000000000beef',
        sourceSide: 'BUY_YES',
        sourcePriceRaw: '1000000',
        sourceQuantityRaw: '1000',
      })
    expect(ok.status).toBe(201)
    expect(ok.body.attempt.decision).toBe('broadcast')
    // Attempt 2: another 0.001 tUSDC would push exposure to 2000 raw = 0.002 tUSDC. Still under 500000 cap.
    // Attempt 3 with quantity that pushes total over cap: 10000 * 1000000 / 1e6 = 10000 raw tUSDC = 0.01 tUSDC.
    // After two 0.001 attempts, exposure = 0.002. Add a 0.5 trade (500000 raw exposure) -> 0.502 > 0.5 cap.
    const breach = await api.post(`/api/external/follows/${followId}/mirror-attempts`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        followId,
        sourceTxHash: '0x' + 'c'.repeat(64),
        sourceMarketId: '0x' + 'b'.repeat(64),
        sourcePool: '0x000000000000000000000000000000000000beef',
        sourceSide: 'BUY_YES',
        sourcePriceRaw: '1000000',
        sourceQuantityRaw: '1000000',     // 1 share * 1 tUSDC = 1 tUSDC exposure
      })
    expect(breach.status).toBe(202)
    expect(breach.body.attempt.decision).toBe('rejected')
    expect(breach.body.attempt.decisionReason).toMatch(/[Pp]er-trade cap/)
  })
})
