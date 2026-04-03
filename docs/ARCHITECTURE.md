# Architecture

## Stack

- Desktop shell: Tauri v2
- Frontend: React 19 + TypeScript + Vite
- Core runtime: Rust
- Local persistence: SQLCipher-backed SQLite
- LAN projection: Axum + WebSocket

## Source of truth

Rust owns domain state, persistence, exchange normalization, risk math, sync health, and LAN APIs.
The React app is a typed command/query client over the Tauri bridge.

Persisted records are the source for shipped portfolio views:

- `accounts` and `positions` drive the current portfolio surface.
- `balance_events` drive portfolio and per-account history.
- `position_events` drive the journal and lifecycle history.
- `closed_trades` drive the closed-trade ledger.
- `exchange_markets`, `exchange_risk_tiers`, and `market_quotes` back exchange-aware manual/import workflows.

## Runtime layout

- [`src-tauri/src/domain.rs`](../src-tauri/src/domain.rs): shared domain types and runtime status models
- [`src-tauri/src/store.rs`](../src-tauri/src/store.rs): encrypted persistence, migrations, CRUD, and historical queries
- [`src-tauri/src/connectors.rs`](../src-tauri/src/connectors.rs): exchange connector implementations and normalization
- [`src-tauri/src/risk_engine.rs`](../src-tauri/src/risk_engine.rs): exchange-backed risk and liquidation math
- [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs): typed Tauri command surface
- [`src-tauri/src/lan.rs`](../src-tauri/src/lan.rs): read-only LAN projection server
- [`src/store/appStore.ts`](../src/store/appStore.ts): frontend state shell
- [`src/`](../src): dense review UI for positions, history, journal, sync health, and detail rails

## Product boundaries

- Portfolio only
- Read-only exchange integrations only
- No trade execution or strategy automation
- No placeholder analytics or speculative AI workflows

## Security boundaries

- Credentials stay in app-local secret files with restrictive permissions.
- The encrypted local database is the durable store.
- LAN projection exposes derived read-only portfolio data only.
- LAN projection is opt-in and requires a user-managed bearer passphrase.
