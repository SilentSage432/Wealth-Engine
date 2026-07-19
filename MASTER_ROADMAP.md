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

## Phase 2 — Depth (Complete)
- [x] Ledger export / import
- [x] Affordability Anchor (Desires pool % + labor hours)
- [x] Expense due dates + due-soon indicator
- [x] Budget Blueprint (planned caps + Planned vs. Actual within 70%)
- [x] Steward-configured budget categories (`addBudgetTarget` via Record Tribute)
- [x] Clear-ledger UI control (confirmed purge via sidebar AlertDialog)
- [x] Budget bucket edit / delete (`updateBudgetTargetFull` / `deleteBudgetTarget`)
- [x] Responsive layout audit (mobile drawer, triad/charts wrap, table scroll, touch targets)
- [x] Progressive Web App (manifest + service worker + installable icons)
- [x] P0 trust math (reverse debt on income delete, current-month Triad expenditure, desires pool + primary rate)
- [x] Income stream kinds + Tribute Engines scoreboard
- [x] P2 Workflow Clarity (inline category create, expense date, mutation feedback, over-plan banner, orphan reassignment, overview ledger declutter)
- [x] Expense paid/settled toggle (`isSettled` + `toggleExpenseSettled`)
- [x] Recent activity strip on overview
- [x] Auto-scale budget caps from current-month expenditure pool
- [x] Monthly close ritual (summary → surplus disposition → archive & roll forward)

## Phase 3 — Platform
- [ ] Auth + cloud sync
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)
- [ ] Accessibility audit (keyboard + screen reader)

## Architectural ownership
| Concern | Owner |
|--------|--------|
| Allocation math | `lib/babylon/engine.ts` |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) |
| Period close / surplus | `hooks/useBabylonEngine.ts` (`closeMonth`, `splitSurplusToDebtWealth`) |
| Ledger state + persistence | `hooks/useBabylonEngine.ts` |
| Type contracts | `types/babylon.ts` |
| Presentation | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
