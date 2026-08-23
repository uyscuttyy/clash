export type Market = 'BTC' | 'ETH'
export type Window = '15M' | '1H'
export type Direction = 'UP' | 'DOWN' | 'NO_TRADE'

export interface Observation {
  market: Market; window: Window; prices: number[]; volumes: number[]; timestamp: string
}
export interface Decision { direction: Direction; confidence: number; signals: Record<string, number>; timestamp: string }
export interface Agent {
  id: string; name: string; description: string; builder: string; markets: Market[]; windows: Window[]
  integration: string; strategy: 'momentum' | 'mean-reversion' | 'volatility' | 'external'; createdAt: string
}
export interface Trade { id: string; agentId: string; roundId: string; market: Market; direction: Exclude<Direction,'NO_TRADE'>; result: 'WIN'|'LOSS'; pnl: number; timestamp: string; reference?: string }

const mean = (v:number[]) => v.reduce((a,b)=>a+b,0)/Math.max(v.length,1)
const returns = (v:number[]) => v.slice(1).map((x,i)=>(x-v[i])/v[i])
const stdev = (v:number[]) => { const m=mean(v); return Math.sqrt(mean(v.map(x=>(x-m)**2))) }

export function decide(agent: Agent, observation: Observation): Decision {
  const p=observation.prices, r=returns(p), last=p.at(-1) ?? 0, now=new Date().toISOString()
  if (p.length < 5) return {direction:'NO_TRADE',confidence:0,signals:{samples:p.length},timestamp:now}
  if(agent.strategy==='momentum'){
    const short=(last-p.at(-4)!)/p.at(-4)!, vol=stdev(r)
    const score=vol ? short/vol : 0
    return {direction:Math.abs(score)<.65?'NO_TRADE':score>0?'UP':'DOWN',confidence:Math.min(Math.abs(score)/2,1),signals:{shortReturn:short,volatility:vol,score},timestamp:now}
  }
  if(agent.strategy==='mean-reversion'){
    const m=mean(p.slice(-8)), sd=stdev(p.slice(-8)), z=sd?(last-m)/sd:0
    return {direction:Math.abs(z)<1?'NO_TRADE':z>0?'DOWN':'UP',confidence:Math.min(Math.abs(z)/3,1),signals:{mean:m,zScore:z},timestamp:now}
  }
  if(agent.strategy==='volatility'){
    const recent=stdev(r.slice(-5)), baseline=stdev(r), impulse=mean(r.slice(-3)), regime=baseline?recent/baseline:0
    return {direction:regime<1.05||Math.abs(impulse)<recent*.25?'NO_TRADE':impulse>0?'UP':'DOWN',confidence:Math.min(regime/2,1),signals:{recentVolatility:recent,regime,impulse},timestamp:now}
  }
  return {direction:'NO_TRADE',confidence:0,signals:{external:1},timestamp:now}
}

export function metrics(agent:Agent,trades:Trade[]){
  const own=trades.filter(t=>t.agentId===agent.id), pnl=own.reduce((s,t)=>s+t.pnl,0), wins=own.filter(t=>t.result==='WIN').length
  let equity=0,peak=0,drawdown=0; own.forEach(t=>{equity+=t.pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)})
  return {...agent,trades:own.length,wins,losses:own.length-wins,pnl,winRate:own.length?wins/own.length*100:0,drawdown}
}
export function rankAgents(agents:Agent[],trades:Trade[]){return agents.map(a=>metrics(a,trades)).sort((a,b)=>b.pnl-a.pnl||a.drawdown-b.drawdown||b.winRate-a.winRate||b.trades-a.trades)}

export const builtIns:Agent[]=[
  {id:'momentum',name:'Momentum',description:'Tracks short-term directional persistence with volatility-normalized confirmation.',builder:'CLASH Labs',markets:['BTC','ETH'],windows:['15M'],integration:'Built-in Agent API',strategy:'momentum',createdAt:new Date().toISOString()},
  {id:'mean-reversion',name:'Mean Reversion',description:'Trades statistically significant departures from a recent reference mean.',builder:'CLASH Labs',markets:['BTC','ETH'],windows:['15M'],integration:'Built-in Agent API',strategy:'mean-reversion',createdAt:new Date().toISOString()},
  {id:'volatility',name:'Volatility',description:'Participates only when volatility regime and directional confirmation align.',builder:'CLASH Labs',markets:['BTC','ETH'],windows:['15M'],integration:'Built-in Agent API',strategy:'volatility',createdAt:new Date().toISOString()},
]
