# Connector Evidence

Last reviewed: 2026-04-04

## Hyperliquid

Official docs:

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Perpetuals API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)

Fixtures in repo:

- [`hyperliquid_clearinghouse_state.json`](../src-tauri/src/fixtures/hyperliquid_clearinghouse_state.json)
- [`hyperliquid_all_mids.json`](../src-tauri/src/fixtures/hyperliquid_all_mids.json)
- [`hyperliquid_predicted_fundings.json`](../src-tauri/src/fixtures/hyperliquid_predicted_fundings.json)
- [`hyperliquid_meta_and_asset_ctxs_live.json`](../src-tauri/src/fixtures/hyperliquid_meta_and_asset_ctxs_live.json)

Covered behavior:

- address validation
- account snapshot sync
- open position normalization
- market catalog parsing
- quote lookup and funding-rate fetch
- HIP-3 market normalization and risk-tier fallback behavior

## BloFin

Official docs:

- [BloFin API documentation](https://docs.blofin.com/index.html)

Fixtures in repo:

- [`blofin_balance_doc.json`](../src-tauri/src/fixtures/blofin_balance_doc.json)
- [`blofin_positions_doc.json`](../src-tauri/src/fixtures/blofin_positions_doc.json)
- [`blofin_funding_rate_live.json`](../src-tauri/src/fixtures/blofin_funding_rate_live.json)
- [`blofin_instruments_live.json`](../src-tauri/src/fixtures/blofin_instruments_live.json)

Covered behavior:

- signed request construction from official auth documentation
- futures balance parsing
- open position parsing
- funding-rate fetch
- market catalog parsing and quote lookup for manual capture

## Notes

- Hyperliquid fixtures are captured from real public responses.
- BloFin public market fixtures are captured from real public responses.
- BloFin private balance and position fixtures are currently documentation-based examples, not captured private-account responses.
- Fixtures are test inputs only and are not loaded into production state except through code paths under test.
