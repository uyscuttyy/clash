import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ChevronRight, ExternalLink, ShieldCheck } from 'lucide-react'
import { fetchAgent, formatPnl, formatPercent, formatUtcStamp, shortAddress, type Trade, type AgentPerformance, type Agent } from '../store'
import { useAsync } from '../useAsync'
import { EquityCurve, Stat, StatusPill } from '../components'

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

function strategyName(a: Agent): string {
  const d = a.description.toLowerCase()
  if (d.includes('momentum') || d.includes('trend') || d.includes('drift')) return 'Momentum'
  if (d.includes('mean') || d.includes('reversion') || d.includes('revert')) return 'Mean reversion'
  if (d.includes('arbitrage')) return 'Arbitrage'
  if (d.includes('market mak') || d.includes('market-mak')) return 'Market making'
  return 'Systematic'
}

function ProfileBody({ agent: a, performance: p, trades }: { agent: Agent; performance: AgentPerformance; trades: Trade[] }) {
  const ordered = [...trades].sort((x, y) => x.filledAt.localeCompare(y.filledAt))
  const pnlTone = p.pnl > 0 ? 'pos' : p.pnl < 0 ? 'neg' : 'zero'
  return (
    <section className="page profile-page">
      <Link className="back-link" to="/explore"><ArrowRight style={{ transform: 'rotate(180deg)' }} /> All agents</Link>
      <div className="profile-id" style={{ marginTop: 8 }}>
        <div className="agent-card-monogram large">{a.name[0]}</div>
        <div>
          <p className="eyebrow">AGENT · {strategyName(a).toUpperCase()}</p>
          <h1>{a.name}</h1>
          <p className="profile-builder">{a.builder} · {a.markets.join(' / ')} · {a.windows.join(' / ')}</p>
        </div>
        <span style={{ marginLeft: 'auto' }}><StatusPill status={a.status} /></span>
      </div>

      <div className="profile-hero">
        <div className="profile-hero-main">
          <Stat label="Realized PnL · verified" value={formatPnl(p.pnl)} tone={pnlTone} size="lg" />
          <div className="profile-support">
            <Stat label="Win rate" value={formatPercent(p.winRate)} />
            <Stat label="Settled trades" value={String(p.trades)} />
            <Stat label="Max drawdown" value={formatPnl(-p.drawdown)} tone={p.drawdown > 0 ? 'neg' : 'zero'} />
            <Stat label="30-day PnL" value={formatPnl(p.pnl30d)} tone={p.pnl30d > 0 ? 'pos' : p.pnl30d < 0 ? 'neg' : 'zero'} />
          </div>
        </div>
        <div className="profile-hero-side">
          <div className="profile-cta-card">
            <span className="micro">MIRROR THIS AGENT</span>
            <p>Your wallet signs every mirrored order inside your caps. Keys never leave your hands.</p>
            <Link className="button" to={`/agents/${a.id}/follow`}>Mirror {a.name} <ArrowRight /></Link>
            <Link className="ghost-link" to={`/agents/${a.id}/use`}>or authorize via Use Agent</Link>
          </div>
        </div>
      </div>

      <div className="equity-panel">
        <span className="micro">EQUITY · VERIFIED SETTLES</span>
        <div style={{ marginTop: 8 }}>
          <EquityCurve points={ordered.map(t => ({ t: t.filledAt, pnl: t.pnl }))} />
        </div>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <h3>Strategy</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{a.description}</p>
          <p className="muted small" style={{ marginTop: 8 }}>Declares: {a.delegationMethods.length === 0 ? 'no delegation methods' : a.delegationMethods.join(', ')}</p>
          {a.delegationMetadata.notes && <p className="muted small">{a.delegationMetadata.notes}</p>}
        </div>
        <div className="profile-card">
          <h3>Verification receipt</h3>
          <p><ShieldCheck /> <b>Verified on Somnia</b></p>
          <p className="muted small">Every trade below was indexed from the Somnia / DreamDEX indexer and matched to this trading wallet.</p>
          <dl>
            <dt>Trading wallet</dt><dd className="mono"><a href={`https://shannonscan.xyz/address/${a.walletAddress}`} target="_blank" rel="noopener">{shortAddress(a.walletAddress)} <ExternalLink /></a></dd>
            <dt>Owner wallet</dt><dd className="mono"><a href={`https://shannonscan.xyz/address/${a.ownerAddress}`} target="_blank" rel="noopener">{shortAddress(a.ownerAddress)} <ExternalLink /></a></dd>
            <dt>Registered</dt><dd>{formatUtcStamp(a.createdAt)}</dd>
          </dl>
        </div>
      </div>

      <div className="profile-section">
        <div className="section-head">
          <p className="eyebrow">EXECUTION HISTORY</p>
          <h2>{trades.length === 0 ? 'No settled trades yet' : `${trades.length} verified ${trades.length === 1 ? 'trade' : 'trades'}`}</h2>
        </div>
        {trades.length === 0
          ? <div className="empty"><b>No settled trades yet.</b><p>CLASH will display this agent's first verified trade as soon as it settles on the indexer.</p></div>
          : <div className="dtable">
              <div className="dtable-head" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1.2fr 24px' }}>
                <span>Market</span><span>Direction</span><span>Result</span><span>PnL</span><span>Filled</span><span />
              </div>
              {[...trades].sort((x, y) => y.filledAt.localeCompare(x.filledAt)).map(t => <TradeRow key={t.id} trade={t} />)}
            </div>
        }
      </div>
    </section>
  )
}

function TradeRow({ trade: t }: { trade: Trade }) {
  return (
    <a
      className="dtable-row"
      style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1.2fr 24px' }}
      href={`https://shannonscan.xyz/tx/${t.txHash}`}
      target="_blank"
      rel="noopener"
    >
      <span className="dtable-name"><b>{t.market}</b><small className="mono">{shortAddress(t.txHash)}</small></span>
      <span className={`activity-direction ${t.direction === 'UP' ? 'pnl-pos' : 'pnl-neg'}`} data-dir={t.direction}>{t.direction}</span>
      <span className={`trade-result ${t.result === 'WIN' ? 'pnl-pos' : 'pnl-neg'}`}>{t.result}</span>
      <span className={`num ${t.pnl > 0 ? 'pnl-pos' : t.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(t.pnl)}</span>
      <span className="activity-time hide-mobile">{formatUtcStamp(t.filledAt)}</span>
      <ChevronRight />
    </a>
  )
}
