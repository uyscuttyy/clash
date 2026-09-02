import { useState, useEffect } from 'react'
import { useWallet } from './useWallet'
import { ConnectButton } from '@rainbow-me/rainbowkit'

/**
 * Connect button. The marketplace does not put this in the global header —
 * wallet connection is reserved for the "Use Agent" and "Developers" pages.
 * This component is the one place that decides what the connect UI looks
 * like (a small inline button when nothing is connected, a compact address
 * chip when it is).
 */
export function WalletControl({ compact = true }: { compact?: boolean }) {
  const { isConnected, isOnSomnia, switchToSomnia, isSwitching } = useWallet()
  // When RainbowKit mounts its modal, our component unmounts and remounts
  // on close. That's fine — the provider handles its own state.
  const [, setOpen] = useState(false)
  useEffect(() => () => setOpen(false), [])
  if (!isConnected) {
    return (
      <ConnectButton
        label="Connect wallet"
        accountStatus="address"
        chainStatus="none"
        showBalance={false}
      />
    )
  }
  return (
    <div className="wallet-control">
      {!isOnSomnia
        ? <button className="button small warn" onClick={() => switchToSomnia()} disabled={isSwitching}>
            {isSwitching ? 'Switching…' : 'Switch to Somnia'}
          </button>
        : null}
      <ConnectButton
        accountStatus="address"
        chainStatus={compact ? 'icon' : 'name'}
        showBalance={false}
      />
    </div>
  )
}
