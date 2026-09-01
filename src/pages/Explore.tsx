import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight } from 'lucide-react'
import { fetchAgents, formatPnl, formatPercent, type AgentPerformance } from '../store'
import { useAsync } from '../useAsync'

export function Explore() {
  const [market, setMarket] = useState<'' | 'BTC' | 'ETH'>('')
  const { data, loading, error } = useAsync(() => fetchAgents({ market: market || undefined }), [market])
  const list = data?.ranked ?? []

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">EXPLORE</p>
        <h1>Trading agents on Somnia</h1>
        <p className="lead">Every agent below is anchored to a wallet on Somnia Shannon. Every metric is derived from on-chain fills.</p>
      </div>

      <div className="filter-row">
        <span className="filter-label">Market</span>
        {['', 'BTC', 'ETH'].map(m => (
          <button
            key={m || 'all'}
            className={`filter-chip${market === m ? ' active' : ''}`}
            onClick={() => setMarket(m as '' | 'BTC' | 'ETH')}
          >{m || 'All'}</button>
        ))}
      </div>

      {loading ? <p className="muted">Loading agents…</p>
      : error ? <p className="error">Could not load agents: {error}</p>
      : list.length === 0
        ? <div className="empty">
            <b>No agents match this filter.</b>
            <p>Try a different market, or register your own agent from the developer portal.</p>
          </div>
        : <div className="card-grid">
            {list.map(p => <ExploreCard key={p.agent.id} performance={p} />)}
          </div>
      }
    </section>
  )
}

function ExploreCard({ performance: p }: { performance: AgentPerformance }) {
  const a = p.agent
  return (
    <Link to={`/agents/${a.id}`} className="agent-card">
      <div className="agent-card-top">
        <div className="agent-card-monogram">{a.name[0]}</div>
        <div className="agent-card-id">
          <h3>{a.name}</h3>
          <p>{a.builder} · {a.markets.join(' / ')} · {a.windows.join(' / ')}</p>
        </div>
        <ChevronRight />
      </div>
      <div className="agent-card-stats">
        <div><b className={p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}>{formatPnl(p.pnl)}</b><small>PNL</small></div>
        <div><b>{formatPercent(p.winRate)}</b><small>WIN RATE</small></div>
        <div><b>{p.trades}</b><small>TRADES</small></div>
        <div><b className="pnl-neg">{formatPnl(-p.drawdown)}</b><small>MAX DD</small></div>
      </div>
      <div className="agent-card-foot">
        <span className="verified-badge"><Check /> Verified on Somnia</span>
      </div>
    </Link>
  )
}
