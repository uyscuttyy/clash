import {defineChain} from 'viem'

// Somnia Shannon testnet (chain id 50312) — the network DreamDEX lives on.
// Mirrors the SDK's somniaShannon definition; we redefine it here so the
// wallet config does not depend on a server-side SDK import.
export const somniaTestnet=defineChain({
  id:50312,
  name:'Somnia Shannon Testnet',
  nativeCurrency:{name:'STT',symbol:'STT',decimals:18},
  rpcUrls:{
    default:{http:['https://api.infra.testnet.somnia.network','https://dream-rpc.somnia.network']},
    public:{http:['https://dream-rpc.somnia.network']},
  },
  blockExplorers:{
    default:{name:'ShannonScan',url:'https://shannonscan.xyz'},
  },
  testnet:true,
})
