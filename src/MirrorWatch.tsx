// Follower-side mirror watch. Mounted once in the layout shell so
// it runs for every connected user. Polls CLASH every 5s for any
// pending mirror_attempts for the connected wallet, and for each one
// it pops a wallet confirmation, signs, broadcasts, and acks the
// result back to CLASH.
//
// The watch is intentionally idempotent: a pending attempt either
// gets a `confirmed` ack (with the mirror tx hash) or a `failed`/`rejected`
// ack. CLASH's background sync picks the fills up from the chain
// after a successful broadcast.
//
// This module is browser-only. The "Shape 2: open-tab" approach
// requires the user to have CLASH open. A future "Shape 1: local
// agent client" would do the same flow from a Node process the user
// runs locally.

import { useEffect, useRef, useState } from 'react'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  SomniaMarkets, SOMNIA_TESTNET_ADDRESSES,
} from '@somnia-chain/markets-sdk'
import { listMyMirrorAttempts, ackMirrorAttempt, type MirrorAttempt } from './store'

const POLL_INTERVAL_MS = 5_000

export function MirrorWatch() {
  const { isConnected, address } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  // const { switchChain } = useSwitchChain()  // reserved for the future "chain prompt" toast
  const [status, setStatus] = useState<'idle' | 'watching' | 'signing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastAckAt, setLastAckAt] = useState<number | null>(null)
  const processing = useRef<Set<string>>(new Set())
  const exchangeRef = useRef<SomniaMarkets | null>(null)

  // Lazily build the SDK client on the browser side. We keep it
  // around between ticks so the read-only cache stays warm.
  useEffect(() => {
    if (!isConnected) return
    if (exchangeRef.current) return
    try {
      exchangeRef.current = new SomniaMarkets({
        chain: somniaShannon,
        indexerUrl: 'https://dev.smk.somnia.host/v1/graphql',
        wsRpcUrl: somniaShannon.rpcUrls.default.webSocket?.[0] ?? somniaShannon.rpcUrls.default.http[0]!,
        addresses: SOMNIA_TESTNET_ADDRESSES,
      })
    } catch (e) {
      setError(`Failed to init SomniaMarkets: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('error')
    }
    return () => {
      exchangeRef.current?.close().catch(() => { /* ignore */ })
      exchangeRef.current = null
    }
  }, [isConnected])

  // The main poll loop. The poll is cheap (a single HTTP GET) so we
  // don't bother with backoff or jitter. If the user is on the wrong
  // chain or has no wallet client, we just idle until they fix it.
  useEffect(() => {
    if (!isConnected || !address) {
      setStatus('idle'); setError(null); return
    }
    if (chainId !== somniaShannon.id) { setStatus('idle'); return }
    if (!walletClient) { setStatus('idle'); return }
    if (!exchangeRef.current) return
    setStatus('watching'); setError(null)

    let alive = true
    const tick = async () => {
      if (!alive || !exchangeRef.current) return
      try {
        const { attempts } = await listMyMirrorAttempts(address as `0x${string}`, { decision: 'broadcast', limit: 10 })
        for (const a of attempts) {
          if (processing.current.has(a.id)) continue
          processing.current.add(a.id)
          processOne(a, address as `0x${string}`, walletClient, exchangeRef.current!)
            .catch(err => console.error('[MirrorWatch] process error', err))
            .finally(() => { processing.current.delete(a.id) })
        }
        setLastAckAt(Date.now())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    }
    const handle = setInterval(tick, POLL_INTERVAL_MS)
    // Run once on mount so the user doesn't wait 5s for the first check.
    void tick()
    return () => { alive = false; clearInterval(handle) }
  }, [isConnected, address, chainId, walletClient])

  // Visible status: only shown when the user is connected and on
  // the right chain. The user can dismiss the panel; the watch
  // continues silently in the background.
// Silence the unused-import lint for status / error / lastAckAt:
// they are used for a future toast/UI panel. Today the watch is silent
// (logs only) so the user isn't bothered.
void status; void error; void lastAckAt
  if (!isConnected || chainId !== somniaShannon.id) return null
  return null  // status is logged to console for now; will surface in a toast later
}

async function processOne(attempt: MirrorAttempt, follower: `0x${string}`, walletClient: import('viem').WalletClient, exchange: SomniaMarkets) {
  console.log('[MirrorWatch] processing attempt', attempt.id, attempt.sourceSide, attempt.sourceQuantityRaw)
  try {
    // 1. Use the SDK to encode the same-shape placeBinaryOrder call
    //    with the follower's scaled quantity. The SDK resolves the
    //    pool's outcome token + YES/NO ids and the market's
    //    expireTimestampNs.
    const trader = exchange.client.createTrader({ walletClient })
    const built = await trader.buildPlaceOrder({
      pool: attempt.sourcePool as `0x${string}`,
      side: attempt.sourceSide,
      price: BigInt(attempt.sourcePriceRaw),
      quantity: BigInt(attempt.sourceQuantityRaw),
      // orderType 0 = NormalOrder. The follower mirrors the same
      // call shape; the agent's orderType (0 in our current build)
      // is preserved.
    })
    // 2. If the SDK computed an approval call, the follower needs
    //    to approve the pool to spend their tUSDC first. We send
    //    the approval (no auth — RainbowKit signs).
    if (built.approval) {
      const approvalHash = await walletClient.sendTransaction({
        to: built.approval.to as `0x${string}`,
        data: built.approval.data as `0x${string}`,
        value: built.approval.value ?? 0n,
        account: follower,
        chain: somniaShannon,
      })
      // Use a fresh public client (no SDK dependency) to wait for the
      // approval receipt. The SDK's client.publicClient is not exposed
      // on the type — use viem directly.
      const { createPublicClient } = await import('viem')
      const pub = createPublicClient({ chain: somniaShannon, transport: (await import('viem')).http(somniaShannon.rpcUrls.default.http[0]!) })
      const approvalReceipt = await pub.waitForTransactionReceipt({ hash: approvalHash })
      if (approvalReceipt.status !== 'success') {
        await ackMirrorAttempt(attempt.id, follower, { decision: 'failed', reason: 'approval reverted' })
        return
      }
    }
    // 3. Send the mirror order itself.
    const mirrorHash = await walletClient.sendTransaction({
      to: built.order.to as `0x${string}`,
      data: built.order.data as `0x${string}`,
      value: built.order.value ?? 0n,
      account: follower,
      chain: somniaShannon,
    })
    // 4. Ack the attempt as confirmed. CLASH does not wait for the
    //    receipt; the background sync will pick up the fill later.
    await ackMirrorAttempt(attempt.id, follower, { decision: 'confirmed', mirrorTxHash: mirrorHash })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // User-rejected and explicit "user rejected" errors are reported
    // as 'rejected' so they don't count as failures; anything else
    // is 'failed' (signing error, RPC error, etc.).
    if (/user rejected|User rejected|denied|User denied|ACTION_REJECTED|4001/i.test(message)) {
      await ackMirrorAttempt(attempt.id, follower, { decision: 'rejected', reason: 'user rejected wallet prompt' })
    } else {
      await ackMirrorAttempt(attempt.id, follower, { decision: 'failed', reason: message.slice(0, 480) })
    }
  }
}
