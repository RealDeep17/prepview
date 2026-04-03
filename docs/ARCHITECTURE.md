# Architecture

## Stack

- Desktop shell: Tauri v2
- Core runtime: Rust
- Frontend: React + TypeScript + Vite
- Local persistence: SQLCipher-backed SQLite
- Secret storage: app-local files with strict filesystem permissions
- Local LAN projection: Axum + WebSocket

## Source of truth

Rust owns domain state, persistence, imports, metrics, and LAN APIs.
The frontend is a query-and-command client over typed Tauri commands.
Persisted `balance_events` are the source for account and portfolio equity-history rendering.
Persisted `position_events` are the source for position lifecycle and trade-journal rendering.
Persisted `market_quotes` cache the latest exchange mark/funding view used to reprice eligible
non-live BloFin and Hyperliquid positions between full sync cycles.
Persisted `exchange_markets` cache official BloFin and Hyperliquid contract catalogs so
manual and CSV-imported exchange-backed positions can resolve canonical `exchange_symbol`,
display `symbol`, contract value, and latest known mark context from stored market metadata
instead of free-text-only user input.
Persisted `exchange_risk_tiers` cache official BloFin position-tier responses and Hyperliquid
margin-table tiers so manual and imported exchange-backed positions can derive maintenance margin
and liquidation estimates from exchange-backed risk bands instead of placeholder math.
For supported exchange-backed manual and CSV-imported positions, quantity and leverage must be
validated against cached official market rules when those rules are available.
Manual and CSV-imported positions are expected to persist the same core position-shape fields the
live path persists, including margin mode, margin used, liquidation price, maintenance margin,
realized PnL, fees, and funding when that data is known.
For supported BloFin and Hyperliquid manual/import positions, the backend owns contract-aware
margin math and account-scoped liquidation recomputation. Engine-owned liquidation values must be
recalculated when the position changes, when sibling cross positions change, when account balance
changes, or when persisted market quotes reprice the position.
Sync freshness and degraded-state derivation are part of the Rust bootstrap/domain response so
LAN consumers and future UI layers can rely on the same backend-owned health model.
Journal queries must be filterable by account, exchange, symbol, event kind, and time window
without rebuilding history from current open positions.

## Primary modules

- `src-tauri/src/domain.rs`
  Core types for accounts, positions, metrics, sync status, and LAN status
- `src-tauri/src/store.rs`
  Encrypted SQLite storage, migrations, CRUD, persisted history derivation, exchange market caching,
  and position journal recording
- `src-tauri/src/csv_import.rs`
  CSV parsing and normalization for portfolio positions
- `src-tauri/src/metrics.rs`
  Exposure, heat, summary, and performance derivations
- `src-tauri/src/lan.rs`
  Read-only LAN server and auth token lifecycle
- `src-tauri/src/commands.rs`
  Tauri command surface used by the React app

## Integration boundary

Live exchange sync is implemented behind a connector contract. The UI must never know
exchange-specific payload shapes.

`get_exchange_markets` must persist official catalog payloads and may fall back to cached
catalogs when live refresh fails, rather than returning an empty surface for supported exchanges.

Required connector behaviors:

- `validate_credentials`
- `fetch_account_snapshot`
- `fetch_open_positions`
- `fetch_balance_history`
- `fetch_funding_rates`
- `subscribe_mark_prices`
- `normalize_symbol`

## Security model

- API credentials are stored in app-local secret files only
- Secret storage must not require OS login or keychain prompts during normal app use
- The portfolio database is encrypted at rest
- LAN projection exposes derived read-only data only
- LAN mode is opt-in, disabled by default, and loopback-only unless remote exposure is explicitly enabled
