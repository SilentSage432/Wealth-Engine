# Development Journal

## 2026-07-19 — Phase 2 Depth complete (settled, activity, auto-scale, monthly close)

### What changed
- **Expense settled status:** `ExpenseEntry.isSettled`; legacy soft-migrates to `true`; new expenses start unsettled; `toggleExpenseSettled`; ledger checkmark with muted/line-through styling; due-soon only for unsettled rows.
- **Recent Activity Strip:** persisted `activityLog` (newest-first, capped); Command Deck shows last 5 mutations with icons + relative time.
- **Auto-Scale Allocations:** `scaleBudgetCapsToPool` + Blueprint action proportionally fits caps to the current-month 70% pool (penny drift on largest bucket).
- **Monthly Close Ritual:** 3-step modal — period summary, surplus → Debt/Wealth or emergency shield, archive + settle month expenses + `lastClosedMonthKey` seal. Persists `periodArchives`, `emergencyShield`.

### Ownership
- Types / migrate: `types/babylon.ts`, `lib/babylon/persistence.ts`, `lib/babylon/constants.ts`
- Math: `lib/babylon/engine.ts` (`scaleBudgetCapsToPool`, `splitSurplusToDebtWealth`)
- Mutations: `hooks/useBabylonEngine.ts`
- UI: `RecentActivityStrip`, `MonthlyCloseModal`, `BudgetBlueprint`, `ledger-matrices`, `command-bar`, dashboard

## 2026-07-19 — P2 Workflow Clarity

### What changed
- **Inline category create:** Expense tab gains “+ Create New Category Inline” nested form (name, cap, essential) via `addBudgetTarget(..., { closeModal: false })`; new bucket auto-selects without leaving the expense draft.
- **Expense transaction date:** Visible date picker (no longer forced/hidden “today”); due date retained beside it.
- **Mutation feedback:** Record Tribute surfaces inline error/success alerts when `addIncome` / `addExpense` / `addDebt` / `addBudgetTarget` reject or succeed at validation bounds.
- **Over-plan banner:** Budget Blueprint warns when `budgetPlannedTotal` exceeds current-month 70% expenditure pool, with exact variance.
- **Orphan reassignment:** `deleteBudgetTarget(id, reassignToId?)` reassigns linked expenses; delete confirm offers an alternate category select.
- **Command Deck declutter:** `LedgerMatrices` render only on Ledger Matrices nav — overview keeps KPIs, engines, blueprint, analytics, wisdom.

### Ownership
- Entry UX: `components/modals/RecordTransactionModal.tsx`
- Blueprint guardrails: `components/dashboard/BudgetBlueprint.tsx`
- Mutations: `hooks/useBabylonEngine.ts` (`addBudgetTarget` → `string | null`, `deleteBudgetTarget` reassign)
- Layout: `components/babylon/wealth-engine-dashboard.tsx`

## 2026-07-19 — P0/P1 trust math + Tribute Engines

### What changed
- **Debt reverse amortization:** `reverseDebtAllocation` + `deleteIncome` restores creditor `remainingDebt` (clamped ≤ `totalDebt`).
- **Golden Triad 70% card:** Uses current-month expenditure pool / spend / remaining (labeled “This Month”).
- **Desires pool:** `computeDesiresPoolRemaining` — discretionary slice after needs reservation (actual needs ∪ essential planned caps).
- **Affordability rate:** `primaryHourlyRate` — primary recurring labor only.
- **IncomeStreamKind:** `primary | side_hustle | passive | other` on incomes; legacy soft-migrates to `primary`.
- **Record Tribute:** Stream Classification toggle group on Income tab.
- **Tribute Engines Breakdown:** Month total, primary vs secondary mix, per-kind MoM pulse (`TributeEnginesPanel`).

### Ownership
- Math: `lib/babylon/engine.ts`
- Schema / migrate: `types/babylon.ts`, `lib/babylon/persistence.ts`, `lib/babylon/constants.ts`
- State: `hooks/useBabylonEngine.ts`
- UI: modal, `TributeEnginesPanel`, triad, affordability, ledger badges

## 2026-07-19 — Progressive Web App (installable standalone)

### What changed
- `app/manifest.ts` — Web App Manifest (standalone, slate theme, 192/512 icons).
- `public/sw.js` — lightweight cache-first service worker for `/` + manifest.
- `components/layout/ServiceWorkerRegistrar.tsx` — registers SW on non-localhost hosts.
- Root layout: Apple web app metadata, theme color, manifest link, registrar mount.
- Icons: `public/icons/icon-192x192.png`, `public/icons/icon-512x512.png`.

### Ownership
- Manifest: `app/manifest.ts`
- Worker: `public/sw.js`
- Registration: `ServiceWorkerRegistrar` composed in `app/layout.tsx`

## 2026-07-19 — Responsive layout audit (320px → ultra-wide)

### What changed
- Shell: hybrid drawer sidebar (<1024px) + locked `lg:pl-72` desktop rail; main content capped at `max-w-screen-2xl` with safer horizontal padding; `overflow-x-clip` on viewport.
- Golden Triad: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` with scaled display type.
- Analytics Hub: `flex-col xl:flex-row` stacking; ResponsiveContainer retained; mobile chart heights reduced.
- Ledgers: horizontal scroll wrappers + `min-w` tables; Table primitive uses `overflow-x-auto scrollbar-thin`.
- Touch: Input/Select `h-11 text-base` on mobile (iOS zoom-safe); buttons/icon targets ≥44px; modal tab triggers `min-h-11`; dialogs inset from screen edges on small viewports.
- Command bar greeting: `text-xl md:text-2xl lg:text-3xl`; full-width Record Tribute on narrow screens.

## 2026-07-19 — Universal Record Tribute + blueprint edit/delete

### What changed
- Consolidated all creation flows into `RecordTransactionModal` (Income / Expense / Debt / Budget Category tabs). Removed header “Manage Categories” and `ConfigureBudgetDialog`.
- **Mutations:** `deleteBudgetTarget(id)` removes a bucket and uncategorized linked expenses; `updateBudgetTargetFull(id, partial)` edits name, cap, and essential flag.
- **BudgetBlueprint:** Pencil opens “Modify Budget Bucket” dialog with save + confirmed delete (crimson). Empty state points stewards to Record Tribute → Budget Category.
- Ledger shows “Uncategorized” when an expense has no live budget bucket.

### Ownership
- Universal entry: `components/modals/RecordTransactionModal.tsx`
- Mutations: `hooks/useBabylonEngine.ts`
- Inline edit UI: `components/dashboard/BudgetBlueprint.tsx`

## 2026-07-19 — Profile username input (emptyable + dedicated persistence)

### What changed
- Fixed header name input that forced `|| "Steward"` on every keystroke, blocking backspace/clear.
- Canonical preference: `username` via `babylon_username` localStorage (`loadUsername` / `saveUsername` / `clearUsername`); vault `displayName` kept in sync for backups and soft-migration.
- Greeting renders `{username.trim() || "Steward"}` as visual-only fallback; input value may be `""`.
- Exported `setUsername` persists on change (and command-bar blur re-saves).

### Ownership
- Preference key + helpers: `lib/babylon/constants.ts`, `lib/babylon/persistence.ts`
- State: `hooks/useBabylonEngine.ts`
- Presentation: `components/babylon/command-bar.tsx`

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
