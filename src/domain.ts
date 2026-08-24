export type Market = 'BTC' | 'ETH'
export type Window = '15M' | '1H'
export type Direction = 'UP' | 'DOWN' | 'NO_TRADE'

export interface Agent {
  id: string; name: string; description: string; builder: string; markets: Market[]; windows: Window[]
  integration: string; walletAddress: `0x${string}`; createdAt: string
}
export interface Trade { id: string; agentId: string; roundId: string; market: Market; direction: Exclude<Direction,'NO_TRADE'>; result: 'WIN'|'LOSS'; pnl: number; timestamp: string; reference?: string }

export function metrics(agent:Agent,trades:Trade[]){
  const own=trades.filter(t=>t.agentId===agent.id), pnl=own.reduce((s,t)=>s+t.pnl,0), wins=own.filter(t=>t.result==='WIN').length
  let equity=0,peak=0,drawdown=0; own.forEach(t=>{equity+=t.pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)})
  return {...agent,trades:own.length,wins,losses:own.length-wins,pnl,winRate:own.length?wins/own.length*100:0,drawdown}
}
export function rankAgents(agents:Agent[],trades:Trade[]){return agents.map(a=>metrics(a,trades)).sort((a,b)=>b.pnl-a.pnl||a.drawdown-b.drawdown||b.winRate-a.winRate||b.trades-a.trades)}
