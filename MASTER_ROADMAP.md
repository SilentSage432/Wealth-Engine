# Master Roadmap — Wealth Engine

## Vision
A personal ledger that splits income 10% to Wealth Building, 20% to Debt Payoff, and 70% to a Living Budget. The method was inspired by *The Richest Man in Babylon*. The product name is Wealth Engine.

## Phase 1 — Foundation (Complete)
- [x] Next.js 15 App Router scaffold
- [x] Luxury dashboard shell (sidebar + viewport)
- [x] 10/20/70 allocation engine
- [x] 10/20/70 summary cards
- [x] Recharts analytics hub
- [x] Ledger matrices (income / expenses / debt)
- [x] Needs and Wants
- [x] localStorage persistence (empty-first, live input pipelines)
- [x] Financial Guidance
- [x] Graceful empty states for charts + tables

## Phase 2 — Depth (Complete)
- [x] Ledger export / import
- [x] Affordability Anchor (money left for wants + labor hours)
- [x] Expense due dates + due-soon indicator
- [x] Budget Blueprint (planned caps + Planned vs. Actual within 70%)
- [x] User-configured budget categories (`addBudgetTarget` via Add)
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
- [x] Path A auth UI (AuthModal, sidebar vault anchor). The first-login financial migrator was removed in WE-SYNC-002.
- [x] Mobile layout (focus cards, compact 10/20/70 cards, Overview / Analytics / Ledger tabs)
- [x] Mobile runtime paint and mount (opaque scrolling surfaces, CommandBar-local clock, one layout tree per breakpoint)
- [x] Path A entity parity schema (`debt_entries`, `period_archives` — `20260807_add_debts_archives_logs.sql`)
- [x] Grand Suite: SecurityGate + Discreet Mode, Paycheck Splitter, Debt Freedom Engine, Monthly Close sweeps, Plaid schema prep
- [x] Plaid security harden (JWT API routes, access_token isolation, idle lock, privacy blur, fail-soft toasts)
- [x] Plaid Link on the command bar and banks card (needs live PLAID_* + service role env)
- [x] SecurityGate client-only mount (`ssr: false`) + PlaidLinkButton always-on DOM fallbacks
- [x] Financial Position — local manual account balances and Money Available, separate from 10/20/70 (WE-BUDGET-002)
- [x] Paid vs Upcoming — settled spending, upcoming Needs, one-time legacy migration (WE-BUDGET-003)
- [x] Existing protected money — designations inside Money Available, separate from tracked allocations (WE-BUDGET-004)
- [x] Monthly recurring obligations — upcoming occurrences only, current month and next month (WE-BUDGET-005)
- [x] Available After Planned Needs — derived from Money Available, Protected Money, and Upcoming Needs (WE-BUDGET-006)
- [x] WE-SYNC-002 versioned vault schema and revision primitives (not yet called by the app)
- [ ] WE-SYNC-003 explicit desktop bootstrap and phone hydration
- [ ] Path A relational dual-write is not the vault. Do not extend it into the planning document.
- [ ] Speed-Tribute 1-tap commit (presets + bar mount; full amount autofill / zero-modal path still open)
- [ ] Plaid transaction sync / steward review workflow
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)

## Phase 3 — Cloud vault (WE-SYNC-002 foundation only)
The planning document is one row per user, not the older relational ledger.
- Vault table and compare-and-swap functions — `supabase/migrations/20260925_wealth_engine_vault.sql`
- Primitives, not yet used by the screen — `lib/babylon/cloud-vault.ts`
- Owner key, unset until an explicit bootstrap — `lib/babylon/cloud-owner.ts`
- Sign-in does not upload financial rows and does not download a vault
- Older relational dual-write still runs only after a later edit of income, a one-time expense, a paid toggle, or auto-scale (`lib/babylon/cloud-sync.ts`)
- Sidebar “Cloud connected” means a session exists. It does not mean the vault is shared.

## Architectural ownership

Canonical map: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (layers, dependency rules, ownership matrix).

| Concern | Owner |
|--------|--------|
| Allocation math | `lib/babylon/engine.ts` |
| Financial Position (manual balances, Money Available) | `lib/babylon/financial-position.ts` |
| Existing protected money | `lib/babylon/protected-money.ts` |
| Monthly recurring obligations | `lib/babylon/recurring-obligations.ts` |
| Available After Planned Needs | `lib/babylon/available-after-planned-needs.ts` |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) |
| Period close / surplus | `hooks/useBabylonEngine.ts` (`closeMonth`, `splitSurplusToDebtWealth`) |
| Ledger state + persistence | `hooks/useBabylonEngine.ts` |
| Type contracts | `types/babylon.ts` |
| Speed-Tribute presets | `lib/babylon/presets.ts` |
| Cloud relational schema | `supabase/migrations/*` |
| Supabase browser client | `lib/supabase/client.ts` |
| Auth session methods | `lib/supabase/auth.ts` |
| Versioned cloud vault | `lib/babylon/cloud-vault.ts` |
| Cloud owner binding | `lib/babylon/cloud-owner.ts` |
| Cloud ↔ domain mappers | `lib/babylon/cloud-mappers.ts` |
| Cloud mutation primitives | `lib/babylon/cloud-sync.ts` |
| Server-state cache | `app/providers.tsx` (TanStack Query) |
| Auth onboarding UI | `components/modals/AuthModal.tsx` |
| Presentation | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
