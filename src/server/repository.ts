import Database from 'better-sqlite3'
import {mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {type Agent,type Trade} from '../domain'

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
    `)
    const columns=this.db.prepare('PRAGMA table_info(agents)').all() as {name:string}[]
    if(!columns.some(column=>column.name==='wallet_address'))this.db.exec("ALTER TABLE agents ADD COLUMN wallet_address TEXT NOT NULL DEFAULT ''")
  }
  createAgent(agent:Agent){this.db.prepare(`INSERT OR IGNORE INTO agents(id,name,description,builder,markets,windows,integration,strategy,created_at,wallet_address) VALUES(@id,@name,@description,@builder,@markets,@windows,@integration,'external',@createdAt,@walletAddress)`).run({...agent,markets:JSON.stringify(agent.markets),windows:JSON.stringify(agent.windows)});return agent}
  listAgents():Agent[]{return this.db.prepare('SELECT * FROM agents ORDER BY created_at').all().map(this.mapAgent) as Agent[]}
  getAgent(id:string){const row=this.db.prepare('SELECT * FROM agents WHERE id=?').get(id);return row?this.mapAgent(row):null}
  createTrade(trade:Trade){this.db.prepare(`INSERT INTO trades VALUES(@id,@agentId,@roundId,@market,@direction,@result,@pnl,@timestamp,@reference)`).run(trade);return trade}
  listTrades():Trade[]{return this.db.prepare('SELECT id,agent_id agentId,round_id roundId,market,direction,result,pnl,timestamp,reference FROM trades ORDER BY timestamp').all() as Trade[]}
  private mapAgent(row:unknown){const r=row as Record<string,string>;return {id:r.id,name:r.name,description:r.description,builder:r.builder,markets:JSON.parse(r.markets),windows:JSON.parse(r.windows),integration:r.integration,walletAddress:r.wallet_address,createdAt:r.created_at} as Agent}
  close(){this.db.close()}
}
