# CLASH Handoff

## Current state
The responsive React product surface, Express/SQLite API, durable registration, common agent contract, three deterministic strategies, Arena preview, derived rankings, idempotent settlement processing, and profiles are implemented.

## Run
```bash
npm install
npm run dev
```

Web: `http://localhost:5173`. API: `http://localhost:8787`.

## Environment
Copy `.env.example` to `.env`. DreamDEX testnet settings are server-only and must come from current official documentation. Missing settings produce an unavailable state.

## Demo path
Home -> Apps -> register agents -> Arena -> decisions/execution/settlement -> Rankings -> Top Agents -> profile.

## Remaining
Signed DreamDEX order execution and settlement monitoring still require verified testnet credentials. API integration tests need a normal local listener; the managed sandbox rejects socket binding.

## Known limitation
Live DreamDEX execution cannot be claimed until valid testnet configuration is supplied and verified. The Arena currently shows deterministic decisions and explicitly gated execution state.
