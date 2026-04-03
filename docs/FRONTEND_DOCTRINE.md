# Frontend Doctrine

## Purpose

Cassini is a local futures portfolio workstation. The UI must feel like a deliberate operator desk for reviewing isolated risk across multiple exchanges and accounts, not like a startup analytics dashboard.

## Non-Negotiables

- Workspace before pages.
- Data before decoration.
- Account isolation before portfolio flattening.
- Layered workflows before permanent forms.
- Real state before demo state.
- Layout memory before stateless navigation.

## Layout Rules

1. The shell is a workstation.
   Cassini uses a multi-pane desk with resizable regions and sticky context, not a stack of route pages with repeated headers.

2. Scope is global.
   The active scope must affect every major surface. Users should be able to review all accounts, one exchange, one account, or a chosen subset without changing mental model.

3. The center pane is the most valuable surface.
   It must show actual portfolio state, grouped positions, exposure structure, history, or active review context. It must never be occupied by large explanatory filler.

4. The right rail is operational.
   It holds scoped detail, sync state, funding context, LAN state, and utility actions. It should feel similar to a trading terminal’s order/utility rail.

5. Create and edit flows are transient.
   Add account, add manual position, and CSV import should open as layered overlays, drawers, or stepped panels.

6. Empty states stay compact.
   Empty areas get a small, actionable prompt and one or two next actions. No full-height blank cards with copywriting.

## Density Rules

- Target compact enterprise density, not consumer-card spacing.
- Primary tables should support 40px-ish row rhythm with numeric alignment.
- Large headlines are rare and mostly limited to workspace title and overlay title.
- Secondary explanatory copy must stay short and only appear where the state is genuinely ambiguous.

## Typography Rules

- Use a strong sans for structure and a mono face for numbers, symbols, and timestamps.
- Numbers must scan faster than prose.
- Labels should be short, uppercase where helpful, and never decorative.
- Do not use oversized marketing-style headings inside data panels.

## Color and Motion Rules

- Dark neutral base with restrained accent usage.
- Color is for state change, interaction, and numeric meaning, not atmosphere.
- Green and red are reserved for directional states, PnL, and side bias.
- Motion should clarify focus changes, overlays, pane resize, and row selection. Avoid ornamental motion.

## Interaction Rules

- Single-click opens layered actions.
- Multi-select and scoped filters should be available where accounts are reviewed.
- Selected rows and focused entities must propagate to inspector surfaces.
- Layout settings must control real behavior such as pane visibility, density, and workspace memory.

## Honesty Rules

- If mark price is local/manual, say so.
- If liquidation or margin data is unavailable for a manual position, the UI must show that it is pending engine support rather than inventing values.
- If history is locally derived from sync persistence, label it that way.

## Forbidden

- Generic summary-card grids dominating the viewport.
- Cringy gradients, glassmorphism haze, or vague product slogans.
- Huge blocks of “explanation” inside the main work area.
- Placeholder KPIs, fake charts, or fake leaderboard concepts.
- Always-open flat forms in the primary board.

## Current Frontend Diagnosis

The current shell still fails on these points:
- Too much card framing.
- Too much prose relative to data.
- The center pane is underutilized.
- Capture flows still feel like forms pasted into a product shell.
- Settings are too shallow to justify a dedicated product-grade workspace.

The next frontend pass must fix those specific failures.
