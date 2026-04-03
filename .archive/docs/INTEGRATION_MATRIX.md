# Integration Matrix

## v0.01 live integrations

| Exchange | Status | Scope | Notes |
| --- | --- | --- | --- |
| BloFin | Backend live sync wired | Live read-only | Signed request path, parser tests, persisted market catalog cache, public position-tier cache, funding/mark polling, contract-aware local margin/liquidation engine for non-live positions, plus market-backed normalization and quantity/leverage validation; real-account QA still pending |
| Hyperliquid | Backend live sync wired | Live read-only | Address validation, snapshot sync, positions, persisted market catalog cache, public margin-table tier cache, funding, mark polling, local margin/liquidation engine for non-live positions, plus market-backed normalization and quantity/leverage validation |

## v0.01 non-live workflows

| Source | Status | Scope | Notes |
| --- | --- | --- | --- |
| Manual entry | Active | Full local | First-class workflow |
| CSV import | Active | Full local | Required for unsupported exchanges |
| AI screenshot import | Deferred | None | Out of scope until proven |

## Connector evidence requirements

- Endpoint docs must be linked in code comments or fixture docs
- Response fixtures must be stored locally before parser hardening
- Missing-field behavior must be covered by tests
