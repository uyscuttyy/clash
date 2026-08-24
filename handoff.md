# CLASH Handoff

## Current state
The responsive React product surface, Express/SQLite API, durable registration, common agent contract, Arena empty state, derived rankings, idempotent settlement processing, profiles, and read-only DreamDEX wallet diagnostics are implemented. No agents are preloaded.

## Run
```bash
npm install
npm run dev
```

Web: `http://localhost:5173`. API: `http://localhost:8787`.

## Environment
Copy `.env.example` to `.env`. DreamDEX testnet settings are server-only and must come from current official documentation. Missing settings produce an unavailable state.

## Demo path
Home -> Apps -> register an agent -> Arena -> Rankings -> Top Agents -> profile. Until Event Contracts are connected, the Arena accurately reports that execution and observations are unavailable.

## Remaining
Signed DreamDEX order execution and settlement monitoring still require tUSDC and explicit approval. The configured signer has 1 STT, 0 tUSDC, and 0 allowance. API integration tests need a normal local listener; the managed sandbox rejects socket binding.

## DreamDEX verification
- Network: Somnia Shannon Testnet, chain ID `50312`, SDK RPC `https://api.infra.testnet.somnia.network`.
- Signer is loaded from `DREAMDEX_PRIVATE_KEY` and is never printed; diagnostics reports only its derived address.
- SDK addresses: collateral/TestUSDC `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`, binary module `0x3ecC694Cef705358864a646142ac17A90E29e388`, binary settlement `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23`, collateral router `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C`.
- The actual order spender is the selected binary pool, not the global module. The current BTC 15m example pool is discovered from the indexer at runtime.
- Official order API: `exchange.client.createTrader({ privateKey }).placeOrder({ pool, side: 'BUY_YES'|'BUY_NO'|'SELL_YES'|'SELL_NO', price, quantity, orderType, expireTimestampNs, autoApprove })`. Binary writes call `placeBinaryOrder`; buy orders escrow collateral and require ERC-20 allowance to the pool. `buildPlaceOrder` returns unsigned order plus approval without sending.
- Official testnet collateral flow: SDK exposes `trader.faucet()` which calls the configured TestUSDC contract's `faucet` function. It was inspected only and not called.
- Faucet verified from official explorer source: anyone may call `faucet`, capped at `FAUCET_PER_TX = 10,000 tUSDC`; no cooldown or per-wallet limit is present. The approved SDK call succeeded: tx `0x30ad2b848456e85c414c7ef5b727d438ab49868708a30864d7380f58751683e6`, block `469894772`. Post-call diagnostics: `10,000 tUSDC`, `0` allowance, `0.998481172 STT`.
- Current read-only result: 557 markets, 12 active binary; BTC 15m candidate `BTC-0-24AUG26-0830/tUSDC`, market ID `0x0000000000000000000000000000000000000000000000000000000000008253`, pool `0xd6fbbe5eb2d7de1071eb07da69a8e18482f9e927`, minimum quantity `0.001`, tUSDC balance `0`, allowance `0`.
- No order is proposed for submission yet because the wallet has no tUSDC and the exact limit price / required collateral must be read from the live order book immediately before approval.

## Known limitation
Live DreamDEX execution cannot be claimed until valid testnet configuration is supplied and verified. The Arena currently shows deterministic decisions and explicitly gated execution state.
