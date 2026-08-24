import {createContext,useContext} from 'react'
import type {ActivityHint,Agent,CompetitionRound,Trade,rankAgents} from './domain'

export type StoreValue={
  agents:Agent[]
  trades:Trade[]
  activityHints:ActivityHint[]
  rounds:CompetitionRound[]
  ranked:ReturnType<typeof rankAgents>
  loading:boolean
  error:string|null
  dreamdex:{network:string;chainId:number;configured:boolean;mode:string}|null
  register:(agent:Omit<Agent,'id'|'createdAt'>)=>Promise<void>
}

export const StoreContext=createContext<StoreValue|null>(null)

export function useStore(){
  const store=useContext(StoreContext)
  if(!store) throw new Error('Store provider is missing')
  return store
}
