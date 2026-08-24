import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react'
import {rankAgents,type Agent,type Trade} from './domain'
import {StoreContext} from './store-context'
export function StoreProvider({children}:{children:ReactNode}){
 const [agents,setAgents]=useState<Agent[]>([]),[trades,setTrades]=useState<Trade[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[dreamdex,setDreamdex]=useState<{network:string;chainId:number;configured:boolean;mode:string}|null>(null)
 const load=useCallback(async()=>{try{const response=await fetch('/api/state');if(!response.ok)throw new Error('CLASH API unavailable');const data=await response.json();setAgents(data.agents);setTrades(data.trades);setDreamdex(data.dreamdex);setError(null)}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load CLASH')}finally{setLoading(false)}},[])
 // The initial API request synchronizes the client with durable server state.
 // oxlint-disable-next-line react(set-state-in-effect)
 useEffect(()=>{void load()},[load])
 const register=useCallback(async(agent:Omit<Agent,'id'|'createdAt'>)=>{const response=await fetch('/api/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(agent)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Registration failed');await load()},[load])
 const value=useMemo(()=>({agents,trades,ranked:rankAgents(agents,trades),loading,error,dreamdex,register}),[agents,trades,loading,error,dreamdex,register])
 return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
