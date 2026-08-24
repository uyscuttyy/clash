import {describe,expect,it} from 'vitest'
import {decide,rankAgents,type Agent,type Observation,type Trade} from './domain'

const agents:Agent[]=[
  {id:'test-momentum',name:'Test Momentum',description:'A test strategy for deterministic domain coverage.',builder:'Test Builder',markets:['BTC'],windows:['15M'],integration:'test',strategy:'momentum',createdAt:'2026-01-01T00:00:00Z'},
  {id:'test-reversion',name:'Test Reversion',description:'A test strategy for deterministic domain coverage.',builder:'Test Builder',markets:['BTC'],windows:['15M'],integration:'test',strategy:'mean-reversion',createdAt:'2026-01-01T00:00:00Z'},
]
const observation:Observation={market:'BTC',window:'15M',prices:[100,101,102,103,104,105,106,108],volumes:[1,2,2,3,3,4,5,6],timestamp:'2026-01-01T00:00:00Z'}

describe('agent strategies',()=>{
 it('uses one common interface and returns valid deterministic decisions',()=>{for(const agent of agents){const a=decide(agent,observation),b=decide(agent,observation);expect(['UP','DOWN','NO_TRADE']).toContain(a.direction);expect(a.direction).toBe(b.direction);expect(a.signals).toBeTypeOf('object')}})
 it('allows no trade with insufficient market data',()=>expect(decide(agents[0],{...observation,prices:[1,2]}).direction).toBe('NO_TRADE'))
})

describe('performance ranking',()=>{
 it('derives PnL and ranks rather than assigning rank',()=>{const trades:Trade[]=[{id:'1',agentId:'test-momentum',roundId:'r',market:'BTC',direction:'UP',result:'WIN',pnl:8,timestamp:'x'},{id:'2',agentId:'test-reversion',roundId:'r',market:'BTC',direction:'DOWN',result:'LOSS',pnl:-3,timestamp:'x'}];const ranked=rankAgents(agents,trades);expect(ranked[0].id).toBe('test-momentum');expect(ranked[0].pnl).toBe(8);expect(ranked[0].winRate).toBe(100)})
})
