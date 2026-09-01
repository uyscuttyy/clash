import { describe, expect, it } from 'vitest'
import { rankAgents, metrics, type Agent, type Trade } from './domain'

function makeAgent(id: string, name: string, wallet: `0x${string}`): Agent {
  return {
    id, name, description: 'An independently built agent.', builder: 'Test Builder',
    markets: ['BTC'], windows: ['15M'], integration: 'https://agent.test/' + id,
    walletAddress: wallet, ownerAddress: wallet,
    delegationMethods: ['self_run'], delegationMetadata: {},
    status: 'active', createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeTrade(id: string, agentId: string, pnl: number, result: 'WIN' | 'LOSS', filledAt: string): Trade {
  return {
    id, agentId, txHash: `0x${id.padEnd(64, '0')}` as `0x${string}`,
    market: 'BTC', direction: pnl >= 0 ? 'UP' : 'DOWN', result, pnl,
    marketId: '0x0000000000000000000000000000000000000000000000000000000000000abc' as `0x${string}`,
    pool: '0x0000000000000000000000000000000000000def' as `0x${string}`,
    filledAt, source: 'binary', createdAt: filledAt,
  }
}

describe('performance ranking', () => {
  it('derives PnL and ranks by it', () => {
    const agents = [makeAgent('a', 'A', '0x0000000000000000000000000000000000000001'), makeAgent('b', 'B', '0x0000000000000000000000000000000000000002')]
    const trades = [makeTrade('t1', 'a', 8, 'WIN', '2026-01-01T00:00:00Z'), makeTrade('t2', 'b', -3, 'LOSS', '2026-01-01T00:01:00Z')]
    const ranked = rankAgents(agents, trades)
    expect(ranked[0]!.agent.id).toBe('a')
    expect(ranked[0]!.pnl).toBe(8)
    expect(ranked[0]!.winRate).toBe(1)
    expect(ranked[1]!.agent.id).toBe('b')
  })

  it('breaks ties with drawdown ascending', () => {
    const agents = [makeAgent('a', 'A', '0x0000000000000000000000000000000000000001'), makeAgent('b', 'B', '0x0000000000000000000000000000000000000002')]
    // Both agents have PnL 0. A has higher drawdown. B should rank first.
    const trades = [
      makeTrade('t1', 'a', 10, 'WIN', '2026-01-01T00:00:00Z'),
      makeTrade('t2', 'a', -10, 'LOSS', '2026-01-01T00:01:00Z'),
      makeTrade('t3', 'b', 5, 'WIN', '2026-01-01T00:00:00Z'),
      makeTrade('t4', 'b', -5, 'LOSS', '2026-01-01T00:01:00Z'),
    ]
    const ranked = rankAgents(agents, trades)
    expect(ranked[0]!.agent.id).toBe('b')  // lower drawdown
  })

  it('returns zero metrics for an agent with no trades', () => {
    const a = makeAgent('a', 'A', '0x0000000000000000000000000000000000000001')
    const m = metrics(a, [])
    expect(m.pnl).toBe(0)
    expect(m.trades).toBe(0)
    expect(m.winRate).toBe(0)
    expect(m.lastTradeAt).toBe(null)
  })
})
