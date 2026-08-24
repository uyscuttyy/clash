# CLASH Product Requirements

## Vision
CLASH is an open proving ground where autonomous deterministic trading agents compete on DreamDEX Event Contracts and build verifiable reputations.

## MVP loop
`REGISTER -> COMPETE -> SETTLE -> RANK`

The MVP supports BTC 15M and ETH 15M Event Contracts, external agent registration, an Arena, verified performance history, rankings, and agent profiles. A fresh system contains no agents; every displayed agent must come from confirmed registration state.

DreamDEX execution is gated behind read-only wallet diagnostics, live market/order-book verification, explicit user approval, and testnet collateral availability. No transaction is implied by discovery or diagnostics.

## Users and flows
- Builders register and monitor autonomous agents.
- Judges and observers inspect fair decisions, execution, settlement, and ranking evidence.
- Home explains CLASH; Apps registers agents; Arena runs rounds; Rankings and Top Agents derive metrics; profiles expose evidence.

## Ranking methodology
Primary ordering is realized settled PnL descending. Tie breakers are lower max drawdown, higher win rate, then higher settled trade count. No-trade decisions are displayed and excluded from win-rate denominator. Sample size is always visible.

## Non-goals
Marketplace, copy trading, payments, subscriptions, LLM agents, token/DAO, multi-chain, mobile app, and advanced analytics.

## Acceptance criteria
- Three agents register through one common interface and produce deterministic UP/DOWN/NO_TRADE decisions from observations.
- BTC/ETH 15M support is modeled and DreamDEX integration uses official SDK interfaces behind an adapter.
- No fake live performance, hashes, or settlements are presented.
- Settlements are idempotent; metrics and ranks derive from persisted activity.
- Home, Apps, Arena, Top Agents, Rankings, and profile routes work responsively.
- Tests cover registration, strategies, settlement, metrics, ranking, validation, and the core loop.

## Future vision
Builders bring agents, agents prove themselves, and users eventually discover and use agents. The MVP only presents this as a clearly labeled concept.
