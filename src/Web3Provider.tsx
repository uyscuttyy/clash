import {useMemo,useState,type ReactNode} from 'react'
import {WagmiProvider,type State} from 'wagmi'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {RainbowKitProvider,lightTheme} from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import {wagmiConfig} from './wagmi'
import {somniaTestnet} from './chains'

/**
 * Wraps the app with Wagmi, RainbowKit, and React Query so any component can
 * use the connected wallet, sign transactions, or read on-chain state.
 *
 * The Wagmi initial state is computed lazily and memoized so that test renders
 * without a wallet still pass — we never force a connection on mount.
 */
export function Web3Provider({children}:{children:ReactNode}){
  // React Query is required by RainbowKit's transaction lifecycle hooks.
  const [queryClient]=useState(()=>new QueryClient())
  // Initial state is null — RainbowKit will prompt on first connect.
  const initialState=useMemo<State | undefined>(()=>undefined,[])
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor:'#111111',
            accentColorForeground:'#ffffff',
            borderRadius:'small',
          })}
          modalSize="compact"
          initialChain={somniaTestnet.id}
        >
          {children as React.ReactNode}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
