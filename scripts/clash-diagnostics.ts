import { formatUnits, createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

const key = process.env.DREAMDEX_PRIVATE_KEY
if (!key) throw new Error('DREAMDEX_PRIVATE_KEY is not configured')
const account = privateKeyToAccount(key as `0x${string}`)
const rpc = somniaShannon.rpcUrls.default.http[0]
const client = createPublicClient({ chain: somniaShannon, transport: http(rpc) })
const addresses = SOMNIA_TESTNET_ADDRESSES

const exchange = new SomniaMarkets({ chain: somniaShannon, indexerUrl: 'https://dev.smk.somnia.host/v1/graphql', wsRpcUrl: somniaShannon.rpcUrls.default.webSocket[0], addresses })
try {
  const [chainId, native, markets] = await Promise.all([client.getChainId(), client.getBalance({ address: account.address }), exchange.fetchMarkets()])
  const binary = markets.filter((m) => m.type === 'binary' && m.active)
  const proposed = binary.filter((m) => m.info?.asset === 'BTC' && m.info?.interval === '15m').sort((a, b) => Number(a.info?.expiry ?? 0) - Number(b.info?.expiry ?? 0))[0]
  const token = (proposed?.info?.collateral ?? addresses.collateral ?? addresses.testUsdc) as Address | undefined
  if (!token) throw new Error('No collateral token is configured by the SDK')
  const spender = proposed?.info?.poolAddress as Address | undefined
  const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    spender ? client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, spender] }) : Promise.resolve(0n),
  ])
  console.log('Clash Diagnostics ────────────────────────────')
  console.log(`Network: Somnia Shannon Testnet\nChain ID: ${chainId}\nRPC endpoint: ${rpc}\nSigner: ${account.address}`)
  console.log(`STT Balance: ${formatUnits(native, 18)}\ntUSDC Token: ${token}\ntUSDC Balance: ${formatUnits(balance, decimals)}\nDreamDEX Spender: ${spender ?? 'unresolved'}\ntUSDC Allowance: ${formatUnits(allowance, decimals)}`)
  console.log(`Markets discovered: ${markets.length} (${binary.length} active binary)\nAddresses: ${JSON.stringify(addresses, null, 2)}`)
  if (proposed) console.log(`PROPOSED TEST ORDER ────────────────────────────\nMarket: ${proposed.symbol}\nMarket ID: ${proposed.id}\nPool: ${proposed.info?.poolAddress}\nAsset: ${proposed.info?.asset}\nDuration: ${proposed.info?.interval}\nDirection: UP (BUY_YES)\nMinimum quantity: ${proposed.limits?.amount?.min ?? 'unresolved'}\nToken: tUSDC (${token})\nStatus: ${balance > 0n ? (allowance > 0n ? 'READY FOR REVIEW' : 'NEEDS ALLOWANCE') : 'NEEDS COLLATERAL'}\n────────────────────────────`)
  else console.log('PROPOSED TEST ORDER: No active BTC 15m market currently available.')
} finally { await exchange.close() }
