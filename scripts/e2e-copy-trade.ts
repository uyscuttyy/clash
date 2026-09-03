// End-to-end smoke test of the copy-trading round trip, driven
// against a live CLASH server. Exercises:
//   1. Agent registration (real POST /api/agents)
//   2. Follower nonce fetch
//   3. Follow creation with a real EIP-712 FollowIntent signed
//      with the follower's private key
//   4. Agent-side: list active follows
//   5. Agent-side: post a mirror attempt (gets 'broadcast')
//   6. Follower-side: poll pending attempts
//   7. Follower-side: ack the attempt as 'confirmed' with a fake
//      mirror tx hash (we don't broadcast a real tx from here —
//      the browser component does that in the actual UX)
//
// This proves the server contract. The browser component is
// separately tested by being mounted and running against the same
// endpoints in development.

import { privateKeyToAccount } from 'viem/accounts'
import { buildFollowMessage, freshFollowNonce } from '/home/user_uy_scutty/clash/src/server/eip712.ts'

const BASE = process.env.CLASH_API_URL ?? 'http://localhost:8787'

// Use a follower key we control. This is the same PK the CLASH test
// suite uses, so it's well-known and not secret.
const FOLLOWER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const followerAccount = privateKeyToAccount(FOLLOWER_PK)
const FOLLOWER = followerAccount.address

async function main() {
  console.log('[e2e] CLASH:', BASE)
  console.log('[e2e] follower:', FOLLOWER)

  // 1. Register an agent
  const reg = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `E2E Agent ${Date.now()}`,
      description: 'A test agent for the copy-trading end-to-end smoke.',
      builder: 'E2E',
      markets: ['BTC'],
      windows: ['15M'],
      integration: 'https://agent.test/api',
      walletAddress: '0x0000000000000000000000000000000000000099',
      ownerAddress: '0x0000000000000000000000000000000000000098',
      delegationMethods: ['self_run'],
    }),
  })
  if (!reg.ok) { console.error('register failed:', await reg.text()); process.exit(1) }
  const { agent, apiKey } = await reg.json()
  console.log('[e2e] agent registered:', agent.id, 'name:', agent.name)

  // 2. Get a nonce
  const nonceRes = await fetch(`${BASE}/api/follows/nonce`, { method: 'POST' })
  const { nonce } = await nonceRes.json()
  console.log('[e2e] nonce:', nonce.slice(0, 14) + '…')

  // 3. Sign the follow intent and POST
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60
  const sizeMultiplier = 0.5
  const maxPerTradeRaw = '5000000'         // 5 tUSDC
  const maxDailyExposureRaw = '50000000'   // 50 tUSDC
  const maxDailyTrades = 100
  const typed = buildFollowMessage({
    agentId: agent.id,
    sizeMultiplierBps: Math.round(sizeMultiplier * 100),
    maxPerTradeRaw: BigInt(maxPerTradeRaw),
    maxDailyExposureRaw: BigInt(maxDailyExposureRaw),
    maxDailyTrades,
    nonce: nonce as `0x${string}`,
    expiresAt,
  })
  const signature = await followerAccount.signTypedData({
    domain: typed.domain,
    types: { FollowIntent: typed.types.FollowIntent as readonly { name: string; type: string }[] },
    primaryType: typed.primaryType,
    message: typed.message,
  })
  const createRes = await fetch(`${BASE}/api/agents/${agent.id}/follow`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Follower-Wallet': FOLLOWER },
    body: JSON.stringify({
      followerAddress: FOLLOWER,
      sizeMultiplier,
      maxPerTradeRaw,
      maxDailyExposureRaw,
      maxDailyTrades,
      signedIntent: signature,
      intentNonce: nonce,
      expiresAt,
    }),
  })
  if (!createRes.ok) { console.error('create follow failed:', await createRes.text()); process.exit(1) }
  const { follow } = await createRes.json()
  console.log('[e2e] follow created:', follow.id, 'status:', follow.status, 'sizeMult:', follow.sizeMultiplier)

  // 4. Agent-side: list active follows
  const listRes = await fetch(`${BASE}/api/external/agents/${agent.id}/follows/active`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  const { follows, count } = await listRes.json()
  console.log('[e2e] agent-side active follows count:', count, 'expected: 1')
  if (count !== 1 || follows[0].followerAddress.toLowerCase() !== FOLLOWER.toLowerCase()) {
    console.error('list mismatch'); process.exit(1)
  }

  // 5. Agent-side: post a mirror attempt
  // Agent placed a 0.001 qty order at 0.5 tUSDC (price 500000 raw).
  // Follower mirrors at 0.5× = 0.0005 qty. Raw = 500.
  // Use unique tx hash per run so the UNIQUE(sourceTxHash, follower)
  // index doesn't dedupe across runs. Slice to 8 hex chars so the
  // total length stays at 0x + 64 hex.
  const unique = Date.now().toString(16).slice(-8)
  const sourceTxHash = ('0x' + unique + 'd'.repeat(56)) as `0x${string}`
  const sourceMarketId = ('0x' + unique + 'e'.repeat(56)) as `0x${string}`
  const sourcePool = '0x0000000000000000000000000000000000000abc'
  const sourcePriceRaw = '500000'         // 0.5 tUSDC
  // Mirror at 0.5× of agent qty 0.001 → 0.0005, raw = 500.
  const sourceQuantityRaw = '500'
  const attemptRes = await fetch(`${BASE}/api/external/follows/${follow.id}/mirror-attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      followId: follow.id,
      sourceTxHash, sourceMarketId, sourcePool,
      sourceSide: 'BUY_YES', sourcePriceRaw, sourceQuantityRaw,
    }),
  })
  if (!attemptRes.ok) { console.error('attempt failed:', await attemptRes.text()); process.exit(1) }
  const { attempt } = await attemptRes.json()
  console.log('[e2e] mirror attempt created:', attempt.id, 'decision:', attempt.decision)
  if (attempt.decision !== 'broadcast') { console.error('expected broadcast, got:', attempt.decision); process.exit(1) }

  // 6. Follower-side: poll pending attempts
  const pendingRes = await fetch(`${BASE}/api/me/mirror-attempts?decision=broadcast&limit=10`, {
    headers: { 'X-Follower-Wallet': FOLLOWER },
  })
  const { attempts } = await pendingRes.json()
  console.log('[e2e] follower pending count:', attempts.length, 'expected: 1')
  if (attempts.length !== 1 || attempts[0].id !== attempt.id) { console.error('pending mismatch'); process.exit(1) }

  // 7. Follower-side: ack as confirmed with a fake mirror tx
  const fakeMirrorTx = '0x' + 'f'.repeat(64)
  const ackRes = await fetch(`${BASE}/api/me/mirror-attempts/${attempt.id}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Follower-Wallet': FOLLOWER },
    body: JSON.stringify({ followerAddress: FOLLOWER, decision: 'confirmed', mirrorTxHash: fakeMirrorTx }),
  })
  if (!ackRes.ok) { console.error('ack failed:', await ackRes.text()); process.exit(1) }
  const { attempt: acked } = await ackRes.json()
  console.log('[e2e] ack:', acked.decision, 'mirrorTx:', acked.mirrorTxHash.slice(0, 14) + '…')
  if (acked.decision !== 'confirmed' || acked.mirrorTxHash !== fakeMirrorTx) {
    console.error('ack mismatch'); process.exit(1)
  }

  // 8. Verify daily stats reflect the new attempt
  const statsRes = await fetch(`${BASE}/api/me/follows`, {
    headers: { 'X-Follower-Wallet': FOLLOWER },
  })
  const { follows: myFollows } = await statsRes.json()
  const f = myFollows.find(x => x.follow.id === follow.id)
  console.log('[e2e] daily stats — exposure:', f.dailyStats.exposureRaw, 'count:', f.dailyStats.count)
  // exposure = sourceQuantityRaw * sourcePriceRaw / 1e6 = 500 * 500000 / 1e6 = 250 raw tUSDC
  if (f.dailyStats.count !== 1 || f.dailyStats.exposureRaw !== '250') {
    console.error('stats mismatch'); process.exit(1)
  }

  // 9. Test pause/resume
  const pauseRes = await fetch(`${BASE}/api/agents/${agent.id}/follow`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'X-Follower-Wallet': FOLLOWER },
    body: JSON.stringify({ followerAddress: FOLLOWER, status: 'paused' }),
  })
  const { follow: paused } = await pauseRes.json()
  console.log('[e2e] paused status:', paused.status)
  if (paused.status !== 'paused') { console.error('pause failed'); process.exit(1) }

  // 10. Test that a new attempt is rejected when paused
  const reqBody = {
    followId: follow.id,
    sourceTxHash: ('0x' + unique + 'a'.repeat(56)) as `0x${string}`,
    sourceMarketId: ('0x' + unique + 'b'.repeat(56)) as `0x${string}`,
    sourcePool: sourcePool,
    sourceSide: 'BUY_YES' as const, sourcePriceRaw: '500000', sourceQuantityRaw: '500',
  }
  console.log('[e2e] step 10 body keys:', Object.keys(reqBody), 'tx len:', reqBody.sourceTxHash.length)
  const rejectedRes = await fetch(`${BASE}/api/external/follows/${follow.id}/mirror-attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(reqBody),
  })
  if (rejectedRes.status !== 409) { console.error('expected 409 on paused follow, got:', rejectedRes.status); process.exit(1) }
  console.log('[e2e] paused follow correctly rejects new attempts with 409')

  // 11. Test kill
  const killRes = await fetch(`${BASE}/api/agents/${agent.id}/follow`, {
    method: 'DELETE',
    headers: { 'X-Follower-Wallet': FOLLOWER },
  })
  const { follow: killed } = await killRes.json()
  console.log('[e2e] killed status:', killed.status)
  if (killed.status !== 'killed') { console.error('kill failed'); process.exit(1) }

  // Cleanup the agent
  // (no DELETE endpoint by design; agent will linger in DB)

  console.log('\n[e2e] all 11 steps passed ✓')
}

main().catch(err => { console.error('[e2e] fatal:', err); process.exit(1) })
