import {afterEach,describe,expect,it} from 'vitest'
import request from 'supertest'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Repository} from './repository'
import {createApp} from './app'

const repos:Repository[]=[]
function setup(){const repo=new Repository(join(mkdtempSync(join(tmpdir(),'clash-')),'test.db'));repos.push(repo);return request(createApp(repo))}
afterEach(()=>repos.splice(0).forEach(repo=>repo.close()))

describe('CLASH API',()=>{
 it('seeds all built-ins through the registry',async()=>{const response=await setup().get('/api/state');expect(response.status).toBe(200);expect(response.body.agents.map((a:{id:string})=>a.id)).toEqual(['momentum','mean-reversion','volatility']);expect(response.body.ranked.every((a:{pnl:number})=>a.pnl===0)).toBe(true)})
 it('validates and persists registration',async()=>{const api=setup();expect((await api.post('/api/agents').send({name:'x'})).status).toBe(400);const response=await api.post('/api/agents').send({name:'Alpha Current',description:'A deterministic external trading agent.',builder:'Builder One',markets:['BTC'],windows:['15M'],integration:'https://agent.test/api'});expect(response.status).toBe(201);expect((await api.get('/api/state')).body.agents).toHaveLength(4)})
 it('processes a settlement once and derives ranking',async()=>{const api=setup(),trade={id:'trade-1',agentId:'momentum',roundId:'round-1',market:'BTC',direction:'UP',result:'WIN',pnl:12.5,timestamp:new Date().toISOString(),reference:'0xverified'};expect((await api.post('/api/settlements').send(trade)).status).toBe(201);expect((await api.post('/api/settlements').send({...trade,id:'trade-2'})).status).toBe(409);const state=(await api.get('/api/state')).body;expect(state.ranked[0].id).toBe('momentum');expect(state.ranked[0].pnl).toBe(12.5)})
})
