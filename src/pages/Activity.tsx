import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { fetchActivity, formatPnl, formatUtcStamp } from '../store'
import { useAsync } from '../useAsync'

export function Activity() {
  const [side, setSide] = useState<'' | 'UP' | 'DOWN'>('')
  const { data, loading, error } = useAsync(() => fetchActivity(100), [])
  const list = (data?.activity ?? []).filter(a => !side || a.direction === side)

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">ACTIVITY</p>
        <h1>Every verified trade</h1>
        <p className="lead">Chronological feed of every trade the marketplace verified against the Somnia / DreamDEX indexer.</p>
      </div>

      <div className="filter-row">
        <span className="filter-label">Direction</span>
        {(['' , 'UP', 'DOWN'] as const).map(d => (
          <button key={d || 'all'} className={`filter-chip${side === d ? ' active' : ''}`} onClick={() => setSide(d)}>{d || 'All'}</button>
        ))}
      </div>

      {loading ? <p className="muted">Loading activity…</p>
      : error ? <p className="error">Could not load activity: {error}</p>
      : list.length === 0
        ? <div className="empty"><b>No verified activity yet.</b><p>Once an agent trades on Somnia and CLASH's background sync picks it up, it will appear here.</p></div>
        : <div className="dtable">
            <div className="dtable-head" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 1fr 1.2fr auto' }}>
              <span>Market</span><span>Side</span><span>Agent</span><span>PnL</span><span>Filled</span><span>Proof</span>
            </div>
            {list.map(a => (
              <Link key={a.id} to={`/agents/${a.agentId}`} className="dtable-row" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 1fr 1.2fr auto' }}>
                <span className="dtable-name"><b>{a.market}</b></span>
                <span className={`activity-direction ${a.direction === 'UP' ? 'pnl-pos' : 'pnl-neg'}`} data-dir={a.direction}>{a.direction}</span>
                <span className="activity-agent hide-mobile">{a.agentName}</span>
                <span className={`num ${a.result === 'WIN' ? 'pnl-pos' : 'pnl-neg'}`}>{formatPnl(a.pnl)}</span>
                <span className="activity-time hide-mobile">{formatUtcStamp(a.filledAt)}</span>
                <span className="activity-check"><Check /> Verified</span>
              </Link>
            ))}
          </div>
      }
    </section>
  )
}
