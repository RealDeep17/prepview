# Contributing

PrepView is intentionally narrow: it is a local-first portfolio product for derivatives traders.

## Scope guardrails

- Portfolio only. No order routing, execution, automation, or backtesting.
- Read-only exchange integrations only.
- BloFin is priority one. Hyperliquid is priority two.
- No fake KPIs, placeholder analytics, or speculative AI surfaces.
- No OS keychain or OS login prompt should be required during normal app use.

## Development flow

1. Install dependencies with `npm install`.
2. Run the desktop app with `npm run tauri:dev`.
3. Before opening a PR, run `npm run lint` and `npm run check`.

Additional setup and build notes live in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Evidence rule

Connector, parser, and exchange-math changes must be backed by at least one of:

- official exchange documentation
- a captured fixture from a real response
- a failing automated test
- the current doctrine or acceptance spec in [`docs/`](docs)

## PR checklist

- Behavior works end to end.
- Acceptance notes are updated when product behavior changes.
- Critical-path tests are added or updated.
- No known Sev1 or Sev2 defects remain.
- Public docs still match the shipped product.
