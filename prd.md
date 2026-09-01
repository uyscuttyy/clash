# CLASH Product Requirements

## Vision
CLASH is the marketplace for autonomous trading agents on Somnia / DreamDEX. Developers register agents, agents trade on-chain in their own wallets, CLASH verifies the on-chain activity, and users discover, compare, and authorize agents whose performance is anchored to real trades on a real network.

## What CLASH is
- A discovery surface where users browse trading agents without connecting a wallet.
- A verification layer that reads every trade from the Somnia / DreamDEX indexer.
- A performance / reputation engine that derives PnL, win rate, drawdown, and trade count from verified fills.
- A developer portal where builders register agents, manage metadata, and rotate API keys.
- An authorization interface where users grant a chosen agent permission to trade on their behalf, using only protocol capabilities Somnia / DreamDEX actually exposes.

## What CLASH is not
- A trading bot or strategy engine.
- A custodial wallet or signer.
- A copy-trading router.
- A platform that takes custody of user funds.
- A marketplace for investment promises.
- A tournament, league, or competition.

## Core product loop
```
Developer builds agent (separate repo)
        ↓
Developer registers agent with CLASH
        ↓
Agent trades on Somnia / DreamDEX
        ↓
CLASH indexes and verifies on-chain activity
        ↓
Verified performance record builds over time
        ↓
User discovers the agent on CLASH
        ↓
User inspects verified performance
        ↓
User clicks "Use Agent"
        ↓
User connects wallet
        ↓
CLASH picks the right authorization path for the agent:
    - spot operator grant (real, SDK-supported)
    - session transaction / EIP-7702 (real on Somnia, agent-supplied)
    - self-run (always available, no authorization needed)
        ↓
User authorizes (or runs the agent themselves)
        ↓
Agent becomes available to trade for the user
```

## "Use Agent" authorization paths

The marketplace's "Use Agent" button is honest about what each agent can support. CLASH inspects the agent's `delegation_methods` field at registration time and presents one of three paths:

### Path 1 — Spot operator grant
For agents that trade on a DreamDEX spot pool and have published a pool address.
- User signs `setOperatorApprovalForPool` with their own wallet.
- CLASH verifies the grant is live via `isOperatorAuthorized`.
- User can revoke at any time by re-signing with `approved: false`.
- Real, SDK-supported, on-chain verifiable today.

### Path 2 — Session transaction / EIP-7702
For agents that publish a session-implementation contract or an EIP-7702 implementation contract.
- The agent's runtime instructs the user's wallet to sign the appropriate authorization.
- CLASH only verifies the on-chain receipt of the authorization.
- Revocation is per the agent's implementation; CLASH displays the live state.
- Real on Somnia (post-Ingot hard fork), but the agent supplies the implementation.

### Path 3 — Self-run
For agents that have not yet published a delegation primitive, or that explicitly opt out.
- CLASH shows the agent's integration URL and the user runs the agent themselves.
- The user funds their own wallet and runs the agent's open-source code.
- CLASH never asks for a private key or seed phrase.
- The agent's verified trade history is still discoverable on CLASH.

CLASH never claims an agent is authorized for a user unless the authorization can be verified on-chain.

## Ranking
Ranking is for discovery, not for competition. The primary ordering is verified realized PnL descending. Tie breakers are lower max drawdown, higher win rate, and higher settled trade count. Sample size is always visible. CLASH does not turn rankings into a tournament or a competitive leaderboard.

## Acceptance criteria
- Developers can register an agent with a connected wallet.
- Each agent has a public profile showing only verified on-chain data.
- The Explore page lists agents without requiring a wallet.
- The Use Agent page presents the right authorization path for the chosen agent.
- The background sync worker continuously updates verified trades.
- The Activity page shows a chronological feed of recent verified trades.
- Tests cover registration, ranking, verification, the three Use Agent paths, and the API key auth.
- No fake or invented data is ever shown.
- `DREAMDEX_PRIVATE_KEY` is not in the codebase.

## Non-goals
- Building or shipping any agent strategy or signer in this repository.
- Custody of user funds.
- Generic crypto dashboard framing, marketing-style growth metrics, or copy-trading UX.
- Cross-chain support (Somnia only for the MVP).
- Onboarding users without a wallet (browsing is wallet-free; only the Use Agent flow needs a wallet).

## Future vision
- A user-funded "follow this agent" position (the user holds tUSDC; the agent trades with that tUSDC via the spot operator grant or a session envelope; CLASH shows the user's position PnL alongside the agent's own).
- Spot-market agent leaderboards scoped to a window (30-day, 90-day) so users can see recent form.
- Developer reputation scores, derived from how many of their registered agents have meaningful verified trade history.
