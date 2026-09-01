import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react'
import { fetchActivity, fetchAgents, formatPnl, formatPercent, formatUtcStamp, type AgentPerformance, type Agent } from '../store'
import { useAsync } from '../useAsync'

interface MarketData {
  agents: Agent[]
  ranked: AgentPerformance[]
  count: number
}

interface ActivityData {
  activity: Array<{ id: string; agentId: string; agentName: string; market: string; direction: 'UP' | 'DOWN'; result: 'WIN' | 'LOSS'; pnl: number; txHash: string; filledAt: string }>
  count: number
}

export function Home() {
  const agentsQ = useAsync<MarketData>(() => fetchAgents(), [])
  const activityQ = useAsync<ActivityData>(() => fetchActivity(8), [])
  const featured = (agentsQ.data?.ranked ?? []).slice(0, 3)
  const recent = activityQ.data?.activity ?? []

  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">THE TRADING-AGENT MARKETPLACE</p>
          <h1>Find a trading agent worth trusting.</h1>
          <p className="lead">
            CLASH discovers autonomous trading agents operating on Somnia / DreamDEX and shows you what they have actually done.
            Every trade is on-chain. Every number is verifiable. No backtests, no promises.
          </p>
          <div className="actions">
            <Link className="button" to="/explore">Explore agents <ArrowRight /></Link>
            <Link className="text-link" to="/developers">Built an agent? <ChevronRight /></Link>
          </div>
          <div className="hero-stats">
            <div><b>{agentsQ.data?.count ?? '—'}</b><small>agents registered</small></div>
            <div><b>{activityQ.data?.count ?? '—'}</b><small>verified trades</small></div>
            <div><b>Somnia</b><small>Shannon testnet</small></div>
          </div>
        </div>
        <div className="hero-mark">
          <div><span>DISCOVER</span><i>01</i></div>
          <div><span>VERIFY</span><i>02</i></div>
          <div><span>CHOOSE</span><i>03</i></div>
          <div><span>USE</span><i>04</i></div>
        </div>
      </section>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">FEATURED AGENTS</p>
          <h2>Top verified performance</h2>
        </div>
        {agentsQ.loading ? <p className="muted">Loading…</p>
        : agentsQ.error ? <p className="error">Could not load agents: {agentsQ.error}</p>
        : featured.length === 0
          ? <div className="empty"><b>No agents have verified activity yet.</b><p>Developers can register an agent on the Developers page. Verified trades will appear here.</p></div>
          : <div className="card-grid three">
              {featured.map(p => <AgentCard key={p.agent.id} performance={p} />)}
            </div>
        }
      </section>

      <section className="page-section">
        <div className="section-head">
          <p className="eyebrow">RECENT ACTIVITY</p>
          <h2>Verified on Somnia</h2>
        </div>
        {recent.length === 0
          ? <div className="empty"><b>No verified activity yet.</b><p>Once an agent trades on a Somnia market and the fill settles, it will appear here.</p></div>
          : <div className="activity-strip">
              {recent.map(a => (
                <Link key={a.id} to={`/agents/${a.agentId}`} className="activity-row">
                  <span className="activity-market">{a.market}</span>
                  <span className="activity-direction" data-dir={a.direction}>{a.direction}</span>
                  <span className="activity-agent">{a.agentName}</span>
                  <span className="activity-pnl" data-result={a.result}>{formatPnl(a.pnl)}</span>
                  <span className="activity-time">{formatUtcStamp(a.filledAt)}</span>
                  <span className="activity-check"><Check /></span>
                </Link>
              ))}
            </div>
        }
      </section>

      <section className="page-section how">
        <div className="section-head">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>From discovery to authorization</h2>
        </div>
        <ol className="how-list">
          <li><b>Discover</b><p>Browse registered agents by market, performance, and developer.</p></li>
          <li><b>Verify</b><p>Every trade is anchored to a real on-chain fill on the Somnia / DreamDEX indexer.</p></li>
          <li><b>Choose</b><p>Pick the agent that fits how you want to trade — short windows, conservative drawdown, BTC only, anything.</p></li>
          <li><b>Use</b><p>Connect your wallet. CLASH checks the agent's delegation method, presents the matching flow, and verifies the authorization on-chain.</p></li>
        </ol>
        <div className="how-meta">
          <span><ShieldCheck /> No seed phrases. No private keys. CLASH never asks.</span>
          <span><Sparkles /> CLASH holds no trading wallet. It verifies, it does not trade.</span>
        </div>
      </section>

      <section className="page-section cta">
        <div>
          <p className="eyebrow">DEVELOPERS</p>
          <h2>Built a trading agent?</h2>
          <p>Register it with CLASH and put it in front of users. You keep your wallet, your signer, and your strategy. CLASH gives you a profile, a verification layer, and a path to users.</p>
        </div>
        <Link className="button" to="/developers">Open developer portal <ArrowRight /></Link>
      </section>
    </>
  )
}

function AgentCard({ performance: p }: { performance: AgentPerformance }) {
  const a: Agent = p.agent
  return (
    <Link to={`/agents/${a.id}`} className="agent-card">
      <div className="agent-card-top">
        <div className="agent-card-monogram">{a.name[0]}</div>
        <div className="agent-card-id">
          <h3>{a.name}</h3>
          <p>{a.builder} · {a.markets.join(' / ')}</p>
        </div>
        <ChevronRight />
      </div>
      <div className="agent-card-stats">
        <div><b className={p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}>{formatPnl(p.pnl)}</b><small>REALIZED PNL</small></div>
        <div><b>{formatPercent(p.winRate)}</b><small>WIN RATE</small></div>
        <div><b>{p.trades}</b><small>TRADES</small></div>
        <div><b className="pnl-neg">{formatPnl(-p.drawdown)}</b><small>MAX DRAWDOWN</small></div>
      </div>
      <div className="agent-card-foot">
        <span className="verified-badge"><Check /> Verified on Somnia</span>
      </div>
    </Link>
  )
}
