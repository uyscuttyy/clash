# CLASH Memory

## Decisions
- The marketplace product surface is wallet-free for browsing. Only the "Use Agent" flow needs a wallet connection.
- CLASH is not a trader. The CLASH server holds no private keys, signs no transactions, and runs no strategy.
- The Somnia / DreamDEX SDK is the only on-chain integration path. CLASH imports `@somnia-chain/markets-sdk` for read-only verification and for the spot operator grant write path. Spot order placement happens from the user's wallet through the SDK's `walletClient`-based `createTrader`, never from a CLASH-owned key.
- The "Use Agent" flow has three honest paths, each grounded in a real Somnia / DreamDEX capability:
  1. **Spot operator grant** — `setOperatorApprovalForPool` from the user's wallet; verified by `isOperatorAuthorized`.
  2. **Session transaction / EIP-7702** — for agents that publish their own session implementation; CLASH only verifies the on-chain authorization.
  3. **Self-run** — the user funds their own wallet and runs the agent's open-source code. CLASH never asks for a private key or seed phrase.
- External agents authenticate with per-agent API keys, never with wallet signatures. Wallet signatures are reserved for users and developers (the people holding wallets).
- The background sync worker re-indexes every registered agent's verified trades on an interval (default: 5 minutes) so the marketplace stays current without a profile visit triggering sync.

## Somnia / DreamDEX findings (2026-09)
- **Somnia Ingot hard fork** (`somnia-c1a0de06c6bcdae-release`, activated 15 Apr 2026) introduced:
  - **Reactivity** — on-chain event subscriptions.
  - **Session transactions** — user pre-authorizes a sequence of transactions.
  - **EIP-7702** — an EOA can temporarily act as a smart contract via an authorization tuple.
  - **Agentic L1** — branding only; the protocol is "for agents and applications."
- The **June 3 hotfix** (`somnia-f03d9d276649877-release`) added *Session transaction cancellation and timeout* (#1685), the maturity fix for sessions.
- These primitives are **real on Somnia Shannon testnet** and are **not yet exposed as a high-level helper by `@somnia-chain/markets-sdk@0.28.1`**.
- Binary event contracts have **no operator-grant primitive in the SDK** today. The only delegation primitive that works against binary markets today is the user's own EOA signing the order. Spot markets have `setOperatorApprovalForPool` / `setOperatorApprovalGlobal`.
- The SDK's EIP-712 signed primitive is `signRedeemAuth` / `redeemFor`, which is for post-settlement redemption only.

## Constraints
- Network access may be intermittent. Do not infer interfaces or present unavailable integration as live.
- Never commit secrets. `DREAMDEX_PRIVATE_KEY` is not in this repository and must not be reintroduced.
- No CLASH-owned agent code. The separate trading-agent repository owns strategy, signer, and trading logic.
- Testnet only for the MVP. Mainnet is a future plan.
