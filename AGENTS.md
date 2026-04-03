# Cassini Agent Guardrails

## Mission

Build a fully local, premium portfolio product for derivatives traders without drifting
into terminal, execution, backtesting, or cloud-SaaS scope.

## Non-negotiables

- Portfolio only. No order routing, strategy automation, or trade execution.
- Read-only exchange integrations only.
- BloFin is priority one, Hyperliquid priority two.
- Every user-facing metric must come from real state or explicit computation.
- No OS-login-gated secret storage or keychain prompts unless explicitly re-approved.
- No placeholders, fake KPIs, "coming soon" surfaces, or speculative AI features.
- No code edits outside this repo. `references/` is read-only reference material.

## Evidence rule

Any connector or parser change must be backed by one of:

- official exchange documentation
- captured fixture from a real response
- a failing automated test
- the approved product doctrine or acceptance spec in `docs/`

## UI/UX doctrine

- Dense, premium, deliberate, and fast
- No generic admin-dashboard patterns
- Tables and metrics first, empty ornament second
- Motion must clarify state changes, never distract from data

## Delivery rule

A feature is complete only when:

1. the behavior exists end to end,
2. the acceptance scenario is documented,
3. tests cover the critical path, and
4. known Sev1/Sev2 defects are zero.
