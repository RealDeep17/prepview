# PrepView

PrepView is a local-first desktop portfolio app for derivatives traders who want trustworthy review surfaces for live, manual, and imported books without drifting into terminal or execution scope.

![PrepView logo](./prepview.svg)

## What It Does

- Tracks derivatives portfolios locally across BloFin, Hyperliquid, CSV imports, and manual books
- Keeps portfolio, exposure, history, journal, and sync health in one dense desktop workspace
- Uses read-only exchange integrations only
- Ships optional read-only LAN projection for local dashboards and mirrors

## Product Boundary

- Portfolio only
- Read-only exchange integrations only
- No order routing, execution, automation, or backtesting
- No fake KPIs, placeholder analytics, or speculative AI features

## Security Posture

- Local-first application data flow
- Encrypted local database
- App-local secret files with restrictive filesystem permissions
- No OS keychain prompt or OS login prompt required during normal startup
- LAN projection disabled by default, loopback-only by default, and protected by a user-set bearer passphrase

## First Public Release Scope

PrepView is being prepared for desktop release only:

- macOS `x64` and `arm64`
- Windows `x64` and `arm64`
- Linux `x64` and `arm64`

iPhone, iPad, and Android are not in scope for the first public release.

## Getting Started

```bash
npm install
npm run tauri:dev
```

## Verification

```bash
npm run lint
npm run check
```

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Acceptance](docs/ACCEPTANCE.md)
- [Connector evidence](docs/CONNECTOR_EVIDENCE.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Archive

The public archive surface is intentionally reduced to a minimal placeholder at [`.archive/`](.archive/README.md). Historical planning and scratch material were removed during release cleanup.
