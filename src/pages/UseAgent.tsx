import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, ShieldCheck } from 'lucide-react'
import { checkUseState, fetchAgent, recordUseState, revokeUseState, type Agent } from '../store'
import { useAsync } from '../useAsync'
import { useWallet } from '../useWallet'

type Path = 'spot_operator' | 'session_tx' | 'self_run'

export function UseAgent() {
  const { id } = useParams<{ id: string }>()
  const { isConnected, address, isOnSomnia, switchToSomnia, isSwitching } = useWallet()

  const agentQ = useAsync(
    () => id ? fetchAgent(id) : Promise.reject(new Error('No agent id')),
    [id],
  )

  const [authState, setAuthState] = useState<{
    path: Path
    authorized: boolean
    reason?: string
  } | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [recorded, setRecorded] = useState(false)

  // Re-check authorization whenever the connected wallet changes.
  useEffect(() => {
    if (!isConnected || !address || !id) { setAuthState(null); return }
    setAuthState(null); setRecorded(false); setRecordError(null)
    let alive = true
    checkUseState(id, address)
      .then(r => { if (alive) setAuthState({ path: r.path as Path, authorized: r.authorized, reason: r.reason }) })
      .catch(err => { if (alive) setRecordError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [address, id, isConnected])

  if (agentQ.loading) return <section className="page"><p className="muted">Loading…</p></section>
  if (agentQ.error) return <section className="page"><p className="error">Could not load agent: {agentQ.error}</p></section>
  if (!agentQ.data) return <section className="page"><h1>Agent not found.</h1></section>
  const { agent: a, performance: p } = agentQ.data

  async function onConfirm() {
    if (!address || !authState || !a) return
    setRecording(true); setRecordError(null)
    try {
      await recordUseState(a.id, address, authState.path)
      setRecorded(true)
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
    }
  }

  async function onRevoke() {
    if (!address || !authState || !a) return
    if (authState.path === 'self_run') return
    setRecording(true); setRecordError(null)
    try {
      await revokeUseState(a.id, address, authState.path)
      setAuthState({ ...authState, authorized: false, reason: 'You have revoked this authorization on the marketplace.' })
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
    }
  }

  return (
    <section className="page use-page">
      <Link className="back-link" to={`/agents/${a.id}`}><ArrowLeft /> Back to {a.name}</Link>
      <div className="section-head">
        <p className="eyebrow">USE AGENT</p>
        <h1>Authorize <span className="brand-inline">{a.name}</span></h1>
        <p className="lead">CLASH picks the right authorization method for this agent based on what it actually supports. You sign the on-chain transaction from your own wallet.</p>
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
            <span className="metric-mini">{p.trades} trades</span>
            <span className="metric-mini"><ShieldCheck /> Verified</span>
          </div>
        </div>

        {!isConnected
          ? <WalletPrompt />
          : !isOnSomnia
            ? <NetworkPrompt isSwitching={isSwitching} onSwitch={switchToSomnia} />
            : <AuthorizationFlow
                a={a}
                authState={authState}
                recorded={recorded}
                recording={recording}
                recordError={recordError}
                onConfirm={onConfirm}
                onRevoke={onRevoke}
              />
        }
      </div>

      <div className="use-meta">
        <p><ShieldCheck /> CLASH never asks for your seed phrase or private key.</p>
        <p><ExternalLink /> All authorizations are verified on Somnia. If CLASH cannot observe the authorization on-chain, it is not recorded.</p>
      </div>
    </section>
  )
}

function WalletPrompt() {
  return (
    <div className="use-step">
      <h3>1. Connect your wallet</h3>
      <p className="muted">Use the connect button in the header. CLASH only asks your wallet to sign the authorization this agent requires — nothing else.</p>
    </div>
  )
}

function NetworkPrompt({ isSwitching, onSwitch }: { isSwitching: boolean; onSwitch: () => void }) {
  return (
    <div className="use-step">
      <h3>1. Switch to Somnia</h3>
      <p className="muted">This agent trades on the Somnia Shannon testnet. Switch your wallet to the Somnia network to continue.</p>
      <button className="button" onClick={onSwitch} disabled={isSwitching}>{isSwitching ? 'Switching…' : 'Switch to Somnia'}</button>
    </div>
  )
}

function AuthorizationFlow({
  a, authState, recorded, recording, recordError, onConfirm, onRevoke,
}: {
  a: Agent
  authState: { path: Path; authorized: boolean; reason?: string } | null
  recorded: boolean
  recording: boolean
  recordError: string | null
  onConfirm: () => void | Promise<void>
  onRevoke: () => void | Promise<void>
}) {
  if (authState === null) {
    return <div className="use-step"><h3>2. Checking on-chain authorization</h3><p className="muted">CLASH is reading the chain to find the right method for this agent…</p></div>
  }

  // Helper to render the right copy.
  const steps = buildSteps(a, authState)

  return (
    <>
      {steps.map((s, i) => (
        <div className={`use-step ${s.complete ? 'complete' : ''} ${s.active ? 'active' : ''}`} key={i}>
          <span className="use-step-num">{i + 1}</span>
          <div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {s.action === 'confirm' && authState.authorized && !recorded
              ? <button className="button" onClick={() => void onConfirm()} disabled={recording}>{recording ? 'Recording…' : 'I have signed — record on CLASH'}</button>
              : null}
            {s.action === 'revoke' && authState.authorized && recorded && authState.path !== 'self_run'
              ? <button className="button warn" onClick={() => void onRevoke()} disabled={recording}>{recording ? 'Revoking…' : 'Revoke authorization'}</button>
              : null}
            {recordError && <p className="error small">{recordError}</p>}
          </div>
          {s.complete ? <Check className="use-step-check" /> : null}
        </div>
      ))}

      {recorded && (
        <div className="use-step complete">
          <span className="use-step-num"><Check /></span>
          <div>
            <h3>Authorized</h3>
            <p>CLASH has recorded your authorization. The on-chain proof is in the marketplace's database and visible on the agent's profile.</p>
            <p className="muted small">You can revoke at any time from this page.</p>
          </div>
        </div>
      )}
    </>
  )
}

interface Step { title: string; body: string; complete: boolean; active: boolean; action?: 'confirm' | 'revoke' }

function buildSteps(_a: Agent, auth: { path: Path; authorized: boolean; reason?: string }): Step[] {
  const walletConnected = true
  const verified = auth.authorized
  const recorded = false
  if (auth.path === 'spot_operator') {
    return [
      { title: 'Wallet connected', body: 'Your wallet is connected to Somnia Shannon testnet.', complete: walletConnected, active: !walletConnected },
      { title: 'Authorize on-chain', body: 'Sign `setOperatorApprovalForPool` from your wallet, naming this agent\'s trading wallet as the operator on the spot pool. CLASH detects the grant on-chain.', complete: verified, active: walletConnected && !verified },
      { title: 'CLASH records the authorization', body: verified ? 'CLASH observed the grant on-chain. Click below to record it on the marketplace.' : 'Waiting for the on-chain grant…', complete: recorded, active: verified && !recorded, action: 'confirm' },
    ]
  }
  if (auth.path === 'session_tx') {
    return [
      { title: 'Wallet connected', body: 'Your wallet is connected to Somnia Shannon testnet.', complete: walletConnected, active: !walletConnected },
      { title: 'Sign the session or EIP-7702 authorization', body: 'The agent\'s runtime will instruct your wallet to sign the right authorization. CLASH detects the designation on-chain by reading the account code.', complete: verified, active: walletConnected && !verified },
      { title: 'CLASH records the authorization', body: verified ? 'CLASH observed the designation. Click below to record it.' : 'Waiting for the on-chain authorization…', complete: recorded, active: verified && !recorded, action: 'confirm' },
    ]
  }
  // self_run
  return [
    { title: 'Wallet connected', body: 'Your wallet is connected to Somnia Shannon testnet.', complete: walletConnected, active: !walletConnected },
    { title: 'Run the agent yourself', body: 'This agent is designed to be run by you, the user. Fund your own wallet, follow the agent\'s instructions, and the agent will trade on your behalf with your private key — never CLASH\'s.', complete: true, active: false },
    { title: 'Open the agent\'s instructions', body: 'CLASH does not record a marketplace authorization for self-run agents. You remain the operator.', complete: true, active: false },
  ]
}

function formatPnl(n: number): string {
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  let formatted: string
  if (abs >= 100) formatted = abs.toFixed(0)
  else if (abs >= 0.01) formatted = abs.toFixed(2)
  else formatted = abs.toFixed(6).replace(/0+$/, '')
  return `${n > 0 ? '+' : '-'}$${formatted}`
}
