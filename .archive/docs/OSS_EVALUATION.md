# OSS Evaluation

Last reviewed: 2026-04-02

## Goal

Decide whether Cassini should:

- fork an existing repo,
- salvage narrow pieces from an existing repo, or
- continue as a fresh build.

The bar is strict. A candidate only clears for forking if it satisfies roughly 80% of the
must-haves for Cassini:

- fully local or self-hosted first
- strong multi-account portfolio handling
- futures/perps relevance
- read-only exchange model
- BloFin + Hyperliquid path
- no trading-terminal drift
- architecture that will not fight the Tauri/Rust doctrine

## Candidates

### 1. Crypto-PNL-Tracker

Source:

- [drksheer/Crypto-PNL-Tracker](https://github.com/drksheer/Crypto-PNL-Tracker)

Evidence:

- The repo describes itself as a tracker that works with Binance, Bybit, or user-owned data.
- It supports multiple accounts through repeated account config blocks.
- It runs a local web server and is oriented around imported data rather than a desktop shell.

Match to Cassini:

- Good:
  - narrow scope
  - account-tracking mindset
  - useful import/config ideas
- Bad:
  - no BloFin support in evidence reviewed
  - no Hyperliquid support in evidence reviewed
  - not a Rust/Tauri desktop architecture
  - not a premium product-grade base we can safely fork as-is

Decision:

- Keep as a narrow reference only.
- Do not fork.

### 2. Wealthfolio

Source:

- [afadil/wealthfolio](https://github.com/afadil/wealthfolio)

Evidence:

- The project describes itself as a local-data, no-cloud desktop investment tracker.
- The repo uses Rust, TypeScript, and Tauri.
- The repo is licensed AGPL-3.0.
- The feature set is broad investment tracking with addons, activities, and multi-asset workflows.

Match to Cassini:

- Good:
  - strong local-first desktop architecture
  - Tauri + Rust alignment
  - useful reference for packaging and local data patterns
- Bad:
  - not futures-first
  - not BloFin + Hyperliquid-first
  - broader wealth-management scope than Cassini
  - AGPL means direct code merge is a deliberate licensing decision, not a casual borrow

Decision:

- Use as architecture inspiration only if needed.
- Do not fork.
- Do not merge code unless we explicitly choose an AGPL-compatible direction later.

### 3. rotki

Source:

- [rotki/rotki](https://github.com/rotki/rotki)

Evidence:

- rotki presents itself as a privacy-focused self-hosted portfolio manager with local encrypted data.
- It is AGPL-3.0 licensed.
- Its scope includes portfolio tracking, analytics, accounting, and broader crypto financial management.

Match to Cassini:

- Good:
  - serious local-first privacy posture
  - mature open-source product
- Bad:
  - much broader than Cassini
  - different stack and product shape
  - not a narrow futures desk product
  - AGPL again makes direct code merge a deliberate licensing choice

Decision:

- Useful as a product-quality benchmark.
- Not a realistic fork base for Cassini.

### 4. Cryptofolio

Source:

- [Xtrendence/Cryptofolio](https://github.com/Xtrendence/Cryptofolio)

Evidence:

- Cryptofolio is an open-source portfolio app with self-hosted API support.
- It includes read-only portfolio sharing.
- The project itself notes the server-side validation is not especially hardened because it is intended for one user.

Match to Cassini:

- Good:
  - local/self-hosted mindset
  - read-only share concept overlaps with Cassini LAN projection
- Bad:
  - general holdings portfolio app, not futures-first
  - older product shape
  - weaker fit for a trust-heavy derivatives review tool

Decision:

- Read-only sharing idea is worth noting.
- Not a fork candidate.

### 5. CoinTracking

Source:

- [CoinTracking homepage](https://www.cointracking.info/)
- [CoinTracking imports page](https://cointracking.info/imports/)
- [CoinTracking BloFin import](https://cointracking.info/import/blofin_api/)
- [CoinTracking Hyperliquid import](https://cointracking.info/import/hyperliquid/)

Evidence:

- CoinTracking supports more than 300 exchanges and wallets.
- The public imports list includes both BloFin and Hyperliquid.
- BloFin has an API-based import page.
- Hyperliquid appears to be supported through CSV export/import in the evidence reviewed.

Match to Cassini:

- Good:
  - excellent coverage benchmark for exchange/import breadth
  - useful reference for import UX and trade-type coverage
- Bad:
  - closed-source hosted product, not salvageable code
  - portfolio/tax focus, not a local futures desk application
  - Hyperliquid support in reviewed evidence is import-oriented, not the live desktop sync Cassini needs

Decision:

- Benchmark only.
- No code reuse path.

### 6. Altrady

Source:

- [How to Connect Your Hyperliquid Exchange Account | Altrady](https://support.altrady.com/en/article/how-to-connect-your-hyperliquid-exchange-account-dquav0/)
- [Trading Futures with Altrady](https://support.altrady.com/en/article/trading-futures-with-altrady-b6m6ci/)

Evidence:

- Altrady supports Hyperliquid connectivity through API keys.
- Their docs explicitly describe Spot/Futures toggles and adding another Hyperliquid account with a new API key.
- The product is a multi-exchange trading platform, not a portfolio-only local desktop tool.

Match to Cassini:

- Good:
  - validates demand for multi-account Hyperliquid workflows
  - useful UX benchmark for account-connect flows
- Bad:
  - trading terminal scope
  - not local-first
  - not an OSS codebase to merge
  - no BloFin evidence reviewed here

Decision:

- UX and workflow benchmark only.

## Conclusion

No reviewed repo or product clears the fork threshold for Cassini.

This is an inference from the evidence above:

- I did not find a product that is simultaneously:
  - local-first desktop,
  - futures/perps first,
  - read-only,
  - multi-account on the same exchange,
  - BloFin-capable,
  - Hyperliquid-capable,
  - and narrow enough to avoid dragging in unrelated product scope.

## Working decision

- Build Cassini as a fresh repo.
- Keep `references/crypto-pnl-tracker-ref/` as the closest narrow salvage reference.
- Keep the legacy in-house snapshot under `references/nexus-terminal/` for product intent and domain specifics.
- Use external products only as benchmarks for:
  - import coverage,
  - connect-account UX,
  - local-first security posture,
  - and product polish.

## Revisit triggers

Re-run this evaluation only if one of these changes:

- a strong OSS project adds BloFin + Hyperliquid portfolio support
- a license-compatible Rust/Tauri local tracker appears
- Cassini scope changes away from portfolio-only
