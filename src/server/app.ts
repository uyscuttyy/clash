import express from 'express'
import { z } from 'zod'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import {
  rankAgents, metrics,
  type Agent, type Trade, type AuthorizationRecord, type DelegationMethod,
  type Follow, type MirrorAttempt,
} from '../domain'
import { Repository } from './repository'
import { DreamDexAdapter } from './dreamdex'
import { pickAndVerifyAuthorization, type AuthorizationPath } from './authorization'
import { SyncWorker } from './sync'
import { verifyFollowSignature, freshFollowNonce } from './eip712'

// ─── Validation schemas ─────────────────────────────────────────────────────

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const hexHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const delegationMethodSchema = z.enum(['spot_operator', 'session_tx', 'self_run'])

const agentRegistration = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(500),
  builder: z.string().trim().min(2).max(80),
  markets: z.array(z.enum(['BTC', 'ETH'])).min(1),
  windows: z.array(z.enum(['15M', '1H'])).min(1),
  integration: z.string().url().max(300),
  walletAddress: address,
  ownerAddress: address,
  delegationMethods: z.array(delegationMethodSchema).min(1).default(['self_run']),
  delegationMetadata: z.object({
    spotPoolAddress: address.optional(),
    sessionContract: address.optional(),
    notes: z.string().max(500).optional(),
  }).default({}),
})

const activityHint = z.object({
  txHash: hexHash,
  orderId: z.string().min(1).optional(),
  marketId: hexHash.optional(),
})

// ─── Follow / mirror schemas ────────────────────────────────────────────
//
// sizeMultiplier is sent as basis points × 100 (so 1.0× = 100, 1.5× = 150,
// 0.5× = 50). The frontend stores a float; the wire format is integer.
// The EIP-712 message uses the same bps value, so the signature binds
// to a precise integer — no float ambiguity.
const followCreate = z.object({
  followerAddress: address,
  sizeMultiplier: z.number().min(0.1).max(10.0),     // human units; converted to bps
  maxPerTradeRaw: z.string().regex(/^[0-9]{1,30}$/),    // raw tUSDC 6dp, max ~10^24
  maxDailyExposureRaw: z.string().regex(/^[0-9]{1,30}$/),
  maxDailyTrades: z.number().int().min(1).max(1000),
  // EIP-712 signatures are 65 bytes: r (32) + s (32) + v (1) = 130 hex chars.
  signedIntent: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  intentNonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  expiresAt: z.number().int().positive(),               // unix seconds
})

const followPatch = z.object({
  followerAddress: address,
  sizeMultiplier: z.number().min(0.1).max(10.0).optional(),
  maxPerTradeRaw: z.string().regex(/^[0-9]{1,30}$/).optional(),
  maxDailyExposureRaw: z.string().regex(/^[0-9]{1,30}$/).optional(),
  maxDailyTrades: z.number().int().min(1).max(1000).optional(),
  signedIntent: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
  intentNonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  expiresAt: z.number().int().positive().optional(),
  status: z.enum(['active', 'paused']).optional(),
})

const mirrorAttemptCreate = z.object({
  followId: z.string().min(1),
  sourceTxHash: hexHash,
  sourceMarketId: hexHash,
  sourcePool: address,
  sourceSide: z.enum(['BUY_YES', 'SELL_YES', 'BUY_NO', 'SELL_NO']),
  sourcePriceRaw: z.string().regex(/^[0-9]{1,30}$/),
  sourceQuantityRaw: z.string().regex(/^[0-9]{1,30}$/),
})

const mirrorAttemptAck = z.object({
  // The follower's wallet, lowercased. The route header is also
  // checked; the body field is a belt-and-braces check.
  followerAddress: address,
  decision: z.enum(['confirmed', 'failed', 'rejected']),
  mirrorTxHash: hexHash.optional(),
  reason: z.string().max(500).optional(),
})

// ─── API key auth middleware ────────────────────────────────────────────────

function requireApiKey(repo: Repository) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const header = req.header('authorization') ?? ''
    const match = header.match(/^Bearer\s+(\S+)$/i)
    if (!match) { res.status(401).json({ error: 'Missing or malformed Authorization header. Expected: Bearer <api_key>.' }); return }
    const keyHash = createHash('sha256').update(match[1]!).digest('hex')
    const key = repo.findApiKeyByHash(keyHash)
    if (!key || key.revokedAt) { res.status(401).json({ error: 'Invalid or revoked API key.' }); return }
    ;(req as express.Request & { agentId: string; apiKeyId: string }).agentId = key.agentId
    ;(req as express.Request & { agentId: string; apiKeyId: string }).apiKeyId = key.id
    repo.touchApiKey(key.id)
    next()
  }
}

function requireApiKeyForAgent() {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const auth = (req as express.Request & { agentId?: string }).agentId
    const urlAgentId = String(req.params.id ?? '')
    if (!auth || auth !== urlAgentId) {
      res.status(403).json({ error: 'API key is not authorized for this agent.' })
      return
    }
    next()
  }
}

// ─── App factory ────────────────────────────────────────────────────────────

export interface AppOptions {
  syncOptions?: { intervalMs?: number; syncOnStart?: boolean; once?: boolean; disabled?: boolean }
  // When true, do not start the sync worker. Useful for tests.
  startSync?: boolean
}

export function createApp(repo: Repository = new Repository(), options: AppOptions = {}) {
  const app = express()
  app.use(express.json({ limit: '32kb' }))
  const dreamdex = new DreamDexAdapter()

  // ─── Health ─────────────────────────────────────────────────────────────

  app.get('/api/health', (_q, r) => r.json({ ok: true, dreamdex: dreamdex.status() }))

  // ─── Public marketplace: agents ────────────────────────────────────────

  app.get('/api/agents', (q, r) => {
    const status = (typeof q.query.status === 'string' && ['active', 'paused', 'retired'].includes(q.query.status))
      ? (q.query.status as Agent['status'])
      : 'active'
    const market = typeof q.query.market === 'string' && ['BTC', 'ETH'].includes(q.query.market)
      ? (q.query.market as 'BTC' | 'ETH')
      : undefined
    const agents = repo.listAgents({ status, market })
    const trades = repo.listTrades()
    r.json({ agents, ranked: rankAgents(agents, trades), count: agents.length })
  })

  // List a developer's own agents (by owner wallet query).
  // This must be registered BEFORE /api/agents/:id so Express matches the
  // literal segment "mine" rather than treating it as a UUID.
  app.get('/api/agents/mine', (q, r) => {
    const owner = typeof q.query.owner === 'string' ? q.query.owner : null
    if (!owner || !address.safeParse(owner).success) {
      return r.status(400).json({ error: 'Query parameter "owner" must be a valid EVM address.' })
    }
    r.json({ agents: repo.listAgentsByOwner(owner) })
  })

  app.get('/api/agents/:id', (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const trades = repo.listTrades({ agentId: agent.id })
    r.json({ agent, performance: metrics(agent, trades), trades })
  })

  app.get('/api/agents/:id/activity', (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const trades = repo.listTrades({ agentId: agent.id })
    r.json({ agentId: agent.id, trades })
  })

  // ─── Public marketplace: global activity feed ──────────────────────────

  app.get('/api/activity', (q, r) => {
    const limit = Math.min(Number(q.query.limit ?? 50) || 50, 200)
    const trades = repo.listTrades({ limit })
    const agents = new Map(repo.listAgents({ status: undefined }).map(a => [a.id, a]))
    const enriched = trades.map(t => {
      const a = agents.get(t.agentId)
      return {
        id: t.id, agentId: t.agentId, agentName: a?.name ?? 'Unknown agent',
        market: t.market, direction: t.direction, result: t.result, pnl: t.pnl,
        txHash: t.txHash, filledAt: t.filledAt, source: t.source,
      }
    })
    r.json({ activity: enriched, count: enriched.length })
  })

  // ─── Public marketplace: rankings ──────────────────────────────────────

  app.get('/api/rankings', (q, r) => {
    const market = typeof q.query.market === 'string' && ['BTC', 'ETH'].includes(q.query.market)
      ? (q.query.market as 'BTC' | 'ETH')
      : undefined
    const agents = repo.listAgents({ status: 'active', market })
    const trades = repo.listTrades()
    r.json({ ranked: rankAgents(agents, trades), count: agents.length })
  })

  // ─── Public marketplace: markets catalog ───────────────────────────────

  app.get('/api/markets', async (_q, r) => {
    try {
      const markets = await dreamdex.discoverBinaryMarkets()
      r.json({ markets, source: 'Somnia Shannon indexer' })
    } catch (err) {
      r.status(503).json({ error: err instanceof Error ? err.message : 'Market indexer unavailable.' })
    }
  })

  // ─── Developer registration ────────────────────────────────────────────

  app.post('/api/agents', (q, r) => {
    const parsed = agentRegistration.safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid registration.', issues: parsed.error.issues })
    const data = parsed.data
    // If the developer claims spot_operator or session_tx support, the relevant
    // metadata must be present.
    if (data.delegationMethods.includes('spot_operator') && !data.delegationMetadata.spotPoolAddress) {
      return r.status(400).json({ error: 'spot_operator delegation requires delegationMetadata.spotPoolAddress.' })
    }
    if (data.delegationMethods.includes('session_tx') && !data.delegationMetadata.sessionContract) {
      return r.status(400).json({ error: 'session_tx delegation requires delegationMetadata.sessionContract.' })
    }
    // If the developer only declares self_run, strip any method-specific metadata.
    const delegationMetadata = {
      spotPoolAddress: data.delegationMethods.includes('spot_operator') ? (data.delegationMetadata.spotPoolAddress as `0x${string}` | undefined) : undefined,
      sessionContract: data.delegationMethods.includes('session_tx') ? (data.delegationMetadata.sessionContract as `0x${string}` | undefined) : undefined,
      notes: data.delegationMetadata.notes,
    }
    const agent: Agent = {
      id: randomUUID(),
      name: data.name, description: data.description, builder: data.builder,
      markets: data.markets, windows: data.windows, integration: data.integration,
      walletAddress: data.walletAddress as `0x${string}`,
      ownerAddress: data.ownerAddress as `0x${string}`,
      delegationMethods: data.delegationMethods,
      delegationMetadata,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    const stored = repo.createAgent(agent)
    if (!stored) return r.status(409).json({ error: 'Agent name already registered.' })
    // Generate a one-time API key. Show it once. The plaintext never appears again.
    const apiKeyPlain = `clash_${randomBytes(24).toString('base64url')}`
    const apiKeyHash = createHash('sha256').update(apiKeyPlain).digest('hex')
    repo.createApiKey({
      id: randomUUID(), agentId: agent.id, keyHash: apiKeyHash,
      label: 'initial', createdAt: new Date().toISOString(),
    })
    r.status(201).json({ agent, apiKey: apiKeyPlain, apiKeyNote: 'Save this key now. CLASH stores only its hash.' })
  })

  // List a developer's own agents (by owner wallet query).
  // Removed — declared earlier in the file so Express matches the literal
  // "mine" segment before the parameterised :id route.

  // Developer dashboard endpoints. These are gated by the developer's
  // connected wallet — passed in the `X-Owner-Wallet` header. CLASH does
  // not ask the developer to sign anything; the header is the developer's
  // own proof of which dashboard they are viewing. (For a real deployment,
  // this would be a SIWE session; for the MVP the header is sufficient
  // because the only thing an attacker can do is read or edit an agent they
  // already know the ID of, and the marketplace public surface already
  // shows the agent.)
  function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const agent = repo.getAgent(String(req.params.id ?? ''))
    if (!agent) { res.status(404).json({ error: 'Agent not found.' }); return }
    const owner = String(req.header('x-owner-wallet') ?? '')
    if (!owner || owner.toLowerCase() !== agent.ownerAddress.toLowerCase()) {
      res.status(403).json({ error: 'Only the registered owner can manage this agent.' })
      return
    }
    next()
  }

  app.patch('/api/agents/:id', requireOwner, (q, r) => {
    const updates = z.object({
      description: z.string().trim().min(10).max(500).optional(),
      integration: z.string().url().max(300).optional(),
      delegationMethods: z.array(delegationMethodSchema).min(1).optional(),
      delegationMetadata: z.object({
        spotPoolAddress: address.optional(),
        sessionContract: address.optional(),
        notes: z.string().max(500).optional(),
      }).optional(),
      status: z.enum(['active', 'paused', 'retired']).optional(),
    }).safeParse(q.body)
    if (!updates.success) return r.status(400).json({ error: 'Invalid update.', issues: updates.error.issues })
    const existing = repo.getAgent(String(q.params.id ?? ''))
    if (!existing) return r.status(404).json({ error: 'Agent not found.' })
    const fields = updates.data as Partial<Agent>
    if (fields.status) {
      const updated = repo.updateAgentStatus(String(q.params.id ?? ''), fields.status)
      if (updated) return r.json({ agent: updated })
    }
    const updated = repo.updateAgentMetadata(String(q.params.id ?? ''), fields)
    if (!updated) return r.status(404).json({ error: 'Agent not found.' })
    r.json({ agent: updated })
  })

  app.get('/api/agents/:id/api-keys', requireOwner, (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    r.json({ keys: repo.listApiKeysForAgent(agent.id) })
  })

  // Dashboard view: agent identity, public performance, api-key list, recent
  // verified trades. Owner-only.
  app.get('/api/agents/:id/dashboard', requireOwner, (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const trades = repo.listTrades({ agentId: agent.id, limit: 10 })
    const keys = repo.listApiKeysForAgent(agent.id)
    r.json({
      agent,
      performance: metrics(agent, trades),
      recentTrades: trades,
      apiKeys: keys,
    })
  })

  app.post('/api/agents/:id/api-keys/rotate', requireOwner, (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const old = repo.listApiKeysForAgent(agent.id)
    for (const k of old) if (!k.revokedAt) repo.revokeApiKey(k.id)
    const apiKeyPlain = `clash_${randomBytes(24).toString('base64url')}`
    const apiKeyHash = createHash('sha256').update(apiKeyPlain).digest('hex')
    repo.createApiKey({
      id: randomUUID(), agentId: agent.id, keyHash: apiKeyHash,
      label: 'rotated', createdAt: new Date().toISOString(),
    })
    r.json({ apiKey: apiKeyPlain, apiKeyNote: 'Save this key now. CLASH stores only its hash. The previous key has been revoked.' })
  })

  // ─── External agent endpoints (API-key auth) ───────────────────────────

  const external = express.Router()
  external.use(requireApiKey(repo))

  external.post('/agents/:id/activity', requireApiKeyForAgent(), async (q, r) => {
    const parsed = activityHint.safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid activity hint.', issues: parsed.error.issues })
    const agentId = String(q.params.id ?? '')
    const agent = repo.getAgent(agentId)
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    try {
      // Re-derive the settled performance from the chain.
      // The hint is a discovery signal only. CLASH verifies the on-chain state.
      const settled = await dreamdex.settledBinaryPerformance(agent.walletAddress, parsed.data.marketId as `0x${string}`)
      if (!settled || settled.txHash.toLowerCase() !== parsed.data.txHash.toLowerCase()) {
        return r.status(422).json({ status: 'rejected', reason: 'No matching settled fill found on-chain for this hint.' })
      }
      const trade: Trade = {
        id: randomUUID(),
        agentId: agent.id,
        txHash: settled.txHash,
        market: settled.market,
        direction: settled.direction,
        result: settled.result,
        pnl: settled.pnl,
        marketId: settled.marketId,
        pool: settled.pool,
        filledAt: settled.filledAt,
        source: 'binary',
        reference: settled.reference,
        createdAt: new Date().toISOString(),
      }
      const out = repo.upsertTrade(trade)
      r.json({ status: 'verified', trade: out.trade, created: out.created })
    } catch (err) {
      r.status(503).json({ error: err instanceof Error ? err.message : 'Verification unavailable.' })
    }
  })

  external.get('/agents/:id', requireApiKeyForAgent(), (q, r) => {
    const agentId = String(q.params.id ?? '')
    const agent = repo.getAgent(agentId)
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const trades = repo.listTrades({ agentId: agent.id })
    r.json({ agent, performance: metrics(agent, trades), trades })
  })

  // Agent-side: list every active follow for this agent. The runtime
  // polls this once per tick and caches for 30s.
  external.get('/agents/:id/follows/active', requireApiKeyForAgent(), (q, r) => {
    const agentId = String(q.params.id ?? '')
    const follows = repo.listActiveFollowsForAgent(agentId)
    r.json({ follows, count: follows.length })
  })

  // Agent-side: read the daily cap usage for one follow (so the
  // runtime can decide whether the next mirror attempt would breach
  // the user's daily limit).
  external.get('/follows/:followId/daily-stats', (q, r) => {
    const followId = String(q.params.followId ?? '')
    const follow = repo.getFollow(followId)
    if (!follow) return r.status(404).json({ error: 'Follow not found.' })
    // Cross-check the follow's agent matches the API key's agent.
    const auth = (q as express.Request & { agentId?: string }).agentId
    if (!auth || auth !== follow.agentId) {
      return r.status(403).json({ error: 'API key is not authorized for this follow.' })
    }
    r.json(repo.dailyMirrorStats(followId))
  })

  // Agent-side: record a new mirror attempt. decision='broadcast'
  // means the runtime has decided to ask the follower to sign; the
  // follower's open tab will see it via /api/me/mirror-attempts and
  // trigger the wallet prompt. The attempt is unique on
  // (sourceTxHash, followerAddress) so retries are no-ops.
  external.post('/follows/:followId/mirror-attempts', (q, r) => {
    const followId = String(q.params.followId ?? '')
    const follow = repo.getFollow(followId)
    if (!follow) return r.status(404).json({ error: 'Follow not found.' })
    const auth = (q as express.Request & { agentId?: string }).agentId
    if (!auth || auth !== follow.agentId) {
      return r.status(403).json({ error: 'API key is not authorized for this follow.' })
    }
    const parsed = mirrorAttemptCreate.safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid mirror attempt.', issues: parsed.error.issues })
    if (follow.status !== 'active') {
      return r.status(409).json({ error: 'Follow is not active.' })
    }
    if (parsed.data.followId !== followId) {
      return r.status(400).json({ error: 'followId in body must match the URL.' })
    }
    // Re-verify the EIP-712 signature is still valid and recovers to
    // the follower — the runtime must NOT trust a follow whose
    // signature has been forged or expired.
    const recovered = verifyFollowSignature({
      expectedFollower: follow.followerAddress,
      signature: follow.signedIntent,
      intent: {
        agentId: follow.agentId,
        sizeMultiplierBps: Math.round(follow.sizeMultiplier * 100),
        maxPerTradeRaw: BigInt(follow.maxPerTradeRaw),
        maxDailyExposureRaw: BigInt(follow.maxDailyExposureRaw),
        maxDailyTrades: follow.maxDailyTrades,
        nonce: follow.intentNonce,
        expiresAt: Math.floor(new Date(follow.expiresAt).getTime() / 1000),
      },
    })
    // (verifyFollowSignature is async, but we need to await it. Convert
    // the handler to async.)
    void (async () => {
      const ok = await recovered
      if (!ok) {
        r.status(400).json({ error: 'Stored follow signature is no longer valid.' })
        return
      }
      if (new Date(follow.expiresAt).getTime() <= Date.now()) {
        r.status(400).json({ error: 'Follow intent has expired.' })
        return
      }
      // Per-trade cap: this single mirror's collateral cost must not
      // exceed maxPerTradeRaw. Checked before the daily aggregate so a
      // one-shot oversized order is rejected with the precise reason.
      // Note: collateral in raw tUSDC = quantity × price ÷ 10^6 to
      // cancel the 6-decimal scaling on both sides.
      const collateralRaw = BigInt(parsed.data.sourceQuantityRaw) * BigInt(parsed.data.sourcePriceRaw) / 1_000_000n
      if (collateralRaw > BigInt(follow.maxPerTradeRaw)) {
        const attempt = repo.createMirrorAttempt({
          id: randomUUID(),
          followId, agentId: follow.agentId,
          followerAddress: follow.followerAddress,
          sourceTxHash: parsed.data.sourceTxHash as `0x${string}`,
          sourceMarketId: parsed.data.sourceMarketId as `0x${string}`,
          sourcePool: parsed.data.sourcePool as `0x${string}`,
          sourceSide: parsed.data.sourceSide,
          sourcePriceRaw: parsed.data.sourcePriceRaw,
          sourceQuantityRaw: parsed.data.sourceQuantityRaw,
          decision: 'rejected',
          decisionReason: 'Per-trade cap exceeded.',
          mirrorTxHash: null,
          createdAt: new Date().toISOString(),
          decidedAt: new Date().toISOString(),
          confirmedAt: null,
        })
        r.status(202).json({ attempt, note: 'Recorded as rejected (per-trade cap).' })
        return
      }
      // Daily-cap gate: total exposure of the day must not exceed maxDailyExposureRaw.
      const stats = repo.dailyMirrorStats(followId)
      const attemptedExposure = collateralRaw
      if (BigInt(stats.exposureRaw) + attemptedExposure > BigInt(follow.maxDailyExposureRaw)) {
        const attempt = repo.createMirrorAttempt({
          id: randomUUID(),
          followId, agentId: follow.agentId,
          followerAddress: follow.followerAddress,
          sourceTxHash: parsed.data.sourceTxHash as `0x${string}`,
          sourceMarketId: parsed.data.sourceMarketId as `0x${string}`,
          sourcePool: parsed.data.sourcePool as `0x${string}`,
          sourceSide: parsed.data.sourceSide,
          sourcePriceRaw: parsed.data.sourcePriceRaw,
          sourceQuantityRaw: parsed.data.sourceQuantityRaw,
          decision: 'rejected',
          decisionReason: 'Daily exposure cap would be exceeded.',
          mirrorTxHash: null,
          createdAt: new Date().toISOString(),
          decidedAt: new Date().toISOString(),
          confirmedAt: null,
        })
        r.status(202).json({ attempt, note: 'Recorded as rejected (daily cap).' })
        return
      }
      if (stats.count >= follow.maxDailyTrades) {
        const attempt = repo.createMirrorAttempt({
          id: randomUUID(),
          followId, agentId: follow.agentId,
          followerAddress: follow.followerAddress,
          sourceTxHash: parsed.data.sourceTxHash as `0x${string}`,
          sourceMarketId: parsed.data.sourceMarketId as `0x${string}`,
          sourcePool: parsed.data.sourcePool as `0x${string}`,
          sourceSide: parsed.data.sourceSide,
          sourcePriceRaw: parsed.data.sourcePriceRaw,
          sourceQuantityRaw: parsed.data.sourceQuantityRaw,
          decision: 'rejected',
          decisionReason: 'Daily trade count cap reached.',
          mirrorTxHash: null,
          createdAt: new Date().toISOString(),
          decidedAt: new Date().toISOString(),
          confirmedAt: null,
        })
        r.status(202).json({ attempt, note: 'Recorded as rejected (daily count).' })
        return
      }
      const attempt = repo.createMirrorAttempt({
        id: randomUUID(),
        followId, agentId: follow.agentId,
        followerAddress: follow.followerAddress,
        sourceTxHash: parsed.data.sourceTxHash as `0x${string}`,
        sourceMarketId: parsed.data.sourceMarketId as `0x${string}`,
        sourcePool: parsed.data.sourcePool as `0x${string}`,
        sourceSide: parsed.data.sourceSide,
        sourcePriceRaw: parsed.data.sourcePriceRaw,
        sourceQuantityRaw: parsed.data.sourceQuantityRaw,
        decision: 'broadcast',
        decisionReason: null,
        mirrorTxHash: null,
        createdAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
        confirmedAt: null,
      })
      r.status(201).json({ attempt })
    })()
  })

  app.use('/api/external', external)

  // ─── "Use Agent" authorization check ───────────────────────────────────

  // The user asks CLASH: "For this agent, given my wallet, what is the
  // authorization state?" CLASH inspects the agent's declared methods,
  // checks each one on-chain, and returns the first authorized path
  // (or the self-run fallback).
  app.get('/api/agents/:id/use', async (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const userWallet = typeof q.query.user === 'string' ? q.query.user : null
    if (!userWallet || !address.safeParse(userWallet).success) {
      return r.status(400).json({ error: 'Query parameter "user" must be a valid EVM address.' })
    }
    const supported = agent.delegationMethods
    const result = await pickAndVerifyAuthorization({
      userWallet: userWallet as `0x${string}`,
      agentAddress: agent.walletAddress,
      supportedMethods: supported as AuthorizationPath[],
      spotPoolAddress: agent.delegationMetadata.spotPoolAddress,
      sessionContract: agent.delegationMetadata.sessionContract,
    })
    r.json({
      agentId: agent.id, userWallet, agentWallet: agent.walletAddress,
      supportedMethods: supported, ...result,
    })
  })

  // Record a verified authorization. CLASH only writes the row after
  // re-verifying on-chain that the authorization is live.
  app.post('/api/agents/:id/use', async (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const parsed = z.object({
      userWallet: address,
      method: delegationMethodSchema,
    }).safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues })
    if (!agent.delegationMethods.includes(parsed.data.method as DelegationMethod)) {
      return r.status(400).json({ error: 'This agent does not support the requested authorization method.' })
    }
    const check = await pickAndVerifyAuthorization({
      userWallet: parsed.data.userWallet as `0x${string}`,
      agentAddress: agent.walletAddress,
      supportedMethods: [parsed.data.method as AuthorizationPath],
      spotPoolAddress: agent.delegationMetadata.spotPoolAddress,
      sessionContract: agent.delegationMetadata.sessionContract,
    })
    if (check.path !== parsed.data.method) {
      return r.status(422).json({ error: 'Authorization could not be verified for the requested method.', check })
    }
    if (!check.authorized) {
      return r.status(422).json({ error: check.reason ?? 'Authorization not live on-chain.', check })
    }
    const row: AuthorizationRecord = {
      id: randomUUID(),
      agentId: agent.id,
      userWallet: parsed.data.userWallet as `0x${string}`,
      method: parsed.data.method as DelegationMethod,
      proof: check.proof,
      verifiedAt: new Date().toISOString(),
      revokedAt: null,
    }
    repo.upsertAuthorization(row)
    r.status(201).json({ authorization: row })
  })

  // List a user's authorizations.
  app.get('/api/users/:wallet/authorizations', (q, r) => {
    if (!address.safeParse(q.params.wallet).success) {
      return r.status(400).json({ error: 'Invalid wallet address.' })
    }
    const records = repo.listAuthorizationsForUser(q.params.wallet)
    const enriched = records.map(rec => {
      const a = repo.getAgent(rec.agentId)
      return { ...rec, agent: a ? { id: a.id, name: a.name, builder: a.builder } : null }
    })
    r.json({ authorizations: enriched })
  })

  // Revoke an authorization. Self-run cannot be "revoked" because it is
  // not an on-chain grant. Spot operator grants and EIP-7702 designations
  // are revoked on-chain by the user; CLASH just records the revocation.
  app.post('/api/agents/:id/use/revoke', (q, r) => {
    const agent = repo.getAgent(String(q.params.id ?? ''))
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const parsed = z.object({
      userWallet: address,
      method: delegationMethodSchema,
    }).safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues })
    if (parsed.data.method === 'self_run') {
      return r.status(400).json({ error: 'self_run authorizations are not stored. Stop running the agent to "revoke."' })
    }
    repo.revokeAuthorization(agent.id, parsed.data.userWallet as `0x${string}`, parsed.data.method as DelegationMethod)
    r.json({ status: 'revoked', note: 'CLASH has recorded the revocation. The user must also revoke the on-chain grant from their wallet (e.g. setOperatorApprovalForPool with approved: false, or clear the EIP-7702 designation).' })
  })

  // ─── Follows (copy-trading) ────────────────────────────────────────────
  //
  // The user signs an EIP-712 FollowIntent message on creation/update
  // and CLASH stores the signature. The agent runtime calls
  // /api/external/follows/active with its own API key, gets the list of
  // active follows for the agent, and on every successful agent order
  // it records a mirror_attempt and asks the follower's open tab to
  // sign and broadcast the same-shape call.
  //
  // Auth model: the follower proves ownership of the wallet by signing
  // the EIP-712 message. The X-Follower-Wallet header is *not* a
  // security boundary by itself; it is only a routing hint so CLASH
  // doesn't have to look up the follow by id and infer the wallet.
  // The header must match the recoverered signer.

  function requireFollower(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const follower = String(req.header('x-follower-wallet') ?? '').toLowerCase()
    if (!address.safeParse(follower).success) {
      res.status(401).json({ error: 'Missing or invalid X-Follower-Wallet header.' })
      return
    }
    ;(req as express.Request & { followerAddress: string }).followerAddress = follower
    next()
  }

  // Helper: verify the body signature, persist the follow.
  // shared by create + update paths.
  async function verifyAndPersistFollow(args: {
    agentId: string
    followerAddress: string
    sizeMultiplier: number
    maxPerTradeRaw: string
    maxDailyExposureRaw: string
    maxDailyTrades: number
    signedIntent: `0x${string}`
    intentNonce: `0x${string}`
    expiresAt: number
  }): Promise<{ follow: Follow; error?: string }> {
    const agent = repo.getAgent(args.agentId)
    if (!agent) return { follow: {} as Follow, error: 'Agent not found.' }
    if (agent.status !== 'active') {
      return { follow: {} as Follow, error: 'Agent is not currently active.' }
    }
    // Time-window check on the intent itself.
    const nowSec = Math.floor(Date.now() / 1000)
    if (args.expiresAt <= nowSec) {
      return { follow: {} as Follow, error: 'Intent has already expired.' }
    }
    // Reject expiresAt > 7 days out. The follow is short-lived by design.
    if (args.expiresAt - nowSec > 7 * 24 * 60 * 60) {
      return { follow: {} as Follow, error: 'expiresAt must be within 7 days.' }
    }
    // Cap sanity: maxPerTrade <= maxDailyExposure.
    if (BigInt(args.maxPerTradeRaw) > BigInt(args.maxDailyExposureRaw)) {
      return { follow: {} as Follow, error: 'maxPerTradeRaw must be <= maxDailyExposureRaw.' }
    }
    // Re-derive the EIP-712 message and verify the signature.
    const sizeMultiplierBps = Math.round(args.sizeMultiplier * 100)
    const recovered = await verifyFollowSignature({
      expectedFollower: args.followerAddress as `0x${string}`,
      signature: args.signedIntent,
      intent: {
        agentId: args.agentId,
        sizeMultiplierBps,
        maxPerTradeRaw: BigInt(args.maxPerTradeRaw),
        maxDailyExposureRaw: BigInt(args.maxDailyExposureRaw),
        maxDailyTrades: args.maxDailyTrades,
        nonce: args.intentNonce,
        expiresAt: args.expiresAt,
      },
    })
    if (!recovered) {
      return { follow: {} as Follow, error: 'Signature did not verify against the supplied intent.' }
    }
    if (recovered !== args.followerAddress.toLowerCase()) {
      return { follow: {} as Follow, error: 'Signature recovered to a different address than X-Follower-Wallet.' }
    }
    const follow: Follow = {
      id: randomUUID(),
      agentId: args.agentId,
      followerAddress: args.followerAddress as `0x${string}`,
      sizeMultiplier: args.sizeMultiplier,
      maxPerTradeRaw: args.maxPerTradeRaw,
      maxDailyExposureRaw: args.maxDailyExposureRaw,
      maxDailyTrades: args.maxDailyTrades,
      signedIntent: args.signedIntent,
      intentNonce: args.intentNonce,
      signedAt: new Date().toISOString(),
      expiresAt: new Date(args.expiresAt * 1000).toISOString(),
      status: 'active',
      createdAt: new Date().toISOString(),
      pausedAt: null,
      killedAt: null,
    }
    const stored = repo.upsertFollow(follow)
    return { follow: stored }
  }

  // Create or update a follow for a given (agent, follower).
  // The route is public (the body is the proof of ownership via signature).
  app.post('/api/agents/:id/follow', async (q, r) => {
    const agentId = String(q.params.id ?? '')
    const parsed = followCreate.safeParse(q.body)
    if (!parsed.success) {
      return r.status(400).json({ error: 'Invalid follow request.', issues: parsed.error.issues })
    }
    const headerFollower = String(q.header('x-follower-wallet') ?? '').toLowerCase()
    if (!headerFollower || headerFollower !== parsed.data.followerAddress.toLowerCase()) {
      return r.status(401).json({ error: 'X-Follower-Wallet header must match followerAddress in body.' })
    }
    const { follow, error } = await verifyAndPersistFollow({
      agentId, followerAddress: parsed.data.followerAddress,
      sizeMultiplier: parsed.data.sizeMultiplier,
      maxPerTradeRaw: parsed.data.maxPerTradeRaw,
      maxDailyExposureRaw: parsed.data.maxDailyExposureRaw,
      maxDailyTrades: parsed.data.maxDailyTrades,
      signedIntent: parsed.data.signedIntent as `0x${string}`,
      intentNonce: parsed.data.intentNonce as `0x${string}`,
      expiresAt: parsed.data.expiresAt,
    })
    if (error) return r.status(400).json({ error })
    r.status(201).json({ follow })
  })

  // Read a follow for a given (agent, follower). Returns the follow
  // plus 24h stats.
  app.get('/api/agents/:id/follow', requireFollower, (q, r) => {
    const agentId = String(q.params.id ?? '')
    const follower = (q as express.Request & { followerAddress: string }).followerAddress
    const follow = repo.getFollowByAgentAndFollower(agentId, follower)
    if (!follow) return r.json({ follow: null, stats: { exposureRaw: '0', count: 0 } })
    const stats = repo.dailyMirrorStats(follow.id)
    r.json({ follow, stats })
  })

  // Patch: change caps (requires a new signature) or pause/resume.
  // Killing a follow is via DELETE.
  app.patch('/api/agents/:id/follow', async (q, r) => {
    const agentId = String(q.params.id ?? '')
    const parsed = followPatch.safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid follow update.', issues: parsed.error.issues })
    const headerFollower = String(q.header('x-follower-wallet') ?? '').toLowerCase()
    if (!headerFollower || headerFollower !== parsed.data.followerAddress.toLowerCase()) {
      return r.status(401).json({ error: 'X-Follower-Wallet header must match followerAddress in body.' })
    }
    const existing = repo.getFollowByAgentAndFollower(agentId, parsed.data.followerAddress)
    if (!existing) return r.status(404).json({ error: 'No follow found to update.' })

    // Status-only patches: just flip the status. No new signature required.
    if (parsed.data.status && !parsed.data.sizeMultiplier && !parsed.data.maxPerTradeRaw
        && !parsed.data.maxDailyExposureRaw && !parsed.data.maxDailyTrades
        && !parsed.data.signedIntent) {
      const next = parsed.data.status === 'paused' ? 'paused' : 'active'
      if (existing.status === 'killed') {
        return r.status(400).json({ error: 'Cannot un-kill a follow. Create a new one.' })
      }
      const updated = repo.updateFollowStatus(existing.id, next)
      return r.json({ follow: updated })
    }

    // Cap changes require a fresh signature over the new intent.
    if (!parsed.data.signedIntent || !parsed.data.intentNonce || !parsed.data.expiresAt) {
      return r.status(400).json({ error: 'Cap changes require signedIntent, intentNonce, and expiresAt.' })
    }
    const merged = {
      sizeMultiplier: parsed.data.sizeMultiplier ?? existing.sizeMultiplier,
      maxPerTradeRaw: parsed.data.maxPerTradeRaw ?? existing.maxPerTradeRaw,
      maxDailyExposureRaw: parsed.data.maxDailyExposureRaw ?? existing.maxDailyExposureRaw,
      maxDailyTrades: parsed.data.maxDailyTrades ?? existing.maxDailyTrades,
      signedIntent: parsed.data.signedIntent,
      intentNonce: parsed.data.intentNonce,
      expiresAt: parsed.data.expiresAt,
    }
    const { follow, error } = await verifyAndPersistFollow({
      agentId, followerAddress: parsed.data.followerAddress,
      sizeMultiplier: merged.sizeMultiplier,
      maxPerTradeRaw: merged.maxPerTradeRaw,
      maxDailyExposureRaw: merged.maxDailyExposureRaw,
      maxDailyTrades: merged.maxDailyTrades,
      signedIntent: merged.signedIntent as `0x${string}`,
      intentNonce: merged.intentNonce as `0x${string}`,
      expiresAt: merged.expiresAt,
    })
    if (error) return r.status(400).json({ error })
    r.json({ follow })
  })

  // Kill (terminal revoke). The follow row is kept for history.
  app.delete('/api/agents/:id/follow', requireFollower, (q, r) => {
    const agentId = String(q.params.id ?? '')
    const follower = (q as express.Request & { followerAddress: string }).followerAddress
    const existing = repo.getFollowByAgentAndFollower(agentId, follower)
    if (!existing) return r.status(404).json({ error: 'No follow to kill.' })
    repo.updateFollowStatus(existing.id, 'killed')
    r.json({ status: 'killed', follow: repo.getFollow(existing.id) })
  })

  // List every follow owned by the connected wallet. Used by the
  // /me/mirrors page.
  app.get('/api/me/follows', requireFollower, (q, r) => {
    const follower = (q as express.Request & { followerAddress: string }).followerAddress
    const follows = repo.listFollowsForFollower(follower)
    const enriched = follows.map(f => {
      const agent = repo.getAgent(f.agentId)
      const stats = repo.dailyMirrorStats(f.id)
      return {
        follow: f,
        agent: agent ? { id: agent.id, name: agent.name, builder: agent.builder } : null,
        dailyStats: stats,
      }
    })
    r.json({ follows: enriched, count: enriched.length })
  })

  // Mirror attempt history for the connected wallet. Filterable by
  // followId and decision.
  app.get('/api/me/mirror-attempts', requireFollower, (q, r) => {
    const follower = (q as express.Request & { followerAddress: string }).followerAddress
    const followId = typeof q.query.followId === 'string' ? q.query.followId : undefined
    const decision = typeof q.query.decision === 'string' && ['pending','broadcast','confirmed','failed','rejected'].includes(q.query.decision)
      ? (q.query.decision as MirrorAttempt['decision'])
      : undefined
    const limit = Math.min(Number(q.query.limit ?? 50) || 50, 200)
    const attempts = repo.listMirrorAttempts({
      followerAddress: follower, followId, decision, limit,
    })
    r.json({ attempts, count: attempts.length })
  })

  // Ack a mirror attempt: the follower's wallet either confirmed the
  // mirror (got a tx hash) or rejected (cancelled the wallet prompt)
  // or failed (signing errored). The decision transitions the
  // attempt to confirmed/failed/rejected.
  app.post('/api/me/mirror-attempts/:attemptId/ack', requireFollower, (q, r) => {
    const attemptId = String(q.params.attemptId ?? '')
    const parsed = mirrorAttemptAck.safeParse(q.body)
    if (!parsed.success) return r.status(400).json({ error: 'Invalid ack.', issues: parsed.error.issues })
    const follower = (q as express.Request & { followerAddress: string }).followerAddress
    const attempt = repo.getMirrorAttempt(attemptId)
    if (!attempt) return r.status(404).json({ error: 'Mirror attempt not found.' })
    if (attempt.followerAddress.toLowerCase() !== follower) {
      return r.status(403).json({ error: 'You are not the follower for this attempt.' })
    }
    if (attempt.decision === 'confirmed' || attempt.decision === 'failed' || attempt.decision === 'rejected') {
      return r.json({ attempt, note: 'Attempt already terminal.' })
    }
    let next: MirrorAttempt | null
    if (parsed.data.decision === 'confirmed') {
      if (!parsed.data.mirrorTxHash) {
        return r.status(400).json({ error: 'confirmed requires mirrorTxHash.' })
      }
      next = repo.updateMirrorAttemptConfirmed(attemptId, parsed.data.mirrorTxHash as `0x${string}`)
    } else {
      next = repo.updateMirrorAttemptDecision(attemptId, parsed.data.decision, parsed.data.reason ?? null)
    }
    r.json({ attempt: next })
  })

  // Helper: produce a fresh nonce for the user to include in their
  // intent. The frontend calls this just before signing.
  app.post('/api/follows/nonce', (_q, r) => {
    r.json({ nonce: freshFollowNonce() })
  })

  // ─── Sync trigger (developer / admin) ──────────────────────────────────

  app.post('/api/sync', async (_q, r) => {
    try {
      const out = await worker.runOnce()
      r.json({ status: 'ok', ...out })
    } catch (err) {
      r.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed.' })
    }
  })

  app.get('/api/sync/status', (_q, r) => r.json(worker.status()))

  // Start the background sync worker unless the caller has disabled it.
  const worker = new SyncWorker(repo, dreamdex, {
    intervalMs: options.syncOptions?.intervalMs ?? 5 * 60 * 1000,
    syncOnStart: options.syncOptions?.syncOnStart ?? true,
    once: options.syncOptions?.once ?? false,
  })
  if (options.startSync !== false && !options.syncOptions?.disabled) {
    worker.start()
  }

  return app
}
