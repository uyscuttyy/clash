import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight } from 'lucide-react'
import { fetchAgents, formatPnl, formatPercent, type AgentPerformance } from '../store'
import { useAsync } from '../useAsync'
import { StatusPill } from '../components'

type SortKey = 'pnl' | 'winRate' | 'trades' | 'drawdown'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'pnl', label: 'PnL' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'trades', label: 'Trades' },
  { key: 'drawdown', label: 'Drawdown' },
]

export function Explore() {
  const [market, setMarket] = useState<'' | 'BTC' | 'ETH'>('')
  const [sort, setSort] = useState<SortKey>('pnl')
  const navigate = useNavigate()
  const { data, loading, error } = useAsync(() => fetchAgents({ market: market || undefined }), [market])
  const list = [...(data?.ranked ?? [])].sort((a, b) => {
    if (sort === 'pnl') return b.pnl - a.pnl
    if (sort === 'winRate') return b.winRate - a.winRate
    if (sort === 'trades') return b.trades - a.trades
    return a.drawdown - b.drawdown
  })

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">AGENTS</p>
        <h1>Compare verified traders</h1>
        <p className="lead">Every row is a wallet on Somnia Shannon. Every number derives from on-chain fills — sorted by what matters to you.</p>
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
        <span className="filter-label" style={{ marginLeft: 12 }}>Sort</span>
        {SORTS.map(s => (
          <button
            key={s.key}
            className={`filter-chip${sort === s.key ? ' active' : ''}`}
            onClick={() => setSort(s.key)}
          >{s.label}</button>
        ))}
      </div>

      {loading ? <p className="muted">Loading agents…</p>
      : error ? <p className="error">Could not load agents: {error}</p>
      : list.length === 0
        ? <div className="empty">
            <b>No agents match this filter.</b>
            <p>Try a different market, or register your own agent from the developer portal.</p>
          </div>
        : <div className="ctable-wrap">
            <table className="ctable">
              <colgroup>
                <col style={{ width: 56 }} />
                <col />
                <col style={{ width: 130 }} />
                <col className="hide-mobile" style={{ width: 110 }} />
                <col className="hide-mobile" style={{ width: 90 }} />
                <col className="hide-mobile" style={{ width: 120 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Agent</th>
                  <th className="num-col">Realized PnL</th>
                  <th className="num-col hide-mobile">Win rate</th>
                  <th className="num-col hide-mobile">Trades</th>
                  <th className="num-col hide-mobile">Max DD</th>
                  <th>Status</th>
                  <th><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Open</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => <ExploreRow key={p.agent.id} rank={i + 1} performance={p} onOpen={() => navigate(`/agents/${p.agent.id}`)} />)}
              </tbody>
            </table>
          </div>
      }
    </section>
  )
}

function strategyName(builder: string, description: string): string {
  const d = description.toLowerCase()
  if (d.includes('momentum') || d.includes('trend') || d.includes('drift')) return 'Momentum'
  if (d.includes('mean') || d.includes('reversion') || d.includes('revert')) return 'Mean reversion'
  if (d.includes('arbitrage')) return 'Arbitrage'
  if (d.includes('market mak') || d.includes('market-mak')) return 'Market making'
  return builder || 'Systematic'
}

function ExploreRow({ rank, performance: p, onOpen }: { rank: number; performance: AgentPerformance; onOpen: () => void }) {
  const a = p.agent
  return (
    <tr className="clickable" onClick={onOpen}>
      <td className="rank-cell">{String(rank).padStart(2, '0')}</td>
      <td className="name-cell">
        <b>{a.name}</b>
        <small>{strategyName(a.builder, a.description)} · {a.markets.join(' / ')}</small>
      </td>
      <td className={`num-col ${p.pnl > 0 ? 'pnl-pos' : p.pnl < 0 ? 'pnl-neg' : 'pnl-zero'}`}>{formatPnl(p.pnl)}</td>
      <td className="num-col hide-mobile">{formatPercent(p.winRate)}</td>
      <td className="num-col hide-mobile">{p.trades}</td>
      <td className="num-col pnl-neg hide-mobile">{formatPnl(-p.drawdown)}</td>
      <td><StatusPill status={a.status} /> <span className="verified-badge" style={{ marginLeft: 6 }}><Check /> Verified</span></td>
      <td><ChevronRight className="row-chevron" /></td>
    </tr>
  )
}
