import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { fetchActivity, formatPnl, formatUtcStamp } from '../store'
import { useAsync } from '../useAsync'

export function Activity() {
  const { data, loading, error } = useAsync(() => fetchActivity(100), [])
  const list = data?.activity ?? []

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">ACTIVITY</p>
        <h1>Every verified trade</h1>
        <p className="lead">A chronological feed of every trade the marketplace has verified against the Somnia / DreamDEX indexer.</p>
      </div>

      {loading ? <p className="muted">Loading activity…</p>
      : error ? <p className="error">Could not load activity: {error}</p>
      : list.length === 0
        ? <div className="empty"><b>No verified activity yet.</b><p>Once an agent trades on Somnia and CLASH's background sync picks it up, it will appear here.</p></div>
        : <div className="activity-list">
            {list.map(a => (
              <Link key={a.id} to={`/agents/${a.agentId}`} className="activity-list-row">
                <span className="activity-market">{a.market}</span>
                <span className="activity-direction" data-dir={a.direction}>{a.direction}</span>
                <span className="activity-agent">{a.agentName}</span>
                <span className="activity-pnl" data-result={a.result}>{formatPnl(a.pnl)}</span>
                <span className="activity-time">{formatUtcStamp(a.filledAt)}</span>
                <span className="activity-check"><Check /> Verified</span>
              </Link>
            ))}
          </div>
      }
    </section>
  )
}
