import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react'
import { listMyAgents, registerAgent, type Agent } from '../store'
import { useWallet } from '../useWallet'
import { WalletControl } from '../WalletControl'

type DelegationMethod = 'spot_operator' | 'session_tx' | 'self_run'

export function Developers() {
  return (
    <section className="page">
      <div className="section-head">
        <p className="eyebrow">DEVELOPERS</p>
        <h1>Register an agent. Earn its reputation.</h1>
        <p className="lead">
          You keep your wallet, your signer, and your strategy. CLASH gives you a public profile, a verification layer, and a path to users.
        </p>
      </div>
      <DevelopersBody />
    </section>
  )
}

function DevelopersBody() {
  const { isConnected, address, isOnSomnia, switchToSomnia, isSwitching } = useWallet()
  const [view, setView] = useState<'overview' | 'form' | 'success'>('overview')
  if (!isConnected) {
    return (
      <div className="empty">
        <b>Connect your developer wallet to register an agent.</b>
        <p>CLASH ties agent ownership to the connected wallet. The wallet is never asked to sign anything by CLASH itself.</p>
        <div className="empty-action"><WalletControl /></div>
      </div>
    )
  }
  if (!isOnSomnia) {
    return <div className="empty"><b>Switch to Somnia to register an agent.</b><button className="button" onClick={switchToSomnia} disabled={isSwitching}>{isSwitching ? 'Switching…' : 'Switch to Somnia'}</button></div>
  }
  if (view === 'form') return <RegistrationForm ownerAddress={address!} onDone={() => setView('success')} onCancel={() => setView('overview')} />
  if (view === 'success') return <SuccessAndBack onAnother={() => setView('form')} />
  return <Overview ownerAddress={address!} onRegister={() => setView('form')} />
}

function Overview({ ownerAddress, onRegister }: { ownerAddress: `0x${string}`; onRegister: () => void }) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { listMyAgents(ownerAddress).then(d => setAgents(d.agents)).catch(e => setError(e.message)) }, [ownerAddress])
  return (
    <div className="dev-grid">
      <div className="dev-card">
        <h3>Your registered agents</h3>
        {error && <p className="error">Could not load your agents: {error}</p>}
        {agents === null && <p className="muted">Loading…</p>}
        {agents !== null && agents.length === 0 && (
          <div className="empty"><b>You have not registered any agents yet.</b><p>Click below to register your first agent.</p></div>
        )}
        {agents !== null && agents.length > 0 && (
          <ul className="dev-agent-list">
            {agents.map(a => (
              <li key={a.id}>
                <Link to={`/developers/agents/${a.id}`} className="dev-agent-row">
                  <span className="dev-agent-id">
                    <b>{a.name}</b>
                    <small>{a.builder} · {a.markets.join(' / ')}</small>
                  </span>
                  <span className="status-chip" data-status={a.status}>{a.status}</span>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button className="button" onClick={onRegister}>Register an agent <ArrowRight /></button>
      </div>
      <div className="dev-card">
        <h3>What you get</h3>
        <ul className="bullet-list">
          <li>A public profile on the marketplace.</li>
          <li>Verified on-chain activity (CLASH reads the indexer, you push hints).</li>
          <li>A per-agent API key for your runtime to authenticate.</li>
          <li>Live rankings, sorted by realized PnL.</li>
        </ul>
        <h3>What you keep</h3>
        <ul className="bullet-list">
          <li>Your agent's strategy, signer, and trading wallet.</li>
          <li>Your own infrastructure. CLASH does not run your agent.</li>
          <li>Full control over what your agent does and when.</li>
        </ul>
      </div>
    </div>
  )
}

function RegistrationForm({ ownerAddress, onDone, onCancel }: { ownerAddress: `0x${string}`; onDone: () => void; onCancel: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [methods, setMethods] = useState<DelegationMethod[]>(['self_run'])
  const [spotPoolAddress, setSpotPoolAddress] = useState('')
  const [sessionContract, setSessionContract] = useState('')
  const [notes, setNotes] = useState('')

  function toggleMethod(m: DelegationMethod) {
    setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!ownerAddress) return
    setError(null); setSubmitting(true)
    try {
      const f = new FormData(e.currentTarget)
      const walletAddress = String(f.get('walletAddress') ?? '').trim() as `0x${string}`
      if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) throw new Error('Trading wallet address must be a valid EVM address.')
      if (methods.length === 0) throw new Error('Pick at least one delegation method.')
      if (methods.includes('spot_operator') && !/^0x[0-9a-fA-F]{40}$/.test(spotPoolAddress)) {
        throw new Error('Spot operator grant requires a spot pool address.')
      }
      if (methods.includes('session_tx') && !/^0x[0-9a-fA-F]{40}$/.test(sessionContract)) {
        throw new Error('Session transaction delegation requires a session contract address.')
      }
      const result = await registerAgent({
        name: String(f.get('name') ?? '').trim(),
        description: String(f.get('description') ?? '').trim(),
        builder: String(f.get('builder') ?? '').trim(),
        markets: f.getAll('markets') as ('BTC' | 'ETH')[],
        windows: ['15M'],
        integration: String(f.get('integration') ?? '').trim(),
        walletAddress,
        ownerAddress,
        delegationMethods: methods,
        delegationMetadata: {
          spotPoolAddress: methods.includes('spot_operator') ? (spotPoolAddress as `0x${string}`) : undefined,
          sessionContract: methods.includes('session_tx') ? (sessionContract as `0x${string}`) : undefined,
          notes: notes.trim() || undefined,
        },
      })
      // Stash the API key for the success view via sessionStorage so a refresh
      // does not lose it, but it is not persisted beyond this tab.
      sessionStorage.setItem('clash:lastApiKey', JSON.stringify({ agentId: result.agent.id, apiKey: result.apiKey, agentName: result.agent.name }))
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setSubmitting(false) }
  }

  return (
    <form className="dev-form" onSubmit={submit}>
      <div className="steps"><b>01 Identity</b><span>02 Markets</span><span>03 Delegation</span><span>04 Submit</span></div>
      {error && <p className="error">{error}</p>}
      <div className="form-grid two">
        <label>Agent name<input required name="name" placeholder="e.g. ETH Momentum" maxLength={60} /></label>
        <label>Builder / team<input required name="builder" placeholder="Builder or team name" maxLength={80} /></label>
      </div>
      <label>Description<textarea required name="description" placeholder="What does this agent do, in plain English?" minLength={10} maxLength={500} /></label>
      <fieldset>
        <legend>Supported markets</legend>
        <label className="check"><input type="checkbox" name="markets" value="BTC" defaultChecked /> BTC</label>
        <label className="check"><input type="checkbox" name="markets" value="ETH" defaultChecked /> ETH</label>
      </fieldset>
      <label>Agent integration URL<input required name="integration" type="url" placeholder="https://agent.example.com" /></label>
      <label>Trading wallet address<input required name="walletAddress" pattern="0x[0-9a-fA-F]{40}" placeholder="0x..." defaultValue={ownerAddress} /><small>The public address the agent uses to trade on Somnia. Defaults to your connected wallet. Use a separate hot wallet for delegated execution.</small></label>

      <fieldset>
        <legend>Delegation methods this agent supports</legend>
        <label className="check">
          <input type="checkbox" checked={methods.includes('spot_operator')} onChange={() => toggleMethod('spot_operator')} />
          <span><b>Spot operator grant</b><small>User signs setOperatorApprovalForPool on a DreamDEX spot pool.</small></span>
        </label>
        {methods.includes('spot_operator') && (
          <label className="indented">Spot pool address<input value={spotPoolAddress} onChange={e => setSpotPoolAddress(e.target.value)} pattern="0x[0-9a-fA-F]{40}" placeholder="0x..." /></label>
        )}
        <label className="check">
          <input type="checkbox" checked={methods.includes('session_tx')} onChange={() => toggleMethod('session_tx')} />
          <span><b>Session transaction / EIP-7702</b><small>User signs a Somnia session envelope or EIP-7702 authorization to your implementation contract.</small></span>
        </label>
        {methods.includes('session_tx') && (
          <label className="indented">Session / implementation contract address<input value={sessionContract} onChange={e => setSessionContract(e.target.value)} pattern="0x[0-9a-fA-F]{40}" placeholder="0x..." /></label>
        )}
        <label className="check">
          <input type="checkbox" checked={methods.includes('self_run')} onChange={() => toggleMethod('self_run')} />
          <span><b>Self-run</b><small>Users run the agent themselves with their own wallet.</small></span>
        </label>
      </fieldset>

      <label>Notes (optional)<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything users should know about how this agent trades." maxLength={500} /></label>

      <div className="form-actions">
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button" disabled={submitting}>{submitting ? 'Registering…' : 'Register agent'} <ArrowRight /></button>
      </div>
    </form>
  )
}

function SuccessAndBack({ onAnother }: { onAnother: () => void }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const stored = sessionStorage.getItem('clash:lastApiKey')
  const data = stored ? JSON.parse(stored) as { agentId: string; apiKey: string; agentName: string } : null

  if (!data) {
    return (
      <div className="dev-card">
        <h3>Registered</h3>
        <p>Your agent is on the marketplace. The API key is gone (it was only shown once). Rotate a new one from the developer dashboard.</p>
        <button className="button" onClick={onAnother}>Register another</button>
      </div>
    )
  }

  return (
    <div className="dev-card success">
      <h3><Check /> {data.agentName} is registered.</h3>
      <p className="muted">Your agent is on the marketplace. Below is the API key your runtime will use to authenticate. <b>This is the only time CLASH will show it.</b></p>
      <div className="api-key">
        <code>{revealed ? data.apiKey : '•'.repeat(40)}</code>
        <button className="button small" onClick={() => setRevealed(r => !r)}>{revealed ? <><EyeOff /> Hide</> : <><Eye /> Reveal</>}</button>
        <button className="button small" onClick={async () => { await navigator.clipboard.writeText(data.apiKey); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
        </button>
      </div>
      <h4>What your runtime does with this key</h4>
      <pre className="code-block">
{`POST /api/external/agents/${data.agentId}/activity
Authorization: Bearer ${revealed ? data.apiKey : '<api_key>'}
Content-Type: application/json

{
  "txHash": "0x...",
  "orderId": "optional",
  "marketId": "0x..."
}`}
      </pre>
      <p className="muted small">CLASH re-derives every trade from the chain. The hint is a discovery signal — performance always comes from the on-chain fill.</p>
      <div className="form-actions">
        <button className="button ghost" onClick={onAnother}>Register another agent</button>
        <a className="button" href={`/agents/${data.agentId}`}>View agent profile <ChevronRight /></a>
      </div>
    </div>
  )
}
