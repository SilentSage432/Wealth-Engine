# Master Roadmap — Wealth Engine

## Vision
A premium, single-page budgeting platform that teaches and enforces Babylonian wealth laws through autonomous allocation — educational clarity first, competitive polish second.

## Phase 1 — Foundation (Complete)
- [x] Next.js 15 App Router scaffold
- [x] Luxury dashboard shell (sidebar + viewport)
- [x] Babylon 10/20/70 allocation engine
- [x] Golden Triad KPIs
- [x] Recharts analytics hub
- [x] Ledger matrices (income / expenses / debt)
- [x] Needs vs. Desires gatekeeper
- [x] localStorage persistence (empty-first, live input pipelines)
- [x] Wisdom marquee
- [x] Graceful empty states for charts + tables

## Phase 2 — Depth
- [x] Ledger export / import
- [x] Affordability Anchor (Desires pool % + labor hours)
- [x] Expense due dates + due-soon indicator
- [x] Budget Blueprint (planned caps + Planned vs. Actual within 70%)
- [x] Steward-configured budget categories (`addBudgetTarget` via Record Tribute)
- [x] Clear-ledger UI control (confirmed purge via sidebar AlertDialog)
- [x] Budget bucket edit / delete (`updateBudgetTargetFull` / `deleteBudgetTarget`)
- [ ] Reversible debt amortization on income delete
- [ ] Monthly close ritual (period summary)
- [ ] Accessibility audit (keyboard + screen reader)
- [ ] Expense paid/settled toggle
- [ ] Auto-scale budget caps from current-month expenditure pool

## Phase 3 — Platform
- [ ] Auth + cloud sync
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)

## Architectural ownership
| Concern | Owner |
|--------|--------|
| Allocation math | `lib/babylon/engine.ts` |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`) |
| Ledger state + persistence | `hooks/useBabylonEngine.ts` |
| Type contracts | `types/babylon.ts` |
| Presentation | `components/babylon/*`, `components/dashboard/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
