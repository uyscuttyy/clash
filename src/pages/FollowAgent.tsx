// "Follow Agent" page. The user picks a size multiplier and per-day
// caps, signs an EIP-712 FollowIntent over those values, and CLASH
// records the follow. The follower's open tab then watches
// /api/me/mirror-attempts and prompts the wallet to sign+send every
// mirrored order the agent places.
//
// Five steps:
//   1. Connect wallet (RainbowKit, on Somnia Shannon testnet)
//   2. Pick size multiplier (0.1×..10.0×)
//   3. Pick caps: max tUSDC per trade, max tUSDC per day, max trades per day
//   4. Sign the EIP-712 FollowIntent
//   5. Active — follower's open tab now mirrors the agent
//
// If the user already has a follow for this agent, the page shows the
// existing follow with Pause / Resume / Kill controls instead of the
// setup wizard.

import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, ShieldCheck, Pause, Play, Trash2 } from 'lucide-react'
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from 'wagmi'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  fetchAgent, fetchFollow, createFollow, updateFollowStatus, killFollow, fetchFollowNonce, formatPnl,
  type Follow,
} from '../store'
import { useAsync } from '../useAsync'
import { WalletControl } from '../WalletControl'
import { buildFollowMessage, humanToRaw, rawToHuman } from '../eip712'

export function FollowAgent() {
  const { id } = useParams<{ id: string }>()
  const { isConnected, address } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const isOnSomnia = chainId === somniaShannon.id

  const agentQ = useAsync(
    () => id ? fetchAgent(id) : Promise.reject(new Error('No agent id')),
    [id],
  )

  // Existing-follow state. Loaded when the user is connected.
  const [follow, setFollow] = useState<Follow | null>(null)
  const [followStats, setFollowStats] = useState<{ exposureRaw: string; count: number }>({ exposureRaw: '0', count: 0 })
  const [followLoading, setFollowLoading] = useState(false)

  useEffect(() => {
    if (!isConnected || !address || !id) { setFollow(null); return }
    setFollowLoading(true)
    fetchFollow(id, address as `0x${string}`)
      .then(r => { setFollow(r.follow); setFollowStats(r.stats) })
      .catch(() => { setFollow(null) })
      .finally(() => setFollowLoading(false))
  }, [id, address, isConnected])

  // Setup form state.
  const [sizeMultiplier, setSizeMultiplier] = useState(1.0)
  const [maxPerTradeT, setMaxPerTradeT] = useState('1.00')         // tUSDC human
  const [maxDailyExposureT, setMaxDailyExposureT] = useState('10.00')
  const [maxDailyTrades, setMaxDailyTrades] = useState(20)
  const [acknowledged, setAcknowledged] = useState(false)

  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [signSuccess, setSignSuccess] = useState(false)

  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const maxPerTradeRaw = useMemo(() => humanToRaw(Number(maxPerTradeT)), [maxPerTradeT])
  const maxDailyExposureRaw = useMemo(() => humanToRaw(Number(maxDailyExposureT)), [maxDailyExposureT])
  const formValid = Number(maxPerTradeT) > 0
    && Number(maxDailyExposureT) >= Number(maxPerTradeT)
    && maxDailyTrades >= 1
    && acknowledged

  if (agentQ.loading) return <section className="page"><p className="muted">Loading…</p></section>
  if (agentQ.error) return <section className="page"><p className="error">Could not load agent: {agentQ.error}</p></section>
  if (!agentQ.data) return <section className="page"><h1>Agent not found.</h1></section>
  const { agent: a, performance: p } = agentQ.data

  async function onSignAndCreate() {
    if (!address || !id) return
    setSigning(true); setSignError(null); setSignSuccess(false)
    try {
      // 1. Fresh nonce from CLASH.
      const { nonce } = await fetchFollowNonce()
      // 2. expiresAt — 24h from now (CLASH caps at 7d).
      const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60
      // 3. Build the EIP-712 message and sign.
      const msg = buildFollowMessage({
        agentId: id,
        sizeMultiplier,
        maxPerTradeRaw: BigInt(maxPerTradeRaw),
        maxDailyExposureRaw: BigInt(maxDailyExposureRaw),
        maxDailyTrades,
        nonce,
        expiresAt,
      })
      const signature = await signTypedDataAsync({
        domain: msg.domain,
        types: msg.types as unknown as Record<string, readonly { name: string; type: string }[]>,
        primaryType: msg.primaryType,
        message: msg.message as unknown as Record<string, unknown>,
      })
      // 4. POST to CLASH.
      const { follow: created } = await createFollow(id, address as `0x${string}`, {
        sizeMultiplier,
        maxPerTradeRaw,
        maxDailyExposureRaw,
        maxDailyTrades,
        signedIntent: signature as `0x${string}`,
        intentNonce: nonce,
        expiresAt,
      })
      setFollow(created)
      setSignSuccess(true)
    } catch (err) {
      setSignError(err instanceof Error ? err.message : String(err))
    } finally {
      setSigning(false)
    }
  }

  async function onPause() {
    if (!address || !id || !follow) return
    setActionPending(true); setActionError(null)
    try {
      const { follow: next } = await updateFollowStatus(id, address as `0x${string}`, 'paused')
      setFollow(next)
    } catch (err) { setActionError(err instanceof Error ? err.message : String(err)) }
    finally { setActionPending(false) }
  }
  async function onResume() {
    if (!address || !id || !follow) return
    setActionPending(true); setActionError(null)
    try {
      const { follow: next } = await updateFollowStatus(id, address as `0x${string}`, 'active')
      setFollow(next)
    } catch (err) { setActionError(err instanceof Error ? err.message : String(err)) }
    finally { setActionPending(false) }
  }
  async function onKill() {
    if (!address || !id || !follow) return
    if (!confirm('Kill this follow? This is permanent. The follow row is kept for history but no more mirror attempts will be created.')) return
    setActionPending(true); setActionError(null)
    try {
      const { follow: next } = await killFollow(id, address as `0x${string}`)
      setFollow(next)
    } catch (err) { setActionError(err instanceof Error ? err.message : String(err)) }
    finally { setActionPending(false) }
  }

  return (
    <section className="page use-page">
      <Link className="back-link" to={`/agents/${a.id}`}><ArrowLeft /> Back to {a.name}</Link>
      <div className="section-head">
        <p className="eyebrow">FOLLOW AGENT</p>
        <h1>Mirror <span className="brand-inline">{a.name}</span> from your wallet</h1>
        <p className="lead">You keep your keys. When the agent places an order, your wallet will be asked to sign an identical-shape order with your size and within your caps.</p>
      </div>

      <div className="use-card">
        <div className="use-card-head">
          <div className="agent-card-monogram">{a.name[0]}</div>
          <div>
            <h2>{a.name}</h2>
            <p className="muted">{a.builder} · {a.markets.join(' / ')} · {a.windows.join(' / ')}</p>
          </div>
          <div className="use-card-stats">
            <span className="metric-mini">PnL <b className={p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{formatPnl(p.pnl)}</b></span>
            <span className="metric-mini">{p.trades} settled</span>
            <span className="metric-mini"><ShieldCheck /> Verified</span>
          </div>
        </div>

        {!isConnected
          ? <WalletPrompt />
          : !isOnSomnia
            ? <NetworkPrompt isSwitching={isSwitching} onSwitch={() => { switchChain({ chainId: somniaShannon.id }) }} />
            : followLoading
              ? <ActiveFollowView
                  a={a} follow={follow} stats={followStats}
                  actionPending={actionPending} actionError={actionError}
                  onPause={onPause} onResume={onResume} onKill={onKill}
                />
              : follow && follow.status !== 'killed'
                ? <ActiveFollowView
                    a={a} follow={follow} stats={followStats}
                    actionPending={actionPending} actionError={actionError}
                    onPause={onPause} onResume={onResume} onKill={onKill}
                  />
                : <div className="quote-grid">
                    <div>
                      <SetupForm
                        sizeMultiplier={sizeMultiplier} setSizeMultiplier={setSizeMultiplier}
                        maxPerTradeT={maxPerTradeT} setMaxPerTradeT={setMaxPerTradeT}
                        maxDailyExposureT={maxDailyExposureT} setMaxDailyExposureT={setMaxDailyExposureT}
                        maxDailyTrades={maxDailyTrades} setMaxDailyTrades={setMaxDailyTrades}
                        acknowledged={acknowledged} setAcknowledged={setAcknowledged}
                        formValid={formValid}
                        signing={signing} signError={signError} signSuccess={signSuccess}
                        onSign={onSignAndCreate}
                        wasKilled={!!follow}
                      />
                    </div>
                    <QuoteSummary
                      agentName={a.name}
                      sizeMultiplier={sizeMultiplier}
                      maxPerTradeT={maxPerTradeT}
                      maxDailyExposureT={maxDailyExposureT}
                      maxDailyTrades={maxDailyTrades}
                      formValid={formValid}
                    />
                  </div>
        }
      </div>

      <div className="use-meta">
        <p><ShieldCheck /> Your private key never leaves your wallet. CLASH verifies the signature and stores only the intent.</p>
        <p><ExternalLink /> Mirror attempts are recorded on-chain — the same shape as the agent's order, but signed by your wallet from your funds.</p>
      </div>
    </section>
  )
}

function QuoteSummary({ agentName, sizeMultiplier, maxPerTradeT, maxDailyExposureT, maxDailyTrades, formValid }: {
  agentName: string
  sizeMultiplier: number
  maxPerTradeT: string
  maxDailyExposureT: string
  maxDailyTrades: number
  formValid: boolean
}) {
  return (
    <aside className="quote-summary" aria-label="Your mirror terms">
      <span className="micro">YOUR MIRROR TERMS</span>
      <h3>{agentName} at {Number(sizeMultiplier).toFixed(1)}×</h3>
      <div className="quote-line"><span>Size</span><b>{Number(sizeMultiplier).toFixed(1)}× agent size</b></div>
      <div className="quote-line"><span>Max per trade</span><b className="num">{maxPerTradeT} tUSDC</b></div>
      <div className="quote-line"><span>Max per day</span><b className="num">{maxDailyExposureT} tUSDC</b></div>
      <div className="quote-line"><span>Max trades / day</span><b className="num">{maxDailyTrades}</b></div>
      <p className="quote-expiry">{formValid ? 'Intent lasts 24 hours. Your wallet approves every single mirror.' : 'Complete the steps to bind these terms into your signature.'}</p>
    </aside>
  )
}

function WalletPrompt() {
  return (
    <div className="use-step">
      <span className="use-step-num">1</span>
      <div>
        <h3>Connect your wallet</h3>
        <p className="muted">You'll sign a one-time EIP-712 message. CLASH never sees your private key. For every mirror attempt, your wallet will pop a confirmation.</p>
        <div className="use-wallet-row"><WalletControl /></div>
      </div>
    </div>
  )
}

function NetworkPrompt({ isSwitching, onSwitch }: { isSwitching: boolean; onSwitch: () => void }) {
  return (
    <div className="use-step">
      <span className="use-step-num">1</span>
      <div>
        <h3>Switch to Somnia Shannon testnet</h3>
        <p className="muted">Mirror trades are settled on Somnia. Switch your wallet network to continue.</p>
        <button className="button" onClick={onSwitch} disabled={isSwitching}>{isSwitching ? 'Switching…' : 'Switch to Somnia'}</button>
      </div>
    </div>
  )
}

function SetupForm(props: {
  sizeMultiplier: number; setSizeMultiplier: (n: number) => void
  maxPerTradeT: string; setMaxPerTradeT: (s: string) => void
  maxDailyExposureT: string; setMaxDailyExposureT: (s: string) => void
  maxDailyTrades: number; setMaxDailyTrades: (n: number) => void
  acknowledged: boolean; setAcknowledged: (b: boolean) => void
  formValid: boolean
  signing: boolean; signError: string | null; signSuccess: boolean
  onSign: () => void
  wasKilled: boolean
}) {
  return (
    <>
      {props.wasKilled && (
        <div className="use-step">
          <div>
            <h3>Previous follow ended</h3>
            <p className="muted">You killed the last follow for this agent. Set fresh conditions below and sign a new intent to start mirroring again.</p>
          </div>
        </div>
      )}
      <div className="use-step">
        <span className="use-step-num">2</span>
        <div>
          <h3>Size multiplier</h3>
          <p className="muted">How much of each order to mirror. 1.0× mirrors at the agent's size; 0.5× mirrors at half-size. Range: 0.1×..10.0×.</p>
          <div className="use-input-row">
            <input
              type="number" min={0.1} max={10} step={0.1}
              value={props.sizeMultiplier}
              onChange={e => props.setSizeMultiplier(Number(e.target.value))}
            />
            <span>×</span>
          </div>
        </div>
      </div>

      <div className="use-step">
        <span className="use-step-num">3</span>
        <div>
          <h3>Your safety caps</h3>
          <p className="muted">CLASH enforces these on every mirror attempt. Mirror requests that would breach a cap are rejected before your wallet is asked to sign.</p>
          <div className="use-cap-grid">
            <label>
              <span>Max per trade (tUSDC)</span>
              <input type="number" min={0.000001} step={0.01} value={props.maxPerTradeT} onChange={e => props.setMaxPerTradeT(e.target.value)} />
              <small>Raw: {props.maxPerTradeT.replace(/^0+|\.$|0+$/g, m => m === '.' ? '' : '') || '0'}</small>
            </label>
            <label>
              <span>Max total per day (tUSDC)</span>
              <input type="number" min={0} step={0.01} value={props.maxDailyExposureT} onChange={e => props.setMaxDailyExposureT(e.target.value)} />
            </label>
            <label>
              <span>Max trades per day</span>
              <input type="number" min={1} max={1000} step={1} value={props.maxDailyTrades} onChange={e => props.setMaxDailyTrades(Number(e.target.value))} />
            </label>
          </div>
        </div>
      </div>

      <div className="use-step">
        <span className="use-step-num">4</span>
        <div>
          <h3>Authorise the mirror</h3>
          <p className="muted">You sign a single EIP-712 message binding the caps above to this agent. Your wallet will pop a confirmation — read the message, then sign.</p>
          <label className="use-checkbox">
            <input type="checkbox" checked={props.acknowledged} onChange={e => props.setAcknowledged(e.target.checked)} />
            <span>
              I understand CLASH does not custody my funds. The agent's runtime cannot sign for me; my wallet will prompt for every mirror attempt.
              The intent expires in 24 hours and CLASH will not mirror after that.
            </span>
          </label>
          {props.signError && <p className="error small">{props.signError}</p>}
          <button
            className="button primary"
            disabled={!props.formValid || props.signing}
            onClick={() => void props.onSign()}
          >
            {props.signing ? 'Sign in wallet…' : 'Sign and activate'}
          </button>
        </div>
      </div>

      {props.signSuccess && (
        <div className="use-step complete">
          <span className="use-step-num"><Check /></span>
          <div>
            <h3>Active</h3>
            <p>CLASH has recorded your follow. From now on, every time the agent broadcasts an order, your open tab will pop a wallet confirmation with the same-shape call. Caps are enforced before your wallet is asked to sign.</p>
            <p className="muted small">You can pause or kill this follow from this page at any time. The follow expires after 24 hours unless you sign a new intent.</p>
          </div>
        </div>
      )}
    </>
  )
}

function ActiveFollowView({ a, follow, stats, actionPending, actionError, onPause, onResume, onKill }: {
  a: import('../store').Agent
  follow: Follow | null
  stats: { exposureRaw: string; count: number }
  actionPending: boolean; actionError: string | null
  onPause: () => void; onResume: () => void; onKill: () => void
}) {
  if (!follow) {
    return <div className="use-step"><p className="muted">Loading your follow…</p></div>
  }
  const isKilled = follow.status === 'killed'
  const isPaused = follow.status === 'paused'
  const expiresIn = Math.max(0, Math.floor((new Date(follow.expiresAt).getTime() - Date.now()) / 1000 / 3600))
  return (
    <>
      <div className="use-step complete">
        <span className="use-step-num"><Check /></span>
        <div>
          <h3>Following {a.name}</h3>
          <p>You are mirroring {a.name} at <b>{follow.sizeMultiplier.toFixed(1)}×</b> the agent's size. CLASH enforces your caps before asking your wallet to sign.</p>
          <p className="muted small">Status: <b data-status={follow.status}>{follow.status}</b> · expires in {expiresIn}h</p>
        </div>
      </div>

      <div className="use-step">
        <div>
          <h3>Your caps</h3>
          <div className="use-cap-grid">
            <div><span>Size multiplier</span><b>{follow.sizeMultiplier.toFixed(1)}×</b></div>
            <div><span>Max per trade</span><b>{rawToHuman(follow.maxPerTradeRaw).toFixed(2)} tUSDC</b></div>
            <div><span>Max per day</span><b>{rawToHuman(follow.maxDailyExposureRaw).toFixed(2)} tUSDC</b></div>
            <div><span>Max trades / day</span><b>{follow.maxDailyTrades}</b></div>
            <div><span>Today's exposure</span><b>{(Number(stats.exposureRaw) / 1_000_000).toFixed(2)} tUSDC</b></div>
            <div><span>Today's trades</span><b>{stats.count}</b></div>
          </div>
        </div>
      </div>

      <div className="use-step">
        <div>
          <h3>Manage follow</h3>
          {actionError && <p className="error small">{actionError}</p>}
          <div className="use-button-row">
            {!isKilled && !isPaused
              ? <button className="button" onClick={onPause} disabled={actionPending}><Pause /> Pause</button>
              : !isKilled && isPaused
                ? <button className="button" onClick={onResume} disabled={actionPending}><Play /> Resume</button>
                : null}
            {!isKilled
              ? <button className="button warn" onClick={onKill} disabled={actionPending}><Trash2 /> Kill</button>
              : <p className="muted">This follow is killed. Create a new one to start mirroring again.</p>}
          </div>
        </div>
      </div>
    </>
  )
}
