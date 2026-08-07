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
- [x] Accessibility audit & keyboard control loops (hotkeys, focus trap, aria-labels)
- [x] High-end micro-animations & UI polish (settled pulse, inline expand, wisdom console, engine tooltips)
- [x] Path A cloud schema foundation (`supabase/migrations/20260719_init_babylon_schema.sql`)
- [x] Path A client connectivity (Supabase SDK + TanStack Query + dual-write mutations)
- [x] Path A auth UI + local→cloud hydration (AuthModal, sidebar vault anchor, one-time migrate)
- [x] Mobile Command Deck streamlining (focus cards, compact Golden Triad, Command/Analytics/Ledgers tabs)
- [x] Path A entity parity schema (`debt_entries`, `period_archives` — `20260807_add_debts_archives_logs.sql`)
- [ ] Path A dual-write for debts / period archives / activity_logs + hydrate remint
- [ ] Speed-Tribute 1-tap commit (presets + bar mount; full amount autofill / zero-modal path still open)
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)

## Phase 3 Path A — Cloud synchronization (complete)
Relational + client bridge fully wired:
- Enums / tables / RLS / indexes — `supabase/migrations/20260719_init_babylon_schema.sql`
- Client: `lib/supabase/client.ts` + `lib/supabase/auth.ts` + `lib/supabase/database.types.ts`
- Cache: `app/providers.tsx` → TanStack Query (`staleTime` 5m)
- Dual-write: `hooks/useBabylonEngine.ts` (income / expense / settled / auto-scale)
- Hydration: `lib/babylon/cloud-hydrate.ts` — first sign-in migrates local vault when cloud is empty
- Auth UI: `components/modals/AuthModal.tsx` (sign-in / create steward)
- Sidebar anchor: Connect Cloud Vault ↔ Synced badge + Sign Out (session only; local cache retained)
- Mappers: `lib/babylon/cloud-mappers.ts` + `lib/babylon/cloud-sync.ts`
- Ownership: SQL owns schema; `types/babylon.ts` owns app contracts; sync adapters compose the boundary

## Architectural ownership

Canonical map: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (layers, dependency rules, ownership matrix).

| Concern | Owner |
|--------|--------|
| Allocation math | `lib/babylon/engine.ts` |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) |
| Period close / surplus | `hooks/useBabylonEngine.ts` (`closeMonth`, `splitSurplusToDebtWealth`) |
| Ledger state + persistence | `hooks/useBabylonEngine.ts` |
| Type contracts | `types/babylon.ts` |
| Speed-Tribute presets | `lib/babylon/presets.ts` |
| Cloud relational schema | `supabase/migrations/*` |
| Supabase browser client | `lib/supabase/client.ts` |
| Auth session methods | `lib/supabase/auth.ts` |
| Local→cloud hydration | `lib/babylon/cloud-hydrate.ts` |
| Cloud ↔ domain mappers | `lib/babylon/cloud-mappers.ts` |
| Cloud mutation primitives | `lib/babylon/cloud-sync.ts` |
| Server-state cache | `app/providers.tsx` (TanStack Query) |
| Auth onboarding UI | `components/modals/AuthModal.tsx` |
| Presentation | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
