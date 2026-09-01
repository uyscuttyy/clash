// Authorization verification. CLASH never signs. CLASH only reads the chain
// to check whether a user's wallet has actually delegated to an agent's
// address / implementation contract.
//
// The three paths are:
//   1. spot_operator  — user has called setOperatorApprovalForPool on a
//      DreamDEX spot pool, naming the agent as the operator.
//   2. session_tx     — user has signed an EIP-7702 authorization or opened
//      a session transaction envelope designating the agent's contract.
//   3. self_run       — no on-chain authorization is needed; the user runs
//      the agent themselves. CLASH returns true unconditionally.

import { createPublicClient, http, getAddress } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

const RPC = 'https://api.infra.testnet.somnia.network'

const client = createPublicClient({ chain: somniaShannon, transport: http(RPC) })

// EIP-7702 designates a contract onto an EOA. The designated code starts
// with the magic prefix 0xef0100 followed by the 20-byte implementation
// address. We check this prefix on the user's account code.
const EIP7702_PREFIX = '0xef0100'

export type AuthorizationPath = 'spot_operator' | 'session_tx' | 'self_run'

export interface AuthorizationCheck {
  // The path we checked.
  path: AuthorizationPath
  // True if CLASH observed the on-chain authorization as live right now.
  // For self_run, always true.
  authorized: boolean
  // The on-chain proof CLASH observed, where one exists:
  //   spot_operator  → tx hash of the most recent grant
  //   session_tx     → implementation address the user delegated to
  //   self_run       → null
  proof: `0x${string}` | null
  // Human-readable note if the check failed.
  reason?: string
}

// Verify the spot operator grant. Requires the agent's `delegationMetadata.spotPoolAddress`.
// CLASH reads the pool's OperatorPermissionsRegistry via the SDK's
// isOperatorAuthorized helper, which is the canonical read for "is this
// operator currently authorized on this pool for this owner".
export async function checkSpotOperatorGrant(opts: {
  userWallet: `0x${string}`
  agentAddress: `0x${string}`
  spotPoolAddress: `0x${string}`
}): Promise<AuthorizationCheck> {
  try {
    const { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } = await import('@somnia-chain/markets-sdk')
    const { somniaShannon } = await import('@somnia-chain/markets-sdk/chains')
    const exchange = new SomniaMarkets({
      chain: somniaShannon,
      indexerUrl: 'https://dev.smk.somnia.host/v1/graphql',
      wsRpcUrl: 'wss://api.infra.testnet.somnia.network/ws',
      addresses: SOMNIA_TESTNET_ADDRESSES,
    })
    try {
      // isOperatorAuthorized requires a selector param too (per IsOperatorAuthorizedParams).
      // We pass PLACE_ORDER_FOR_SELECTOR, which is the canonical "can the operator place orders
      // for this owner" check.
      const { PLACE_ORDER_FOR_SELECTOR } = await import('@somnia-chain/markets-sdk')
      const authorized = await exchange.client.isOperatorAuthorized({
        pool: opts.spotPoolAddress as `0x${string}`,
        owner: opts.userWallet,
        operator: opts.agentAddress,
        selector: PLACE_ORDER_FOR_SELECTOR,
      })
      return {
        path: 'spot_operator',
        authorized: Boolean(authorized),
        proof: null,
        reason: authorized ? undefined : 'No live operator grant observed for this pool.',
      }
    } finally { await exchange.close() }
  } catch (err) {
    return {
      path: 'spot_operator',
      authorized: false,
      proof: null,
      reason: `Spot grant verification unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// Verify an EIP-7702 designation. If the user's account has code that starts
// with 0xef0100 followed by the agent's contract address, the user has
// designated that contract to execute on their behalf. The proof we record is
// the implementation address.
export async function checkSessionOrEip7702Designation(opts: {
  userWallet: `0x${string}`
  expectedImplementation: `0x${string}`
}): Promise<AuthorizationCheck> {
  try {
    const code = await client.getBytecode({ address: getAddress(opts.userWallet) })
    if (!code || code === '0x') {
      return {
        path: 'session_tx',
        authorized: false,
        proof: null,
        reason: 'User account has no designated code. The EIP-7702 authorization or session envelope has not been observed.',
      }
    }
    // EIP-7702: code starts with 0xef0100<20 bytes impl address>
    if (code.toLowerCase().startsWith(EIP7702_PREFIX)) {
      const impl = ('0x' + code.slice(8, 48)) as `0x${string}`
      const match = impl.toLowerCase() === opts.expectedImplementation.toLowerCase()
      return {
        path: 'session_tx',
        authorized: match,
        proof: match ? impl : null,
        reason: match ? undefined : `User account designates a different contract (${impl}); not the agent's implementation.`,
      }
    }
    return {
      path: 'session_tx',
      authorized: false,
      proof: null,
      reason: 'User account has contract code but it does not start with the EIP-7702 designation prefix.',
    }
  } catch (err) {
    return {
      path: 'session_tx',
      authorized: false,
      proof: null,
      reason: `Session / EIP-7702 verification unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// Self-run needs no on-chain authorization.
export function checkSelfRun(): AuthorizationCheck {
  return { path: 'self_run', authorized: true, proof: null }
}

// Pick the right check for a given agent + user. Returns the first authorized
// path, in priority order (spot_operator > session_tx > self_run). If none of
// the on-chain paths authorize, returns self_run with authorized: true
// because the user can always run the agent themselves.
export async function pickAndVerifyAuthorization(opts: {
  userWallet: `0x${string}`
  agentAddress: `0x${string}`
  supportedMethods: AuthorizationPath[]
  spotPoolAddress?: `0x${string}`
  sessionContract?: `0x${string}`
}): Promise<AuthorizationCheck> {
  // 1. Spot operator grant (real, SDK-supported).
  if (opts.supportedMethods.includes('spot_operator') && opts.spotPoolAddress) {
    const result = await checkSpotOperatorGrant({
      userWallet: opts.userWallet,
      agentAddress: opts.agentAddress,
      spotPoolAddress: opts.spotPoolAddress,
    })
    if (result.authorized) return result
  }
  // 2. Session transaction / EIP-7702 (verified on-chain by reading account code).
  if (opts.supportedMethods.includes('session_tx') && opts.sessionContract) {
    const result = await checkSessionOrEip7702Designation({
      userWallet: opts.userWallet,
      expectedImplementation: opts.sessionContract,
    })
    if (result.authorized) return result
  }
  // 3. Self-run fallback (always available).
  if (opts.supportedMethods.includes('self_run')) {
    return checkSelfRun()
  }
  return {
    path: 'self_run',
    authorized: false,
    proof: null,
    reason: 'This agent does not support any delegation method on the marketplace.',
  }
}
