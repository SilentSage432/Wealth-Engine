# Development Journal

## 2026-07-19 — Reset Ledger Workspace (confirmed purge)

### What changed
- Confirmed that `clearAllData()` zeroes incomes, expenses, debts, allocations, and budgetTargets, removes the persistence key via `clearPersistedState()`, resets display name / dialogs / nav to the cold-start empty state, and lets the dashboard re-render instantly.
- **UI:** Sidebar Data backups zone gains a low-emphasis crimson “Reset Ledger Workspace” control that opens an AlertDialog; only “Purge Workspace Data” calls `clearAllData()`.
- Added shadcn-styled `components/ui/alert-dialog.tsx` on `@radix-ui/react-alert-dialog`.

### Ownership
- Mutation + localStorage wipe: `hooks/useBabylonEngine.ts` (`clearAllData`) / `lib/babylon/persistence.ts` (`clearPersistedState`)
- Confirmation presentation: `components/babylon/app-sidebar.tsx`
- Primitive: `components/ui/alert-dialog.tsx`

## 2026-07-19 — Dynamic budget blueprint (steward-configured categories)

### What changed
- Removed hardcoded `DEFAULT_BUDGET_TARGETS` seeding. Cold start / clear / empty backup now use `budgetTargets: []`.
- **Mutation:** `addBudgetTarget(Omit<BudgetTarget, "id">)` generates a unique id, appends the bucket, persists via the existing localStorage effect, and closes the configure dialog.
- **UI:** Command bar secondary `Manage Categories` control launches `ConfigureBudgetDialog` (“Configure Budget Blueprint”) with name, monthly cap, and Essential/Desire classification.
- **Empty state:** `BudgetBlueprint` prompts stewards to map buckets when none exist; expense tribute disables archive until categories exist and reads the live `budgetTargets` dropdown.
- Persistence no longer falls back to operational defaults when the stored list is empty.

### Ownership
- Empty blueprint contract: `lib/babylon/constants.ts` (`EMPTY_STATE`)
- Soft load / backup parse: `lib/babylon/persistence.ts`
- State + `addBudgetTarget`: `hooks/useBabylonEngine.ts`
- Presentation: `configure-budget-dialog.tsx`, `command-bar.tsx`, `BudgetBlueprint.tsx`, tribute dialog, dashboard shell

## 2026-07-19 — Budget Blueprint (Necessary Expenditures planning)

### What changed
- **Budget targets:** Persisted `budgetTargets[]` for operational buckets inside the 70% expenditure boundary (later made fully steward-configured).
- **Mutation:** `updateBudgetTarget(id, newAmount)` for on-the-fly planned-cap edits with immediate localStorage sync.
- **Variance selector:** Pure `buildBudgetVariances()` groups current-month spend by `budgetCategoryId` and computes Planned vs. Actual (remaining, used %, emerald→amber at 85%).
- **UI:** `components/dashboard/BudgetBlueprint.tsx` — compact category workspace with inline cap editor, dual-layer progress, remaining-balance copy. Mounted on Command Deck (before charts) and Ledger Matrices nav.
- **Attribution:** Expense form requires a budget category; ledger shows bucket under expense name. Desire expenses soft-migrate to a legacy discretionary id when missing.

### Ownership
- Warning threshold: `lib/babylon/constants.ts`
- Variance math: `lib/babylon/engine.ts`
- State + persistence + `updateBudgetTarget` / `addBudgetTarget`: `hooks/useBabylonEngine.ts`
- Presentation: `BudgetBlueprint`, tribute dialog, ledger, dashboard shell

## 2026-07-19 — Cash-flow utilities (backup, affordability, due dates)

### What changed
- **Data portability:** Sidebar footer utility zone with Export Backup / Import Backup. Export downloads a versioned JSON ledger (`LedgerBackup`). Import validates schema strictly via `validateLedgerBackup`, overwrites localStorage, and resets in-memory state for a clean re-render.
- **Affordability Anchor:** Command Deck single-input tool showing (1) % of current-month remaining Desires pool and (2) labor hours at the aggregated hourly rate from recurring income streams.
- **Expense due dates:** `ExpenseEntry` / `ExpenseInput` require `dueDate`. Tribute dialog + expenses ledger updated; amber “Due soon” tag when due within the next 7 days.
- Persistence load soft-migrates legacy expenses missing `dueDate` (falls back to transaction `date`).

### Ownership
- Schema validation + backup builders: `lib/babylon/persistence.ts`
- Labor / due-date pure helpers: `lib/babylon/engine.ts`
- Mutations + derived metrics: `hooks/useBabylonEngine.ts`
- Presentation: sidebar, `affordability-anchor.tsx`, ledger, tribute dialog

## 2026-07-19 — Live input pipelines (no mock seed)

### What changed
- Removed first-visit `buildSeedData()` fallback; ledger state now initializes as empty arrays and hydrates only from `localStorage`.
- Bumped persistence key to `wealth-engine-babylon-v2` so prior demo seed payloads are not reloaded.
- Deleted `lib/babylon/seed.ts`.
- Hook mutations standardized as `addIncome` / `addExpense` / `addDebt`, plus `clearAllData()` for a full localStorage + state wipe.
- Debt enrollment requires a mandatory monthly allocation amount.
- Ledger tables render a single empty-state row; Analytics Hub charts show placeholder copy instead of synthetic Recharts slices.

### Invariants preserved
- Same 10/20/70 allocation math and creditor waterfall.
- `RecordTributeDialog` remains the ephemeral form owner; durable mutations stay in `useBabylonEngine`.

## 2026-07-19 — Wealth Engine: Babylon Ledger SPA

### What shipped
- Scaffolded Next.js 15 (App Router) + Tailwind CSS v4 + TypeScript.
- Installed Recharts, Lucide React, Radix primitives, and shadcn-styled UI kit under `components/ui/`.
- Built the production single-page **Babylon Engine** budgeting application in `app/page.tsx`.

### Babylon Engine (10/20/70)
- **10% Wealth Archive** — locked as “yours to keep”; never spent on expenses.
- **20% Debt Liquidation** — auto-applied to remaining creditor balances (smallest-first). When debt is zero, this share redirects into the Wealth Archive (effective 30% savings).
- **70% Expenditure Allowance** — living pool with emerald → amber → crimson remaining-funds progress.

### UI zones
1. Premium sidebar + command bar (greeting, live clock, Record Tribute).
2. Golden Triad KPI cards with sparkline / fraction / dynamic progress.
3. Visual Analytics Hub — composed income/allocation chart + expenditure donut.
4. Ledger Matrices — Income / Expenses / Debt tabs with Needs vs. Desires gatekeeper.
5. Rotating Babylon Wisdom Box.

### Persistence
- Client-side `localStorage` key `wealth-engine-babylon-v2`.
- Empty ledger until the steward records the first tribute.

### Design direction
- Slate-950 / Slate-900 luxury shell with emerald & amber wealth accents.
- Display typography: Cormorant Garamond; body: DM Sans.

## 2026-07-19 — Modular production refactor

### What changed
- Extracted canonical types to `types/babylon.ts`.
- Moved pure allocation math to `lib/babylon/engine.ts` with persistence modules.
- Created `hooks/useBabylonEngine.ts` as the single owner of ledger state, localStorage sync, derived metrics, and mutation actions.
- Split presentation into `components/babylon/*` (sidebar, command bar, golden triad, analytics hub, ledgers, wisdom, tribute dialog, dashboard shell).
- Reduced `app/page.tsx` to a thin client composer.

### Invariants preserved
- Same 10/20/70 allocation behavior and debt redirect.
- Same Shadcn styling and executive UI zones.
