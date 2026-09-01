# CLASH

## The marketplace for autonomous trading agents on Somnia / DreamDEX

CLASH is a place to discover trading agents that actually work. Not agents that promise to work, not agents that look good in a backtest — agents whose activity and results can be verified on-chain.

Developers register their agents. Agents trade on Somnia / DreamDEX in their own wallets, on their own terms. CLASH reads the activity, verifies it against the chain, builds a verified performance record, and lets users discover, compare, and authorize the agents they want to use.

> **Find a trading agent worth trusting.**

## Why CLASH exists

The hardest question in autonomous trading is not *"can this agent trade?"* It is *"did this agent actually do what it says it did?"*

CLASH is the answer:

- Every registered agent has a public profile.
- Every profile is anchored to a wallet address on Somnia.
- Every trade on that profile can be checked on the Somnia / DreamDEX indexer.
- Every performance number is derived from on-chain fills and settlement — never from the agent's own self-report.

If an agent says it made money on a 15-minute BTC market, the trade is on the chain. CLASH shows it.

## How it works

```text
Developer builds agent (separate repository)
        ↓
Developer registers agent with CLASH
        ↓
Agent trades on Somnia / DreamDEX in its own wallet
        ↓
CLASH continuously re-indexes the agent's on-chain activity
        ↓
CLASH verifies each trade against the chain
        ↓
Performance, drawdown, and win rate are derived from verified data
        ↓
Users browse, compare, and choose an agent
        ↓
User connects a wallet and authorizes the agent
        ↓
Agent trades for the user, with on-chain authorization CLASH can verify
```

CLASH never signs for the user. CLASH never holds user funds. CLASH never asks for a seed phrase or private key. The user's wallet, the user's keys, the user's exit.

## Users

You can browse every page of CLASH without a wallet. The "Use Agent" button is the only place that requires one — and even there, CLASH only asks the user to sign a real on-chain authorization that the user can verify and revoke.

## Developers

If you have built a trading agent, you can register it on CLASH:

1. Connect your developer wallet.
2. Submit the agent's identity, supported markets, integration URL, and trading wallet.
3. CLASH gives you a per-agent API key.
4. Your agent runtime uses that API key to push transaction hints to CLASH.
5. CLASH verifies every hint on-chain. Verified trades become your agent's public record.
6. The more verified trades you accumulate, the more discoverable your agent becomes.

The agent's trading wallet, signer, and strategy live wherever you want them to live. CLASH imports none of that code.

## What CLASH is not

CLASH is not:

- a trading bot
- a strategy or AI engine
- a copy-trading router
- a wallet custodian
- a marketplace for investment promises
- a custodial delegation service

If you want a bot, build one and register it on CLASH. If you want to use a bot, browse CLASH and authorize one. CLASH is the surface, not the engine.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:5173` and the API runs at `http://localhost:8787`.

Useful checks:

```bash
npm test
npm run build
npm run diagnostics
```

Diagnostics are read-only. They confirm the Somnia / DreamDEX indexer is reachable and the marketplace can see live markets.

## What this repository contains

- The marketplace web app (Vite + React 19).
- The CLASH API (Express 5 + SQLite).
- The Somnia / DreamDEX read-only verification layer.
- The external-agent integration boundary (per-agent API key auth, transaction-hint endpoint).
- Background sync that re-indexes registered agents continuously.
- A read-only `clash-diagnostics.ts` script.

The marketplace does **not** contain any agent strategy, any agent signer, or any agent trading code. That lives in a separate repository and integrates with CLASH only through the documented API.

## License

This repository is part of the CLASH marketplace project. See the LICENSE file for terms.
