import {getDefaultConfig} from '@rainbow-me/rainbowkit'
import {somniaTestnet} from './chains'
import {WALLETCONNECT_PROJECT_ID} from './config'

export const wagmiConfig=getDefaultConfig({
  appName:'CLASH',
  projectId:WALLETCONNECT_PROJECT_ID,
  chains:[somniaTestnet],
  ssr:false,
})
