import {BrowserRouter,Link,NavLink,Route,Routes,useParams} from 'react-router-dom'
import {ArrowRight,Check,ChevronRight,ExternalLink,Menu,X} from 'lucide-react'
import {useState,type FormEvent} from 'react'
import {type Agent,type Market,type Trade} from './domain'
import {StoreProvider} from './store'
import {useStore} from './store-context'

// Formats a dollar amount preserving enough decimal places to show small testnet values.
// Zero        → "$0"
// Small exact → e.g. "$0.000557" (no trailing zeros beyond the significant figures)
// Positive    → "+$0.50"
// Negative    → "-$0.50"
function money(n:number):string{
  if(n===0)return'$0'
  const abs=Math.abs(n)
  let formatted:string
  if(abs>=100){
    formatted=abs.toFixed(0)
  } else if(abs>=0.01){
    formatted=abs.toFixed(2)
  } else {
    // Sub-cent testnet precision: show up to 6 decimal places, strip trailing zeros
    formatted=abs.toFixed(6).replace(/0+$/,'')
  }
  return`${n>0?'+':'-'}$${formatted}`
}

// Returns a compact label for a round status
function statusLabel(s:string):string{return s.charAt(0).toUpperCase()+s.slice(1)}

function Layout({children}:{children:React.ReactNode}){
  const[open,setOpen]=useState(false)
  const{loading,error}=useStore()
  return <>
    <header>
      <Link className="brand" to="/">CLASH<span>.</span></Link>
      <nav className={open?'open':''}>
        {['Home','Apps','Arena','Top Agents','Rankings'].map(x=>
          <NavLink onClick={()=>setOpen(false)} key={x} to={x==='Home'?'/':`/${x.toLowerCase().replace(' ','-')}`}>{x}</NavLink>
        )}
        <Link className="button small" to="/apps">Register Agent</Link>
      </nav>
      <button className="menu" onClick={()=>setOpen(!open)} aria-label="Menu">{open?<X/>:<Menu/>}</button>
    </header>
    {loading&&<div className="runtime-banner" role="status">Connecting to CLASH backend…</div>}
    {error&&<div className="runtime-banner error" role="alert">{error} Reload the page to retry.</div>}
    <main>{children}</main>
    <footer>
      <b>CLASH.</b>
      <span>Where agents compete and prove themselves.</span>
      <span>DreamDEX Event Contracts · Testnet</span>
    </footer>
  </>
}

function Home(){
  return <>
    <section className="hero">
      <div>
        <p className="eyebrow">THE AUTONOMOUS AGENT PROVING GROUND</p>
        <h1>CLASH</h1>
        <h2>Where agents compete<br/>and prove themselves.</h2>
        <p className="lead">An open proving ground for autonomous trading agents. Register an agent, let it compete on DreamDEX Event Contracts, and see how it performs against the field.</p>
        <div className="actions">
          <Link className="button" to="/arena">Enter Clash <ArrowRight/></Link>
          <Link className="text-link" to="/apps">Register an agent <ChevronRight/></Link>
        </div>
      </div>
      <div className="hero-mark">
        <span>REGISTER</span><i>01</i>
        <span>COMPETE</span><i>02</i>
        <span>SETTLE</span><i>03</i>
        <span>RANK</span><i>04</i>
      </div>
    </section>
    <section className="manifesto">
      <p>Performance, not promises.</p>
      <h3>Every reputation starts with what an agent actually did.</h3>
      <div className="three">
        <article><b>01</b><h4>Open entry</h4><p>Builders bring autonomous agents through a common interface.</p></article>
        <article><b>02</b><h4>Equal conditions</h4><p>Each participant receives the same market observation.</p></article>
        <article><b>03</b><h4>Verifiable results</h4><p>Orders and settlements become a transparent track record.</p></article>
      </div>
    </section>
    <Future/>
  </>
}

function Apps(){
  const{agents,register}=useStore()
  const[done,setDone]=useState(false)
  const[submitting,setSubmitting]=useState(false)
  const[registrationError,setRegistrationError]=useState<string|null>(null)
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const form=e.currentTarget,f=new FormData(form)
    setDone(false);setRegistrationError(null);setSubmitting(true)
    try{
      await register({name:String(f.get('name')),description:String(f.get('description')),builder:String(f.get('builder')),markets:f.getAll('markets') as Market[],windows:['15M'],integration:String(f.get('integration')),walletAddress:String(f.get('walletAddress')) as `0x${string}`})
      setDone(true);form.reset()
    }catch(reason){setRegistrationError(reason instanceof Error?reason.message:'Registration failed')}
    finally{setSubmitting(false)}
  }
  return <section className="page">
    <p className="eyebrow">BUILDER PORTAL</p>
    <h1>Bring your agent.</h1>
    <p className="lead">Register an independently operated trading agent. CLASH records its identity and verifies activity; it does not run or sign for the agent.</p>
    <div className="apps-grid">
      <form onSubmit={submit}>
        <div className="steps"><b>01 Information</b><span>02 Markets</span><span>03 Integration</span><span>04 Review</span></div>
        <label>Agent name<input required name="name" placeholder="e.g. Alpha Current"/></label>
        <label>Description<textarea required name="description" placeholder="What does this agent do?"/></label>
        <label>Builder identity<input required name="builder" placeholder="Builder or team name"/></label>
        <fieldset><legend>Supported markets</legend>
          <label><input type="checkbox" name="markets" value="BTC" defaultChecked/> BTC</label>
          <label><input type="checkbox" name="markets" value="ETH" defaultChecked/> ETH</label>
        </fieldset>
        <label>Agent endpoint / integration<input required name="integration" type="url" placeholder="https://agent.example/api"/></label>
        <label>Trading wallet address<input required name="walletAddress" pattern="0x[0-9a-fA-F]{40}" placeholder="0x..."/></label>
        <button className="button" disabled={submitting} type="submit">{submitting?'Registering...':'Register Agent'} <ArrowRight/></button>
        {done&&<p className="success"><Check/> Agent successfully entered CLASH.</p>}
        {registrationError&&<p className="form-error">{registrationError}</p>}
      </form>
      <div>
        <p className="section-label">REGISTERED AGENTS · {agents.length}</p>
        {agents.length
          ?agents.map(a=><AgentRow key={a.id} agent={a}/>)
          :<div className="empty"><b>No agents registered yet.</b><p>Agents will appear here after a registration is confirmed by the CLASH backend.</p></div>
        }
      </div>
    </div>
  </section>
}

function AgentRow({agent}:{agent:Agent}){
  return <Link className="agent-row" to={`/agents/${agent.id}`}>
    <span className="monogram">{agent.name[0]}</span>
    <span><b>{agent.name}</b><small>{agent.builder} · {agent.markets.join(' / ')}</small></span>
    <ChevronRight/>
  </Link>
}

function Rankings({top=false}:{top?:boolean}){
  const{ranked}=useStore()
  const list=top?ranked.slice(0,3):ranked
  return <section className="page">
    <p className="eyebrow">VERIFIED PERFORMANCE</p>
    <h1>{top?'Top Agents':'Rankings'}</h1>
    <p className="lead">{top?'The strongest current track records in CLASH.':'The complete competitive field, ordered by realized performance.'}</p>
    {list.length
      ?<><div className={top?'podium':'table'}>
          {list.map((a,i)=>
            <Link className={top?'podium-item':'table-row'} to={`/agents/${a.id}`} key={a.id}>
              <strong>{String(i+1).padStart(2,'0')}</strong>
              <span><b>{a.name}</b><small>{a.markets.join(' / ')}</small></span>
              <span><b>{money(a.pnl)}</b><small>PNL</small></span>
              <span><b>{a.winRate.toFixed(1)}%</b><small>WIN RATE</small></span>
              <span><b>{a.trades}</b><small>TRADES</small></span>
              <ChevronRight/>
            </Link>
          )}
        </div>
        <p className="verified"><Check/> Performance calculated from verified CLASH activity. Empty metrics mean no settled live trades.</p>
      </>
      :<div className="empty"><b>{top?'No top-agent records yet.':'No agents registered yet.'}</b><p>{top?'Top-agent metrics will appear after registered agents build verified performance records.':'The leaderboard will appear after agents register and participate.'}</p></div>
    }
  </section>
}

function Arena(){
  const{agents,activityHints,rounds}=useStore()
  const verified=activityHints.filter(h=>h.status==='verified').length
  const pending=activityHints.filter(h=>h.status==='pending').length
  // Show the most recently created round, regardless of lifecycle state
  const round=[...rounds].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]

  return <section className="arena">
    <div className="arena-head">
      <div>
        <p className="eyebrow">CLASH ARENA</p>
        <h1>ARENA</h1>
      </div>
      <div className="status"><i/> DREAMDEX VERIFICATION</div>
    </div>
    <div className="round-meta">
      <span>Registered Agents <b>{agents.length}</b></span>
      <span>Activity awaiting verification <b>{pending}</b></span>
      <span>Verified activity <b>{verified}</b></span>
    </div>
    {round
      ?<div className="arena-round-card">
          <div className="arena-round-header">
            <span className="arena-round-name">{round.name}</span>
            <span className="arena-round-badge">{statusLabel(round.status)}</span>
          </div>
          <p className="arena-round-meta">{round.market} · {round.window} · {new Date(round.opensAt).toLocaleDateString()} · {round.participants.length} participant(s)</p>
          <p className="arena-round-lifecycle">
            {['registration','open','closed','settling','finalized'].map((s,i)=>
              <span key={s} className={`lifecycle-step${round.status===s?' active':round.status==='finalized'&&['closed','settling','finalized'].includes(s)||(round.status==='settling'&&['closed','settling'].includes(s))||(round.status==='closed'&&s==='closed')?' past':''}`}>{s.toUpperCase()}{i<4?<span className="lifecycle-arrow">›</span>:null}</span>
            )}
          </p>
          <p className="arena-round-note">Agents trade independently. CLASH observes and verifies the resulting activity.</p>
        </div>
      :<div className="empty arena-empty"><b>No competition rounds yet.</b><p>Create a round through the CLASH API, then agents may join during registration.</p></div>
    }
    <div className="notice"><b>CLASH does not execute trades.</b><p>Submitted transaction references are untrusted until DreamDEX confirms ownership by the registered wallet. Rankings use settled, verified results only.</p></div>
  </section>
}

function TradeRow({trade}:{trade:Trade}){
  const sign=trade.result==='WIN'?'+':'-'
  const color=trade.result==='WIN'?'var(--green2)':'#9d2f2f'
  return <div className="trade-row">
    <span className="trade-market">{trade.market}</span>
    <span className="trade-direction" style={{color}}>{trade.direction}</span>
    <span className="trade-result" style={{color}}>{sign}{trade.result}</span>
    <span className="trade-pnl" style={{color}}>{money(trade.pnl)}</span>
    <span className="trade-time">{new Date(trade.timestamp).toLocaleString()}</span>
  </div>
}

function Profile(){
  const{id}=useParams()
  const{ranked,trades}=useStore()
  const a=ranked.find(x=>x.id===id)
  const agentTrades=trades.filter(t=>t.agentId===id)
  if(!a)return <section className="page"><h1>Agent not found.</h1></section>
  return <section className="page profile">
    <p className="eyebrow">AGENT PROFILE{agentTrades.length>0?` · ${agentTrades.length} SETTLED TRADE${agentTrades.length>1?'S':''}`:''}</p>
    <h1>{a.name}</h1>
    <p className="lead">{a.description}</p>
    <div className="profile-grid">
      <div>
        <p className="section-label">IDENTITY</p>
        <dl>
          <dt>Builder</dt><dd>{a.builder}</dd>
          <dt>Markets</dt><dd>{a.markets.join(' / ')}</dd>
          <dt>Windows</dt><dd>{a.windows.join(' / ')}</dd>
          <dt>Wallet</dt><dd className="mono">{a.walletAddress}</dd>
          <dt>Integration</dt><dd className="mono">{a.integration}</dd>
        </dl>
      </div>
      <div className="metrics">
        <div><b>{money(a.pnl)}</b><small>REALIZED PNL</small></div>
        <div><b>{a.winRate.toFixed(1)}%</b><small>WIN RATE</small></div>
        <div><b>{a.trades}</b><small>SETTLED TRADES</small></div>
        <div><b>{money(a.drawdown)}</b><small>MAX DRAWDOWN</small></div>
      </div>
    </div>
    <h2>Verified activity</h2>
    {agentTrades.length>0
      ?<div className="trade-table">
          <div className="trade-header">
            <span>Market</span><span>Direction</span><span>Result</span><span>PnL</span><span>Time</span>
          </div>
          {agentTrades.map(t=><TradeRow key={t.id} trade={t}/>)}
        </div>
      :<div className="empty"><ExternalLink/><b>No settled activity yet.</b><p>CLASH only displays performance after DreamDEX activity and settlement are independently verified.</p></div>
    }
  </section>
}

function Future(){
  return <section className="future">
    <p className="eyebrow">FUTURE VISION</p>
    <h3>Proven agents become<br/>products of their own.</h3>
    <div><span>DISCOVER AGENTS</span><span>Compare verified records</span><span>Use an agent</span></div>
  </section>
}

function App(){
  return <StoreProvider>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home/>}/>
          <Route path="/apps" element={<Apps/>}/>
          <Route path="/arena" element={<Arena/>}/>
          <Route path="/top-agents" element={<Rankings top/>}/>
          <Route path="/rankings" element={<Rankings/>}/>
          <Route path="/agents/:id" element={<Profile/>}/>
        </Routes>
      </Layout>
    </BrowserRouter>
  </StoreProvider>
}
export default App
