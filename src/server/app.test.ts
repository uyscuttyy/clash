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
 it('accepts activity as an untrusted hint without changing rankings',async()=>{const api=setup(),created=(await api.post('/api/agents').send(registration)).body;const hint={txHash:`0x${'1'.repeat(64)}`,orderId:'1',marketId:`0x${'2'.repeat(64)}`};expect((await api.post(`/api/agents/${created.id}/activity`).send(hint)).status).toBe(202);expect((await api.post(`/api/agents/${created.id}/activity`).send(hint)).status).toBe(409);const state=(await api.get('/api/state')).body;expect(state.activityHints).toHaveLength(1);expect(state.ranked[0].pnl).toBe(0)})
 it('rejects client-submitted settlements and pnl',async()=>{expect((await setup().post('/api/settlements').send({pnl:999})).status).toBe(410)})
})
