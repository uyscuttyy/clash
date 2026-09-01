# CLASH Architecture

## Product boundary

CLASH is a **marketplace for autonomous trading agents** operating on Somnia / DreamDEX.

CLASH is **not**:

- a trading bot
- a strategy engine
- an AI agent
- a wallet custodian
- a private-key manager
- a copy-trading or copy-trading-router service
- a marketplace for investment promises

CLASH **is**:

- a discovery surface where users browse trading agents
- a verification layer that reads on-chain activity from Somnia / DreamDEX
- a performance / reputation engine for those agents
- an authorization interface where users grant a chosen agent permission to trade on their behalf (when the underlying protocol supports it for that agent)
- an API surface that external agents authenticate against to report their own identity and activity hints

## Stack

- Vite + React 19 + TypeScript (frontend)
- Express 5 + better-sqlite3 + Zod (API)
- `@somnia-chain/markets-sdk@^0.28.1` (read-only verification, spot operator grant, spot order placement by user wallet)
- viem (EIP-7702 authorization tuples, session-tx envelope construction, on-chain reads)
- wagmi + RainbowKit + @tanstack/react-query (wallet connection)
- lucide-react (icons)
- Vitest + Supertest (tests)

CLASH does not import any trading-strategy code, any private-key-holding agent code, or any code that signs on behalf of users. Any signing is initiated by the user's own wallet (RainbowKit → viem wallet client).

## Verified Somnia / DreamDEX capabilities (2026-09)

The marketplace's "Use Agent" path is grounded in the following protocol facts, verified by inspecting the installed SDK (`@somnia-chain/markets-sdk@0.28.1`) and the official Somnia release notes.

### 1. Spot markets support operator grants (delegation primitive, real today)

- The SDK exposes `setOperatorApprovalForPool({ pool, operator, selectors, approved })` and `setOperatorApprovalGlobal({ operator, selectors, approved })`.
- Source code comment: *"The grant is per `msg.sender`, so the signer is the owner granting."*
- Verification on-chain: `client.isOperatorAuthorized({ pool, owner, operator })` or `client.isApprovedForPool({ pool, owner, operator, selector })`.
- The grant is per `msg.sender`. The user signs from their own wallet. The agent's EOA becomes the operator.
- The user can revoke at any time by calling the same write with `approved: false`.
- Selectors include `PLACE_ORDER_FOR_SELECTOR` and `CANCEL_ORDER_FOR_SELECTOR`.
- This is **spot markets only**. Binary event markets have no equivalent in the SDK.

### 2. Binary event markets have no operator grant in the current SDK

- The SDK source is explicit: *"SPOT-ONLY: the registry gates SpotPool's operator entry points (placeOrderFor and friends). A BinaryPool escrows through the module and has no operator gate."*
- `BinaryPool.placeBinaryOrder` pulls collateral from `msg.sender` directly. There is no `placeBinaryOrderFor` exposed in the SDK.
- The only EIP-712 signed primitive in the SDK is `signRedeemAuth` / `redeemFor`, which is for post-settlement redemption only.

### 3. Somnia protocol-level delegation primitives (live on testnet)

Somnia's **Ingot hard fork (activated 15 Apr 2026)** added three protocol-level capabilities. From the official Somnia release notes (`somnia-c1a0de06c6bcdae-release`):

- **Reactivity** — contracts subscribe to event logs and run handler code in the same block.
- **Session transactions** — users can pre-authorize a sequence of transactions and an agent can submit them within that envelope.
- **EIP-7702** — an EOA can temporarily execute smart contract code by signing an authorization tuple that designates an implementation.
- The **June 3 2026 hotfix** (`somnia-f03d9d276649877-release`) added *"Session transaction cancellation and timeout"* (#1685), which is the maturity fix for sessions.

These are **real, on-chain, verifiable**. They are **not yet exposed as a high-level helper by `@somnia-chain/markets-sdk@0.28.1`**. CLASH cannot use them as black-box helpers today, but it can:

- read on-chain evidence that the user has signed a session authorization or an EIP-7702 authorization
- surface that evidence as "authorization verified on Somnia"
- leave the actual session / EIP-7702 envelope construction to the **external agent's own implementation**, which is outside this repository

### 4. CLASH does not invent protocol capabilities

The marketplace's three "Use Agent" paths use the protocol as it actually exists. They are:

| Path | Protocol mechanism | On-chain verification | Revoke path |
|---|---|---|---|
| Spot operator grant | `setOperatorApprovalForPool` via the user's wallet | `isOperatorAuthorized(pool, owner, operator)` | User re-signs with `approved: false` |
| Session transaction / EIP-7702 | The external agent's own implementation; CLASH only verifies the on-chain receipt | Scan for an `Authorization` event (EIP-7702 type `0x4`) or a session envelope stored at a known address; both are real on Somnia today | Per the agent's implementation; CLASH displays the live state it reads |
| Self-run | No on-chain authorization; the user funds their own wallet and runs the agent's open-source code themselves | N/A — the user is the operator | N/A — the user stops running the agent |

CLASH does not synthesize a delegation scheme the protocol does not have. If during implementation we discover that any of these paths requires a capability the protocol does not expose, we stop and report the gap before writing the corresponding code.

## External-agent integration boundary

```
External Trading Agent
        ↓
   CLASH API
        ↓
      CLASH
```

### Agent authentication

Every external agent authenticates with a per-agent API key:

- Generated by CLASH at registration time (or rotated later by the developer).
- Returned to the developer **once** at creation; only a hash is stored in CLASH's database.
- Submitted by the agent as `Authorization: Bearer <key>` on the agent-scoped endpoints.
- Scoped to one agent. The key is not a wallet signature and the agent is not a person; CLASH does not put agents behind wallet auth.

### Agent-to-CLASH endpoints (proposed, see API spec below)

- `POST /api/agents/:id/activity` — discovery hint. Body is `{ txHash, orderId?, marketId? }`. CLASH verifies on-chain before recording.
- `GET /api/agents/:id` — read the agent's own profile, performance, and trade history.
- `POST /api/agents/:id/api-keys/rotate` — rotate the agent's API key.

### CLASH-to-chain verification (always authoritative)

- CLASH reads `getOrders`, `getMarketResolution`, `getBinaryPositionPnL`, and `getPortfolio` from the SDK using only the **registered trading wallet** as a query key. CLASH does not sign to read.
- For spot operator grants, CLASH reads `isOperatorAuthorized` from the SDK.
- For session transactions and EIP-7702, CLASH reads the relevant chain state (e.g. an EIP-7702 designation is observable in the account's `eth_getCode` returning code that starts with `0xef0100` followed by the implementation address).
- The blockchain is the source of truth. The agent's API hints are never trusted on their own.

## Data model

```
developers            (one row per developer wallet that has registered at least one agent)
   id, wallet_address, display_name?, created_at

agents
   id, name, description, builder, owner_wallet, trading_wallet,
   integration_url, strategy_summary?,
   markets (JSON), windows (JSON),
   delegation_methods (JSON: which of "spot_operator" | "session_tx" | "self_run" the agent supports),
   delegation_metadata (JSON: spot pool address, session contract, etc., per method),
   status (active | paused | retired),
   created_at

agent_api_keys         (one row per active key per agent)
   id, agent_id, key_hash (sha256), label, created_at, last_used_at, revoked_at

trades                 (one row per verified on-chain fill)
   id, agent_id, market, direction, result, pnl,
   tx_hash UNIQUE, market_id, pool, filled_at, source, created_at
```

`developer ≠ owner ≠ user`. The developer is the wallet that registered the agent. The user is any person who later browses the marketplace and chooses an agent. CLASH tracks users only by their connected wallet during a session; no account table, no PII.

## Folder layout

```
clash/
├── package.json
├── tsconfig.*.json
├── vite.config.ts
├── .env.example
├── README.md
├── prd.md
├── architecture.md          (this file)
├── project-plan.md
├── handoff.md
├── memory.md
├── agent-integration.md
├── data/                    (SQLite database file, .gitignored)
├── scripts/
│   └── clash-diagnostics.ts (read-only network + market check, no signer)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── domain.ts            (Agent, Trade, Market, Window, AgentPerformance, rankAgents)
│   ├── domain.test.ts
│   ├── store.tsx            (frontend store: agents, trades, rankings, activity)
│   ├── store-context.ts
│   ├── chains.ts            (Somnia testnet definition)
│   ├── config.ts
│   ├── wagmi.ts             (Wagmi config)
│   ├── Web3Provider.tsx
│   ├── WalletControl.tsx
│   ├── useWallet.ts
│   ├── pages/
│   │   ├── Home.tsx
│   │   ├── Explore.tsx
│   │   ├── AgentProfile.tsx
│   │   ├── Rankings.tsx
│   │   ├── Activity.tsx
│   │   ├── UseAgent.tsx
│   │   ├── DeveloperDashboard.tsx
│   │   └── RegisterAgent.tsx
│   ├── components/          (AgentCard, TradeRow, MetricTile, VerificationBadge, etc.)
│   └── server/
│       ├── index.ts
│       ├── app.ts
│       ├── repository.ts
│       ├── dreamdex.ts      (read-only SDK adapter)
│       ├── authorization.ts (spot operator grant read paths)
│       ├── session-tx.ts    (EIP-7702 / session tx verification reads)
│       ├── sync.ts          (background sync worker)
│       └── app.test.ts
```

## Phase order

1. Phase 1–3 (inspection, plan, clarifications) — done.
2. Phase 4 (clean / restructure): delete arena code, the order-preview script, `DREAMDEX_PRIVATE_KEY`, and any reference to a CLASH-owned trading wallet.
3. Phase 5 (wipe database, migrate the two test agents out into a handoff file).
4. Phase 6 (developer registration).
5. Phase 7 (external-agent integration boundary, API key auth).
6. Phase 8 (Somnia / DreamDEX verification, including spot grant verification and EIP-7702 read paths).
7. Phase 9 (marketplace / explore).
8. Phase 10 (agent profiles).
9. Phase 11 (activity and rankings).
10. Phase 12 (developer dashboard).
11. Phase 13 (Use Agent flow with three honest paths).
12. Phase 14 (responsive polish).
13. Phase 15 (end-to-end test against the live testnet).

## Stop conditions

If, during any phase, we discover that a path requires a protocol capability that does not exist, we stop and report the gap. We do not invent a sham path that pretends to authorize a user. The "Use Agent" page is honest about what is and is not delegated.
