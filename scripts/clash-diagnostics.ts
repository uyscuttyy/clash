// CLASH diagnostics: a read-only check that the marketplace can talk to the
// Somnia Shannon testnet indexer and RPC. CLASH does not own a signer, so
// the diagnostics script no longer prints a wallet address — it only checks
// the network, the indexer, and the list of active binary markets.

import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, http } from 'viem'

const rpc = somniaShannon.rpcUrls.default.http[0]!
const indexer = 'https://dev.smk.somnia.host/v1/graphql'
const addresses = SOMNIA_TESTNET_ADDRESSES

const client = createPublicClient({ chain: somniaShannon, transport: http(rpc) })
const exchange = new SomniaMarkets({ chain: somniaShannon, indexerUrl: indexer, wsRpcUrl: somniaShannon.rpcUrls.default.webSocket[0]!, addresses })
try {
  const [chainId, blockNumber, markets] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    exchange.fetchMarkets(),
  ])
  const binary = markets.filter(m => m.type === 'binary' && m.active)
  const eth15m = binary.filter(m => m.info?.asset === 'ETH' && m.info?.interval === '15m')
  const btc15m = binary.filter(m => m.info?.asset === 'BTC' && m.info?.interval === '15m')

  console.log('CLASH diagnostics ────────────────────────────')
  console.log(`Network:           Somnia Shannon Testnet`)
  console.log(`Chain ID:          ${chainId}`)
  console.log(`RPC endpoint:      ${rpc}`)
  console.log(`Indexer:           ${indexer}`)
  console.log(`Block number:      ${blockNumber}`)
  console.log(`Active markets:    ${binary.length} binary (of ${markets.length} total)`)
  console.log(`ETH 15m markets:   ${eth15m.length}`)
  console.log(`BTC 15m markets:   ${btc15m.length}`)
  console.log(`SDK addresses:`)
  console.log(`  collateral:      ${addresses.collateral ?? addresses.testUsdc}`)
  console.log(`  binary module:   ${addresses.binaryModule ?? 'unresolved'}`)
  console.log(`  binary settlement: ${addresses.binarySettlement ?? 'unresolved'}`)
  console.log('─────────────────────────────────────────────')
  console.log('CLASH holds no private key. The marketplace reads from this network only.')
} finally { await exchange.close() }
