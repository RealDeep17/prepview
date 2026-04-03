# Nexus-Terminal Contamination Audit

Date: `2026-04-03`

Purpose:
- record the exact cross-repo contamination discovered in `/Users/deepanshukumar/Documents/Project/Nexus-Terminal`
- separate direct portfolio-related edits from broader workstation/layout edits
- confirm the correct standalone portfolio repo is now `/Users/deepanshukumar/Documents/Project/Cassini`

## Boundary Facts

- Parent repo with contamination:
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal`
- Standalone portfolio repo that should have been used:
  - `/Users/deepanshukumar/Documents/Project/Cassini`
- Nested Tauri portfolio app also exists inside the parent repo:
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini`
- There is no top-level parent Tauri app at:
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src-tauri`

## Confirmed Changed Files In Parent Repo

Tracked modified files reported by `git diff --name-only`:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/CHANGELOG.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/bundle-stats.html`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/CHART_UX_V2_2.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/HANDOFF_V2_1_2026-03-19.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/RELEASE_NOTES_V2_1.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_2_BACKLOG.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_2_WORKSPACE_ARCHITECTURE.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertCreatorModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertDashboard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertHistoryPanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ChartSettingsTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/MainChart.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ManualOrderPanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ObjectTreePanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ObjectTreeTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/SymbolSearchModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/AppRouteNav.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/ChartToolkitShell.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/CommandPalette.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/LeftToolbar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/RightSidebar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/SymbolSearch.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/TopBar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/AccountCard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/CSVImportModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/PortfolioDashboard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/PortfolioPage.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/ScalePositionModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/scanner/ScannerPage.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/scanner/TokenScanner.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/settings/SettingsModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/watchlist/WatchlistTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/index.css`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/scanner/useScannerStore.js`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/store/layoutPanelState.js`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/frontendWorkflowSmoke.test.mjs`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/layoutPanelState.test.mjs`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/layoutTabs.test.mjs`

Untracked additions in the parent repo:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/cassini`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_ICONOGRAPHY_SPEC.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_LAYOUT_AND_DENSITY_SPEC.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_ROADMAP.md`

## Category A: Direct Portfolio Contamination

These are the highest-confidence files that clearly belong to portfolio product work and should not have been edited in the parent repo:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/AccountCard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/CSVImportModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/PortfolioDashboard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/PortfolioPage.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio/ScalePositionModal.jsx`

Why this is direct contamination:
- the files are portfolio-route surfaces by path and purpose
- diffs show route-specific redesign and behavior changes for portfolio overview, account management, and import flows

## Category B: Portfolio-Adjacent Shell Contamination

These files are not portfolio-only, but their diffs clearly touched app routing, docking, or shared UI behavior in ways that affect the portfolio route:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/AppRouteNav.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/RightSidebar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/TopBar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/index.css`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/settings/SettingsModal.jsx`

Why this is adjacent contamination:
- diffs show density/layout changes and route navigation changes that affect portfolio shell framing
- these are shared surfaces, so changing them in the parent repo changed product-wide behavior

## Category C: Broad Workstation/Layout Spillover

These files show a broader terminal-wide UI/layout reset that is outside the new portfolio repo scope:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ManualOrderPanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/SymbolSearchModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/MainChart.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ChartSettingsTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ObjectTreePanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/chart/ObjectTreeTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/ChartToolkitShell.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/CommandPalette.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/LeftToolbar.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout/SymbolSearch.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/scanner/ScannerPage.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/scanner/TokenScanner.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/scanner/useScannerStore.js`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/watchlist/WatchlistTab.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertCreatorModal.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertDashboard.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/alerts/AlertHistoryPanel.jsx`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/store/layoutPanelState.js`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/frontendWorkflowSmoke.test.mjs`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/layoutPanelState.test.mjs`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/tests/unit/layoutTabs.test.mjs`

Why this matters:
- even when not portfolio-specific, these edits still broke the repo boundary
- they indicate work spilled out of the intended product scope into the terminal app

## Category D: Parent-Repo Docs/Artifacts Contamination

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/CHANGELOG.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/bundle-stats.html`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/CHART_UX_V2_2.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/HANDOFF_V2_1_2026-03-19.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/RELEASE_NOTES_V2_1.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_2_BACKLOG.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_2_WORKSPACE_ARCHITECTURE.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_ICONOGRAPHY_SPEC.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_LAYOUT_AND_DENSITY_SPEC.md`
- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/docs/V2_3_ROADMAP.md`

Why this matters:
- parent project docs were updated to reflect unfinished layout/density/iconography work
- those changes belong to the terminal repo’s own planning, not the isolated portfolio repo

## Practical Conclusion

What is definitely true:

- the parent repo was edited outside the allowed boundary
- the contamination is not limited to the nested `cassini` folder
- the most obvious direct cross-repo contamination is under:
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/portfolio`
- shared-shell collateral also landed under:
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/layout`
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/index.css`
  - `/Users/deepanshukumar/Documents/Project/Nexus-Terminal/src/components/settings`

What this audit does not do:

- it does not revert any parent repo files
- it does not assume every changed file was caused by the latest portfolio work alone
- it does not mutate `Nexus-Terminal`

## Operational Rule Going Forward

All future portfolio work must happen only in:

- `/Users/deepanshukumar/Documents/Project/Cassini`

No edits should be made in:

- `/Users/deepanshukumar/Documents/Project/Nexus-Terminal`

unless explicitly requested for forensic comparison or migration-only reading.
