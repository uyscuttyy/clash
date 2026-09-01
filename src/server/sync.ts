// Background sync worker. Periodically walks every active agent's on-chain
// activity and re-derives verified trades. CLASH never signs; this worker
// only reads from the indexer and writes to the local database.
//
// The worker is started by the API server on boot. It uses setInterval at a
// fixed cadence (default: 5 minutes). On a real production deployment, this
// would be a separate process; for the hackathon MVP it lives in the same
// Node process as the API.

import { randomUUID } from 'node:crypto'
import { DreamDexAdapter } from './dreamdex'
import { Repository } from './repository'
import { type Trade } from '../domain'

export interface SyncOptions {
  intervalMs: number
  // When true, sync every active agent immediately on startup. Default true.
  syncOnStart: boolean
  // When true, run a sync pass immediately and then return, for tests.
  once: boolean
}

const DEFAULT_OPTIONS: SyncOptions = {
  intervalMs: 5 * 60 * 1000,
  syncOnStart: true,
  once: false,
}

export class SyncWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastRunAt: string | null = null
  private lastResult: { agentsScanned: number; tradesUpserted: number; errors: string[] } | null = null
  private readonly repo: Repository
  private readonly dreamdex: DreamDexAdapter
  private readonly options: SyncOptions

  constructor(repo: Repository, dreamdex: DreamDexAdapter = new DreamDexAdapter(), options: SyncOptions = DEFAULT_OPTIONS) {
    this.repo = repo
    this.dreamdex = dreamdex
    this.options = options
  }

  start(): void {
    if (this.timer) return
    if (this.options.syncOnStart) {
      void this.runOnce()
    }
    if (this.options.once) return
    this.timer = setInterval(() => { void this.runOnce() }, this.options.intervalMs)
    // Don't keep the process alive just for the timer.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  status(): { running: boolean; lastRunAt: string | null; lastResult: { agentsScanned: number; tradesUpserted: number; errors: string[] } | null } {
    return { running: this.running, lastRunAt: this.lastRunAt, lastResult: this.lastResult }
  }

  async runOnce(): Promise<{ agentsScanned: number; tradesUpserted: number; errors: string[] }> {
    if (this.running) return { agentsScanned: 0, tradesUpserted: 0, errors: ['sync already in progress'] }
    this.running = true
    const errors: string[] = []
    let agentsScanned = 0
    let tradesUpserted = 0
    try {
      const agents = this.repo.listAgents({ status: 'active' })
      for (const agent of agents) {
        agentsScanned++
        try {
          const result = await this.syncAgent(agent.id, agent.walletAddress)
          tradesUpserted += result
        } catch (err) {
          errors.push(`${agent.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } finally {
      this.running = false
      this.lastRunAt = new Date().toISOString()
      this.lastResult = { agentsScanned, tradesUpserted, errors }
    }
    return this.lastResult
  }

  // For one agent, walk every settled binary market they ever traded on and
  // upsert any trades not already in the database. The SDK's getOrders
  // returns the agent's order history; for each unique market we ask for the
  // settled performance, and if the SDK returns a non-null result, we
  // upsert the trade row.
  private async syncAgent(agentId: string, walletAddress: `0x${string}`): Promise<number> {
    const orders = await this.dreamdex.ordersForWallet(walletAddress)
    const filledOrders = orders.filter(o => BigInt(o.filledQuantity) > 0n && (o.asset === 'BTC' || o.asset === 'ETH'))
    const uniqueMarkets = [...new Set(filledOrders.map(o => o.marketId))]
    let upserted = 0
    for (const marketId of uniqueMarkets) {
      const settled = await this.dreamdex.settledBinaryPerformance(walletAddress, marketId)
      if (!settled) continue
      const trade: Trade = {
        id: randomUUID(),
        agentId,
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
      const out = this.repo.upsertTrade(trade)
      if (out.created) upserted++
    }
    return upserted
  }
}
