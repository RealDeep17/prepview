# Connector Evidence

Last reviewed: 2026-04-02

## Hyperliquid

Official docs:

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Perpetuals API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)

Recorded fixtures used in repo:

- [src-tauri/src/fixtures/hyperliquid_clearinghouse_state.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/hyperliquid_clearinghouse_state.json)
- [src-tauri/src/fixtures/hyperliquid_all_mids.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/hyperliquid_all_mids.json)
- [src-tauri/src/fixtures/hyperliquid_predicted_fundings.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/hyperliquid_predicted_fundings.json)
- [src-tauri/src/fixtures/hyperliquid_meta_and_asset_ctxs_live.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/hyperliquid_meta_and_asset_ctxs_live.json)

Current coverage:

- address validation
- account snapshot sync
- open position normalization
- funding-rate fetch
- mark-price polling subscription
- market catalog and quote lookup for manual capture

## BloFin

Official docs:

- [BloFin API docs](https://docs.blofin.com/index.html)

Recorded/local fixtures used in repo:

- [src-tauri/src/fixtures/blofin_balance_doc.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/blofin_balance_doc.json)
- [src-tauri/src/fixtures/blofin_positions_doc.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/blofin_positions_doc.json)
- [src-tauri/src/fixtures/blofin_funding_rate_live.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/blofin_funding_rate_live.json)
- [src-tauri/src/fixtures/blofin_instruments_live.json](/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini/src-tauri/src/fixtures/blofin_instruments_live.json)

Current coverage:

- signed request construction from official auth docs
- futures balance parsing
- open position parsing
- funding-rate fetch
- mark-price polling subscription
- market catalog and selected-market quote lookup for manual capture

## Notes

- Hyperliquid fixtures are recorded from real public responses.
- BloFin public market fixtures are recorded from real public responses.
- BloFin private balance/position fixtures are currently based on official documentation examples because no live read-only account credentials were available in this workspace.
- The fixture JSON files are test-only parser/contract inputs. They are not loaded into production runtime state unless Rust tests are running.
