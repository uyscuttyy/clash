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
# DreamDEX verification checkpoint (2026-08-24)
- `npm run diagnostics` is a read-only command using the installed official SDK and local `.env`.
- Verified chain: Somnia Shannon Testnet (`50312`), native gas token STT, RPC `https://api.infra.testnet.somnia.network`.
- Signer address derived locally: `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C`; private key is never emitted.
- Live indexer discovery succeeded: 557 markets, 12 active binary. Current BTC 15m example: `BTC-0-24AUG26-0830/tUSDC`, pool `0xd6fbbe5eb2d7de1071eb07da69a8e18482f9e927`, minimum quantity `0.001`.
- tUSDC/TestUSDC address from SDK: `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`; wallet balance and pool allowance are both zero.
- SDK order method is `createTrader(...).placeOrder`; binary buy maps to `BUY_YES`/`BUY_NO`, calls pool `placeBinaryOrder`, and auto-approves the collateral token to that pool by default. `buildPlaceOrder` is the non-sending inspection path.
- SDK includes `trader.faucet()` -> TestUSDC `faucet` contract call. Do not invoke without explicit user approval.
- Faucet inspection and execution: official explorer source for TestUSDC confirms public `faucet(uint256)` with `FAUCET_PER_TX = 10,000 tUSDC`, no cooldown/per-wallet limit. Approved SDK faucet succeeded in tx `0x30ad2b848456e85c414c7ef5b727d438ab49868708a30864d7380f58751683e6`; balance is now 10,000 tUSDC, allowance remains 0, STT is 0.998481172.
- Stop before any approval, faucet, or order transaction. Exact price, collateral amount, and gas estimate remain to be read from the live book for an explicitly approved market.
