# Product Doctrine

## Cassini in one sentence

Cassini is a fully local desktop portfolio application for multi-account derivatives
traders who need trustworthy read-only exchange sync, exact portfolio math, and a
premium review surface without cloud dependency.

## What Cassini is

- A local-first Tauri desktop product
- A portfolio engine for balances, positions, exposure, heat, and performance
- A review surface for imported or synced account state
- A read-only integration layer for exchange account state and market data
- A product that treats sync freshness and degraded connector state as first-class portfolio review data
- A secure personal tool with optional read-only LAN projection

## What Cassini is not

- Not a trading terminal
- Not an execution engine
- Not a social or collaborative product
- Not a hosted SaaS in v0.01
- Not an AI-led workflow product

## Quality bar

- Trustworthy before broad
- Exact before flashy
- Premium before generic
- Tested before shipped
- Manual mode must not be a crippled fallback; when live APIs are not in use, manual and import workflows must still represent portfolio state with live-grade fidelity

## Local security posture

- Secrets stay on the machine and never leave the local app boundary
- No OS-keychain dependency or OS login/password prompt is required to use the product
- Secret files must remain app-local with strict filesystem permissions
- The portfolio database stays encrypted at rest
- LAN projection is loopback-only by default and becomes LAN-visible only by explicit opt-in

## v0.01 must-haves

- Manual accounts and manual positions
- Manual accounts and manual positions must carry the core live-state fields needed for real portfolio review, including margin mode, margin used, liquidation, maintenance margin, fees, funding, and realized PnL when known
- Supported BloFin and Hyperliquid manual/import positions must derive margin and liquidation from official exchange market specs and official risk tiers when the user does not provide explicit values
- Exchange-backed manual/import sizing must respect exchange-native contract semantics, including BloFin contract value multipliers instead of assuming every venue uses `price * qty`
- CSV import for unsupported exchanges and historical workflows
- BloFin live read-only sync
- Hyperliquid live read-only sync
- Account-isolated portfolio math
- Snapshot history
- Exposure, heat, and performance views
- Optional read-only LAN projection
