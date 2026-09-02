import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Copy, Eye, EyeOff, Pause, Play, RotateCcw, X } from 'lucide-react'
import {
  fetchDashboard, formatPnl, formatPercent, formatUtcStamp, listApiKeys, rotateApiKey,
  updateAgent, type Agent, type AgentPerformance, type Trade,
} from '../store'
import { useAsync } from '../useAsync'
import { useWallet } from '../useWallet'

type Status = 'active' | 'paused' | 'retired'

export function DeveloperDashboard() {
  const { id } = useParams<{ id: string }>()
  const { isConnected, address, isOnSomnia, switchToSomnia, isSwitching } = useWallet()
  const [tick, setTick] = useState(0)

  if (!isConnected) {
    return (
      <section className="page">
        <Link className="back-link" to="/developers"><ArrowLeft /> Back to developer portal</Link>
        <div className="empty">
          <b>Connect your developer wallet.</b>
          <p>CLASH ties agent management to the connected wallet.</p>
        </div>
      </section>
    )
  }
  if (!isOnSomnia) {
    return (
      <section className="page">
        <Link className="back-link" to="/developers"><ArrowLeft /> Back to developer portal</Link>
        <div className="empty">
          <b>Switch to Somnia.</b>
          <p>This agent's dashboard is on the Somnia Shannon testnet.</p>
          <button className="button" onClick={switchToSomnia} disabled={isSwitching}>{isSwitching ? 'Switching…' : 'Switch to Somnia'}</button>
        </div>
      </section>
    )
  }
  return <DashboardBody key={`${id}-${tick}`} agentId={String(id ?? '')} owner={address!} onRefresh={() => setTick(t => t + 1)} />
}

function DashboardBody({ agentId, owner, onRefresh }: { agentId: string; owner: `0x${string}`; onRefresh: () => void }) {
  const { data, loading, error, refresh } = useAsync(() => fetchDashboard(agentId, owner), [agentId, owner])
  const [tab, setTab] = useState<'overview' | 'edit' | 'keys'>('overview')

  if (loading) return <section className="page"><p className="muted">Loading dashboard…</p></section>
  if (error) {
    if (/HTTP 403|HTTP 404/.test(error)) {
      return (
        <section className="page">
          <Link className="back-link" to="/developers"><ArrowLeft /> Back to developer portal</Link>
          <div className="empty">
            <b>This dashboard is not yours.</b>
            <p>CLASH only shows the dashboard to the wallet that registered the agent. Connect the owner wallet to manage this agent.</p>
          </div>
        </section>
      )
    }
    return <section className="page"><p className="error">Could not load dashboard: {error}</p></section>
  }
  if (!data) return <section className="page"><h1>Agent not found.</h1></section>
  return <DashboardContent data={data} tab={tab} setTab={setTab} owner={owner} onChange={() => { refresh(); onRefresh() }} />
}

function DashboardContent({
  data, tab, setTab, owner, onChange,
}: {
  data: { agent: Agent; performance: AgentPerformance; recentTrades: Trade[]; apiKeys: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }> }
  tab: 'overview' | 'edit' | 'keys'
  setTab: (t: 'overview' | 'edit' | 'keys') => void
  owner: `0x${string}`
  onChange: () => void
}) {
  const { agent: a, performance: p, recentTrades } = data
  return (
    <section className="page dashboard-page">
      <Link className="back-link" to="/developers"><ArrowLeft /> Back to developer portal</Link>
      <div className="dashboard-head">
        <div>
          <p className="eyebrow">DEVELOPER DASHBOARD</p>
          <h1>{a.name}</h1>
          <p className="muted">{a.builder} · {a.markets.join(' / ')} · {a.windows.join(' / ')}</p>
        </div>
        <div className="dashboard-head-actions">
          <Link className="button ghost" to={`/agents/${a.id}`}>View public profile <ChevronRight /></Link>
          <StatusControl agent={a} owner={owner} onChange={onChange} />
        </div>
      </div>

      <div className="profile-stats">
        <div className="metric-tile"><span className="metric-label">REALIZED PNL</span><span className={`metric-value ${p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl)}</span></div>
        <div className="metric-tile"><span className="metric-label">WIN RATE</span><span className="metric-value">{formatPercent(p.winRate)}</span></div>
        <div className="metric-tile"><span className="metric-label">SETTLED TRADES</span><span className="metric-value">{p.trades}</span></div>
        <div className="metric-tile"><span className="metric-label">30-DAY PNL</span><span className={`metric-value ${p.pnl30d > 0 ? 'pnl-pos' : p.pnl30d < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl30d)}</span></div>
      </div>

      <nav className="dashboard-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>Edit profile</button>
        <button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}>API keys</button>
      </nav>

      {tab === 'overview' ? <OverviewTab trades={recentTrades} /> : null}
      {tab === 'edit' ? <EditTab agent={a} owner={owner} onChange={onChange} /> : null}
      {tab === 'keys' ? <KeysTab agentId={a.id} owner={owner} initial={data.apiKeys} /> : null}
    </section>
  )
}

function StatusControl({ agent, owner, onChange }: { agent: Agent; owner: `0x${string}`; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function set(status: Status) {
    setBusy(true); setError(null)
    try {
      await updateAgent(agent.id, owner, { status })
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }
  return (
    <div className="status-control">
      {agent.status === 'active'
        ? <button className="button ghost" disabled={busy} onClick={() => set('paused')}><Pause /> Pause</button>
        : agent.status === 'paused'
          ? <button className="button" disabled={busy} onClick={() => set('active')}><Play /> Resume</button>
          : <button className="button ghost" disabled={busy} onClick={() => set('active')}><RotateCcw /> Restore</button>
      }
      {agent.status !== 'retired' && <button className="button warn" disabled={busy} onClick={() => set('retired')}><X /> Retire</button>}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

function OverviewTab({ trades }: { trades: Trade[] }) {
  return (
    <div className="dashboard-section">
      <div className="section-head">
        <p className="eyebrow">RECENT VERIFIED TRADES</p>
        <h2>Last 10 settlements</h2>
      </div>
      {trades.length === 0
        ? <div className="empty"><b>No verified trades yet.</b><p>CLASH re-indexes every 5 minutes. As soon as your agent's first trade settles on Somnia, it will appear here.</p></div>
        : <div className="trade-list">
            <div className="trade-header">
              <span>Market</span><span>Direction</span><span>Result</span><span>PnL</span><span>Filled at</span>
            </div>
            {trades.map(t => <RecentTradeRow key={t.id} trade={t} />)}
          </div>
      }
    </div>
  )
}

function RecentTradeRow({ trade: t }: { trade: Trade }) {
  const dir = t.direction === 'UP' ? 'pnl-pos' : 'pnl-neg'
  const result = t.result === 'WIN' ? 'pnl-pos' : 'pnl-neg'
  return (
    <a className="trade-row" href={`https://shannonscan.xyz/tx/${t.txHash}`} target="_blank" rel="noopener">
      <span className="trade-market"><b>{t.market}</b><small>{t.txHash.slice(0, 10)}…</small></span>
      <span className={`trade-direction ${dir}`}>{t.direction}</span>
      <span className={`trade-result ${result}`}>{t.result}</span>
      <span className={`trade-pnl ${t.pnl > 0 ? 'pnl-pos' : t.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(t.pnl)}</span>
      <span className="trade-time">{formatUtcStamp(t.filledAt)}</span>
    </a>
  )
}

function EditTab({ agent, owner, onChange }: { agent: Agent; owner: `0x${string}`; onChange: () => void }) {
  const [description, setDescription] = useState(agent.description)
  const [integration, setIntegration] = useState(agent.integration)
  const [methods, setMethods] = useState(agent.delegationMethods)
  const [spotPool, setSpotPool] = useState(agent.delegationMetadata.spotPoolAddress ?? '')
  const [sessionContract, setSessionContract] = useState(agent.delegationMetadata.sessionContract ?? '')
  const [notes, setNotes] = useState(agent.delegationMetadata.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function toggleMethod(m: typeof methods[number]) {
    setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
    setSaved(false)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null); setSaved(false)
    if (description.trim().length < 10) { setError('Description is too short.'); return }
    if (methods.length === 0) { setError('Pick at least one delegation method.'); return }
    if (methods.includes('spot_operator') && !/^0x[0-9a-fA-F]{40}$/.test(spotPool)) {
      setError('Spot operator grant requires a valid spot pool address.'); return
    }
    if (methods.includes('session_tx') && !/^0x[0-9a-fA-F]{40}$/.test(sessionContract)) {
      setError('Session transaction delegation requires a valid session contract address.'); return
    }
    setSubmitting(true)
    try {
      await updateAgent(agent.id, owner, {
        description: description.trim(),
        integration: integration.trim(),
        delegationMethods: methods,
        delegationMetadata: {
          spotPoolAddress: methods.includes('spot_operator') ? (spotPool as `0x${string}`) : undefined,
          sessionContract: methods.includes('session_tx') ? (sessionContract as `0x${string}`) : undefined,
          notes: notes.trim() || undefined,
        },
      })
      setSaved(true)
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setSubmitting(false) }
  }

  return (
    <form className="dev-form" onSubmit={submit}>
      <label>Description<textarea value={description} onChange={e => { setDescription(e.target.value); setSaved(false) }} minLength={10} maxLength={500} /></label>
      <label>Integration URL<input value={integration} onChange={e => { setIntegration(e.target.value); setSaved(false) }} type="url" /></label>
      <fieldset>
        <legend>Delegation methods</legend>
        {(['spot_operator', 'session_tx', 'self_run'] as const).map(m => (
          <label key={m} className="check">
            <input type="checkbox" checked={methods.includes(m)} onChange={() => toggleMethod(m)} />
            <span><b>{m === 'spot_operator' ? 'Spot operator grant' : m === 'session_tx' ? 'Session transaction / EIP-7702' : 'Self-run'}</b><small>{delegationHint(m)}</small></span>
          </label>
        ))}
      </fieldset>
      {methods.includes('spot_operator') && (
        <label className="indented">Spot pool address<input value={spotPool} onChange={e => { setSpotPool(e.target.value); setSaved(false) }} pattern="0x[0-9a-fA-F]{40}" placeholder="0x..." /></label>
      )}
      {methods.includes('session_tx') && (
        <label className="indented">Session / implementation contract<input value={sessionContract} onChange={e => { setSessionContract(e.target.value); setSaved(false) }} pattern="0x[0-9a-fA-F]{40}" placeholder="0x..." /></label>
      )}
      <label>Notes (optional)<textarea value={notes} onChange={e => { setNotes(e.target.value); setSaved(false) }} maxLength={500} /></label>
      {error && <p className="error">{error}</p>}
      {saved && <p className="success"><Check /> Saved.</p>}
      <div className="form-actions">
        <button type="submit" className="button" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'} <ArrowRight /></button>
      </div>
    </form>
  )
}

function delegationHint(m: 'spot_operator' | 'session_tx' | 'self_run'): string {
  if (m === 'spot_operator') return 'User signs setOperatorApprovalForPool on a DreamDEX spot pool.'
  if (m === 'session_tx') return 'User signs a Somnia session envelope or EIP-7702 authorization to your implementation contract.'
  return 'Users run the agent themselves with their own wallet.'
}

function KeysTab({ agentId, owner, initial }: { agentId: string; owner: `0x${string}`; initial: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }> }) {
  const [keys, setKeys] = useState(initial)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)

  async function refresh() {
    try {
      const d = await listApiKeys(agentId, owner)
      setKeys(d.keys)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => { setKeys(initial) }, [initial])

  async function rotate() {
    setRotating(true); setError(null); setNewKey(null)
    try {
      const r = await rotateApiKey(agentId, owner)
      setNewKey(r.apiKey)
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setRotating(false) }
  }

  return (
    <div className="dashboard-section">
      <div className="section-head">
        <p className="eyebrow">API KEYS</p>
        <h2>Authentication for your agent runtime</h2>
        <p className="lead">Each agent gets one active API key. Your runtime sends it as <code>Authorization: Bearer &lt;key&gt;</code> on <code>/api/external/agents/&lt;id&gt;/*</code>. Rotating revokes the previous key.</p>
      </div>
      <div className="api-keys-list">
        {keys.length === 0
          ? <p className="muted">No keys yet. Click rotate to generate one.</p>
          : keys.map(k => (
            <div key={k.id} className={`api-key-row${k.revokedAt ? ' revoked' : ''}`}>
              <div>
                <b>{k.label || 'key'}</b>
                <small>Created {formatUtcStamp(k.createdAt)}{k.lastUsedAt ? ` · last used ${formatUtcStamp(k.lastUsedAt)}` : ''}</small>
              </div>
              <span className="status-chip" data-status={k.revokedAt ? 'retired' : 'active'}>{k.revokedAt ? 'revoked' : 'active'}</span>
            </div>
          ))
        }
      </div>
      {newKey && (
        <div className="api-key-reveal">
          <p className="success"><Check /> New API key. Save it now — CLASH only shows it once.</p>
          <div className="api-key">
            <code>{revealed === newKey ? newKey : '•'.repeat(40)}</code>
            <button type="button" className="button small" onClick={() => setRevealed(r => r === newKey ? null : newKey)}>
              {revealed === newKey ? <><EyeOff /> Hide</> : <><Eye /> Reveal</>}
            </button>
            <button type="button" className="button small" onClick={async () => { await navigator.clipboard.writeText(newKey) }}>
              <Copy /> Copy
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="button" disabled={rotating} onClick={rotate}><RotateCcw /> {rotating ? 'Rotating…' : 'Rotate key'}</button>
      </div>
    </div>
  )
}
