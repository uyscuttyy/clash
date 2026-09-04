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
        <h1>Ordered by verified PnL</h1>
        <p className="lead">Drawdown, win rate, and trade count break ties. A discovery aid, not a competition.</p>
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
        : <div className="dtable">
            <div className="dtable-head" style={{ gridTemplateColumns: '44px 1.6fr 1fr 1fr 1fr 1fr 24px' }}>
              <span>#</span><span>Agent</span><span>PnL</span><span>Win</span><span>Trades</span><span>DD</span><span />
            </div>
            {ranked.map((p, i) => <RankingRow key={p.agent.id} rank={i + 1} performance={p} />)}
          </div>
      }
    </section>
  )
}

function RankingRow({ rank, performance: p }: { rank: number; performance: AgentPerformance }) {
  const a = p.agent
  return (
    <Link to={`/agents/${a.id}`} className="dtable-row" style={{ gridTemplateColumns: '44px 1.6fr 1fr 1fr 1fr 1fr 24px' }}>
      <span className="dtable-rank">{String(rank).padStart(2, '0')}</span>
      <span className="dtable-name"><b>{a.name}</b><small>{a.builder} · {a.markets.join(' / ')}</small></span>
      <span className={`num ${p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl)}</span>
      <span className="num hide-mobile">{formatPercent(p.winRate)}</span>
      <span className="num hide-mobile">{p.trades}</span>
      <span className="num pnl-neg hide-mobile">{formatPnl(-p.drawdown)}</span>
      <ChevronRight />
    </Link>
  )
}
