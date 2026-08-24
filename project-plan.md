# CLASH Project Plan

## Phases
1. Foundation: repository, stack, docs, environment, design tokens, routes. **Complete**
2. Website: responsive product pages and shared state. **Complete**
3. Agent system: external-agent identity registry and backend registration. **Complete**
4. DreamDEX: official SDK adapter, wallet diagnostics, network verification, collateral acquisition, and faucet verification complete; order submission remains pending explicit market/amount/direction approval.
5. Performance: SQLite persistence, metrics, drawdown, ranking, and idempotent verified-settlement boundary complete; authoritative PnL derivation pending settlement evidence.
6. Arena: external activity verification boundary and truthful lifecycle status implemented; settlement/PnL timeline pending settlement mapping.
7. Polish: responsive/accessibility/loading/error/empty states.
8. Testing: domain and API test coverage added; API listener tests require local socket permissions; testnet verification pending.
9. Demo preparation: clean state and reliable demo sequence.
10. Final documentation and handoff.

## Completed
- Empty repository initialized on `main`.
- Vite React TypeScript scaffold and dependencies installed, including `@somnia-chain/markets-sdk`.
- Initial living documentation created.

## Current work
- Full-stack runtime verification and Arena round lifecycle.

## Constraints
- Until valid current DreamDEX testnet configuration is verified, integration reports unavailable and never implies live execution.
- Read-only diagnostics: `npm run diagnostics` (requires local `.env`; never prints the private key).
