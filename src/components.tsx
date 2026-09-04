import { formatPnl } from './store'

// Shared display primitives for the CLASH redesign. No data fetching here.

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase()
  return <span className="pill" data-status={s}>{status}</span>
}

export function Stat({ label, value, tone, size }: {
  label: string
  value: string
  tone?: 'pos' | 'neg' | 'zero'
  size?: 'md' | 'lg'
}) {
  const cls = tone === 'pos' ? 'pnl-pos' : tone === 'neg' ? 'pnl-neg' : tone === 'zero' ? 'pnl-zero' : ''
  return (
    <div className={`stat${size === 'lg' ? ' lg' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value num ${cls}`}>{value}</span>
    </div>
  )
}

// Real equity curve drawn only from verified settled trades. Never
// invents points: with fewer than two trades it renders an honest flat
// line plus the sample size. Caller passes cumulative series.
export function EquityCurve({ points, height = 120 }: {
  points: Array<{ t: string; pnl: number }>
  height?: number
}) {
  const W = 560
  const H = height
  const PAD = 8
  if (points.length < 2) {
    return (
      <div className="equity empty-note">
        <svg viewBox={`0 0 ${W} ${H}`} className="equity-svg" role="img" aria-label="Not enough settled trades for a curve yet">
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} className="equity-flat" />
        </svg>
        <p className="muted small">Curve appears after 2+ settled trades. {points.length} so far.</p>
      </div>
    )
  }
  const cum: number[] = []
  let run = 0
  for (const p of points) { run += p.pnl; cum.push(run) }
  const min = Math.min(0, ...cum)
  const max = Math.max(0, ...cum)
  const span = max - min || 1
  const x = (i: number) => PAD + (i / (cum.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2)
  const zeroY = y(0)
  const line = cum.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(cum.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z`
  const up = cum[cum.length - 1]! >= 0
  return (
    <div className="equity">
      <svg viewBox={`0 0 ${W} ${H}`} className="equity-svg" role="img" aria-label={`Equity curve over ${points.length} settled trades`}>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} className="equity-zero" />
        <path d={area} className={`equity-area ${up ? 'up' : 'down'}`} />
        <path d={line} className={`equity-line ${up ? 'up' : 'down'}`} />
        <circle cx={x(cum.length - 1)} cy={y(cum[cum.length - 1]!)} r="3.5" className={`equity-dot ${up ? 'up' : 'down'}`} />
      </svg>
      <div className="equity-foot">
        <span className="muted small">{points.length} settled trades</span>
        <span className={`num small ${up ? 'pnl-pos' : 'pnl-neg'}`}>{formatPnl(cum[cum.length - 1]!)}</span>
      </div>
    </div>
  )
}
