import {ConnectButton} from '@rainbow-me/rainbowkit'
import {useWallet} from './useWallet'

/**
 * Header wallet control. Shows RainbowKit's connect button and, when the
 * wallet is on a non-Somnia chain, a prompt to switch.
 */
export function WalletControl(){
  const {isConnected,isOnSomnia,switchToSomnia,isSwitching}=useWallet()
  return (
    <div className="wallet-control">
      {isConnected && !isOnSomnia
        ? <button className="button small warn" onClick={()=>switchToSomnia()} disabled={isSwitching}>
            {isSwitching ? 'Switching…' : 'Switch to Somnia'}
          </button>
        : null}
      <ConnectButton
        accountStatus="address"
        chainStatus={isConnected ? 'icon' : 'none'}
        showBalance={false}
      />
    </div>
  )
}
