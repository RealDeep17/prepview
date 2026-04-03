# Development

## Prerequisites

- Node.js 20+
- Rust stable toolchain
- Platform prerequisites for Tauri desktop development

## Local development

```bash
npm install
npm run tauri:dev
```

Notes:

- The Vite dev server is pinned to port `1420` with `--strictPort` so Tauri never points at the wrong frontend origin.
- Desktop development is the only supported mode for the first public release.

## Verification

```bash
npm run lint
npm run check
```

`npm run check` runs frontend tests, a production web build, and the Rust test suite.

## Desktop release targets

PrepView is currently prepared for desktop-only releases on:

- macOS `x64` and `arm64`
- Windows `x64` and `arm64`
- Linux `x64` and `arm64`

The app is not being prepared for iOS or Android in the first public release.

## Packaging

```bash
npm run tauri:build
```

Bundle formats are limited to desktop package types:

- Linux: `AppImage`, `deb`
- macOS: `dmg`
- Windows: `msi`, `nsis`

CPU architecture is determined by the Rust target triple used on the release machine or CI runner.

## Repo layout

- [`src/`](../src): frontend application
- [`src-tauri/`](../src-tauri): Rust core and Tauri shell
- [`docs/`](.): public project docs
- [`.archive/`](../.archive): intentionally non-runtime historical material
