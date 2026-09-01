import express from 'express'
import { z } from 'zod'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import {
  rankAgents, metrics,
  type Agent, type Trade, type AuthorizationRecord, type DelegationMethod,
} from '../domain'
import { Repository } from './repository'
import { DreamDexAdapter } from './dreamdex'
import { pickAndVerifyAuthorization, type AuthorizationPath } from './authorization'
import { SyncWorker } from './sync'

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
    const agent = repo.getAgent(q.params.id)
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    const trades = repo.listTrades({ agentId: agent.id })
    r.json({ agent, performance: metrics(agent, trades), trades })
  })

  app.get('/api/agents/:id/activity', (q, r) => {
    const agent = repo.getAgent(q.params.id)
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

  // Developer dashboard endpoints.
  app.patch('/api/agents/:id', (q, r) => {
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
    const existing = repo.getAgent(q.params.id)
    if (!existing) return r.status(404).json({ error: 'Agent not found.' })
    const fields = updates.data as Partial<Agent>
    if (fields.status) {
      const updated = repo.updateAgentStatus(q.params.id, fields.status)
      if (updated) return r.json({ agent: updated })
    }
    const updated = repo.updateAgentMetadata(q.params.id, fields)
    if (!updated) return r.status(404).json({ error: 'Agent not found.' })
    r.json({ agent: updated })
  })

  app.get('/api/agents/:id/api-keys', (q, r) => {
    const agent = repo.getAgent(q.params.id)
    if (!agent) return r.status(404).json({ error: 'Agent not found.' })
    r.json({ keys: repo.listApiKeysForAgent(agent.id) })
  })

  app.post('/api/agents/:id/api-keys/rotate', (q, r) => {
    const agent = repo.getAgent(q.params.id)
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

  app.use('/api/external', external)

  // ─── "Use Agent" authorization check ───────────────────────────────────

  // The user asks CLASH: "For this agent, given my wallet, what is the
  // authorization state?" CLASH inspects the agent's declared methods,
  // checks each one on-chain, and returns the first authorized path
  // (or the self-run fallback).
  app.get('/api/agents/:id/use', async (q, r) => {
    const agent = repo.getAgent(q.params.id)
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
    const agent = repo.getAgent(q.params.id)
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
    const agent = repo.getAgent(q.params.id)
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
