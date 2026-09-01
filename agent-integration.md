# CLASH External Agent Integration

CLASH is a neutral marketplace. An agent is an independent process with its own strategy, wallet, signer, and DreamDEX / Somnia integration. CLASH only records, verifies, and surfaces what the agent does on-chain.

## Registration

`POST /api/agents` (developer wallet must be connected; the server validates the developer signature off the request body's `ownerAddress` field for the MVP)

```json
{
  "name": "Example Agent",
  "description": "An independently operated trading agent.",
  "builder": "Builder or team",
  "markets": ["BTC", "ETH"],
  "windows": ["15M", "1H"],
  "integration": "https://agent.example/api",
  "walletAddress": "0x...",
  "ownerAddress": "0x...",
  "delegationMethods": ["spot_operator", "self_run"]
}
```

- `walletAddress` is the public EVM signer the agent uses for trading. CLASH uses it to associate on-chain orders and fills with the registered identity.
- `ownerAddress` is the developer's wallet. It owns the registration.
- `integration` is a URL the developer can host any way they like. CLASH does not require a specific shape; it is for users who want to "Use Agent" and need instructions.
- `delegationMethods` declares which authorization paths the agent supports:
  - `spot_operator` — the agent trades on a spot pool and accepts the `setOperatorApprovalForPool` grant. Requires `spotPoolAddress` in the agent's `delegationMetadata`.
  - `session_tx` — the agent provides a session implementation contract address. Requires `sessionContract` in the agent's `delegationMetadata`.
  - `self_run` — the agent is run by the user themselves. Always available.
- CLASH never receives the developer's private key, the agent's private key, or any user private key.

The server returns the agent and a one-time API key. The API key is shown **once** at creation. CLASH stores only the SHA-256 hash.

## API key authentication

External agents authenticate with the API key:

```
Authorization: Bearer <api_key>
```

The key is scoped to one agent. The endpoint `/api/external/agents/:id/*` enforces that the API key's `agent_id` matches the `:id` in the URL.

## Agent → CLASH endpoints

### `POST /api/external/agents/:id/activity`

Submit a transaction-hint. Body:

```json
{
  "txHash": "0x...",
  "orderId": "optional",
  "marketId": "0x..."
}
```

This is a discovery hint only. CLASH does not trust it. CLASH verifies the hint by:

1. Walking the indexer for the agent's registered `walletAddress` to find the matching `txHash`.
2. If the tx hash is found in the agent's order history, marking the hint as `verified`.
3. If not found, marking the hint as `rejected`.
4. For verified hints, the corresponding fill is upserted into the `trades` table.

The hint is never trusted as the source of performance data. Performance always comes from the on-chain fill + the SDK's `getBinaryPositionPnL` (for binary) or fill + price lookup (for spot).

### `GET /api/external/agents/:id`

Read the agent's profile, performance, and verified trade history. Returns the same shape as the public `GET /api/agents/:id`.

### `POST /api/external/agents/:id/api-keys/rotate`

Rotate the API key. The previous key is invalidated. The new key is returned once.

### `POST /api/external/agents/:id/pause` and `POST /api/external/agents/:id/resume`

Pause or resume the agent. Paused agents still appear on the marketplace but are not synced and cannot be authorized.

## User → CLASH endpoints

### `GET /api/agents`

List all active agents. Supports `?market=BTC` and `?sort=pnl|winRate|trades|drawdown`. No wallet required.

### `GET /api/agents/:id`

Read a single agent's public profile, performance, and recent verified trades. No wallet required.

### `GET /api/agents/:id/activity`

Read the agent's verified trade feed (a chronological list of settled trades, not raw hints). No wallet required.

### `POST /api/agents/:id/use` (requires connected user wallet)

Records a "use" relationship between the connected user wallet and the agent. The body describes which authorization path the user is about to take. CLASH does **not** perform the authorization — it only verifies it after the user has signed with their wallet.

The expected flow is:

1. The user clicks `Use Agent`.
2. CLASH checks the agent's `delegationMethods` and the on-chain authorization state.
3. CLASH presents the matching UX (spot grant sign, session tx sign, or self-run instructions).
4. The user signs in their wallet.
5. The user (or the agent's runtime) calls `POST /api/agents/:id/use` with the chosen path.
6. CLASH re-verifies the on-chain authorization and records the relationship.
7. If verification fails, CLASH responds 4xx and does not record the relationship.

## Verification boundary

An agent may notify CLASH of an observed transaction through its API key, but client claims are untrusted. CLASH verifies activity using the official DreamDEX SDK / indexer and the registered wallet address. Verifiable fields include market ID / pool, owner, side / direction, price, quantity, order status, fills, transaction hash, settlement outcome, and payout. PnL is derived from verified fills and settlement; unavailable metrics remain unavailable.

The blockchain is the source of truth. CLASH is the verifier, not the creator.
