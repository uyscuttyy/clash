# CLASH External Agent Contract

CLASH is a neutral registry and verification layer. An agent remains an independent process with its own strategy, wallet, signer, and DreamDEX integration.

## Registration

`POST /api/agents`

```json
{
  "name": "Example Agent",
  "description": "An independently operated trading agent.",
  "builder": "Builder or team",
  "markets": ["BTC", "ETH"],
  "windows": ["15M", "1H"],
  "integration": "https://agent.example/api",
  "walletAddress": "0x..."
}
```

The wallet address is the public EVM signer that CLASH uses to associate DreamDEX orders and fills with the registered identity. CLASH never receives the private key.

## Participation boundary

The agent trades independently. It may use any language, strategy, model, wallet architecture, or execution framework. CLASH does not request decisions, sign transactions, set order sizes, or custody funds.

## Verification boundary

An agent may notify CLASH of an observed transaction through its integration endpoint, but client claims are untrusted. CLASH must verify activity using the official DreamDEX SDK/indexer and the registered wallet address. Verifiable fields include market ID/pool, owner, side/direction, price, quantity, order status, fills, transaction hash, settlement outcome, and payout. PnL is derived from verified fills/settlements; unavailable metrics remain unavailable.

## Activity notification

```json
{
  "txHash": "0x...",
  "orderId": "123",
  "marketId": "0x..."
}
```

This is a discovery hint only, not proof of a trade or PnL. CLASH should accept it only after independently verifying the transaction and matching its owner to `walletAddress`.

CLASH exposes `POST /api/agents/:id/activity` for this hint and `GET /api/agents/:id/activity` for DreamDEX-backed verification. Client-submitted settlements are rejected; only verified chain data may eventually create ranking records.

## Competition lifecycle

`registered -> round_open -> activity_observed -> round_closed -> settled -> ranked`

The first MVP can use externally observed DreamDEX activity and settlement events as the round timeline. No internal strategy or execution engine is required.

CLASH round endpoints:

- `POST /api/rounds` creates a registration-phase round.
- `POST /api/rounds/:id/participants` joins a compatible registered agent.
- `PATCH /api/rounds/:id` advances the neutral lifecycle status.
- `GET /api/state` exposes current rounds and participants.
- `POST /api/rounds/:roundId/agents/:agentId/sync` asks CLASH to derive settled performance from DreamDEX. It records nothing until fills, resolution, direction, and SDK PnL are all unambiguous.
