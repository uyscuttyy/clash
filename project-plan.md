# CLASH Project Plan

## Phases (in order)
1. **Inspect** the existing repository. **Complete.**
2. **Report** what to keep, modify, and delete. **Complete.**
3. **Clarify** product boundaries, delegation mechanisms, and the relationship to the separate trading-agent repository. **Complete.**
4. **Restructure** — delete arena code, the order-preview script, the CLASH-owned signer config; rewrite the documentation, the home copy, the navigation, the data model, the API surface, and the front-end. **In progress.**
5. **Wipe the database** and migrate the two existing test agents to the separate trading-agent repository. Record the move in `handoff.md`.
6. **Developer registration** — connect-wallet flow, agent metadata form, API key generation, registration confirmation.
7. **External-agent integration boundary** — API key auth middleware, `POST /api/external/agents/:id/activity` for transaction hints, key rotation, key revocation.
8. **Somnia / DreamDEX verification** — read-only SDK adapter, on-chain trade verification, background sync worker that re-indexes each registered agent on an interval, spot operator grant verification, EIP-7702 read paths.
9. **Marketplace / Explore** — agent cards with verified performance, filter by market, sort by metric, no-wallet browsing.
10. **Agent profiles** — identity, verified performance, trade history, "Use Agent" CTA, developer / verified badges.
11. **Activity and rankings** — chronological feed of verified trades, sortable leaderboard.
12. **Developer dashboard** — manage registered agents, view activity hints, rotate API keys, pause / resume an agent.
13. **Use Agent flow** — connect wallet, determine the right authorization path for the chosen agent, present the matching UX (spot grant, session tx, self-run), verify the authorization on-chain, show a revoke path where supported.
14. **Responsive polish** — mobile layouts for the entire flow, including the Use Agent flow.
15. **End-to-end test** — register a developer, register an agent, simulate a verified trade (or use the existing test agent from the separate repo), confirm the marketplace renders it, walk the Use Agent flow.

## Stop conditions
- If, during Phase 8 or 13, a Use Agent path requires a protocol capability the Somnia / DreamDEX stack does not actually expose, we stop and report the gap. We do not invent a sham path.
- If the external-agent integration boundary cannot be designed without CLASH trusting agent-submitted data, we stop and report the gap.
- If background sync cannot re-derive trades deterministically from the chain, we stop and report the gap.

## Constraints
- No CLASH-owned trading wallet, no CLASH private key, no CLASH strategy.
- The Somnia / DreamDEX SDK is the only on-chain integration path. No ad-hoc RPC calls for trading.
- Verified only — no fabricated activity, no fake settlement, no invented PnL.
- Testnet only for the MVP. Mainnet is a future plan.
