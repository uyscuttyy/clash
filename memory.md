# CLASH Memory

## Decisions
- One React app plus Express API and SQLite keeps the hackathon surface small while retaining clean boundaries.
- Strategies are deterministic and receive the same immutable observation per round.
- Realized PnL leads ranking; drawdown, win rate, and sample size provide context.

## DreamDEX findings
- Official docs are GitBook with markdown alternates.
- Official `dreamdex-bot-kit` requires Node 20+, uses ESM, and demonstrates an SDK-driven Somnia CLOB workflow.
- `@somnia-chain/markets-sdk` is installed. Exact integration configuration remains sourced from official docs and environment.
- Installed SDK `0.28.1` documents Shannon testnet chain id `50312`, indexer `https://dev.smk.somnia.host/v1/graphql`, WebSocket RPC `wss://api.infra.testnet.somnia.network/ws`, and exported `SOMNIA_TESTNET_ADDRESSES`.
- Official unified flow is `new SomniaMarkets(...)`, `loadMarkets`/`fetchMarkets`, and `createOrder`; binary settlement reads include `getMarketResolution`.

## Constraints
- Network access may be intermittent. Do not infer interfaces or present unavailable integration as live.
- Never commit secrets.
