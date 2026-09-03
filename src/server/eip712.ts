// EIP-712 typed-data verifier for the copy-trading follow intent.
//
// The user signs a single EIP-712 message at follow creation (and at
// follow update if the caps change). The signature is verified by the
// agent runtime on every mirror attempt. The nonce prevents replay;
// expiresAt is a separate time-based cutoff.
//
// The domain name + version are stable. The EIP-712 message is the
// "FollowIntent" type. CLASH acts as the verifying contract; the
// signature says "wallet X authorises mirror trades for agent Y with
// caps C, valid until T, replay nonce N."

import { verifyTypedData, recoverTypedDataAddress, type TypedDataDomain, type Hex } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { randomBytes } from 'node:crypto'

export const FOLLOW_DOMAIN_NAME = 'CLASH Follow Intent' as const
export const FOLLOW_DOMAIN_VERSION = '1' as const
// EIP-712 verifyingContract is set to the zero address. CLASH does not
// live on-chain; the contract slot exists only to bind the signature to
// a deterministic value, and the zero address is acceptable because
// viem does not require the contract to be deployed.
export const FOLLOW_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000000' as const

export const followTypes = {
  FollowIntent: [
    { name: 'agentId', type: 'string' },
    { name: 'sizeMultiplier', type: 'uint16' },   // 0.1..10.0 × 100 (avoids float)
    { name: 'maxPerTradeRaw', type: 'uint256' },  // raw tUSDC (6dp)
    { name: 'maxDailyExposureRaw', type: 'uint256' },
    { name: 'maxDailyTrades', type: 'uint16' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },       // unix seconds
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

export interface FollowIntentMessage {
  agentId: string
  sizeMultiplierBps: number       // 0.1..10.0 × 100, e.g. 100 = 1.0×
  maxPerTradeRaw: bigint
  maxDailyExposureRaw: bigint
  maxDailyTrades: number
  nonce: `0x${string}`
  expiresAt: number                // unix seconds
}

export interface FollowTypedData {
  domain: TypedDataDomain
  types: typeof followTypes
  primaryType: 'FollowIntent'
  message: {
    agentId: string
    sizeMultiplier: number
    maxPerTradeRaw: bigint
    maxDailyExposureRaw: bigint
    maxDailyTrades: number
    nonce: `0x${string}`
    expiresAt: number
  }
}

export function buildFollowMessage(parts: FollowIntentMessage): FollowTypedData {
  return {
    domain: buildFollowDomain(),
    types: followTypes,
    primaryType: 'FollowIntent',
    message: {
      agentId: parts.agentId,
      sizeMultiplier: parts.sizeMultiplierBps,
      maxPerTradeRaw: parts.maxPerTradeRaw,
      maxDailyExposureRaw: parts.maxDailyExposureRaw,
      maxDailyTrades: parts.maxDailyTrades,
      nonce: parts.nonce,
      expiresAt: parts.expiresAt,
    },
  }
}

// Verify a signed FollowIntent. Returns null on any failure; otherwise
// returns the recovered signer address (lowercased).
export async function verifyFollowSignature(args: {
  expectedFollower: `0x${string}`
  signature: `0x${string}`
  intent: FollowIntentMessage
}): Promise<string | null> {
  try {
    const data = buildFollowMessage(args.intent)
    const ok = await verifyTypedData({
      address: args.expectedFollower,
      domain: data.domain,
      types: data.types as unknown as Record<string, readonly { name: string; type: string }[]>,
      primaryType: data.primaryType,
      message: data.message,
      signature: args.signature,
    })
    if (!ok) return null
    // Belt-and-braces: also recover and compare, to catch any race between
    // address-binding and signature math.
    const recovered = await recoverTypedDataAddress({
      domain: data.domain,
      types: data.types as unknown as Record<string, readonly { name: string; type: string }[]>,
      primaryType: data.primaryType,
      message: data.message,
      signature: args.signature,
    })
    return recovered.toLowerCase()
  } catch {
    return null
  }
}

// Helper to produce a fresh bytes32 nonce.
export function freshFollowNonce(): Hex {
  return ('0x' + randomBytes(32).toString('hex')) as Hex
}
