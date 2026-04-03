# Frontend Plan

## Objective

Replace the current shell with a denser, futures-inspired workspace that keeps account isolation intact while allowing cross-exchange portfolio review at a glance.

## Target Workspace Model

### 1. Desk Header

- Product identity
- Active scope
- Sync actions
- Layered action launchers
- Compact live state strip

### 2. Left Scope Rail

- Exchange groups
- Per-account rows
- Aggregate and subset selection
- Workspace bookmarks and pulse stats

### 3. Center Workbench

- Top monitor surface:
  - grouped positions
  - equity/history context
  - exposure ladder
  - risk or funding strip
- Bottom ledger:
  - positions
  - exposure
  - funding
  - sync
  - history

### 4. Right Ops Rail

- Scoped inspector
- Margin and balance context
- Sync and funding activity
- LAN controls
- Meaningful settings entry

### 5. Layered Capture Flows

- Add account overlay
- Manual position overlay with steps
- CSV import drawer
- Settings drawer with real workspace controls

## Immediate Implementation Scope

This pass should deliver:
- A more terminal-like workstation shell
- Reduced card feel
- Stronger central data focus
- A more structured add-position overlay
- More meaningful settings controls
- Cleaner grouping and filtering behavior

This pass will not fake:
- live symbol search for manual mode
- exchange-backed mark updates for manual mode
- liquidation and maintenance margin math for manual positions

Those remain next-phase domain tasks and must be wired to backend evidence.

## Next Domain/UI Follow-Up After Shell Rebuild

1. Add exchange market metadata commands for BloFin and Hyperliquid.
2. Add searchable symbol picker in manual capture.
3. Add live mark lookup or subscription for manual positions that reference supported exchanges.
4. Add margin mode, initial margin, maintenance margin, and liquidation surfaces.
5. Add position detail drawer with funding, fee drag, and per-account risk context.

## Acceptance For This Pass

- No giant empty hero area remains in the main workspace.
- Add position uses a layered flow instead of a flat always-open form.
- Scope selection feels primary and propagates through the desk.
- The desk looks and behaves more like a workstation than a dashboard.
- No fake metrics or invented charts are introduced.
