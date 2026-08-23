import express from 'express'
import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import {rankAgents,type Agent,type Trade} from '../domain'
import {Repository} from './repository'
import {DreamDexAdapter} from './dreamdex'

const registration=z.object({name:z.string().trim().min(2).max(60),description:z.string().trim().min(10).max(500),builder:z.string().trim().min(2).max(80),markets:z.array(z.enum(['BTC','ETH'])).min(1),windows:z.array(z.enum(['15M','1H'])).min(1),integration:z.string().trim().min(3).max(300)})
const settlement=z.object({id:z.string(),agentId:z.string(),roundId:z.string(),market:z.enum(['BTC','ETH']),direction:z.enum(['UP','DOWN']),result:z.enum(['WIN','LOSS']),pnl:z.number().finite(),timestamp:z.string(),reference:z.string().min(3)})

export function createApp(repo=new Repository()){
 const app=express(),dreamdex=new DreamDexAdapter();app.use(express.json({limit:'32kb'}))
 app.get('/api/health',(_q,r)=>r.json({ok:true,dreamdex:dreamdex.status()}))
 app.get('/api/state',(_q,r)=>{const agents=repo.listAgents(),trades=repo.listTrades();r.json({agents,trades,ranked:rankAgents(agents,trades),dreamdex:dreamdex.status()})})
 app.post('/api/agents',(q,r)=>{const parsed=registration.safeParse(q.body);if(!parsed.success)return r.status(400).json({error:'Invalid registration',issues:parsed.error.issues});const agent:Agent={...parsed.data,id:randomUUID(),strategy:'external',createdAt:new Date().toISOString()};try{return r.status(201).json(repo.createAgent(agent))}catch{return r.status(409).json({error:'Agent name already registered'})}})
 app.get('/api/agents/:id',(q,r)=>{const agent=repo.getAgent(q.params.id);if(!agent)return r.status(404).json({error:'Agent not found'});const trades=repo.listTrades().filter(t=>t.agentId===agent.id);return r.json({agent,performance:rankAgents([agent],trades)[0],trades})})
 app.post('/api/settlements',(q,r)=>{const parsed=settlement.safeParse(q.body);if(!parsed.success)return r.status(400).json({error:'Invalid settlement',issues:parsed.error.issues});try{return r.status(201).json(repo.createTrade(parsed.data as Trade))}catch{return r.status(409).json({error:'Settlement already processed'})}})
 app.get('/api/dreamdex/markets',async(_q,r)=>{try{return r.json({status:dreamdex.status(),markets:await dreamdex.discover()})}catch(error){return r.status(503).json({status:dreamdex.status(),error:error instanceof Error?error.message:'DreamDEX unavailable'})}})
 return app
}
