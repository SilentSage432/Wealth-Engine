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
- [x] WE-SYNC-002 versioned vault schema and revision primitives
- [x] WE-SYNC-003 explicit desktop bootstrap and empty-device hydration
- [ ] WE-SYNC-004 continuous sync, offline edits, and conflict choice
- [ ] Speed-Tribute 1-tap commit (presets + bar mount; full amount autofill / zero-modal path still open)
- [ ] Plaid transaction sync / steward review workflow
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)

## Phase 3 — Cloud vault
The planning document is one row per user.
- Vault table and compare-and-swap — `supabase/migrations/20260925_wealth_engine_vault.sql` (not applied until a deliberate manual step)
- Explicit setup — `lib/babylon/cloud-setup.ts`. Sign-in does not upload or download.
- Initialize only after confirmation, and only when this device has financial data and the cloud vault is absent. The owner key is saved after revision 1 matches.
- An empty device can load that vault after a second confirmation. A device that already has data is left alone.
- New entries after that stay on the device until WE-SYNC-004. The sidebar does not call that synchronized.

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
| Explicit cloud setup | `lib/babylon/cloud-setup.ts` |
| Cloud owner binding | `lib/babylon/cloud-owner.ts` |
| Supabase id check | `lib/babylon/cloud-mappers.ts` |
| Server-state cache | `app/providers.tsx` (TanStack Query) |
| Auth onboarding UI | `components/modals/AuthModal.tsx` |
| Presentation | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
