# Cassini

Cassini is a fully local desktop portfolio product for serious derivatives traders.
It is built as a Tauri v2 application with a Rust core, a React + TypeScript frontend,
encrypted local storage, app-local secret handling with strict file permissions, and an
optional read-only LAN projection layer.

## Product boundary

- Portfolio only
- Read-only exchange integrations
- BloFin and Hyperliquid are the mandatory live connectors for v0.01
- CSV and manual workflows are first-class, not fallback-only
- AI screenshot import is intentionally out of scope until the core product is proven

## Getting started

```bash
npm install
npm run tauri:dev
```

For frontend-only tests:

```bash
npm run test
```

For the full local verification pass:

```bash
npm run check
```

## Reference snapshots

The `references/` directory contains the reference material that implementation work is
allowed to use:

- `references/nexus-terminal/` for the legacy in-house portfolio code and spec snapshot
- `references/crypto-pnl-tracker-ref/` for the closest open-source tracker baseline
- `docs/OSS_EVALUATION.md` for the bounded salvage decision and external product/repo review
- `docs/CONNECTOR_EVIDENCE.md` for official API sources and local fixture provenance

No implementation work should drift back into `../src` or any other part of the original
`Nexus-Terminal` repo.
