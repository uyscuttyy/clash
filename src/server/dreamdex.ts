import {SomniaMarkets,SOMNIA_TESTNET_ADDRESSES} from '@somnia-chain/markets-sdk'
import {somniaShannon} from '@somnia-chain/markets-sdk/chains'

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
}
