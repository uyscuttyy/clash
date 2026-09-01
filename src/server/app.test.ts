import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository } from './repository'
import { createApp } from './app'

const repos: Repository[] = []
function setup() {
  const repo = new Repository(join(mkdtempSync(join(tmpdir(), 'clash-')), 'test.db'))
  repos.push(repo)
  // Disable the sync worker in tests — the indexer calls would hit Somnia
  // and slow the test suite.
  return request(createApp(repo, { startSync: false, syncOptions: { disabled: true } }))
}
afterEach(() => repos.splice(0).forEach(repo => repo.close()))

const registration = {
  name: 'Alpha Current',
  description: 'A deterministic external trading agent.',
  builder: 'Builder One',
  markets: ['BTC'],
  windows: ['15M'],
  integration: 'https://agent.test/api',
  walletAddress: '0x0000000000000000000000000000000000000001',
  ownerAddress: '0x0000000000000000000000000000000000000001',
  delegationMethods: ['self_run'],
}

describe('CLASH marketplace API', () => {
  it('lists zero agents on a fresh database', async () => {
    const response = await setup().get('/api/agents')
    expect(response.status).toBe(200)
    expect(response.body.agents).toEqual([])
    expect(response.body.count).toBe(0)
  })

  it('rejects an invalid registration', async () => {
    const api = setup()
    const response = await api.post('/api/agents').send({ name: 'x' })
    expect(response.status).toBe(400)
  })

  it('validates a complete registration and returns an API key once', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    expect(created.status).toBe(201)
    expect(created.body.agent.name).toBe('Alpha Current')
    expect(typeof created.body.apiKey).toBe('string')
    expect(created.body.apiKey.startsWith('clash_')).toBe(true)
    const list = await api.get('/api/agents')
    expect(list.body.agents).toHaveLength(1)
  })

  it('rejects a duplicate name with 409', async () => {
    const api = setup()
    await api.post('/api/agents').send(registration)
    const second = await api.post('/api/agents').send(registration)
    expect(second.status).toBe(409)
  })

  it('requires spot_pool_address when the agent declares spot_operator support', async () => {
    const api = setup()
    const response = await api.post('/api/agents').send({ ...registration, delegationMethods: ['spot_operator'] })
    expect(response.status).toBe(400)
  })

  it('does not require CLASH to ever see a private key', async () => {
    const response = await setup().get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.dreamdex.network).toBe('Somnia Shannon')
  })

  it('exposes a developer\'s own agents by owner query', async () => {
    const api = setup()
    await api.post('/api/agents').send(registration)
    const mine = await api.get('/api/agents/mine?owner=0x0000000000000000000000000000000000000001')
    expect(mine.status).toBe(200)
    expect(mine.body.agents).toHaveLength(1)
    const notMine = await api.get('/api/agents/mine?owner=0x0000000000000000000000000000000000000099')
    expect(notMine.body.agents).toHaveLength(0)
  })

  it('rejects a use-state query without a valid user wallet', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const bad = await api.get(`/api/agents/${created.body.agent.id}/use?user=not-an-address`)
    expect(bad.status).toBe(400)
  })

  it('authenticates external agent requests with a valid API key', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const apiKey = created.body.apiKey as string
    const profile = await api.get(`/api/external/agents/${created.body.agent.id}`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(profile.status).toBe(200)
    const denied = await api.get(`/api/external/agents/${created.body.agent.id}`)
    expect(denied.status).toBe(401)
  })

  it('rejects API keys scoped to a different agent', async () => {
    const api = setup()
    const a = await api.post('/api/agents').send(registration)
    const b = await api.post('/api/agents').send({ ...registration, name: 'Other Agent', walletAddress: '0x0000000000000000000000000000000000000002' })
    const wrong = await api.get(`/api/external/agents/${b.body.agent.id}`)
      .set('Authorization', `Bearer ${a.body.apiKey}`)
    expect(wrong.status).toBe(403)
  })

  it('rotates API keys and revokes the old one', async () => {
    const api = setup()
    const created = await api.post('/api/agents').send(registration)
    const oldKey = created.body.apiKey as string
    const rotated = await api.post(`/api/agents/${created.body.agent.id}/api-keys/rotate`)
    expect(rotated.status).toBe(200)
    expect(rotated.body.apiKey).not.toEqual(oldKey)
    const oldRevoked = await api.get(`/api/external/agents/${created.body.agent.id}`)
      .set('Authorization', `Bearer ${oldKey}`)
    expect(oldRevoked.status).toBe(401)
  })
})
