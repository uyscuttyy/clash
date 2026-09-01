import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { type Agent, type Trade, type AuthorizationRecord } from '../domain'

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

  close(): void { this.db.close() }
}
