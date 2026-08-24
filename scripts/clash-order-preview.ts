import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const key = process.env.DREAMDEX_PRIVATE_KEY
if (!key) throw new Error('DREAMDEX_PRIVATE_KEY is not configured')
const account = privateKeyToAccount(key as `0x${string}`)
const exchange = new SomniaMarkets({ chain: somniaShannon, indexerUrl: 'https://dev.smk.somnia.host/v1/graphql', wsRpcUrl: somniaShannon.rpcUrls.default.webSocket[0], addresses: SOMNIA_TESTNET_ADDRESSES, privateKey: key })
const rpc = createPublicClient({ chain: somniaShannon, transport: http(somniaShannon.rpcUrls.default.http[0]) })
try {
  const markets = (await exchange.fetchMarkets()).filter((m) => m.type === 'binary' && m.active && m.info?.asset === 'BTC' && m.info?.interval === '15m').sort((a, b) => Number(a.info?.expiry) - Number(b.info?.expiry))
  const market = markets[0]
  if (!market || !market.info?.poolAddress) throw new Error('No active BTC 15m market found')
  const book = await exchange.fetchOrderBook(market.symbol, 10)
  const ask = book.asks[0]
  if (!ask) throw new Error('Selected market has no ask liquidity')
  const quantity = BigInt(Math.round(Number(market.limits.amount.min) * 1e6))
  const price = BigInt(Math.round(ask[0] * 1e6))
  const trader = exchange.client.createTrader({ privateKey: key })
  const built = await trader.buildPlaceOrder({ pool: market.info.poolAddress, side: 'BUY_YES', price, quantity, orderType: 2, autoApprove: false })
  const escrow = (quantity * price + 1_000_000n - 1n) / 1_000_000n
  const approvalAmount = escrow + (escrow + 9n) / 10n
  const approvalAbi = parseAbi(['function approve(address spender, uint256 amount)'])
  const approvalData = encodeFunctionData({ abi: approvalAbi, functionName: 'approve', args: [market.info.poolAddress, approvalAmount] })
  const approvalTo = (market.info.collateral ?? SOMNIA_TESTNET_ADDRESSES.collateral) as `0x${string}`
  const approvalGas = await rpc.estimateGas({ account: account.address, to: approvalTo, data: approvalData })
  let orderGas: string | null = null
  let orderSimulation: string | null = null
  try { orderGas = (await rpc.estimateGas({ account: account.address, to: built.order.to, data: built.order.data })).toString() } catch (error) { orderSimulation = error instanceof Error ? error.message : String(error) }
  console.log(JSON.stringify({ market: market.symbol, marketId: market.id, pool: market.info.poolAddress, expiry: market.info.expiry, book, side: 'BUY_YES', quantity: quantity.toString(), quantityHuman: market.limits.amount.min, price: price.toString(), priceHuman: ask[0], escrowBaseUnits: escrow.toString(), collateralHuman: formatUnits(escrow, 6), approval: { to: approvalTo, amountBaseUnits: approvalAmount.toString(), amountHuman: formatUnits(approvalAmount, 6), gas: approvalGas.toString(), data: approvalData }, order: { to: built.order.to, data: built.order.data, value: built.order.value?.toString() ?? '0', gas: orderGas, simulation: orderSimulation } }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2))
} finally { await exchange.close() }
