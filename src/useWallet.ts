import {useAccount,useChainId,useSwitchChain} from 'wagmi'
import {somniaTestnet} from './chains'

/**
 * Centralises wallet state. Components that need to know whether a wallet is
 * connected, which chain it is on, or whether to prompt a network switch use
 * this hook instead of pulling from wagmi directly. Keeps the rest of the
 * codebase chain-agnostic.
 */
export function useWallet(){
  const {address,isConnected,connector}=useAccount()
  const chainId=useChainId()
  const {switchChain,isPending:isSwitching}=useSwitchChain()
  const isOnSomnia=chainId===somniaTestnet.id
  return {
    address,
    isConnected,
    connectorName:connector?.name,
    chainId,
    isOnSomnia,
    switchToSomnia:()=>switchChain({chainId:somniaTestnet.id}),
    isSwitching,
  }
}
