# Acceptance

## Foundation acceptance

- App boots as a Tauri desktop app
- Frontend reads portfolio state through Tauri commands
- Local database is created and opened successfully
- Manual accounts and manual positions persist across restarts
- CSV import stores validated positions and rejects malformed rows safely
- No fake portfolio metrics are rendered

## Product acceptance

- Two accounts on the same exchange remain isolated in calculations
- Exposure aggregates across accounts correctly
- Heat and performance views derive from stored positions, not hardcoded values
- Equity-history views derive from persisted `balance_events`, not frontend-only interpolation
- Position lifecycle and trade-journal views derive from persisted `position_events`, not current open positions alone
- Trade-journal queries support account, exchange, symbol, event-kind, and time-window filtering against persisted `position_events`
- Manual or imported BloFin/Hyperliquid positions with resolvable symbols are repriced from persisted official exchange quotes without mutating live-account positions
- Supported BloFin/Hyperliquid manual and CSV-imported rows resolve to persisted official exchange market identities instead of remaining free-text-only symbols
- Supported BloFin/Hyperliquid manual and CSV-imported rows reject quantity or leverage values that violate persisted official market rules, while CSV imports continue importing valid rows
- Manual and CSV-imported positions can persist live-grade portfolio fields including margin mode, margin used, liquidation price, maintenance margin, fees, funding, and realized PnL when provided
- Supported BloFin/Hyperliquid manual and CSV-imported positions without explicit liquidation inputs derive margin used, maintenance margin, and liquidation estimates from cached official exchange market specs and official risk tiers
- BloFin manual/import sizing uses persisted contract value when deriving notional, margin, and liquidation instead of assuming raw quantity is always base-size quantity
- Cross-margin manual positions recalculate liquidation when sibling positions or account collateral change, and quote refresh recomputes engine-owned maintenance/liquidation fields for repriced non-live positions
- LAN projection returns read-only JSON without secret exposure
- LAN projection binds to `127.0.0.1` by default and only binds to LAN interfaces when remote exposure is explicitly requested
- Restarting the app preserves encrypted local state
- A live sync writes a sync job record, balance event, and funding snapshot when data is available
- Manual add/edit/delete and live sync open/adjust/close all record position journal events
- Retried live sync attempts are visible in the sync log and do not silently disappear
- Syncing all live accounts isolates failures so one broken account does not poison the others

## Release blockers

- Any known Sev1 or Sev2 defect
- Any failing frontend or Rust test
- Any placeholder or hardcoded KPI in a shipped surface
