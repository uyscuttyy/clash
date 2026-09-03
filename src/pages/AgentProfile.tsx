import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ChevronRight, ExternalLink, ShieldCheck } from 'lucide-react'
import { fetchAgent, formatPnl, formatPercent, formatUtcStamp, shortAddress, type Trade, type AgentPerformance, type Agent } from '../store'
import { useAsync } from '../useAsync'

export function AgentProfile() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, error } = useAsync(
    () => id ? fetchAgent(id) : Promise.reject(new Error('No agent id')),
    [id],
  )

  if (loading) return <section className="page"><p className="muted">Loading agent…</p></section>
  if (error) return <section className="page"><p className="error">Could not load agent: {error}</p></section>
  if (!data) return <section className="page"><h1>Agent not found.</h1></section>
  const { agent: a, performance: p, trades } = data
  return <ProfileBody agent={a} performance={p} trades={trades} />
}

function ProfileBody({ agent: a, performance: p, trades }: { agent: Agent; performance: AgentPerformance; trades: Trade[] }) {
  return (
    <section className="page profile-page">
      <div className="profile-head">
        <div className="profile-id">
          <div className="agent-card-monogram large">{a.name[0]}</div>
          <div>
            <p className="eyebrow">AGENT PROFILE</p>
            <h1>{a.name}</h1>
            <p className="profile-builder">{a.builder}</p>
            <p className="profile-markets">{a.markets.join(' / ')} · {a.windows.join(' / ')}</p>
          </div>
        </div>
        <div className="profile-cta">
          <Link className="button primary" to={`/agents/${a.id}/follow`}>Mirror this agent <ArrowRight /></Link>
          <Link className="button" to={`/agents/${a.id}/use`}>Use Agent</Link>
        </div>
      </div>
      <p className="lead">{a.description}</p>

      <div className="profile-stats">
        <div className="metric-tile"><span className="metric-label">REALIZED PNL</span><span className={`metric-value ${p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl)}</span></div>
        <div className="metric-tile"><span className="metric-label">WIN RATE</span><span className="metric-value">{formatPercent(p.winRate)}</span></div>
        <div className="metric-tile"><span className="metric-label">SETTLED TRADES</span><span className="metric-value">{p.trades}</span></div>
        <div className="metric-tile"><span className="metric-label">MAX DRAWDOWN</span><span className="metric-value pnl-neg">{formatPnl(-p.drawdown)}</span></div>
        <div className="metric-tile"><span className="metric-label">30-DAY PNL</span><span className={`metric-value ${p.pnl30d > 0 ? 'pnl-pos' : p.pnl30d < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl30d)}</span></div>
        <div className="metric-tile"><span className="metric-label">90-DAY PNL</span><span className={`metric-value ${p.pnl90d > 0 ? 'pnl-pos' : p.pnl90d < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl90d)}</span></div>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <h3>Identity</h3>
          <dl>
            <dt>Builder</dt><dd>{a.builder}</dd>
            <dt>Markets</dt><dd>{a.markets.join(' / ')}</dd>
            <dt>Windows</dt><dd>{a.windows.join(' / ')}</dd>
            <dt>Trading wallet</dt><dd className="mono"><a href={`https://shannonscan.xyz/address/${a.walletAddress}`} target="_blank" rel="noopener">{shortAddress(a.walletAddress)} <ExternalLink /></a></dd>
            <dt>Owner wallet</dt><dd className="mono"><a href={`https://shannonscan.xyz/address/${a.ownerAddress}`} target="_blank" rel="noopener">{shortAddress(a.ownerAddress)} <ExternalLink /></a></dd>
            <dt>Status</dt><dd>{a.status}</dd>
            <dt>Registered</dt><dd>{formatUtcStamp(a.createdAt)}</dd>
          </dl>
          <p className="muted small">Trading wallet is the public address the agent uses on Somnia. Owner wallet is the developer who registered the agent. CLASH holds neither's private key.</p>
        </div>
        <div className="profile-card">
          <h3>Verification</h3>
          <p><ShieldCheck /> <b>Verified on Somnia</b></p>
          <p className="muted small">Every trade on this page was indexed from the Somnia / DreamDEX indexer and matched to this agent's registered trading wallet. CLASH does not trust self-reported numbers.</p>
          <h3 style={{ marginTop: '1.5rem' }}>Delegation methods</h3>
          {a.delegationMethods.length === 0
            ? <p className="muted">None declared.</p>
            : <ul className="bullet-list">
                {a.delegationMethods.map(m => <li key={m}>{delegationLabel(m)}</li>)}
              </ul>
          }
          {a.delegationMetadata.notes && <p className="muted small">{a.delegationMetadata.notes}</p>}
        </div>
      </div>

      <div className="profile-section">
        <div className="section-head">
          <p className="eyebrow">TRADE HISTORY</p>
          <h2>Verified on Somnia</h2>
        </div>
        {trades.length === 0
          ? <div className="empty"><b>No settled trades yet.</b><p>CLASH will display this agent's first verified trade as soon as it settles on the indexer.</p></div>
          : <div className="trade-list">
              <div className="trade-header">
                <span>Market</span><span>Direction</span><span>Result</span><span>PnL</span><span>Filled at</span>
              </div>
              {trades.map(t => <TradeRow key={t.id} trade={t} />)}
            </div>
        }
      </div>
    </section>
  )
}

function TradeRow({ trade: t }: { trade: Trade }) {
  const dir = t.direction === 'UP' ? 'pnl-pos' : 'pnl-neg'
  const result = t.result === 'WIN' ? 'pnl-pos' : 'pnl-neg'
  return (
    <a className="trade-row" href={`https://shannonscan.xyz/tx/${t.txHash}`} target="_blank" rel="noopener">
      <span className="trade-market"><b>{t.market}</b><small>{shortAddress(t.txHash)}</small></span>
      <span className={`trade-direction ${dir}`}>{t.direction}</span>
      <span className={`trade-result ${result}`}>{t.result}</span>
      <span className={`trade-pnl ${t.pnl > 0 ? 'pnl-pos' : t.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(t.pnl)}</span>
      <span className="trade-time">{formatUtcStamp(t.filledAt)}</span>
      <ChevronRight />
    </a>
  )
}

function delegationLabel(m: 'spot_operator' | 'session_tx' | 'self_run'): string {
  if (m === 'spot_operator') return 'Spot operator grant — authorize the agent to trade on a DreamDEX spot pool via setOperatorApprovalForPool.'
  if (m === 'session_tx') return 'Session transaction / EIP-7702 — the user delegates to the agent\'s implementation contract on Somnia.'
  return 'Self-run — the user funds their own wallet and runs the agent themselves.'
}
