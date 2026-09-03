// EIP-712 helpers for the CLASH follow intent. The client side
// constructs the same typed-data the server verifies. The EIP-712
// domain and types MUST stay in lockstep with src/server/eip712.ts —
// the server is the verifying contract.

import { type TypedDataDomain } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

export const FOLLOW_DOMAIN_NAME = 'CLASH Follow Intent' as const
export const FOLLOW_DOMAIN_VERSION = '1' as const
export const FOLLOW_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000000' as const

export const followTypes = {
  FollowIntent: [
    { name: 'agentId', type: 'string' },
    { name: 'sizeMultiplier', type: 'uint16' },
    { name: 'maxPerTradeRaw', type: 'uint256' },
    { name: 'maxDailyExposureRaw', type: 'uint256' },
    { name: 'maxDailyTrades', type: 'uint16' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const

export function buildFollowDomain(): TypedDataDomain {
  return {
    name: FOLLOW_DOMAIN_NAME,
    version: FOLLOW_DOMAIN_VERSION,
    chainId: somniaShannon.id,
    verifyingContract: FOLLOW_VERIFYING_CONTRACT,
  }
}

export interface FollowIntentInput {
  agentId: string
  sizeMultiplier: number               // 0.1..10.0
  maxPerTradeRaw: bigint
  maxDailyExposureRaw: bigint
  maxDailyTrades: number
  nonce: `0x${string}`
  expiresAt: number                    // unix seconds
}

export function buildFollowMessage(input: FollowIntentInput) {
  return {
    domain: buildFollowDomain(),
    types: { FollowIntent: followTypes.FollowIntent as readonly { name: string; type: string }[] },
    primaryType: 'FollowIntent' as const,
    message: {
      agentId: input.agentId,
      sizeMultiplier: Math.round(input.sizeMultiplier * 100),  // 1.0× → 100 bps
      maxPerTradeRaw: input.maxPerTradeRaw,
      maxDailyExposureRaw: input.maxDailyExposureRaw,
      maxDailyTrades: input.maxDailyTrades,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
    },
  }
}

// Convert a human tUSDC value (e.g. 1.50) to a 6dp raw bigint string.
export function humanToRaw(human: number): string {
  if (!Number.isFinite(human) || human <= 0) return '0'
  return Math.trunc(human * 1_000_000).toString()
}

// Convert a raw 6dp bigint string to a human tUSDC value (e.g. "1500000" -> 1.5).
export function rawToHuman(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return n / 1_000_000
}
