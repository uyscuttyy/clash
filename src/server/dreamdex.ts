import {SomniaMarkets,SOMNIA_TESTNET_ADDRESSES} from '@somnia-chain/markets-sdk'
import {somniaShannon} from '@somnia-chain/markets-sdk/chains'
import type {VerifiedOrder} from '../domain'

const INDEXER='https://dev.smk.somnia.host/v1/graphql'
const WS_RPC='wss://api.infra.testnet.somnia.network/ws'

export class DreamDexAdapter {
  configured(){return Boolean(process.env.DREAMDEX_PRIVATE_KEY)}
  status(){return {network:'Somnia Shannon',chainId:somniaShannon.id,indexer:INDEXER,configured:this.configured(),mode:this.configured()?'live-testnet':'read-only'}}
  async discover(){
    const exchange=new SomniaMarkets({chain:somniaShannon,indexerUrl:INDEXER,wsRpcUrl:WS_RPC,addresses:SOMNIA_TESTNET_ADDRESSES})
    try { const markets=await exchange.fetchMarkets(); return markets.filter(m=>m.type==='binary') }
    finally { await exchange.close() }
  }
  async ordersForAgent(agentId:string,walletAddress:`0x${string}`):Promise<VerifiedOrder[]>{
    const exchange=new SomniaMarkets({chain:somniaShannon,indexerUrl:INDEXER,wsRpcUrl:WS_RPC,addresses:SOMNIA_TESTNET_ADDRESSES})
    try {return (await exchange.client.getOrders(walletAddress,{limit:200})).filter(order=>order.marketInfo?.asset==='BTC'||order.marketInfo?.asset==='ETH').map(order=>({agentId,walletAddress,orderId:order.orderId,marketId:order.market,pool:order.pool,asset:order.marketInfo?.asset??null,window:order.marketInfo?.interval??null,side:order.side,price:order.price,quantity:order.fullQuantity,filledQuantity:order.filledQuantity,status:order.status,txHash:order.placedTxHash,timestamp:order.placedAtTimestamp}))}
    finally {await exchange.close()}
  }
  async portfolioForAgent(walletAddress:`0x${string}`){
    const exchange=new SomniaMarkets({chain:somniaShannon,indexerUrl:INDEXER,wsRpcUrl:WS_RPC,addresses:SOMNIA_TESTNET_ADDRESSES})
    try {const portfolio=await exchange.client.getPortfolio(walletAddress,{ordersLimit:200,tradesLimit:200});return {account:walletAddress,positions:portfolio.positions,openOrders:portfolio.openOrders,trades:portfolio.trades}}
    finally {await exchange.close()}
  }
  async settlementsForAgent(walletAddress:`0x${string}`){
    const exchange=new SomniaMarkets({chain:somniaShannon,indexerUrl:INDEXER,wsRpcUrl:WS_RPC,addresses:SOMNIA_TESTNET_ADDRESSES})
    try {const portfolio=await exchange.client.getPortfolio(walletAddress,{ordersLimit:0,tradesLimit:0});const markets=[...new Map(portfolio.positions.map(position=>[position.market.id,position.market])).values()];return Promise.all(markets.map(async market=>{const resolution=await exchange.client.getMarketResolution(market.id);const event=resolution.events.at(-1);return {marketId:market.id,asset:market.asset,window:market.interval,status:event?.voided?'voided':event?.winningOutcome===null||event?.winningOutcome===undefined?'pending':'resolved',winningOutcome:event?.winningOutcome??null,payoutNumerators:event?.payoutNumerators??null,payoutDenominator:event?.payoutDenominator??null,positions:portfolio.positions.filter(position=>position.market.id===market.id).map(position=>({outcomeIndex:position.outcomeIndex,balance:position.balance})),sourceTxHash:event?.txHash??null,resolvedAt:resolution.closingAnswer?.resolvedAt??null}}))}
    finally {await exchange.close()}
  }
  async settledPerformance(walletAddress:`0x${string}`,marketId:string){
    const exchange=new SomniaMarkets({chain:somniaShannon,indexerUrl:INDEXER,wsRpcUrl:WS_RPC,addresses:SOMNIA_TESTNET_ADDRESSES})
    try {const orders=(await exchange.client.getOrders(walletAddress,{limit:200})).filter(order=>order.market.toLowerCase()===marketId.toLowerCase()&&BigInt(order.filledQuantity)>0n);if(!orders.length)return null;const resolution=await exchange.client.getMarketResolution(marketId);const event=resolution.events.at(-1);if(!event||(event.winningOutcome===null&&!event.voided))return null;const outcomes=new Set(orders.map(order=>order.side?.includes('YES')?'UP':order.side?.includes('NO')?'DOWN':null).filter(Boolean));if(outcomes.size!==1)return null;const pnl=await exchange.client.getBinaryPositionPnL(walletAddress,marketId);const decimals=orders[0].marketInfo?.quoteDecimals??6;const pnlRaw=pnl.realizedPnl+pnl.unrealizedPnl;return {direction:[...outcomes][0] as 'UP'|'DOWN',pnl:Number(pnlRaw)/10**decimals,result:pnlRaw>=0n?'WIN' as const:'LOSS' as const,reference:event.txHash,timestamp:event.timestamp}}
    finally {await exchange.close()}
  }
}
