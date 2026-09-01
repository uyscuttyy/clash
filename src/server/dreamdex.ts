// The CLASH DreamDEX adapter. Read-only. CLASH never signs.
//
// All methods query the Somnia Shannon testnet indexer and RPC for on-chain
// facts: market list, orders for a given trading wallet, market resolution,
// and the SDK's derived position PnL. The blockchain is the source of truth.

import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import type { Direction, TradeResult } from '../domain'

const INDEXER = 'https://dev.smk.somnia.host/v1/graphql'
const WS_RPC = 'wss://api.infra.testnet.somnia.network/ws'

// What CLASH learns about one verified on-chain order for a single agent.
export interface AgentOrder {
  orderId: string
  marketId: `0x${string}`
  pool: `0x${string}`
  asset: 'BTC' | 'ETH' | null
  interval: string | null
  side: string | null
  price: string
  quantity: string
  filledQuantity: string
  status: string
  txHash: `0x${string}`
  placedAt: string
}

export interface AgentTrade {
  tradeId: string
  marketId: `0x${string}`
  pool: `0x${string}`
  asset: 'BTC' | 'ETH' | null
  side: string | null
  price: string
  quantity: string
  txHash: `0x${string}`
  filledAt: string
}

export interface AgentPosition {
  marketId: `0x${string}`
  outcomeIndex: number
  balance: string
}

export interface MarketResolution {
  marketId: `0x${string}`
  status: 'resolved' | 'voided' | 'pending'
  winningOutcome: number | null
  resolvedAt: string | null
  sourceTxHash: `0x${string}` | null
}

export interface SettledFill {
  // The on-chain order this fill came from. One fill, one trade row.
  txHash: `0x${string}`
  marketId: `0x${string}`
  pool: `0x${string}`
  market: 'BTC' | 'ETH'
  direction: Direction
  result: TradeResult
  pnl: number
  // The market resolution tx hash, used as a stable reference for the trade row.
  reference: `0x${string}`
  filledAt: string
  source: 'binary' | 'spot'
}

function asAsset(s: string | null | undefined): 'BTC' | 'ETH' | null {
  if (s === 'BTC' || s === 'ETH') return s
  return null
}

function asMarket(s: string | null | undefined): 'BTC' | 'ETH' {
  return s === 'ETH' ? 'ETH' : 'BTC'
}

export class DreamDexAdapter {
  status(): { network: string; chainId: number; indexer: string } {
    return { network: 'Somnia Shannon', chainId: somniaShannon.id, indexer: INDEXER }
  }

  private async withClient<T>(fn: (exchange: SomniaMarkets) => Promise<T>): Promise<T> {
    const exchange = new SomniaMarkets({
      chain: somniaShannon,
      indexerUrl: INDEXER,
      wsRpcUrl: WS_RPC,
      addresses: SOMNIA_TESTNET_ADDRESSES,
    })
    try { return await fn(exchange) } finally { await exchange.close() }
  }

  // List every active binary market the indexer can see.
  async discoverBinaryMarkets(): Promise<Array<{ marketId: `0x${string}`; symbol: string; asset: 'BTC' | 'ETH' | null; interval: string | null; expiry: string | null; pool: `0x${string}` | null }>> {
    return this.withClient(async (exchange) => {
      const markets = await exchange.fetchMarkets()
      return markets
        .filter((m): boolean => m.type === 'binary' && m.active)
        .map((m) => {
          const info = (m as unknown as { info?: { asset?: string; interval?: string | null; expiry?: string | null; marketAddress?: string; marketId?: string } }).info
          return {
            marketId: (info?.marketId ?? m.id) as `0x${string}`,
            symbol: m.symbol,
            asset: asAsset(info?.asset ?? m.base),
            interval: info?.interval ?? null,
            expiry: info?.expiry ?? null,
            pool: (info?.marketAddress ?? null) as `0x${string}` | null,
          }
        })
    })
  }

  // Every order for the given trading wallet, regardless of market.
  async ordersForWallet(walletAddress: `0x${string}`): Promise<AgentOrder[]> {
    return this.withClient(async (exchange) => {
      const orders = await exchange.client.getOrders(walletAddress, { limit: 200 })
      return orders.map((o): AgentOrder => {
        const marketAsset = (o as unknown as { marketAsset?: string }).marketAsset
        return {
          orderId: o.orderId,
          marketId: o.market as `0x${string}`,
          pool: o.pool as `0x${string}`,
          asset: asAsset(marketAsset),
          interval: (o as unknown as { marketInterval?: string | null }).marketInterval ?? null,
          side: (o as unknown as { side?: string | null }).side ?? null,
          price: o.price,
          quantity: o.fullQuantity,
          filledQuantity: o.filledQuantity,
          status: o.status,
          txHash: o.placedTxHash as `0x${string}`,
          placedAt: o.placedAtTimestamp,
        }
      })
    })
  }

  // Every settled trade for the given trading wallet.
  async tradesForWallet(walletAddress: `0x${string}`): Promise<AgentTrade[]> {
    return this.withClient(async (exchange) => {
      const portfolio = await exchange.client.getPortfolio(walletAddress, { ordersLimit: 0, tradesLimit: 200 })
      return portfolio.trades.map(t => {
        const m = t.market as unknown as { id?: string; marketId?: string; poolAddress?: string; asset?: string }
        return {
          tradeId: t.id ?? '',
          marketId: (m.marketId ?? m.id ?? '') as `0x${string}`,
          pool: (m.poolAddress ?? '') as `0x${string}`,
          asset: asAsset(m.asset),
          side: t.side ?? null,
          price: t.fillPrice,
          quantity: t.quantity,
          txHash: t.txHash as `0x${string}`,
          filledAt: t.timestamp,
        }
      })
    })
  }

  // Current positions for the given trading wallet.
  async positionsForWallet(walletAddress: `0x${string}`): Promise<AgentPosition[]> {
    return this.withClient(async (exchange) => {
      const portfolio = await exchange.client.getPortfolio(walletAddress, { ordersLimit: 0, tradesLimit: 0 })
      return portfolio.positions.map(p => {
        const m = p.market as unknown as { marketId?: string; id?: string }
        return {
          marketId: (m.marketId ?? m.id ?? '') as `0x${string}`,
          outcomeIndex: p.outcomeIndex,
          balance: p.balance,
        }
      })
    })
  }

  // Resolution state for one market. `pending` if the market has not settled.
  async resolutionForMarket(marketId: `0x${string}`): Promise<MarketResolution> {
    return this.withClient(async (exchange) => {
      const resolution = await exchange.client.getMarketResolution(marketId)
      const event = resolution.events.at(-1)
      const status: MarketResolution['status'] =
        event?.voided ? 'voided'
        : event?.winningOutcome === null || event?.winningOutcome === undefined ? 'pending'
        : 'resolved'
      return {
        marketId,
        status,
        winningOutcome: event?.winningOutcome ?? null,
        resolvedAt: resolution.closingAnswer?.resolvedAt ?? null,
        sourceTxHash: (event?.txHash ?? null) as `0x${string}` | null,
      }
    })
  }

  // For one binary market, derive the settled performance for the trading wallet.
  // Returns null if the market is not yet resolved, or if the wallet's position
  // is ambiguous (more than one side taken). Returns the source tx hash so the
  // caller can dedupe.
  async settledBinaryPerformance(walletAddress: `0x${string}`, marketId: `0x${string}`): Promise<SettledFill | null> {
    return this.withClient(async (exchange) => {
      const orders = await exchange.client.getOrders(walletAddress, { limit: 200 })
      const filled = orders.filter(o =>
        o.market.toLowerCase() === marketId.toLowerCase()
        && BigInt(o.filledQuantity) > 0n,
      )
      if (filled.length === 0) return null
      const resolution = await exchange.client.getMarketResolution(marketId)
      const event = resolution.events.at(-1)
      if (!event || (event.winningOutcome === null && !event.voided)) return null
      const sides = new Set(filled.map(o => {
        const s = (o as unknown as { side?: string | null }).side
        if (s?.includes('YES')) return 'UP' as const
        if (s?.includes('NO')) return 'DOWN' as const
        return null
      }).filter(Boolean))
      if (sides.size !== 1) return null
      const pnl = await exchange.client.getBinaryPositionPnL(walletAddress, marketId)
      const decimals = (filled[0] as unknown as { marketQuoteDecimals?: number }).marketQuoteDecimals ?? 6
      const pnlRaw = pnl.realizedPnl + pnl.unrealizedPnl
      const direction = [...sides][0] as Direction
      const filledOrder = filled[0]!
      const m = filledOrder as unknown as { marketAsset?: string; marketInterval?: string }
      return {
        txHash: filledOrder.placedTxHash as `0x${string}`,
        marketId,
        pool: filledOrder.pool as `0x${string}`,
        market: asMarket(m.marketAsset),
        direction,
        result: pnlRaw >= 0n ? 'WIN' : 'LOSS',
        pnl: Number(pnlRaw) / 10 ** decimals,
        reference: event.txHash as `0x${string}`,
        filledAt: filledOrder.placedAtTimestamp,
        source: 'binary',
      }
    })
  }
}
