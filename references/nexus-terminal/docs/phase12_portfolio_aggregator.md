# Phase 12: Portfolio Aggregator — Teralyn v2.0

> 18 new files · ~6,950 LOC · Sub-phases: §12a Services, §12b Stores, §12c Components Batch 1, §12d Components Batch 2, §12e Alert Extension + Layout Wiring

### ⚠️ NON-NEGOTIABLE RULES (ALL APPLY)

1. **ORGANIC COMPLEXITY, NOT FILLER**: LOC estimates are a floor signal — if you're significantly under, you're likely missing edge cases, liq math branches, CSV parsing guards, or architectural depth. Never pad code. Every line must earn its place.
2. **NEVER use placeholders**. Every form field, empty state, error boundary, loader, modal, action must be fully functional and beautifully designed.
3. **Extreme modularity**: services in `src/services/portfolio/`, stores in `src/store/`, components in `src/components/portfolio/`. Nothing clustered.
4. **Float64Array** for all PnL rolling computations, equity curve tracking, and liq calculations. No native `[]` in computational loops.
5. **Graceful NaN propagation**: CSV fields WILL be missing, malformed, or partially filled. All parsing must cleanly handle without silent errors or division panics.
6. **DAG memoization**: shared sub-calculations (e.g. margin used across positions in same account) must be memoized in a shared `PortfolioComputeContext` and re-used — not recalculated per field.
7. **Sync this spec** to `docs/phase12_portfolio_aggregator.md`.
8. **Record exact LOC per file** in `task.md`.
9. **Rewrite whole file** — never partial updates.

---

## Vision

A unified **Portfolio Aggregator** panel inside Teralyn for tracking and managing futures and spot positions across **multiple named accounts** (same exchange can appear twice — e.g. `blofin_1`, `blofin_2`). Each account is fully isolated with its own balance, margin pool, and liquidation math. Positions are entered via **CSV import** (agent-generated from exchange screenshots) or **manual form**. The app is **read-only from exchanges** — it fetches live mark prices and funding rates only, never places orders.

---

## Position Types

| Type | Leverage | Margin | Liq Price | Funding Fee | PnL Formula |
|------|:--------:|:------:|:---------:|:-----------:|-------------|
| **Futures** | ✅ | ✅ | ✅ | ✅ | `(markPrice − entryPrice) × size × direction` |
| **Spot** | ❌ | ❌ | ❌ | ❌ | `(markPrice − entryPrice) × size` |

**Auto-detection rule:** leverage blank or `1` AND no margin fields → **spot**. Otherwise → **futures**.

---

## Two Ways to Add Positions

### 1. CSV Import (primary — agent-generated from screenshots)

```csv
# Required always
account_name, symbol, side, size, entry_price

# Required for futures only
leverage, wallet_balance

# Optional — calculated by app if blank
margin, margin_balance, liq_price, margin_type, tp_price, sl_price

# Examples:
blofin_1, BTCUSDT, long, 0.1, 95000, 10, 4000
blofin_2, ETHUSDT, short, 1.5, 3200, 20, 3000, , , , cross, 3000, 3400
blofin_1, SOLUSDT, long, 10, 180
```

- `exchange` is **never** a column — auto-resolved from ticker via `ExchangeRegistry.js`. Binance Spot as fallback.
- Each import saved as a **timestamped snapshot** to `DatabaseService.js` (IndexedDB).
- CSV parsing must be **NaN-safe**. Missing optional fields default to `null` (calculated on demand).

### 2. Manual Entry Form (identical schema, form-based)

- Same fields as CSV with identical optional/required rules
- Position type toggle: **Futures / Spot**
- Account selector: choose existing account or create new inline
- TP/SL optional — settable here or edited later on any position at any time

---

## Position Lifecycle (account-scoped)

> **Core rule:** `blofin_1` and `blofin_2` are 100% independent even if same exchange. Every mutation to any position or balance triggers **full liq recalculation** for all open positions in that account only.

### Scale Into Position
- **Input:** additional size + price
- **Recalculate:** `averageEntry = (existingSize × existingEntry + newSize × newPrice) / totalSize`
- **Recalculate:** total size, margin, liq
- **Recalculate:** all sibling positions in same account

### Partial Close
- **Input:** size to close
- **Recalculate** remaining position
- **Log** partial realized PnL to `useJournalStore`
- **Recalculate** all siblings (freed margin)

### Full Close
- Mark position **closed**
- Compute final realized PnL, net PnL (after fees), duration
- **Log** to `useJournalStore` with full trade record
- **Recalculate** all remaining siblings (freed margin)

### Add / Remove Funds
- **Input:** amount + reason (`deposit` | `withdrawal` | `transfer`)
- Updates `wallet_balance` for that account
- Logs to `accountBalanceHistory`
- Triggers **full account liq recalculation**

---

## Computation Engine

All calculations performed in `LiqCalculator.js`, `FeeEngine.js`, and `RiskEngine.js`. **Never computed inline** in components or stores.

```
margin               = (size × entry_price) / leverage
margin_balance       = wallet_balance + sum(unrealizedPnL of all positions)
available_margin(p)  = wallet_balance − sum(margin of all OTHER open positions in account)
liq_price (long)     = entry_price × (1 − (available_margin(p) / (size × entry_price)))
liq_price (short)    = entry_price × (1 + (available_margin(p) / (size × entry_price)))
unrealizedPnL        = (markPrice − entry_price) × size × direction  [futures]
                     = (markPrice − entry_price) × size               [spot]
trading_fee          = size × entry_price × BloFin maker/taker rate
funding_fee          = fetched from BloFinAdapter.js → GET /api/v1/market/funding-rate-history
net_pnl              = unrealizedPnL − trading_fee − funding_fee
ROE %                = unrealizedPnL / margin × 100
margin_usage %       = sum(all margins in account) / wallet_balance × 100
risk_per_trade %     = abs(entry_price − sl_price) × size / wallet_balance × 100
portfolio_heat(X%)   = sum(unrealizedPnL at price × (1 + X/100)) across all open positions
```

- All rolling arrays use **Float64Array** (equity curve, PnL series, balance history)
- Shared sub-calculations injected via **PortfolioComputeContext** DAG — margin sums, mark prices, funding rates never re-fetched per field
- Mark prices resolved via `ExchangeRegistry.js` → correct adapter per ticker → Binance Spot fallback

---

# §12a: Portfolio Services (5 files, ~1,850 LOC)

## 1. `src/services/portfolio/PortfolioComputeContext.js` (~300 LOC)

```js
class PortfolioComputeContext {
  constructor()
  // Memoization DAG for a single compute pass across all accounts
  // Caches: markPrices, fundingRates, marginSums, pnlValues
  
  getOrCompute(key, computeFn): any
  // Checks internal cache. If miss, runs computeFn and stores result.
  
  register(key, value): void
  // Manually inject a pre-computed value into the DAG
  
  invalidateAccount(accountName): void
  // Clears all cached values scoped to a specific account
  
  getMarkPrice(symbol): number
  // Fetches from ExchangeRegistry → live adapter tick, cached per pass
  
  getFundingRate(symbol): number
  // Fetches from BloFinAdapter.js, cached per pass
  
  reset(): void
  // Full DAG flush for new computation cycle
}
```

## 2. `src/services/portfolio/LiqCalculator.js` (~400 LOC)

```js
export function computeMargin(size, entryPrice, leverage): number
export function computeAvailableMargin(walletBalance, accountPositions, excludePositionId): number
export function computeLiqPrice(side, entryPrice, availableMargin, size): number
export function computeUnrealizedPnL(side, entryPrice, markPrice, size, type): number
export function computeMarginBalance(walletBalance, positions, markPrices): number
export function computeMarginUsage(positions, walletBalance): number

export function recomputeAccountLiquidations(account, ctx: PortfolioComputeContext): void
// Full account-scoped recalculation using Float64Array for position arrays
// Iterates all open positions, recalculates each liq price considering freed/consumed margin

export function computeAvgEntry(existingSize, existingEntry, newSize, newPrice): number
// Weighted average for scale-in operations
```

## 3. `src/services/portfolio/FeeEngine.js` (~350 LOC)

```js
const FEE_SCHEDULES = {
  blofin: { maker: 0.0002, taker: 0.0006 },
  binance_futures: { maker: 0.0002, taker: 0.0004 },
  bybit: { maker: 0.0001, taker: 0.0006 },
  mexc: { maker: 0.0000, taker: 0.0003 },
  hyperliquid: { maker: -0.0002, taker: 0.0005 }
};

export function computeTradingFee(size, entryPrice, exchange, isMaker): number
export function computeFundingFee(symbol, size, ctx: PortfolioComputeContext): Promise<number>
export function computeNetPnL(unrealizedPnL, tradingFee, fundingFee): number
export function computeROE(unrealizedPnL, margin): number
export function computeFeeSchedule(exchange): { maker, taker }
export function aggregateFeeDrag(closedTrades): { totalTrading, totalFunding, net }
// Float64Array rolling sum for performance charts
```

## 4. `src/services/portfolio/RiskEngine.js` (~450 LOC)

```js
export function computeRiskPerTrade(entryPrice, slPrice, size, walletBalance): number
export function computePortfolioHeat(positions, markPrices, movePct, ctx): number
// "If market moves X%" scenario computation across all positions

export function computeSymbolExposure(allAccounts): Map<symbol, ExposureRecord>
// Cross-account aggregation: total long size, total short size, net exposure per symbol

export function computeAccountRiskProfile(account, ctx): RiskProfile
// { marginUsage, largestPosition, avgLeverage, maxDrawdownEstimate, heatAt5Pct, heatAt10Pct }

export function computeEquityCurve(balanceHistory): Float64Array
// Rolling equity from balance history entries using Float64Array

export function computeDrawdownSeries(equityCurve: Float64Array): Float64Array
// Peak-to-trough drawdown at each point

export function computePerformanceMetrics(closedTrades): PerformanceStats
// { winRate, avgRR, bestTrade, worstTrade, profitFactor, avgHoldTime, sharpeRatio }
```

## 5. `src/services/portfolio/CSVImporter.js` (~350 LOC)

```js
export function parseCSV(csvString): ParseResult
// NaN-safe line-by-line parsing, field trimming, type coercion
// Returns { positions: Position[], errors: ParseError[], warnings: string[] }

export function validatePosition(raw): { valid: boolean, position: Position | null, errors: string[] }
// Required field check, numeric range validation, side validation ('long'|'short')

export function detectPositionType(raw): 'futures' | 'spot'
// Auto-detection: leverage blank or 1 AND no margin fields → spot

export function resolveExchange(symbol): string
// ExchangeRegistry.js lookup → Binance Spot fallback

export function createSnapshot(positions, source): Snapshot
// Timestamped snapshot object for IndexedDB persistence

export function exportPositionsCSV(positions): string
// Reverse: Position[] → CSV string for clipboard/file export
```

---

# §12b: Portfolio Store (1 new file, 1 extended)

## 6. `src/store/usePortfolioStore.js` (~600 LOC)

```js
// State shape:
{
  accounts: Map<accountName, {
    name, notes, walletBalance,
    positions: Map<posId, Position>,
    balanceHistory: Array<{ time, amount, reason, balance }>,
    createdAt
  }>,
  snapshots: Array<{ id, timestamp, accounts, source: 'csv'|'manual' }>,
  settings: { liquidationAlertThreshold: 0.10 }
}

// Actions:
importCSV(csvString): snapshotId
addPosition(accountName, config): posId
scalePosition(posId, additionalSize, price): void
partialClose(posId, size): TradeRecord
fullClose(posId): TradeRecord
updateTPSL(posId, tp, sl): void
adjustFunds(accountName, amount, reason): void
updateAccountNotes(accountName, notes): void
deletePosition(posId): void
deleteAccount(accountName): void
getSnapshotById(id): Snapshot
recomputeAccount(accountName): void
```

Persisted via `DatabaseService.js` (IndexedDB). Zustand pattern matching Phase 1h/1i/1j.

## 7. `src/store/useJournalStore.js` (EXTEND — rewrite whole file)

- Add portfolio closed trades logging
- CSV export of trade journal
- Performance stats (win rate, avg RR, profit factor)
- Filterable by account / symbol / side / date / tags

---

# §12c: Portfolio Components Batch 1 (6 files, ~2,300 LOC)

## 8. `src/components/portfolio/PortfolioPanel.jsx` (~350 LOC)
Main panel shell with tabs: **Dashboard**, **Positions**, **Exposure**, **Heat**, **Performance**, **Journal**

## 9. `src/components/portfolio/PortfolioDashboard.jsx` (~500 LOC)
Top-level equity, total net PnL, total fee drag, per-account summary cards

## 10. `src/components/portfolio/AccountCard.jsx` (~300 LOC)
Per-account widget: name, notes badge, wallet balance, margin balance, floating PnL, open count, balance delta

## 11. `src/components/portfolio/PositionTable.jsx` (~500 LOC)
Full sortable table: account, symbol, type, side, leverage, size, entry, mark, uPnL, netPnL, margin, liq, margin ratio, ROE, risk%, TP/SL (inline editable). Live mark price via existing WS adapters.

## 12. `src/components/portfolio/AddPositionModal.jsx` (~400 LOC)
Manual entry form. Futures/Spot toggle. Account selector with inline create. Optional fields collapsible. Full validation.

## 13. `src/components/portfolio/ScalePositionModal.jsx` (~350 LOC)
Add to / partial close modal. Shows recalculated avg entry and new liq preview before confirm.

---

# §12d: Portfolio Components Batch 2 (7 files, ~2,200 LOC)

## 14. `src/components/portfolio/CSVImportModal.jsx` (~400 LOC)
Drag-and-drop CSV upload, parse preview table, validation errors highlighted, confirm import.

## 15. `src/components/portfolio/FundTransferModal.jsx` (~250 LOC)
Add/remove funds per account. Amount + reason. Shows new balance preview + balance history log.

## 16. `src/components/portfolio/ExposurePanel.jsx` (~300 LOC)
Cross-account symbol aggregation. Per symbol: total size, direction breakdown, per-account drill-down. Visibility only.

## 17. `src/components/portfolio/PortfolioHeatPanel.jsx` (~350 LOC)
"If market moves X%" scenario. Slider input. Per-account PnL impact + total capital impact %.

## 18. `src/components/portfolio/PerformancePanel.jsx` (~450 LOC)
Win rate, avg RR, best/worst trade, realized PnL over time, fee drag over time. Derived from `useJournalStore`.

## 19. `src/components/portfolio/AccountNotesModal.jsx` (~200 LOC)
Per-account name + notes editor.

## 20. `src/components/portfolio/SnapshotHistoryPanel.jsx` (~250 LOC)
Timeline of CSV imports. Click to view that snapshot's positions.

---

# §12e: Alert Extension + Layout Wiring (4 files extended)

## Alert Integration (Phase 6 AlertEngine.js)

Extend `AlertEvaluator.js` with three new condition types:

```js
static _evalPortfolioTP(params, ctx): result
// triggered when markPrice >= tpPrice (long) or <= tpPrice (short)

static _evalPortfolioSL(params, ctx): result
// triggered when markPrice <= slPrice (long) or >= slPrice (short)

static _evalPortfolioLiqProximity(params, ctx): result
// triggered when abs(markPrice − liqPrice) / liqPrice <= thresholdPercent
```

- All fire through `AlertEngine.evaluateAll()` → `AlertNotifier.notify()` → toast + browser + audio
- Liq proximity threshold configurable per account (default 10%)
- **No orders placed** — alert only

## Layout Wiring

- `src/components/layout/RightSidebar.jsx` — register **Portfolio** as new tab
- `src/components/layout/WorkspaceLayout.jsx` — add **"Portfolio"** workspace preset

---

# Integration with Existing Architecture

| What | How |
|------|-----|
| **Mark prices** | `ExchangeRegistry.getAdapter(ticker)` → existing adapters' live tick via `WebSocketManager.js`. Binance Spot fallback. |
| **Funding rates** | `BloFinAdapter.js` → `GET /api/v1/market/funding-rate-history` (Phase 1e) |
| **Persistence** | `DatabaseService.js` (Dexie/IndexedDB) — no new DB setup |
| **Alert wiring** | Extend `AlertEvaluator.js` + `useAlertStore.js` — no new alert infrastructure |
| **Panel registration** | New tab in `RightSidebar.jsx` + new "Portfolio" preset in `WorkspaceLayout.jsx` |
| **Performance data** | Feeds from `useJournalStore.js` into `PerformancePanel.jsx` — same pattern as `PaperPortfolioDashboard.jsx` |
| **No new WS infrastructure** | Subscribes to existing mark price streams already running for chart/watchlist |
