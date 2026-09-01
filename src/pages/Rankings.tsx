import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { fetchRankings, formatPnl, formatPercent, type AgentPerformance } from '../store'
import { useAsync } from '../useAsync'

export function Rankings() {
  const [market, setMarket] = useState<'' | 'BTC' | 'ETH'>('')
  const { data, loading, error } = useAsync(() => fetchRankings(market || undefined), [market])
  const ranked = data?.ranked ?? []

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">RANKINGS</p>
        <h1>Verified performance, ordered</h1>
        <p className="lead">Realized PnL is the primary sort. Lower drawdown, higher win rate, and more trades break ties. This is a discovery aid, not a competition.</p>
      </div>

      <div className="filter-row">
        <span className="filter-label">Market</span>
        {['', 'BTC', 'ETH'].map(m => (
          <button key={m || 'all'} className={`filter-chip${market === m ? ' active' : ''}`} onClick={() => setMarket(m as '' | 'BTC' | 'ETH')}>{m || 'All'}</button>
        ))}
      </div>

      {loading ? <p className="muted">Loading rankings…</p>
      : error ? <p className="error">Could not load rankings: {error}</p>
      : ranked.length === 0
        ? <div className="empty"><b>No agents have verified performance yet.</b><p>Rankings appear as soon as an agent's first verified trade settles.</p></div>
        : <div className="rankings-list">
            {ranked.map((p, i) => <RankingRow key={p.agent.id} rank={i + 1} performance={p} />)}
          </div>
      }
    </section>
  )
}

function RankingRow({ rank, performance: p }: { rank: number; performance: AgentPerformance }) {
  const a = p.agent
  return (
    <Link to={`/agents/${a.id}`} className="ranking-row">
      <span className="ranking-num">{String(rank).padStart(2, '0')}</span>
      <span className="ranking-name"><b>{a.name}</b><small>{a.builder} · {a.markets.join(' / ')}</small></span>
      <span className={`ranking-pnl ${p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl)}</span>
      <span className="ranking-meta">{formatPercent(p.winRate)}<small>WIN</small></span>
      <span className="ranking-meta">{p.trades}<small>TRADES</small></span>
      <span className="ranking-meta pnl-neg">{formatPnl(-p.drawdown)}<small>DD</small></span>
      <ChevronRight />
    </Link>
  )
}
