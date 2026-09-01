// CLASH domain types. Pure types and pure functions only — no I/O, no SDK imports.

export type Market = 'BTC' | 'ETH'
export type Window = '15M' | '1H'
export type Direction = 'UP' | 'DOWN'
export type TradeResult = 'WIN' | 'LOSS'

// What the marketplace shows about a registered agent. Public, no secrets.
export interface Agent {
  id: string
  name: string
  description: string
  builder: string
  markets: Market[]
  windows: Window[]
  integration: string  // URL to agent instructions
  walletAddress: `0x${string}`  // public address the agent uses to trade
  ownerAddress: `0x${string}`   // developer's wallet, owns the registration
  // Which authorization paths this agent supports for users who want to "Use Agent".
  // CLASH never invents a path. The agent tells CLASH which paths are real.
  delegationMethods: DelegationMethod[]
  // Per-method metadata, opaque to CLASH except for the fields CLASH needs
  // to verify on-chain (e.g. spot pool address for the spot operator grant).
  delegationMetadata: DelegationMetadata
  // Marketplace visibility state. `paused` agents are still visible but cannot
  // be authorized. `retired` agents are hidden from the explore page.
  status: 'active' | 'paused' | 'retired'
  createdAt: string
}

export type DelegationMethod = 'spot_operator' | 'session_tx' | 'self_run'

export interface DelegationMetadata {
  // The spot pool the agent trades on. Required for `spot_operator`.
  spotPoolAddress?: `0x${string}`
  // The agent's session-implementation contract. Required for `session_tx`.
  // The contract is owned by the agent's developer and exposes the agent's
  // own session / EIP-7702 flow. CLASH does not implement this.
  sessionContract?: `0x${string}`
  // Human-readable notes the agent publishes (free text, shown in the Use Agent page).
  notes?: string
}

// A verified on-chain fill attributed to an agent. The single source of truth
// for performance calculations.
export interface Trade {
  id: string
  agentId: string
  // The verified on-chain reference. The tx hash is UNIQUE in the database so
  // we never double-count a fill.
  txHash: `0x${string}`
  market: Market
  direction: Direction
  result: TradeResult
  // Realized PnL in tUSDC (or spot quote token). The number is what the SDK
  // returned, formatted by the frontend for display. Negative is a loss.
  pnl: number
  // The market ID on DreamDEX. Bytes32 hex string.
  marketId: `0x${string}`
  // The pool address the trade was placed on.
  pool: `0x${string}`
  // When the fill was observed on-chain.
  filledAt: string
  // 'binary' for event contracts, 'spot' for spot fills.
  source: 'binary' | 'spot'
  // Resolution or settlement transaction reference, if known.
  reference?: `0x${string}`
  createdAt: string
}

// Performance metrics for a single agent, derived from its verified trades.
export interface AgentPerformance {
  agent: Agent
  pnl: number
  winRate: number         // 0..1
  trades: number
  wins: number
  losses: number
  drawdown: number        // max drawdown in tUSDC
  lastTradeAt: string | null
  // 30-day and 90-day rolling PnL, where available.
  pnl30d: number
  pnl90d: number
}

// A per-agent authorization record CLASH keeps so it can render the live
// "use" state on the agent's profile. CLASH never creates this record unless
// the on-chain authorization is independently verified.
export interface AuthorizationRecord {
  id: string
  agentId: string
  // The user wallet that authorized the agent. CLASH tracks this by wallet.
  userWallet: `0x${string}`
  // Which path was used.
  method: DelegationMethod
  // The on-chain proof CLASH observed. For spot_operator, this is the tx hash
  // of the most recent approval. For session_tx, this is the implementation
  // contract address the user delegated to. For self_run, this is null.
  proof: `0x${string}` | null
  // When CLASH last verified the authorization is still live on-chain.
  verifiedAt: string
  // When the user revoked (if they did). CLASH keeps a history; it does not
  // delete the row on revoke, so users can see "you used this agent, then
  // revoked on date X."
  revokedAt: string | null
}

// Pure functions.

/**
 * Compute performance metrics for one agent from its verified trades.
 * The metrics function is pure: same trades in, same metrics out.
 */
export function metrics(agent: Agent, trades: Trade[]): AgentPerformance {
  const own = trades.filter(t => t.agentId === agent.id).sort((a, b) => a.filledAt.localeCompare(b.filledAt))
  const pnl = own.reduce((s, t) => s + t.pnl, 0)
  const wins = own.filter(t => t.result === 'WIN').length
  const losses = own.length - wins
  // Max drawdown: the most negative peak-to-trough drop in cumulative PnL.
  let equity = 0, peak = 0, drawdown = 0
  for (const t of own) {
    equity += t.pnl
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, peak - equity)
  }
  // 30-day / 90-day rolling PnL.
  const now = Date.now()
  const day30 = now - 30 * 24 * 60 * 60 * 1000
  const day90 = now - 90 * 24 * 60 * 60 * 1000
  const pnl30d = own.filter(t => Date.parse(t.filledAt) >= day30).reduce((s, t) => s + t.pnl, 0)
  const pnl90d = own.filter(t => Date.parse(t.filledAt) >= day90).reduce((s, t) => s + t.pnl, 0)
  const lastTradeAt = own.length > 0 ? own[own.length - 1]!.filledAt : null
  return {
    agent, pnl, wins, losses, trades: own.length,
    winRate: own.length > 0 ? wins / own.length : 0,
    drawdown, pnl30d, pnl90d, lastTradeAt,
  }
}

/**
 * Rank agents for the marketplace. Discovery-oriented, not competition-oriented.
 * Primary sort: realized PnL desc. Tie breakers: lower drawdown, higher win rate,
 * higher trade count, then name.
 */
export function rankAgents(agents: Agent[], trades: Trade[]): AgentPerformance[] {
  return agents
    .map(a => metrics(a, trades))
    .sort((a, b) =>
      b.pnl - a.pnl
      || a.drawdown - b.drawdown
      || b.winRate - a.winRate
      || b.trades - a.trades
      || a.agent.name.localeCompare(b.agent.name),
    )
}
