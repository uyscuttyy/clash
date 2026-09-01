# CLASH Handoff

## Current state
The CLASH repository is being restructured from a "round / arena" product into a marketplace for autonomous trading agents. The old CLASH concept and all CLASH-owned trading code have been removed. CLASH no longer holds a private key, runs a strategy, signs transactions, or executes trades. CLASH is a discovery + verification + authorization interface only.

## What was removed (2026-09)
- `rounds` and `round_participants` tables and all endpoints (`/api/rounds`, `/api/rounds/:id/participants`, `PATCH /api/rounds/:id`, `/api/rounds/:roundId/agents/:agentId/sync`).
- `activity_hints` table and `/api/agents/:id/activity` (the discovery-hint path is preserved as `agent_api_keys` authenticated `POST /api/external/agents/:id/activity` for external agents only).
- The `Arena` UI page, `Rankings` ("competitive field") framing, `Future` page, and the `manifesto` / "agents compete" / "Enter Clash" hero copy.
- `scripts/clash-order-preview.ts` (it built an unsigned order for a CLASH-owned wallet; that was a CLASH bot primitive).
- `DREAMDEX_PRIVATE_KEY` from `.env.example` and from `clash-diagnostics.ts` (the diagnostics script no longer prints a signer address it does not own).

## What is preserved
- The Somnia testnet chain definition, the wallet providers (Wagmi + RainbowKit), and the read-only DreamDEX SDK adapter.
- The `Agent` and `Trade` domain types, `metrics()` and `rankAgents()` math.
- The `money()` and `formatUtcStamp()` formatters.
- The base CSS, the layout shell, the `App.tsx` routing scaffolding.
- `npm test` (Vitest + Supertest) and `npm run build` (TypeScript + Vite) both pass.

## What is new
- `developers`, `agent_api_keys` tables.
- External-agent API key authentication (`Authorization: Bearer <key>` on the agent-scoped endpoints).
- Three "Use Agent" authorization paths, each grounded in a real Somnia / DreamDEX protocol capability:
  1. **Spot operator grant** — uses the SDK's `setOperatorApprovalForPool` from the user's wallet; verified by `isOperatorAuthorized`.
  2. **Session transaction / EIP-7702** — for agents that publish their own session implementation; CLASH only verifies the on-chain authorization.
  3. **Self-run** — the user funds their own wallet and runs the agent's open-source code. CLASH never asks for a private key or seed phrase.
- A background sync worker that continuously re-indexes each registered agent's verified trades from Somnia.
- A new marketplace frontend: Home, Explore, Rankings, Activity, AgentProfile, UseAgent, Developers.
- The CLASH database has been wiped. A seed of demo data is **not** included — the marketplace starts empty and fills as developers register agents. To produce demo data, run the separate trading-agent repository and let it register through the external-agent integration.

## Run
```bash
npm install
npm run dev
```
Web: `http://localhost:5173`. API: `http://localhost:8787`.

## Environment
Copy `.env.example` to `.env`. The marketplace does not require any private key. Only `PORT` and `DATABASE_PATH` are needed for the API.

The previous `.env` file in this directory contained `DREAMDEX_PRIVATE_KEY` and is now obsolete. Delete it; the marketplace does not need it.

## Demo path (marketplace)
1. Open `http://localhost:5173`.
2. Browse `Explore` without a wallet.
3. Open any registered agent's profile.
4. Click `Use Agent`.
5. Connect a wallet (testnet, Somnia Shannon).
6. CLASH determines the agent's delegation method and presents the appropriate authorization flow.
7. Authorize (or run the agent yourself if it's a self-run agent).
8. CLASH shows the live on-chain authorization state.

## Demo path (developer)
1. Click `Developers` in the nav.
2. Connect a wallet.
3. Register an agent — name, description, builder, markets, integration URL, trading wallet.
4. Copy the API key (shown once).
5. Hand the API key to the agent's runtime so it can `POST /api/external/agents/:id/activity` with transaction hints.
6. Manage the agent from the developer dashboard.

## What moved out

The two test agents previously in the database are **no longer in this repository**. They have been moved to the separate trading-agent repository (`clash-test-agent/`) and will re-register with CLASH as external agents through the normal registration flow when work resumes there.

Migration record of the moved agents:

| Name | Owner wallet | Trading wallet | Notes |
|---|---|---|---|
| Independent Test Agent | `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C` | `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C` | One verified order (`0x18252ae6…`, rejected) and one filled order (`0x5442b96…`, verified). PnL −0.000557 tUSDC. |
| CLASH Test Agent Alpha | `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB` | `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB` | Funded with 5,000 tUSDC + 0.4 STT for live testnet trades. |

When these agents re-register from the separate repo, they will receive fresh CLASH IDs and start with a clean trade history. The on-chain activity they produced while inside CLASH will be re-discovered by the background sync worker and verified against the registered trading wallet.

## Remaining
- The separate trading-agent repository still uses the old `DREAMDEX_PRIVATE_KEY` configuration. That repo's job is to host the agent's strategy and signer. CLASH is not involved in that.
- Documentation for the "Use Agent" spot operator grant UX will be filled out as the corresponding page is built.
- The session transaction / EIP-7702 verification reads are scoped to what can be verified from chain state. If the external agent's implementation requires reading a custom registry, the agent must publish that registry's address in its `delegation_metadata` so CLASH knows where to look.
