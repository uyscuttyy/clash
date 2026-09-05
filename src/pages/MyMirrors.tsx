// /me/mirrors — every follow the connected wallet has set up, with
// pause / resume / kill controls and a recent mirror-attempt log per
// follow. The follower-side watch component is mounted in the layout
// shell; the dashboard is the user's view into what the watch
// component is doing.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pause, Play, Trash2, ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import {
  listMyFollows, listMyMirrorAttempts, updateFollowStatus, killFollow, type Follow,
} from '../store'
import { useAsync } from '../useAsync'
import { WalletControl } from '../WalletControl'
import { rawToHuman } from '../eip712'
import { StatusPill } from '../components'

export function MyMirrors() {
  const { isConnected, address } = useAccount()

  if (!isConnected) {
    return (
      <section className="page">
        <div className="section-head">
          <p className="eyebrow">MIRRORS</p>
          <h1>Your active follows</h1>
          <p className="lead">Connect your wallet to see which agents you're mirroring, your caps, and the live mirror log.</p>
        </div>
        <div className="empty">
          <b>Connect your wallet</b>
          <p>CLASH only knows about follows that your wallet signed. Connect to see them.</p>
          <div className="empty-action"><WalletControl /></div>
        </div>
      </section>
    )
  }

  return <MyMirrorsConnected follower={address as `0x${string}`} />
}

function MyMirrorsConnected({ follower }: { follower: `0x${string}` }) {
  const followsQ = useAsync(() => listMyFollows(follower), [follower])
  const follows = followsQ.data?.follows ?? []

  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">MIRRORS</p>
        <h1>Your active follows</h1>
        <p className="lead">Every follow the marketplace has on file for this wallet. Pause to stop new mirrors, kill to revoke permanently.</p>
      </div>

      {followsQ.loading ? <p className="muted">Loading your follows…</p>
        : followsQ.error ? <p className="error">Could not load follows: {followsQ.error}</p>
        : follows.length === 0
          ? <div className="empty">
              <b>No follows yet.</b>
              <p>Pick an agent on the Explore page and click "Mirror this agent" to set up your first follow.</p>
              <Link className="button" to="/explore">Explore agents</Link>
            </div>
          : <div className="follows-list">
              {follows.map(({ follow, agent, dailyStats }) => (
                <FollowCard key={follow.id} follow={follow} agent={agent} dailyStats={dailyStats} follower={follower} />
              ))}
            </div>
        }
    </section>
  )
}

function FollowCard({ follow, agent, dailyStats, follower }: {
  follow: Follow
  agent: { id: string; name: string; builder: string } | null
  dailyStats: { exposureRaw: string; count: number }
  follower: `0x${string}`
}) {
  const [status, setStatus] = useState(follow.status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attemptsQ = useAsync(() => listMyMirrorAttempts(follower, { followId: follow.id, limit: 25 }), [follower, follow.id])
  const attempts = attemptsQ.data?.attempts ?? []

  async function onPause() { if (!agent) return; setPending(true); setError(null); try { const r = await updateFollowStatus(agent.id, follower, 'paused'); setStatus(r.follow.status) } catch (e) { setError(String(e)) } finally { setPending(false) } }
  async function onResume() { if (!agent) return; setPending(true); setError(null); try { const r = await updateFollowStatus(agent.id, follower, 'active'); setStatus(r.follow.status) } catch (e) { setError(String(e)) } finally { setPending(false) } }
  async function onKill() {
    if (!agent) return
    if (!confirm('Kill this follow? This is permanent. The follow row is kept for history but no more mirror attempts will be created.')) return
    setPending(true); setError(null)
    try { const r = await killFollow(agent.id, follower); setStatus(r.follow.status) } catch (e) { setError(String(e)) } finally { setPending(false) }
  }

  const expiresIn = Math.max(0, Math.floor((new Date(follow.expiresAt).getTime() - Date.now()) / 1000 / 3600))
  const exposure = rawToHuman(dailyStats.exposureRaw)
  const cap = rawToHuman(follow.maxDailyExposureRaw)
  const exposurePct = cap > 0 ? Math.min(100, (exposure / cap) * 100) : 0
  const tradePct = follow.maxDailyTrades > 0 ? Math.min(100, (dailyStats.count / follow.maxDailyTrades) * 100) : 0

  return (
    <div className="mirror-row">
      <div className="mirror-row-head">
        <div className="agent-card-monogram">{agent?.name?.[0] ?? '?'}</div>
        <div style={{ flex: 1 }}>
          {agent
            ? <Link to={`/agents/${agent.id}`} className="follow-card-name"><b>{agent.name}</b></Link>
            : <span className="follow-card-name muted">(agent removed)</span>
          }
          <span className="muted small"> · {agent?.builder} · {follow.sizeMultiplier.toFixed(1)}× size</span>
        </div>
        {status === 'active' && <span className="live-dot" title="This tab is watching for new orders" />}
        <StatusPill status={status} />
      </div>
      <div className="micro">TODAY'S EXPOSURE · {exposure.toFixed(2)} / {cap.toFixed(2)} tUSDC</div>
      <div className="exposure-bar"><i style={{ width: `${exposurePct}%` }} /></div>
      <div className="micro" style={{ marginTop: 8 }}>TRADES TODAY · {dailyStats.count} / {follow.maxDailyTrades}</div>
      <div className="exposure-bar"><i style={{ width: `${tradePct}%` }} /></div>
      <div className="use-card-stats" style={{ marginTop: 12 }}>
        <span className="metric-mini">Max / trade <b className="num">{rawToHuman(follow.maxPerTradeRaw).toFixed(2)} tUSDC</b></span>
        <span className="metric-mini">Expires <b>{expiresIn}h</b></span>
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="follow-card-actions">
        {status === 'active'
          ? <button className="button" onClick={onPause} disabled={pending}><Pause /> Pause</button>
          : status === 'paused'
            ? <button className="button" onClick={onResume} disabled={pending}><Play /> Resume</button>
            : <span className="muted">Killed</span>
        }
        {status !== 'killed' && <button className="button warn" onClick={onKill} disabled={pending}><Trash2 /> Kill</button>}
      </div>

      <details className="follow-card-log">
        <summary>Recent mirror attempts ({attempts.length})</summary>
        {attempts.length === 0
          ? <p className="muted small">No mirror attempts yet. They'll appear here when the agent broadcasts an order.</p>
          : <table className="mirror-attempts">
              <thead><tr><th>Time</th><th>Source tx</th><th>Side</th><th>Qty</th><th>Decision</th><th>Reason</th></tr></thead>
              <tbody>
                {attempts.map(a => (
                  <tr key={a.id}>
                    <td>{new Date(a.createdAt).toISOString().slice(11, 19)}</td>
                    <td><a href={`https://shannon-explorer.somnia.network/tx/${a.sourceTxHash}`} target="_blank" rel="noreferrer">{a.sourceTxHash.slice(0, 10)}…<ExternalLink className="inline" /></a></td>
                    <td>{a.sourceSide}</td>
                    <td>{rawToHuman(a.sourceQuantityRaw).toFixed(4)}</td>
                    <td data-decision={a.decision}>{a.decision}</td>
                    <td className="muted small">{a.decisionReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </details>
    </div>
  )
}
