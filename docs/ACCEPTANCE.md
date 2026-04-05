# Acceptance

## Foundation

- The app boots as a Tauri desktop application.
- The frontend reads portfolio state through typed Tauri commands.
- The encrypted local database opens and persists state across restarts.
- Manual accounts and manual positions persist correctly.
- CSV import accepts valid rows and rejects malformed rows safely.

## Product

- Portfolio metrics derive from stored account and position state, not placeholders.
- Accounts on the same exchange remain isolated in calculations.
- Exposure, history, journal, and closed-trade views derive from persisted records.
- Manual and imported BloFin or Hyperliquid positions resolve official market metadata when available.
- Exchange-aware manual/import positions reject invalid quantity or leverage values against cached rules.
- Margin, maintenance, and liquidation values for supported exchange-backed manual/import positions derive from stored exchange metadata or explicit user input.
- Sync jobs record attempts, success/failure state, and recent history without erasing the last good state.

## LAN and security

- LAN projection is read-only.
- LAN projection binds to `127.0.0.1` by default.
- LAN projection only exposes to the local network after explicit user action.
- LAN projection requires a user-set bearer passphrase before remote access is allowed.
- Startup does not require OS keychain or OS login prompts.

## Release blockers

- Any known Sev1 or Sev2 defect
- Any failing `npm run lint` or `npm run check`
- Any shipped placeholder KPI or fake metric
- Any missing release artifact for a promised desktop OS/CPU target
- Any version mismatch between `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`, and the release tag
- Public docs that materially disagree with shipped behavior
