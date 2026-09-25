# Chat Handoff

## Project
**Wealth Engine** — personal ledger using a 10/20/70 split: Wealth Building, Debt Payoff, and a Living Budget. The method was inspired by *The Richest Man in Babylon*.

**Architecture map:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, dependency rules, canonical ownership matrix.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, dual-write, hydration, auth, actions, metrics)
- Pure engine: `lib/babylon/engine.ts`
- Speed-Tribute presets: `lib/babylon/presets.ts` (`QuickPreset`, `DEFAULT_PRESETS`, kind resolvers → domain)
- Quick Add bar: `components/babylon/speed-tribute-bar.tsx` (chips open Add; full 1-tap commit pending)
- Mobile focus: `components/babylon/spending-power-focus.tsx` (70% remaining + labor-hour readout)
- Mobile deck: below `lg` (1024px), only the Command / Analytics / Ledgers tree mounts; at `lg` and above only the desktop tree mounts (`hooks/useDesktopLayout.ts`). Sticky `CommandBar` + `SpeedTributeBar` are opaque slate (no backdrop blur on those surfaces or on `Card`)
- Security: `components/babylon/security-gate.client.tsx` (`next/dynamic` `ssr: false`) → `security-gate.tsx` + `vault-error-boundary.tsx` + `lib/babylon/security.ts` (fail-soft PIN setup, 1.5s WebAuthn timeout + PIN bypass, 3-min idle lock, multitasking privacy blur); Discreet Mode via CommandBar eye toggle
- Paycheck splitter: `components/modals/PaycheckSplitterModal.tsx` — `proposeIncomeSplit` → execute 10/20/70
- Debt freedom: `components/babylon/debt-freedom-engine.tsx` — Snowball/Avalanche + Freedom Date + velocity chart
- Monthly close sweeps: `split_50_50` | `wealth_boost` | `rollover` | `emergency_shield` (+ legacy `debt_wealth`)
- Plaid Link UI: `components/babylon/plaid-link-button.tsx` (always mounted; init toast fallback), `connected-banks-card.tsx`, `hooks/usePlaidConnections.ts` (command bar + Overview); API routes remain JWT + server-secret only
- Plaid (hardened prep): `app/api/plaid/*` (JWT + server secrets), `lib/babylon/plaid-server.ts`, `plaid-client.ts`, `plaid-schema.ts`, migration `20260808_plaid_tables.sql` (access_token never client-readable)
- Fail-soft toasts: `lib/babylon/vault-toast.ts` + `components/ui/vault-toast.tsx` (dismissible; `durationMs: 0` sticky)
- Add: `components/modals/RecordTransactionModal.tsx` (preventDefault + try/catch; buttons default non-submit)
- Types: `types/babylon.ts`
- Shell: `app/layout.tsx` → `app/providers.tsx` (TanStack Query), `app/globals.css`, `app/manifest.ts`
- Cloud client: `lib/supabase/client.ts`, `lib/supabase/auth.ts`, `lib/supabase/server.ts` (API JWT + service role), `lib/supabase/database.types.ts`
- Cloud sync: `lib/babylon/cloud-mappers.ts`, `lib/babylon/cloud-sync.ts`, `lib/babylon/cloud-hydrate.ts`
- Schema: `supabase/migrations/20260719_init_babylon_schema.sql`, `supabase/migrations/20260807_add_debts_archives_logs.sql` (`debt_entries`, `period_archives`; `activity_logs` from init)
- Auth UI: `components/modals/AuthModal.tsx`
- PWA: `public/sw.js` (network-first `/`, offline document fallback, cache `babylon-engine-v2`), `components/layout/ServiceWorkerRegistrar.tsx` (not registered on localhost; `updateViaCache: "none"`), `public/icons/*`
- Primitives: `components/ui/*`
- Feature UI: `components/babylon/*`, `components/dashboard/BudgetBlueprint.tsx`, `components/dashboard/TributeEnginesPanel.tsx`, `components/dashboard/RecentActivityStrip.tsx`, `components/modals/RecordTransactionModal.tsx`, `components/modals/MonthlyCloseModal.tsx`
- Helpers: `lib/utils.ts` (`cn`, currency formatters, `generateId`, `formatRelativeTime`)
- Hotkeys: `hooks/useTributeHotkeys.ts`
## Run locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

## State model
Persisted in `localStorage` (`wealth-engine-babylon-v2`) as:
- `incomes[]` — with precomputed `wealthShare` / `debtShare` / `expenditureShare`
- `expenses[]` — `need` | `desire`, mandatory `dueDate`, optional `budgetCategoryId`, `isSettled` (paid vs upcoming)
- `expenseSemanticsVersion` — `2` means unsettled expenses are upcoming. Missing on older vaults; those unsettled rows are marked paid once on load
- `debts[]` — `totalDebt`, `remainingDebt`, `monthlyAllocation` (required on create)
- `allocations[]` — historical events for charts (includes synthetic period-close rows)
- `budgetTargets[]` — planned caps inside the Living Budget (starts empty)
- `accounts[]` — manual Financial Position (checking / savings / cash, balance, local `asOf`). Missing on older vaults; loads as `[]`. Never inferred from income or spending. Not cloud-backed.
- `activityLog[]` — mutation feed for Recent Activity (newest first, capped)
- `emergencyShield` — reservoir from Monthly Close surplus
- `periodArchives[]` — sealed month snapshots
- `lastClosedMonthKey` — YYYY-MM of the last sealed period (or null)
- `displayName` — mirrored into vault for backup compatibility; canonical UI preference is `babylon_username`

Hydration: load ledger from localStorage when present; username from `babylon_username` (soft-migrates from vault `displayName` once). Empty ledger + empty budget blueprint. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`. Want expenses (`category: "desire"`) without `budgetCategoryId` map to the legacy discretionary id when present. Expenses without `isSettled` soft-migrate to `true`. Vaults without `expenseSemanticsVersion: 2` mark every remaining unsettled expense paid once, because those rows were already counted as spent.

## Mutations (hook exports)
- `addAccount` / `updateAccount` / `removeAccount` — Financial Position only. Never calls `addIncome`, `proposeIncomeSplit`, or `allocateIncome`
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active); appends activity log
- `addExpense` — Need/Want, due date, category, and Already Paid (`isSettled: true`) or Upcoming (`isSettled: false`)
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `addBudgetTarget` — ID + custom category; returns new id or `null`; optional `{ closeModal: false }` for inline create
- `updateBudgetTarget` / `updateBudgetTargetFull` — adjust caps / name / essential flag
- `deleteBudgetTarget(id, reassignToId?)` — remove bucket; reassign or uncategorize orphans
- `toggleExpenseSettled(id)` — same row. Paying sets the transaction date to the local day and does not copy the due date. Reopening leaves that date unchanged
- `autoScaleBudgetCaps()` — proportionally fit planned caps to `currentMonthExpenditurePool`
- `closeMonth(disposition)` — archive period, dispose 70% surplus, seal `lastClosedMonthKey`. Does not mark unpaid expenses paid
- `clearAllData` — wipe vault + reset workspace
- `exportBackup` / `importBackup` — versioned vault including activity log, shield, period archives, and accounts. New exports are version 3. Version 1 imports with an empty account list. Versions 1 and 2 import unsettled expenses as paid. Version 3 keeps upcoming rows unpaid. Older builds reject version 3.

## Financial Position vs allocation
- **Financial Position** — manually entered current account balances
- **Income** — newly received money that enters the 10/20/70 Allocation Engine
- **Living Budget** — the 70% allocation produced from new income
- **Money Available** — sum of current manual account balances. It is not safe-to-spend, not Living Budget remaining, and not net worth. Paying an expense does not change it
- **Upcoming obligation** — an expense that is not yet paid (`isSettled: false`)
- **Actual spending** — a paid expense. Living Budget remaining subtracts only this
- **Upcoming Needs** — sum of every unpaid Need. It is not limited to this month or the next seven days, and it is not subtracted from Money Available
- Overview places Financial Position, then Upcoming Needs, then the Living Budget. Month close does not settle unpaid expenses or change account balances

## Derived budget metrics
- `budgetVariances` / `budgetPlannedTotal` / `budgetActualTotal`
- Over-plan banner when planned total exceeds `currentMonthExpenditurePool`
- `recentActivity` — last 5 `activityLog` events
- `monthlyCloseSummary` — closing-month income/spend/10/20/70 rollup
- `emergencyShield` — Emergency Fund balance from a monthly-close surplus choice

## Overview utilities
- **Affordability Anchor** — money left for wants + main-income hours
- **Budget Blueprint** — scale caps; edit / delete a category and reassign expenses
- **Recent Activity Strip** — last five saved changes
- **Add** — income, expense, debt, and category
- **Close Month** — command-bar "Close Month" → 3-step modal
- **Ledger** — income, expenses, and debts; paid marks on expenses

## Known behaviors
- Recording income runs `allocateIncome()` (penny-exact 10/20/70; shares sum to gross) and optionally `applyDebtAllocation()`.
- Financial "today" is the local calendar day (`todayIso`), not UTC. The ledger hook advances that day at the next local midnight (and when a backgrounded tab returns on a new day). The visible CommandBar clock is a local one-second timer and does not rerender the dashboard.
- Main income rate is the latest recurring deposit per income source. Repeated paychecks from the same source do not stack into extra wages. `source` is the only way two simultaneous jobs stay separate.
- Sidebar cloud state reads "Cloud connected" (session present). It does not mean the ledger is fully mirrored.
- Plaid success means the institution link was saved. Transactions are not imported.
- Deleting an income reverses its `debtShare` via `reverseDebtAllocation` (remainingDebt clamped ≤ totalDebt).
- The Living Budget card is **this month's** budget and spending.
- Unpaid expenses show Upcoming, Due soon (today through 7 days), or Overdue. Paid rows show Paid. Legacy vaults without the upcoming marker migrate unsettled rows to paid once.
- A month may be closed once per calendar month key; historical ledgers remain for charts.
- Overview does not embed the full Ledger.

## Next candidates (Phase 3)
- Multi-currency / shared household vaults
- Debt payment waterfall visualization
- Recurring income scheduling automation
- Cloud→local pull / multi-device conflict policy (Path A is local-first dual-write + first-login migrate)

## Path A — Cloud synchronization (complete)
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`; legacy `ANON_KEY` still accepted)
- Migration: `supabase/migrations/20260719_init_babylon_schema.sql`
- Auth: sidebar “☁️ Connect Cloud Vault” → `AuthModal` (sign-in / create steward)
- Hydration: first session with local data + empty cloud → batch upsert incomes / expenses / budget_targets
- Dual-write: subsequent mutations while `isCloudSynced`
- Badge copy: "Cloud connected". A session is not a full ledger mirror.
- Sign out: clears the Supabase session only; the local ledger in `localStorage` stays
- Map at sync: TS `IncomeInterval` / `ActivityKind` ↔ DB enums via `cloud-mappers`

## Path B polish (complete)
- Add hotkeys: `N` / `Ctrl+N` / `Cmd+N` via `useTributeHotkeys`
- Paid-state pulse + opacity transitions; inline category expand
- Income breakdown tooltips; Financial Guidance panel
