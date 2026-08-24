import {describe,expect,it} from 'vitest'
import {rankAgents,type Agent,type Trade} from './domain'

const agents:Agent[]=[
  {id:'test-a',name:'Test A',description:'An independently built agent.',builder:'Test Builder',markets:['BTC'],windows:['15M'],integration:'https://agent.test/a',walletAddress:'0x0000000000000000000000000000000000000001',createdAt:'2026-01-01T00:00:00Z'},
  {id:'test-b',name:'Test B',description:'Another independently built agent.',builder:'Test Builder',markets:['BTC'],windows:['15M'],integration:'https://agent.test/b',walletAddress:'0x0000000000000000000000000000000000000002',createdAt:'2026-01-01T00:00:00Z'},
]

describe('performance ranking',()=>{
 it('derives PnL and ranks rather than assigning rank',()=>{const trades:Trade[]=[{id:'1',agentId:'test-a',roundId:'r',market:'BTC',direction:'UP',result:'WIN',pnl:8,timestamp:'x'},{id:'2',agentId:'test-b',roundId:'r',market:'BTC',direction:'DOWN',result:'LOSS',pnl:-3,timestamp:'x'}];const ranked=rankAgents(agents,trades);expect(ranked[0].id).toBe('test-a');expect(ranked[0].pnl).toBe(8);expect(ranked[0].winRate).toBe(100)})
})
