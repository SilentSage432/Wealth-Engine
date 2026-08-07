# Chat Handoff

## Project
**Wealth Engine** — executive financial budgeting SPA based on *The Richest Man in Babylon* 10/20/70 formula.

**Architecture map:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, dependency rules, canonical ownership matrix.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, dual-write, hydration, auth, actions, metrics)
- Pure engine: `lib/babylon/engine.ts`
- Speed-Tribute presets: `lib/babylon/presets.ts` (`QuickPreset`, `DEFAULT_PRESETS`, kind resolvers → domain)
- Speed-Tribute bar: `components/babylon/speed-tribute-bar.tsx` (chips → open tribute mode; full 1-tap commit pending)
- Mobile focus: `components/babylon/spending-power-focus.tsx` (70% remaining + labor-hour readout)
- Mobile deck: below `lg`, Command / Analytics / Ledgers tabs; sticky `CommandBar` + `SpeedTributeBar`; desktop keeps sidebar nav
- Security: `components/babylon/security-gate.client.tsx` (`next/dynamic` `ssr: false`) → `security-gate.tsx` + `vault-error-boundary.tsx` + `lib/babylon/security.ts` (fail-soft PIN setup, 1.5s WebAuthn timeout + PIN bypass, 3-min idle lock, multitasking privacy blur); Discreet Mode via CommandBar eye toggle
- Paycheck splitter: `components/modals/PaycheckSplitterModal.tsx` — `proposeIncomeSplit` → execute 10/20/70
- Debt freedom: `components/babylon/debt-freedom-engine.tsx` — Snowball/Avalanche + Freedom Date + velocity chart
- Monthly close sweeps: `split_50_50` | `wealth_boost` | `rollover` | `emergency_shield` (+ legacy `debt_wealth`)
- Plaid Link UI: `components/babylon/plaid-link-button.tsx` (always mounted; init toast fallback), `connected-banks-card.tsx`, `hooks/usePlaidConnections.ts` (CommandBar + Command Deck); API routes remain JWT + server-secret only
- Plaid (hardened prep): `app/api/plaid/*` (JWT + server secrets), `lib/babylon/plaid-server.ts`, `plaid-client.ts`, `plaid-schema.ts`, migration `20260808_plaid_tables.sql` (access_token never client-readable)
- Fail-soft toasts: `lib/babylon/vault-toast.ts` + `components/ui/vault-toast.tsx` (dismissible; `durationMs: 0` sticky)
- Record Tribute: `components/modals/RecordTransactionModal.tsx` (preventDefault + try/catch; buttons default non-submit)
- Types: `types/babylon.ts`
- Shell: `app/layout.tsx` → `app/providers.tsx` (TanStack Query), `app/globals.css`, `app/manifest.ts`
- Cloud client: `lib/supabase/client.ts`, `lib/supabase/auth.ts`, `lib/supabase/server.ts` (API JWT + service role), `lib/supabase/database.types.ts`
- Cloud sync: `lib/babylon/cloud-mappers.ts`, `lib/babylon/cloud-sync.ts`, `lib/babylon/cloud-hydrate.ts`
- Schema: `supabase/migrations/20260719_init_babylon_schema.sql`, `supabase/migrations/20260807_add_debts_archives_logs.sql` (`debt_entries`, `period_archives`; `activity_logs` from init)
- Auth UI: `components/modals/AuthModal.tsx`
- PWA: `public/sw.js`, `components/layout/ServiceWorkerRegistrar.tsx`, `public/icons/*`
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
- `expenses[]` — `need` | `desire`, mandatory `dueDate`, optional `budgetCategoryId`, `isSettled`
- `debts[]` — `totalDebt`, `remainingDebt`, `monthlyAllocation` (required on create)
- `allocations[]` — historical events for charts (includes synthetic period-close rows)
- `budgetTargets[]` — steward-configured planned caps for Necessary Expenditures buckets (starts empty)
- `activityLog[]` — mutation feed for Recent Activity (newest first, capped)
- `emergencyShield` — reservoir from Monthly Close surplus
- `periodArchives[]` — sealed month snapshots
- `lastClosedMonthKey` — YYYY-MM of the last sealed period (or null)
- `displayName` — mirrored into vault for backup compatibility; canonical UI preference is `babylon_username`

Hydration: load ledger from localStorage when present; username from `babylon_username` (soft-migrates from vault `displayName` once). Empty ledger + empty budget blueprint. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`. Desire expenses without `budgetCategoryId` map to the legacy discretionary id when present. Expenses without `isSettled` soft-migrate to `true`.

## Mutations (hook exports)
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active); appends activity log
- `addExpense` — ID + Need/Desire + due date + required `budgetCategoryId`; new rows start `isSettled: false`
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `addBudgetTarget` — ID + custom category; returns new id or `null`; optional `{ closeModal: false }` for inline create
- `updateBudgetTarget` / `updateBudgetTargetFull` — adjust caps / name / essential flag
- `deleteBudgetTarget(id, reassignToId?)` — remove bucket; reassign or uncategorize orphans
- `toggleExpenseSettled(id)` — flip paid/settled; due-soon ignores settled rows
- `autoScaleBudgetCaps()` — proportionally fit planned caps to `currentMonthExpenditurePool`
- `closeMonth(disposition)` — archive period, dispose 70% surplus (`debt_wealth` | `emergency_shield`), settle month expenses, seal `lastClosedMonthKey`
- `clearAllData` — wipe vault + reset workspace
- `exportBackup` / `importBackup` — versioned vault including activity log, shield, and period archives

## Derived budget metrics
- `budgetVariances` / `budgetPlannedTotal` / `budgetActualTotal`
- Over-plan banner when planned total exceeds `currentMonthExpenditurePool`
- `recentActivity` — last 5 `activityLog` events
- `monthlyCloseSummary` — closing-month income/spend/10/20/70 rollup
- `emergencyShield` — reservoir from monthly-close surplus disposition

## Command Deck utilities
- **Affordability Anchor** — Desires pool % + primary labor hours
- **Budget Blueprint** — Auto-Scale Allocations; pencil edit / delete + orphan reassignment
- **Recent Activity Strip** — lightweight last-5 mutation feed
- **Record Tribute** — universal entry modal
- **Monthly Close Ritual** — command-bar "Close Month" → 3-step modal
- **Ledger Matrices** — detailed ledgers under Ledger Matrices nav; settled checkmarks on expenses

## Known behaviors
- Recording income runs `allocateIncome()` and optionally `applyDebtAllocation()`.
- Deleting an income reverses its `debtShare` via `reverseDebtAllocation` (remainingDebt clamped ≤ totalDebt).
- Golden Triad Necessary Expenditures card is **current-month** pool/spend.
- Unsettled expenses due within 7 days show "Due soon"; legacy expenses without `isSettled` migrate to settled.
- Monthly close may be sealed once per calendar month key; historical ledgers remain for charts.
- Overview does not embed full Ledger Matrices.

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
- Sign out: clears Supabase session only; `localStorage` vault retained
- Map at sync: TS `IncomeInterval` / `ActivityKind` ↔ DB enums via `cloud-mappers`

## Path B polish (complete)
- Record Tribute hotkeys: `N` / `Ctrl+N` / `Cmd+N` via `useTributeHotkeys`
- Settled pulse + opacity transitions; inline category expand-fade
- Tribute Engines accessible tooltips; Wisdom floating console aesthetic
