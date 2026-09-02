import { type Agent, type Trade, type AgentPerformance } from './domain'

// Re-export the domain types so the rest of the app can import from the
// store barrel. The store is intentionally tiny: the marketplace is mostly
// a read surface, and the React Query / fetch state lives in the components.
export type { Agent, Trade, AgentPerformance, DelegationMethod, DelegationMetadata } from './domain'
export { rankAgents, metrics } from './domain'

// ─── Helpers ───────────────────────────────────────────────────────────────

export function formatPnl(n: number): string {
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  let formatted: string
  if (abs >= 100) formatted = abs.toFixed(0)
  else if (abs >= 0.01) formatted = abs.toFixed(2)
  else formatted = abs.toFixed(6).replace(/0+$/, '')
  return `${n > 0 ? '+' : '-'}$${formatted}`
}

export function formatPercent(n: number, fractionDigits = 1): string {
  return `${(n * 100).toFixed(fractionDigits)}%`
}

export function formatUtcStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  const year = String(d.getUTCFullYear()).slice(-2)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day}-${month}-${year} ${hh}:${mm} UTC`
}

export function shortAddress(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ─── Lightweight fetch helpers ────────────────────────────────────────────

export async function fetchAgents(opts: { market?: string } = {}): Promise<{ agents: Agent[]; ranked: AgentPerformance[]; count: number }> {
  const qs = opts.market ? `?market=${opts.market}` : ''
  const res = await fetch(`/api/agents${qs}`)
  if (!res.ok) throw new Error(`Failed to load agents: HTTP ${res.status}`)
  return res.json()
}

export async function fetchAgent(id: string): Promise<{ agent: Agent; performance: AgentPerformance; trades: Trade[] }> {
  const res = await fetch(`/api/agents/${id}`)
  if (!res.ok) throw new Error(`Failed to load agent: HTTP ${res.status}`)
  return res.json()
}

export async function fetchActivity(limit = 50): Promise<{ activity: Array<{ id: string; agentId: string; agentName: string; market: string; direction: 'UP' | 'DOWN'; result: 'WIN' | 'LOSS'; pnl: number; txHash: string; filledAt: string; source: string }>; count: number }> {
  const res = await fetch(`/api/activity?limit=${limit}`)
  if (!res.ok) throw new Error(`Failed to load activity: HTTP ${res.status}`)
  return res.json()
}

export async function fetchRankings(market?: string): Promise<{ ranked: AgentPerformance[]; count: number }> {
  const qs = market ? `?market=${market}` : ''
  const res = await fetch(`/api/rankings${qs}`)
  if (!res.ok) throw new Error(`Failed to load rankings: HTTP ${res.status}`)
  return res.json()
}

export async function checkUseState(agentId: string, userWallet: string) {
  const res = await fetch(`/api/agents/${agentId}/use?user=${userWallet}`)
  if (!res.ok) throw new Error(`Failed to check authorization: HTTP ${res.status}`)
  return res.json() as Promise<{
    agentId: string
    userWallet: string
    agentWallet: string
    supportedMethods: string[]
    path: 'spot_operator' | 'session_tx' | 'self_run'
    authorized: boolean
    proof: string | null
    reason?: string
  }>
}

export async function recordUseState(agentId: string, userWallet: string, method: 'spot_operator' | 'session_tx' | 'self_run') {
  const res = await fetch(`/api/agents/${agentId}/use`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userWallet, method }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to record authorization: HTTP ${res.status}`)
  }
  return res.json()
}

export async function revokeUseState(agentId: string, userWallet: string, method: 'spot_operator' | 'session_tx') {
  const res = await fetch(`/api/agents/${agentId}/use/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userWallet, method }),
  })
  if (!res.ok) throw new Error(`Failed to revoke: HTTP ${res.status}`)
  return res.json()
}

export async function registerAgent(payload: {
  name: string
  description: string
  builder: string
  markets: ('BTC' | 'ETH')[]
  windows: ('15M' | '1H')[]
  integration: string
  walletAddress: `0x${string}`
  ownerAddress: `0x${string}`
  delegationMethods: ('spot_operator' | 'session_tx' | 'self_run')[]
  delegationMetadata: { spotPoolAddress?: `0x${string}`; sessionContract?: `0x${string}`; notes?: string }
}) {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to register: HTTP ${res.status}`)
  }
  return res.json() as Promise<{ agent: Agent; apiKey: string; apiKeyNote: string }>
}

export async function listMyAgents(owner: `0x${string}`): Promise<{ agents: Agent[] }> {
  const res = await fetch(`/api/agents/mine?owner=${owner}`)
  if (!res.ok) throw new Error(`Failed to load my agents: HTTP ${res.status}`)
  return res.json()
}

// Developer dashboard helpers. All requests to these endpoints carry an
// `X-Owner-Wallet` header so the server can confirm the caller is the
// registered owner of the agent.
export async function fetchDashboard(agentId: string, ownerWallet: `0x${string}`) {
  const res = await fetch(`/api/agents/${agentId}/dashboard`, { headers: { 'X-Owner-Wallet': ownerWallet } })
  if (!res.ok) throw new Error(`Failed to load dashboard: HTTP ${res.status}`)
  return res.json() as Promise<{
    agent: Agent
    performance: AgentPerformance
    recentTrades: Trade[]
    apiKeys: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>
  }>
}

export async function updateAgent(agentId: string, ownerWallet: `0x${string}`, patch: Partial<{
  description: string
  integration: string
  delegationMethods: ('spot_operator' | 'session_tx' | 'self_run')[]
  delegationMetadata: { spotPoolAddress?: `0x${string}`; sessionContract?: `0x${string}`; notes?: string }
  status: 'active' | 'paused' | 'retired'
}>) {
  const res = await fetch(`/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'X-Owner-Wallet': ownerWallet },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to update agent: HTTP ${res.status}`)
  }
  return res.json() as Promise<{ agent: Agent }>
}

export async function listApiKeys(agentId: string, ownerWallet: `0x${string}`) {
  const res = await fetch(`/api/agents/${agentId}/api-keys`, { headers: { 'X-Owner-Wallet': ownerWallet } })
  if (!res.ok) throw new Error(`Failed to load keys: HTTP ${res.status}`)
  return res.json() as Promise<{ keys: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }> }>
}

export async function rotateApiKey(agentId: string, ownerWallet: `0x${string}`) {
  const res = await fetch(`/api/agents/${agentId}/api-keys/rotate`, {
    method: 'POST',
    headers: { 'X-Owner-Wallet': ownerWallet },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to rotate key: HTTP ${res.status}`)
  }
  return res.json() as Promise<{ apiKey: string; apiKeyNote: string }>
}
