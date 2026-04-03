# Frontend Research

Last updated: 2026-04-02

## Goal

Define an evidence-backed frontend direction for Cassini that feels closer to a premium futures workstation than a generic dashboard. This research is focused on interaction grammar, layout systems, density, account grouping, and workflow layering.

## Reference Findings

### TradingView Desktop

Source:
- https://www.tradingview.com/support/solutions/43000671618-what-is-tradingview-desktop/

Observed product patterns:
- TradingView explicitly centers the product around a dedicated analysis space rather than a page-by-page dashboard.
- The desktop app restores ticker, interval, and active watchlist per tab on relaunch.
- Tabs can be linked by color so multiple panes stay synchronized on the same symbol.
- Screeners can be connected to charts.
- The product emphasizes multi-monitor support, synchronized tabs, and customizable layouts.

What Cassini should borrow:
- Persistent workspace memory.
- Linked-scope behavior across panes.
- A layout system that feels like a desk, not a report page.
- Context-preserving relaunch behavior.

### Bybit Futures Trading Page

Sources:
- https://www.bybit.com/en/help-center/article/How-to-navigate-Bybit-perpetual-futures-contract-trading-page
- https://www.bybit.com/en/help-center/article/Calculator-for-Perpetual-and-Futures-Standard-Account

Observed product patterns:
- Bybit organizes the futures page around operational zones: positions, asset details, order zone, calculator, and trading chart.
- The position tab exposes margin mode, leverage, quantity, value, entry price, mark price, liquidation price, initial margin, maintenance margin, and PnL-related values in one dense surface.
- The interface supports both all-contract and per-contract review.
- The calculator is a transient utility attached to the trading workflow instead of a permanent always-open form.
- The calculator uses leverage, quantity, entry, target, and margin logic as first-class inputs.

What Cassini should borrow:
- Dense futures-first field grammar.
- Calculator or capture utilities as layered tools, not full-page forms.
- Position rows that expose margin and liquidation context beside price context.
- Aggregate and scoped viewing without changing the overall desk layout.

### Coinigy Boards and V2

Sources:
- https://insights.coinigy.com/coinigy-enhanced-boards-feature-for-crypto-trading-analysis-and-visualization/
- https://insights.coinigy.com/major-v2-beta-updates/
- https://insights.coinigy.com/coinigy-announces-a-new-feature-packed-release-of-its-market-leading-crypto-trading-platform/

Observed product patterns:
- Coinigy Boards is built around customizable single-screen trading environments assembled from multiple panels.
- Coinigy explicitly supports portfolio balances, charts, aggregated news, and other panels on one board.
- Coinigy stresses multi-monitor display, expanded boards, integrated multi-exchange and multi-market view, and portfolio management.
- V2 moved open orders, order history, and balances into a right sidebar trade tab instead of burying them below the chart.
- V2 also emphasizes precision, theme control, smoother post-order behavior, and responsive layout improvements.

What Cassini should borrow:
- A compositional board model instead of static cards.
- Right-rail utility stacks for scoped details and operations.
- Dense panels with strong visual hierarchy and restrained theming.
- Multi-exchange aggregation without flattening account identity.

### Altrady Multi-Account Management

Sources:
- https://support.altrady.com/en/article/trading-accounts-managing-multiple-accounts-on-the-same-exchange-12spsno/
- https://www.altrady.com/features/multi-cryptocurrency-exchanges

Observed product patterns:
- Altrady treats each account on the same exchange as a separate trading account, but allows review separately or together.
- Markets, orders, positions, analytics, and portfolio views all respect account selection.
- Users can select one, many, or all trading accounts.
- Search and filter are built into account selection.
- Account labels matter and are used across widgets to distinguish accounts cleanly.

What Cassini should borrow:
- First-class multi-account selection and grouping.
- Exchange groups that preserve account isolation.
- Searchable scoped account pickers and multi-select flows.
- Label discipline for account identity across every pane.

### Nansen Portfolio Monitoring

Source:
- https://academy.nansen.ai/articles/1437225-monitoring-your-portfolio-and-exporting-data

Observed product patterns:
- Portfolio review is organized around balances, transaction history, token-level PnL, and filters.
- Export and filtering are treated as core workflow features, not afterthoughts.
- Naming conventions and portfolio separation are encouraged to keep reporting clean.

What Cassini should borrow:
- Strong filter bar behavior.
- Clear entity naming and labeling conventions.
- Review and export surfaces that are operational, not decorative.

### rotki

Source:
- https://docs.rotki.com/latest/usage-guides/pnl.html

Observed product patterns:
- rotki keeps long-running accounting work explicit.
- Reports are saved and reviewable later.
- Manual trades are treated as part of the same accounting system rather than second-class UI.
- Export and reproducibility matter as much as on-screen display.

What Cassini should borrow:
- Honest task states for calculations and imports.
- Durable review surfaces for generated history.
- Manual/local data paths that feel native to the product instead of tacked on.

## Cross-Product Synthesis

Repeated patterns across real products:
- Workspace first, pages second.
- Scope selection is persistent and affects multiple panes.
- Dense operational sidebars are preferred over giant summary cards.
- Calculators and create/edit flows are layered utilities.
- Account identity is preserved even when aggregate views exist.
- Precision, synchronization, and layout memory are treated as product features.

## Frontend Implications For Cassini

Cassini should move toward:
- A desk layout with linked panes and layout memory.
- A left scope rail for exchange groups, account buckets, and saved workspace focus.
- A center workbench that behaves like a trading terminal, not a dashboard landing page.
- A right operations rail for inspector, sync health, funding context, LAN state, and scoped utilities.
- Bottom ledgers for positions, exposure, funding, sync, and history.
- Overlay or drawer capture flows for add account, add position, CSV import, and settings.

Cassini should avoid:
- Hero copy.
- Large empty cards.
- Frontend-only decorative charts.
- Permanent CRUD forms pasted into the main layout.
- Excessive gradient-heavy “AI dashboard” styling.
