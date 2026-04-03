# Teralyn

Teralyn is a React + Vite trading terminal focused on charting, scanning, backtesting, and portfolio workflows.

This v2.1 branch introduces a production-minded security boundary:
- AI extraction runs through backend APIs.
- Signed trading operations are routed through a backend execution gateway.
- Frontend no longer stores long-lived exchange secrets for signed calls.
- Backtest optimization now runs through the backend as well.

## Tech Stack
- Frontend: React 18, Vite, Zustand
- Charts: Lightweight Charts
- Backend (v2.1 gateway): Node HTTP server (`server/index.js`)

## Local Setup

### 1) Install dependencies
```bash
npm install
```

### 2) Start backend gateway
```bash
npm run backend:dev
```

### 3) Start frontend
```bash
npm run dev
```

Frontend defaults to proxying `/api` requests to `http://localhost:8787` (configurable via `NEXUS_BACKEND_URL`).

## Environment Contracts

### Frontend
- `NEXUS_BACKEND_URL` (optional): Vite dev proxy target for `/api`.
- `VITE_API_BASE_URL` (optional): absolute API base URL for non-proxy deployments.
- `VITE_BACKEND_TOKEN` (optional): bearer token used by the backend gateway client when auth is enabled.

### Backend
- `PORT` (default: `8787`)
- `AI_PROVIDER` (default: `gemini`)
- `GEMINI_API_KEY` (required for `/api/ai/positions/extract`)
- `TRADING_GATEWAY_ENABLED` (`true` enables trading execution routes)
- `NEXUS_ADMIN_TOKEN` (optional: enables auth/session requirement for protected trading + credential routes)
- `CREDENTIAL_VAULT_KEY` (recommended: encryption key for persisted credential vault)
- `RATE_LIMIT_WINDOW_MS` (optional)
- `RATE_LIMIT_MAX_REQUESTS` (optional)
- `NEXUS_DATA_DIR` (optional: backend runtime state directory, defaults to `server-data/`)

## API Surface (v2.1)
- `GET /health`
- `POST /api/auth/session`
- `POST /api/ai/positions/extract`
- `GET /api/trading/orders`
- `POST /api/trading/orders`
- `DELETE /api/trading/orders/:id`
- `POST /api/trading/orders/cancel-all`
- `POST /api/exchange/credentials`
- `POST /api/backtest/run` (backend runner implemented; server-side historical loading wired for current exchange adapters, with submitted-candle fallback)
- `POST /api/backtest/optimize` (implemented for `grid`, `genetic`, `montecarlo`, and `walkforward`)

Verified on `2026-03-19` with live exchange responses:
- `POST /api/backtest/run` returned `executedBy=server` and `candleSource=server` for `binance-futures`, `binance-spot`, `bybit`, `hyperliquid`, `blofin`, and `mexc`
- `POST /api/backtest/optimize` returned `executedBy=server` and `candleSource=server` for a live `binance-futures` grid-search check
- Protected trading routes were live-verified with auth enabled:
  - unauthenticated order placement returned `401`
  - `POST /api/auth/session` returned a session token
  - authenticated place/list/cancel flow succeeded against the stateful paper execution gateway

## Architecture Boundaries
- Frontend:
  - UI, charting, scanner, and local backtest orchestration.
  - Calls backend for AI extraction and order execution gateway.
  - Can store a backend session token via `createBackendSession()` or `VITE_BACKEND_TOKEN` when auth is enabled.
  - Includes in-app backend session controls under Settings → Backend and a top-bar backend status badge.
- Backend:
  - Holds provider secrets.
  - Provides execution/API boundary for signed operations.
  - Persists encrypted credentials to local disk and maintains audit logs + in-memory rate limiting.
  - Currently uses a stateful paper execution gateway, not a real live exchange execution worker.

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:e2e:smoke
```

Or run all tests:

```bash
npm test
```

## Release Checklist (Baseline)
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run security:scan` passes
- [ ] No frontend hardcoded API keys or exchange secrets
- [ ] All signed trading paths route through backend gateway
- [ ] Set `CREDENTIAL_VAULT_KEY` in non-dev environments
- [ ] Replace the paper execution gateway with a real exchange execution worker before production trading
