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

const registration={name:'Alpha Current',description:'A deterministic external trading agent.',builder:'Builder One',markets:['BTC'],windows:['15M'],integration:'https://agent.test/api',walletAddress:'0x0000000000000000000000000000000000000001'}

describe('CLASH API',()=>{
 it('starts with no registered agents or trades',async()=>{const response=await setup().get('/api/state');expect(response.status).toBe(200);expect(response.body.agents).toEqual([]);expect(response.body.trades).toEqual([]);expect(response.body.ranked).toEqual([])})
 it('validates and persists registration',async()=>{const api=setup();expect((await api.post('/api/agents').send({name:'x'})).status).toBe(400);expect((await api.post('/api/agents').send(registration)).status).toBe(201);expect((await api.get('/api/state')).body.agents).toHaveLength(1)})
 it('processes a settlement once and derives ranking',async()=>{const api=setup(),created=(await api.post('/api/agents').send(registration)).body;const trade={id:'trade-1',agentId:created.id,roundId:'round-1',market:'BTC',direction:'UP',result:'WIN',pnl:12.5,timestamp:new Date().toISOString(),reference:'0xverified'};expect((await api.post('/api/settlements').send(trade)).status).toBe(201);expect((await api.post('/api/settlements').send({...trade,id:'trade-2'})).status).toBe(409);const state=(await api.get('/api/state')).body;expect(state.ranked[0].id).toBe(created.id);expect(state.ranked[0].pnl).toBe(12.5)})
})
