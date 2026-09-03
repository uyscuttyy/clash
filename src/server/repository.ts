import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { type Agent, type Trade, type AuthorizationRecord, type Follow, type MirrorAttempt } from '../domain'

// The CLASH marketplace database. The schema is small and deliberate:
//   - `agents`         — public registry of every agent the marketplace knows about
//   - `trades`         — one row per verified on-chain fill, keyed by tx hash
//   - `agent_api_keys` — per-agent API key (hashed) for external-agent auth
//   - `authorizations` — per-user-per-agent "use" relationship, verified on-chain
//
// There is no users table. Users are identified only by their connected wallet
// for the duration of a session, and persisted only as a `user_wallet` field
// on the `authorizations` row when they authorize an agent.
//
// There is no rounds / round_participants / activity_hints tables. The
// marketplace product does not use the old arena concept.

export class Repository {
  private db: Database.Database

  constructor(path = process.env.DATABASE_PATH || './data/clash.db') {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  // One-shot migration that creates the v1 schema. Idempotent.
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        builder TEXT NOT NULL,
        markets TEXT NOT NULL,
        windows TEXT NOT NULL,
        integration TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        delegation_methods TEXT NOT NULL DEFAULT '["self_run"]',
        delegation_metadata TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents(owner_address);
      CREATE INDEX IF NOT EXISTS agents_status_idx ON agents(status);

      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        market TEXT NOT NULL,
        direction TEXT NOT NULL,
        result TEXT NOT NULL,
        pnl REAL NOT NULL,
        market_id TEXT NOT NULL,
        pool TEXT NOT NULL,
        filled_at TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES agents(id)
      );
      CREATE INDEX IF NOT EXISTS trades_agent_idx ON trades(agent_id);
      CREATE INDEX IF NOT EXISTS trades_filled_at_idx ON trades(filled_at);

      CREATE TABLE IF NOT EXISTS agent_api_keys (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        FOREIGN KEY(agent_id) REFERENCES agents(id)
      );
      CREATE INDEX IF NOT EXISTS api_keys_agent_idx ON agent_api_keys(agent_id);

      CREATE TABLE IF NOT EXISTS authorizations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_wallet TEXT NOT NULL,
        method TEXT NOT NULL,
        proof TEXT,
        verified_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(agent_id) REFERENCES agents(id),
        UNIQUE(agent_id, user_wallet, method)
      );
      CREATE INDEX IF NOT EXISTS authorizations_agent_idx ON authorizations(agent_id);
      CREATE INDEX IF NOT EXISTS authorizations_user_idx ON authorizations(user_wallet);

      CREATE TABLE IF NOT EXISTS follows (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        follower_address TEXT NOT NULL,
        size_multiplier REAL NOT NULL,
        max_per_trade_raw TEXT NOT NULL,
        max_daily_exposure_raw TEXT NOT NULL,
        max_daily_trades INTEGER NOT NULL,
        signed_intent TEXT NOT NULL,
        intent_nonce TEXT NOT NULL,
        signed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        paused_at TEXT,
        killed_at TEXT,
        FOREIGN KEY(agent_id) REFERENCES agents(id),
        UNIQUE(agent_id, follower_address)
      );
      CREATE INDEX IF NOT EXISTS follows_agent_idx ON follows(agent_id);
      CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows(follower_address);
      CREATE INDEX IF NOT EXISTS follows_status_idx ON follows(status);

      CREATE TABLE IF NOT EXISTS mirror_attempts (
        id TEXT PRIMARY KEY,
        follow_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        follower_address TEXT NOT NULL,
        source_tx_hash TEXT NOT NULL,
        source_market_id TEXT NOT NULL,
        source_pool TEXT NOT NULL,
        source_side TEXT NOT NULL,
        source_price_raw TEXT NOT NULL,
        source_quantity_raw TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        decision_reason TEXT,
        mirror_tx_hash TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        confirmed_at TEXT,
        FOREIGN KEY(follow_id) REFERENCES follows(id),
        UNIQUE(source_tx_hash, follower_address)
      );
      CREATE INDEX IF NOT EXISTS mirror_attempts_follow_idx ON mirror_attempts(follow_id);
      CREATE INDEX IF NOT EXISTS mirror_attempts_follower_idx ON mirror_attempts(follower_address);
      CREATE INDEX IF NOT EXISTS mirror_attempts_decision_idx ON mirror_attempts(decision);
    `)
  }

  // ─── Agents ────────────────────────────────────────────────────────────

  createAgent(agent: Agent): Agent | null {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO agents(
        id, name, description, builder, markets, windows, integration,
        wallet_address, owner_address,
        delegation_methods, delegation_metadata, status, created_at
      ) VALUES (
        @id, @name, @description, @builder, @markets, @windows, @integration,
        @walletAddress, @ownerAddress,
        @delegationMethods, @delegationMetadata, @status, @createdAt
      )
    `).run({
      ...agent,
      markets: JSON.stringify(agent.markets),
      windows: JSON.stringify(agent.windows),
      delegationMethods: JSON.stringify(agent.delegationMethods),
      delegationMetadata: JSON.stringify(agent.delegationMetadata),
    })
    return result.changes === 1 ? agent : null
  }

  listAgents(opts: { status?: Agent['status']; market?: string } = {}): Agent[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (opts.status) { where.push('status = @status'); params.status = opts.status }
    const rows = this.db.prepare(
      `SELECT * FROM agents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`
    ).all(params)
    const agents = (rows as unknown[]).map(this.mapAgent)
    if (opts.market) return agents.filter(a => a.markets.includes(opts.market as 'BTC' | 'ETH'))
    return agents
  }

  listAgentsByOwner(ownerAddress: string): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents WHERE owner_address = ? ORDER BY created_at').all(ownerAddress)
    return (rows as unknown[]).map(this.mapAgent)
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
    return row ? this.mapAgent(row) : null
  }

  getAgentByWallet(walletAddress: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE wallet_address = ? ORDER BY created_at LIMIT 1').get(walletAddress)
    return row ? this.mapAgent(row) : null
  }

  updateAgentStatus(id: string, status: Agent['status']): Agent | null {
    this.db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
    return this.getAgent(id)
  }

  updateAgentMetadata(id: string, fields: Partial<Pick<Agent, 'name' | 'description' | 'integration' | 'delegationMethods' | 'delegationMetadata'>>): Agent | null {
    const current = this.getAgent(id)
    if (!current) return null
    const updated: Agent = {
      ...current,
      ...fields,
      delegationMethods: fields.delegationMethods ?? current.delegationMethods,
      delegationMetadata: fields.delegationMetadata ?? current.delegationMetadata,
    }
    this.db.prepare(`
      UPDATE agents SET
        name = @name, description = @description, integration = @integration,
        delegation_methods = @delegationMethods, delegation_metadata = @delegationMetadata
      WHERE id = @id
    `).run({
      id,
      name: updated.name, description: updated.description, integration: updated.integration,
      delegationMethods: JSON.stringify(updated.delegationMethods),
      delegationMetadata: JSON.stringify(updated.delegationMetadata),
    })
    return this.getAgent(id)
  }

  // ─── Trades ─────────────────────────────────────────────────────────────

  upsertTrade(trade: Trade): { trade: Trade; created: boolean } {
    const existing = this.db.prepare('SELECT id FROM trades WHERE tx_hash = ?').get(trade.txHash) as { id: string } | undefined
    if (existing) return { trade, created: false }
    this.db.prepare(`
      INSERT INTO trades(
        id, agent_id, tx_hash, market, direction, result, pnl,
        market_id, pool, filled_at, source, reference, created_at
      ) VALUES (
        @id, @agentId, @txHash, @market, @direction, @result, @pnl,
        @marketId, @pool, @filledAt, @source, @reference, @createdAt
      )
    `).run(trade)
    return { trade, created: true }
  }

  listTrades(opts: { agentId?: string; limit?: number } = {}): Trade[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (opts.agentId) { where.push('agent_id = @agentId'); params.agentId = opts.agentId }
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 500
    const rows = this.db.prepare(
      `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY filled_at DESC LIMIT ${limit}`
    ).all(params)
    return (rows as unknown[]).map(this.mapTrade)
  }

  countTrades(agentId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM trades WHERE agent_id = ?').get(agentId) as { n: number }
    return row.n
  }

  // ─── API keys ───────────────────────────────────────────────────────────

  createApiKey(row: { id: string; agentId: string; keyHash: string; label?: string; createdAt: string }): void {
    this.db.prepare(`
      INSERT INTO agent_api_keys(id, agent_id, key_hash, label, created_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(row.id, row.agentId, row.keyHash, row.label ?? '', row.createdAt)
  }

  findApiKeyByHash(keyHash: string): { id: string; agentId: string; revokedAt: string | null } | null {
    const row = this.db.prepare(
      'SELECT id, agent_id AS agentId, revoked_at AS revokedAt FROM agent_api_keys WHERE key_hash = ?'
    ).get(keyHash) as { id: string; agentId: string; revokedAt: string | null } | undefined
    return row ?? null
  }

  touchApiKey(id: string): void {
    this.db.prepare('UPDATE agent_api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }

  listApiKeysForAgent(agentId: string): Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }> {
    const rows = this.db.prepare(`
      SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
      FROM agent_api_keys WHERE agent_id = ? ORDER BY created_at DESC
    `).all(agentId) as Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>
    return rows
  }

  revokeApiKey(id: string): void {
    this.db.prepare('UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }

  // ─── Authorizations ────────────────────────────────────────────────────

  upsertAuthorization(row: AuthorizationRecord): AuthorizationRecord {
    this.db.prepare(`
      INSERT INTO authorizations(id, agent_id, user_wallet, method, proof, verified_at, revoked_at)
      VALUES(@id, @agentId, @userWallet, @method, @proof, @verifiedAt, @revokedAt)
      ON CONFLICT(agent_id, user_wallet, method) DO UPDATE SET
        proof = excluded.proof,
        verified_at = excluded.verified_at,
        revoked_at = excluded.revoked_at
    `).run({
      id: row.id,
      agentId: row.agentId,
      userWallet: row.userWallet,
      method: row.method,
      proof: row.proof,
      verifiedAt: row.verifiedAt,
      revokedAt: row.revokedAt,
    })
    return row
  }

  listAuthorizationsForUser(userWallet: string): AuthorizationRecord[] {
    const rows = this.db.prepare(
      'SELECT id, agent_id AS agentId, user_wallet AS userWallet, method, proof, verified_at AS verifiedAt, revoked_at AS revokedAt FROM authorizations WHERE user_wallet = ? ORDER BY verified_at DESC'
    ).all(userWallet)
    return rows as AuthorizationRecord[]
  }

  listAuthorizationsForAgent(agentId: string): AuthorizationRecord[] {
    const rows = this.db.prepare(
      'SELECT id, agent_id AS agentId, user_wallet AS userWallet, method, proof, verified_at AS verifiedAt, revoked_at AS revokedAt FROM authorizations WHERE agent_id = ? ORDER BY verified_at DESC'
    ).all(agentId)
    return rows as AuthorizationRecord[]
  }

  getAuthorization(agentId: string, userWallet: string, method: AuthorizationRecord['method']): AuthorizationRecord | null {
    const row = this.db.prepare(
      'SELECT id, agent_id AS agentId, user_wallet AS userWallet, method, proof, verified_at AS verifiedAt, revoked_at AS revokedAt FROM authorizations WHERE agent_id = ? AND user_wallet = ? AND method = ?'
    ).get(agentId, userWallet, method) as AuthorizationRecord | undefined
    return row ?? null
  }

  revokeAuthorization(agentId: string, userWallet: string, method: AuthorizationRecord['method']): void {
    this.db.prepare(
      'UPDATE authorizations SET revoked_at = ? WHERE agent_id = ? AND user_wallet = ? AND method = ?'
    ).run(new Date().toISOString(), agentId, userWallet, method)
  }

  // ─── Mappers ────────────────────────────────────────────────────────────

  private mapAgent = (row: unknown): Agent => {
    const r = row as Record<string, string>
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      builder: r.builder,
      markets: JSON.parse(r.markets) as Agent['markets'],
      windows: JSON.parse(r.windows) as Agent['windows'],
      integration: r.integration,
      walletAddress: r.wallet_address as `0x${string}`,
      ownerAddress: r.owner_address as `0x${string}`,
      delegationMethods: JSON.parse(r.delegation_methods) as Agent['delegationMethods'],
      delegationMetadata: JSON.parse(r.delegation_metadata) as Agent['delegationMetadata'],
      status: r.status as Agent['status'],
      createdAt: r.created_at,
    }
  }

  private mapTrade = (row: unknown): Trade => {
    const r = row as Record<string, string | number | null>
    return {
      id: r.id as string,
      agentId: r.agent_id as string,
      txHash: r.tx_hash as `0x${string}`,
      market: r.market as 'BTC' | 'ETH',
      direction: r.direction as 'UP' | 'DOWN',
      result: r.result as 'WIN' | 'LOSS',
      pnl: Number(r.pnl),
      marketId: r.market_id as `0x${string}`,
      pool: r.pool as `0x${string}`,
      filledAt: r.filled_at as string,
      source: r.source as 'binary' | 'spot',
      reference: (r.reference ?? undefined) as `0x${string}` | undefined,
      createdAt: r.created_at as string,
    }
  }

  // ─── Follows (copy-trading) ────────────────────────────────────────────

  upsertFollow(follow: Follow): Follow {
    // The (agent, follower) UNIQUE constraint means "upsert" replaces
    // the previous follow in place, preserving the follow.id is fine —
    // we keep the existing id and just refresh the config.
    const existing = this.db.prepare(
      'SELECT id FROM follows WHERE agent_id = ? AND follower_address = ?'
    ).get(follow.agentId, follow.followerAddress.toLowerCase()) as { id: string } | undefined
    if (existing) {
      this.db.prepare(`
        UPDATE follows SET
          size_multiplier = @sizeMultiplier,
          max_per_trade_raw = @maxPerTradeRaw,
          max_daily_exposure_raw = @maxDailyExposureRaw,
          max_daily_trades = @maxDailyTrades,
          signed_intent = @signedIntent,
          intent_nonce = @intentNonce,
          signed_at = @signedAt,
          expires_at = @expiresAt,
          status = @status,
          paused_at = @pausedAt,
          killed_at = @killedAt
        WHERE id = @id
      `).run({
        id: existing.id,
        sizeMultiplier: follow.sizeMultiplier,
        maxPerTradeRaw: follow.maxPerTradeRaw,
        maxDailyExposureRaw: follow.maxDailyExposureRaw,
        maxDailyTrades: follow.maxDailyTrades,
        signedIntent: follow.signedIntent,
        intentNonce: follow.intentNonce,
        signedAt: follow.signedAt,
        expiresAt: follow.expiresAt,
        status: follow.status,
        pausedAt: follow.pausedAt,
        killedAt: follow.killedAt,
      })
      return this.getFollow(existing.id)!
    }
    this.db.prepare(`
      INSERT INTO follows(
        id, agent_id, follower_address, size_multiplier,
        max_per_trade_raw, max_daily_exposure_raw, max_daily_trades,
        signed_intent, intent_nonce, signed_at, expires_at, status,
        created_at, paused_at, killed_at
      ) VALUES (
        @id, @agentId, @followerAddress, @sizeMultiplier,
        @maxPerTradeRaw, @maxDailyExposureRaw, @maxDailyTrades,
        @signedIntent, @intentNonce, @signedAt, @expiresAt, @status,
        @createdAt, @pausedAt, @killedAt
      )
    `).run({
      id: follow.id,
      agentId: follow.agentId,
      followerAddress: follow.followerAddress.toLowerCase(),
      sizeMultiplier: follow.sizeMultiplier,
      maxPerTradeRaw: follow.maxPerTradeRaw,
      maxDailyExposureRaw: follow.maxDailyExposureRaw,
      maxDailyTrades: follow.maxDailyTrades,
      signedIntent: follow.signedIntent,
      intentNonce: follow.intentNonce,
      signedAt: follow.signedAt,
      expiresAt: follow.expiresAt,
      status: follow.status,
      createdAt: follow.createdAt,
      pausedAt: follow.pausedAt,
      killedAt: follow.killedAt,
    })
    return follow
  }

  getFollow(id: string): Follow | null {
    const row = this.db.prepare('SELECT * FROM follows WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapFollow(row) : null
  }

  getFollowByAgentAndFollower(agentId: string, followerAddress: string): Follow | null {
    const row = this.db.prepare(
      'SELECT * FROM follows WHERE agent_id = ? AND follower_address = ?'
    ).get(agentId, followerAddress.toLowerCase()) as Record<string, unknown> | undefined
    return row ? this.mapFollow(row) : null
  }

  listFollowsForFollower(followerAddress: string): Follow[] {
    const rows = this.db.prepare(
      'SELECT * FROM follows WHERE follower_address = ? ORDER BY created_at DESC'
    ).all(followerAddress.toLowerCase()) as Record<string, unknown>[]
    return rows.map(r => this.mapFollow(r))
  }

  listActiveFollowsForAgent(agentId: string): Follow[] {
    const rows = this.db.prepare(
      `SELECT * FROM follows WHERE agent_id = ? AND status = 'active' AND expires_at > ? ORDER BY created_at`
    ).all(agentId, new Date().toISOString()) as Record<string, unknown>[]
    return rows.map(r => this.mapFollow(r))
  }

  updateFollowStatus(id: string, status: Follow['status']): Follow | null {
    const now = new Date().toISOString()
    if (status === 'paused') {
      this.db.prepare('UPDATE follows SET status = ?, paused_at = ? WHERE id = ?').run(status, now, id)
    } else if (status === 'killed') {
      this.db.prepare('UPDATE follows SET status = ?, killed_at = ? WHERE id = ?').run(status, now, id)
    } else {
      this.db.prepare('UPDATE follows SET status = ?, paused_at = NULL WHERE id = ?').run(status, id)
    }
    return this.getFollow(id)
  }

  // ─── Mirror attempts ──────────────────────────────────────────────────

  createMirrorAttempt(attempt: MirrorAttempt): MirrorAttempt {
    // UNIQUE(source_tx_hash, follower_address) — if the runtime already
    // recorded an attempt for this (source, follower), no-op.
    const existing = this.db.prepare(
      'SELECT id FROM mirror_attempts WHERE source_tx_hash = ? AND follower_address = ?'
    ).get(attempt.sourceTxHash, attempt.followerAddress.toLowerCase()) as { id: string } | undefined
    if (existing) return this.getMirrorAttempt(existing.id)!
    this.db.prepare(`
      INSERT INTO mirror_attempts(
        id, follow_id, agent_id, follower_address,
        source_tx_hash, source_market_id, source_pool, source_side,
        source_price_raw, source_quantity_raw,
        decision, decision_reason, mirror_tx_hash,
        created_at, decided_at, confirmed_at
      ) VALUES (
        @id, @followId, @agentId, @followerAddress,
        @sourceTxHash, @sourceMarketId, @sourcePool, @sourceSide,
        @sourcePriceRaw, @sourceQuantityRaw,
        @decision, @decisionReason, @mirrorTxHash,
        @createdAt, @decidedAt, @confirmedAt
      )
    `).run({
      id: attempt.id,
      followId: attempt.followId,
      agentId: attempt.agentId,
      followerAddress: attempt.followerAddress.toLowerCase(),
      sourceTxHash: attempt.sourceTxHash,
      sourceMarketId: attempt.sourceMarketId,
      sourcePool: attempt.sourcePool,
      sourceSide: attempt.sourceSide,
      sourcePriceRaw: attempt.sourcePriceRaw,
      sourceQuantityRaw: attempt.sourceQuantityRaw,
      decision: attempt.decision,
      decisionReason: attempt.decisionReason,
      mirrorTxHash: attempt.mirrorTxHash,
      createdAt: attempt.createdAt,
      decidedAt: attempt.decidedAt,
      confirmedAt: attempt.confirmedAt,
    })
    return attempt
  }

  getMirrorAttempt(id: string): MirrorAttempt | null {
    const row = this.db.prepare('SELECT * FROM mirror_attempts WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapMirrorAttempt(row) : null
  }

  listMirrorAttempts(opts: { followerAddress?: string; followId?: string; decision?: MirrorAttempt['decision']; limit?: number } = {}): MirrorAttempt[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (opts.followerAddress) { where.push('follower_address = @followerAddress'); params.followerAddress = opts.followerAddress.toLowerCase() }
    if (opts.followId) { where.push('follow_id = @followId'); params.followId = opts.followId }
    if (opts.decision) { where.push('decision = @decision'); params.decision = opts.decision }
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 200
    const rows = this.db.prepare(
      `SELECT * FROM mirror_attempts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit}`
    ).all(params) as Record<string, unknown>[]
    return rows.map(r => this.mapMirrorAttempt(r))
  }

  // Pending = "broadcast" — runtime has asked the user to sign. Used by
  // the follower's open tab to know what to do next.
  listPendingMirrorAttempts(followerAddress: string, limit = 50): MirrorAttempt[] {
    return this.listMirrorAttempts({ followerAddress, decision: 'broadcast', limit })
  }

  updateMirrorAttemptDecision(id: string, decision: MirrorAttempt['decision'], reason: string | null): MirrorAttempt | null {
    const now = new Date().toISOString()
    this.db.prepare(
      'UPDATE mirror_attempts SET decision = ?, decision_reason = ?, decided_at = ? WHERE id = ?'
    ).run(decision, reason, now, id)
    return this.getMirrorAttempt(id)
  }

  updateMirrorAttemptConfirmed(id: string, mirrorTxHash: `0x${string}`): MirrorAttempt | null {
    const now = new Date().toISOString()
    this.db.prepare(
      'UPDATE mirror_attempts SET decision = ?, mirror_tx_hash = ?, confirmed_at = ? WHERE id = ?'
    ).run('confirmed', mirrorTxHash, now, id)
    return this.getMirrorAttempt(id)
  }

  // Daily aggregate for cap enforcement. Returns raw tUSDC summed across
  // confirmed+failed mirror attempts in the last 24h, plus the count.
  dailyMirrorStats(followId: string): { exposureRaw: string; count: number } {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    // Both source_quantity_raw and source_price_raw are 6dp tUSDC
    // amounts. Their product is in raw^2 — divide by 10^6 to recover
    // raw tUSDC exposure (the actual collateral the follower spent).
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CAST(source_quantity_raw AS INTEGER) * CAST(source_price_raw AS INTEGER) / 1000000), 0) AS exposure,
        COUNT(*) AS n
      FROM mirror_attempts
      WHERE follow_id = ? AND created_at >= ? AND decision IN ('broadcast','confirmed','failed')
    `).get(followId, since) as { exposure: number | bigint; n: number }
    // bigint SUM is returned as bigint by better-sqlite3. Normalize to string.
    const exposure = typeof row.exposure === 'bigint' ? row.exposure.toString() : String(row.exposure)
    return { exposureRaw: exposure, count: row.n }
  }

  // ─── Mappers ────────────────────────────────────────────────────────────

  private mapFollow = (row: Record<string, unknown>): Follow => ({
    id: row.id as string,
    agentId: row.agent_id as string,
    followerAddress: (row.follower_address as string) as `0x${string}`,
    sizeMultiplier: Number(row.size_multiplier),
    maxPerTradeRaw: row.max_per_trade_raw as string,
    maxDailyExposureRaw: row.max_daily_exposure_raw as string,
    maxDailyTrades: row.max_daily_trades as number,
    signedIntent: (row.signed_intent as string) as `0x${string}`,
    intentNonce: (row.intent_nonce as string) as `0x${string}`,
    signedAt: row.signed_at as string,
    expiresAt: row.expires_at as string,
    status: row.status as Follow['status'],
    createdAt: row.created_at as string,
    pausedAt: (row.paused_at as string | null) ?? null,
    killedAt: (row.killed_at as string | null) ?? null,
  })

  private mapMirrorAttempt = (row: Record<string, unknown>): MirrorAttempt => ({
    id: row.id as string,
    followId: row.follow_id as string,
    agentId: row.agent_id as string,
    followerAddress: (row.follower_address as string) as `0x${string}`,
    sourceTxHash: (row.source_tx_hash as string) as `0x${string}`,
    sourceMarketId: (row.source_market_id as string) as `0x${string}`,
    sourcePool: (row.source_pool as string) as `0x${string}`,
    sourceSide: row.source_side as MirrorAttempt['sourceSide'],
    sourcePriceRaw: row.source_price_raw as string,
    sourceQuantityRaw: row.source_quantity_raw as string,
    decision: row.decision as MirrorAttempt['decision'],
    decisionReason: (row.decision_reason as string | null) ?? null,
    mirrorTxHash: (row.mirror_tx_hash as string | null) as `0x${string}` | null,
    createdAt: row.created_at as string,
    decidedAt: (row.decided_at as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
  })

  close(): void { this.db.close() }
}
