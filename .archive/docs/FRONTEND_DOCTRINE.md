# Frontend Doctrine

## Purpose

Cassini is a local futures portfolio workstation for serious derivatives traders.
It must feel premium, precise, and alive — not a dev-tool skeleton, not a generic SaaS
dashboard, not a stripped-down Bloomberg clone.

The target: someone opens Cassini and immediately trusts it with real money because
it *looks* like it was built for people who have real money in it.

---

## Non-Negotiables

- Workspace before pages — multi-pane desk, not a route stack.
- Data before decoration — real numbers are always the hero, not the design.
- Account isolation before portfolio flattening — scope selector affects everything.
- Real state before demo state — no fake KPIs, no placeholder charts, ever.
- Premium before minimal — restraint is earned by knowing what to add, not by removing everything.

---

## Visual Identity

Cassini is dark, precise, and confident. It should feel like a premium product that
exists at the intersection of a professional trading terminal and a modern design studio.

**The benchmark:** Take the best design elements from tools like Linear, Arc, Vercel's
dashboard, and Framer — applied to a locally-owned derivatives portfolio context.

### Palette

- **Base:** Near-black background, not pure `#000`. Think `#0a0a0f` or `#09090f` —
  deep, rich, slightly purple-blue tinted darkness.
- **Surface layers:** Subtle elevation via slightly lighter dark surfaces
  (`#111118`, `#16161f`). Glass/translucency is allowed and encouraged on overlays
  and rails — done tastefully, not applied everywhere.
- **Accent:** One primary accent (violet-blue or electric indigo, e.g. `hsl(252, 85%, 65%)`)
  used for active states, selected rows, CTAs, and interactive indicators.
- **PnL colors:**  
  - Positive/long: A cool-tinted green (`hsl(152, 70%, 52%)`) — not neon, not toxic.
  - Negative/short: A warm red (`hsl(0, 72%, 58%)`) — not eye-burning.
- **Neutral text:** Three tiers — bright (`hsl(0,0%,95%)`), secondary (`hsl(0,0%,52%)`),
  muted (`hsl(0,0%,30%)`). Numbers should be bright. Labels can be secondary.

### Gradients

Gradients are allowed and should be used deliberately:

- Subtle glow/gradient behind key summary metrics to create visual hierarchy.
- Gradient borders on selected/active states look excellent — use them.
- Avoid applying gradients to everything. One or two anchor points per screen, max.
- Linear gradient overlays on row selections and hover states are encouraged.

### Glassmorphism

Allowed on overlays, command palettes, drawers, and right rail panels.
Not allowed on data table rows. The rule: glass is for chrome and scaffolding, not for
data surfaces where readability is paramount. Use `backdrop-filter: blur(12px)` with
a translucent dark background (`rgba(12, 12, 20, 0.85)`) for overlays.

---

## Layout Rules

1. **The shell is a workstation.**
   Multi-pane desk with resizable regions. Not a route-based page stack.

2. **Scope is global.**
   The active account/exchange scope must filter every surface simultaneously.
   Switching scope should feel instant and feel like tuning, not navigating.

3. **The center pane is the primary value surface.**
   Positions table, exposure view, equity history, or trade journal — all live here.
   It must never be occupied by explanatory filler or half-empty card grids.

4. **The right rail is operational chrome.**
   Sync status, account details, funding rates, LAN state, utility actions.
   Think terminal order panel — dense, always relevant to the current scope.

5. **Overlays are layered, not routed.**
   Add account, add position, CSV import = drawer/sheet with backdrop blur.
   They layer over the workspace without destroying context.

6. **Empty states are compact and actionable.**
   Small prompt + 1–2 ghost buttons. No hero-sized empty illustrations.

---

## Density Rules

- **Table rows:** 38–42px rhythm. Tighter on small viewports.
- **Right-align all numbers.** No exceptions.
- **Mono font for all numbers, symbols, and timestamps.**
- **Sans font for labels, headings, and prose.** Use Inter, DM Sans, or Geist.
- **Secondary copy is short or absent.** Labels describe; they don't explain.
- **No oversized marketing headlines** inside data panels. Section headings are small
  and either uppercase + tracked or small-caps.

---

## Motion Rules

Motion clarifies, it does not decorate. It should be fast and purposeful.

- Row selection: `150ms ease-out` background transition.
- Overlay appear: slide + fade, `200ms`. Dismiss: `150ms`.
- Pane resize: live, no animation needed.
- Numeric updates: subtle brightness flash when a value changes (`100ms` flash then settle).
- Auto-sync running indicator: subtle pulse on the sync badge only.
- Avoid: looping animations, full-screen transitions, page-level motion.

Micro-animations on interactive elements (hover lift, button press depression) are
encouraged — these make the product feel alive. The limit is 1–2 motion layers per
interaction, not 5.

---

## Typography Rules

```
Heading/label font : Inter or DM Sans — 600 weight
Data/number font   : JetBrains Mono, IBM Plex Mono, or Geist Mono
```

- **Numbers** must scan in one pass. Right-aligned, mono, consistent decimal places.
- **Symbol labels** (BTCUSDT, ETH-PERP) in mono uppercase, slightly muted.
- **Timestamps** in mono, secondary color, short format (e.g. "5m ago", "03 Apr 14:30").
- **Section headers** small, uppercase, letter-spacing `0.08em`, muted color.

---

## Interaction Rules

- Single-click on a position row → opens the position detail in the right rail (inspector mode).
- Double-click or right-click → opens context menu (edit, close, delete).
- Scope filter is always visible, always responds instantly.
- Selected rows and focused entities propagate to inspector surfaces without navigation.
- Keyboard shortcuts for power users — `R` to refresh sync, `N` for new position,
  `Escape` to dismiss overlays.

---

## Honesty Rules

These are non-negotiable and override all visual decisions:

- If `riskSource === 'local_engine'` → show small indicator "est." next to liquidation price.
- If `riskSource === 'user_input'` → show "manual" badge on risk fields.
- If mark price is cached/local (non-live position), show a "~" prefix or "cached" chip.
- If liquidation or margin data is genuinely absent, show a dash or "—" — never a zero.
- If sync is degraded, the account row must visually communicate degraded state (red/orange tone).
- If `autoSyncStatus.lastError` exists, it is visible — not buried.

---

## What is Actually Forbidden

- **Fake/placeholder KPIs** — any number that isn't from real backend state.
- **Explanatory walls of text** inside data panels.
- **Summary-card grids as the primary data surface** — tables exist for a reason.
- **Always-open flat forms** embedded in the main workspace.
- **Full-height single-purpose pages** that break the workstation model.
- **Inconsistent number formatting** — same decimal precision across the same metric type.
- **Animations on data itself** — PnL numbers should not bounce or scroll.

Gradients, glassmorphism, motion, and color are all tools. They are not forbidden.
Bad execution of those tools is forbidden.

---

## Rebuild Status

The current frontend (`App.tsx`, `ProductApp.tsx`) is being deleted and rebuilt from scratch.

The new frontend must:
- Look like it belongs next to Linear, Vercel, and high-end fintech tools.
- Feel instantly trustworthy to a trader who has real capital at stake.
- Present data with a density and clarity that makes it faster to process than prose.
- Never let the design win over the data — but the design must be excellent or the data
  isn't trusted either.
