import Database from 'better-sqlite3'
import {mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {type ActivityHint,type Agent,type CompetitionRound,type Trade} from '../domain'

export class Repository {
  private db:Database.Database
  constructor(path=process.env.DATABASE_PATH || './data/clash.db'){
    mkdirSync(dirname(path),{recursive:true})
    this.db=new Database(path)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL,builder TEXT NOT NULL,markets TEXT NOT NULL,windows TEXT NOT NULL,integration TEXT NOT NULL,strategy TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,round_id TEXT NOT NULL,market TEXT NOT NULL,direction TEXT NOT NULL,result TEXT NOT NULL,pnl REAL NOT NULL,timestamp TEXT NOT NULL,reference TEXT UNIQUE,FOREIGN KEY(agent_id) REFERENCES agents(id));
      CREATE TABLE IF NOT EXISTS activity_hints(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,tx_hash TEXT NOT NULL UNIQUE,order_id TEXT,market_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,verified_at TEXT,FOREIGN KEY(agent_id) REFERENCES agents(id));
      CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY,name TEXT NOT NULL,market_id TEXT NOT NULL,market TEXT NOT NULL,window TEXT NOT NULL,status TEXT NOT NULL,opens_at TEXT NOT NULL,closes_at TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS round_participants(round_id TEXT NOT NULL,agent_id TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(round_id,agent_id),FOREIGN KEY(round_id) REFERENCES rounds(id),FOREIGN KEY(agent_id) REFERENCES agents(id));
    `)
    const columns=this.db.prepare('PRAGMA table_info(agents)').all() as {name:string}[]
    if(!columns.some(column=>column.name==='wallet_address'))this.db.exec("ALTER TABLE agents ADD COLUMN wallet_address TEXT NOT NULL DEFAULT ''")
  }
  createAgent(agent:Agent){this.db.prepare(`INSERT OR IGNORE INTO agents(id,name,description,builder,markets,windows,integration,strategy,created_at,wallet_address) VALUES(@id,@name,@description,@builder,@markets,@windows,@integration,'external',@createdAt,@walletAddress)`).run({...agent,markets:JSON.stringify(agent.markets),windows:JSON.stringify(agent.windows)});return agent}
  listAgents():Agent[]{return this.db.prepare('SELECT * FROM agents ORDER BY created_at').all().map(this.mapAgent) as Agent[]}
  getAgent(id:string){const row=this.db.prepare('SELECT * FROM agents WHERE id=?').get(id);return row?this.mapAgent(row):null}
  createTrade(trade:Trade){this.db.prepare(`INSERT INTO trades VALUES(@id,@agentId,@roundId,@market,@direction,@result,@pnl,@timestamp,@reference)`).run(trade);return trade}
  listTrades():Trade[]{return this.db.prepare('SELECT id,agent_id agentId,round_id roundId,market,direction,result,pnl,timestamp,reference FROM trades ORDER BY timestamp').all() as Trade[]}
  getTradeByReference(reference:string){return this.db.prepare('SELECT id,agent_id agentId,round_id roundId,market,direction,result,pnl,timestamp,reference FROM trades WHERE reference=?').get(reference) as Trade|undefined}
  createActivityHint(hint:ActivityHint){this.db.prepare(`INSERT INTO activity_hints(id,agent_id,tx_hash,order_id,market_id,status,created_at,verified_at) VALUES(@id,@agentId,@txHash,@orderId,@marketId,@status,@createdAt,@verifiedAt)`).run({...hint,orderId:hint.orderId??null,marketId:hint.marketId??null,verifiedAt:hint.verifiedAt??null});return hint}
  listActivityHints(agentId?:string):ActivityHint[]{const rows=agentId?this.db.prepare('SELECT id,agent_id agentId,tx_hash txHash,order_id orderId,market_id marketId,status,created_at createdAt,verified_at verifiedAt FROM activity_hints WHERE agent_id=? ORDER BY created_at DESC').all(agentId):this.db.prepare('SELECT id,agent_id agentId,tx_hash txHash,order_id orderId,market_id marketId,status,created_at createdAt,verified_at verifiedAt FROM activity_hints ORDER BY created_at DESC').all();return rows as ActivityHint[]}
  markActivityHint(id:string,status:'verified'|'rejected'){this.db.prepare('UPDATE activity_hints SET status=?,verified_at=? WHERE id=?').run(status,new Date().toISOString(),id)}
  createRound(round:Omit<CompetitionRound,'participants'>){this.db.prepare('INSERT INTO rounds(id,name,market_id,market,window,status,opens_at,closes_at,created_at) VALUES(@id,@name,@marketId,@market,@window,@status,@opensAt,@closesAt,@createdAt)').run(round);return {...round,participants:[]}}
  listRounds():CompetitionRound[]{return (this.db.prepare('SELECT id,name,market_id marketId,market,window,status,opens_at opensAt,closes_at closesAt,created_at createdAt FROM rounds ORDER BY created_at DESC').all() as Omit<CompetitionRound,'participants'>[]).map(round=>({...round,participants:(this.db.prepare('SELECT agent_id agentId FROM round_participants WHERE round_id=? ORDER BY joined_at').all(round.id) as {agentId:string}[]).map(row=>row.agentId)}))}
  getRound(id:string){return this.listRounds().find(round=>round.id===id)??null}
  joinRound(roundId:string,agentId:string){this.db.prepare('INSERT INTO round_participants(round_id,agent_id,joined_at) VALUES(?,?,?)').run(roundId,agentId,new Date().toISOString());return this.getRound(roundId)}
  updateRoundStatus(id:string,status:CompetitionRound['status']){this.db.prepare('UPDATE rounds SET status=? WHERE id=?').run(status,id);return this.getRound(id)}
  private mapAgent(row:unknown){const r=row as Record<string,string>;return {id:r.id,name:r.name,description:r.description,builder:r.builder,markets:JSON.parse(r.markets),windows:JSON.parse(r.windows),integration:r.integration,walletAddress:r.wallet_address,createdAt:r.created_at} as Agent}
  close(){this.db.close()}
}
