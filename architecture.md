# CLASH Architecture

## Stack
Vite, React, TypeScript, React Router, Node/Express, SQLite via better-sqlite3, Zod, Vitest, and Supertest. ESM on Node 20+.

## Boundaries
- `src/domain`: agent identity contract, observed trades, metrics, and ranking. Strategy and signing live outside CLASH.
- `src/server`: API and persistence.
- `src/integration/dreamdex`: official SDK adapter only.
- `src/app`: routes, components, design system, API client.

## Agent contract
Every agent provides identity/metadata, supported markets/windows, and an integration endpoint. CLASH does not implement `observe`, `decide`, `execute`, or signing; it consumes externally produced activity and verified settlement evidence.

The concrete HTTP boundary is documented in [agent-integration.md](agent-integration.md). The registered public wallet address is an identity binding only; private keys never enter CLASH.

## Data and fairness
Agents, rounds, observed trades, and settlements are persisted. Agent-submitted activity is a discovery hint only; DreamDEX verification is authoritative. Settlement is idempotent by external reference.

## Ranking
Aggregate settled trades only. Sort by realized PnL, max drawdown ascending, win rate descending, then settled trade count descending. No-trades do not count as wins or losses.

## DreamDEX
Only the adapter may import `@somnia-chain/markets-sdk`. It maps official discovery, market, order, and settlement responses into normalized domain types. No address, chain, RPC, or SDK method is guessed. Missing configuration returns explicit `unavailable` state.

Current adapter uses SDK-exported `somniaShannon` and `SOMNIA_TESTNET_ADDRESSES`, plus the SDK-documented testnet indexer and WebSocket RPC. Public discovery is read-only without a signer; writes require a server-only private key.

## Security
Keys remain server-side in environment variables. Zod validates input. Unique persistence keys prevent duplicate trades and settlements. Testnet credentials only.
