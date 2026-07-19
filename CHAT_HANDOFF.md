# Chat Handoff

## Project
**Wealth Engine** — executive financial budgeting SPA based on *The Richest Man in Babylon* 10/20/70 formula.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, actions, metrics)
- Pure engine: `lib/babylon/engine.ts`
- Types: `types/babylon.ts`
- Shell: `app/layout.tsx`, `app/globals.css`
- Primitives: `components/ui/*`
- Feature UI: `components/babylon/*`, `components/dashboard/BudgetBlueprint.tsx`
- Helpers: `lib/utils.ts` (`cn`, currency formatters, `generateId`)

## Run locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

## State model
Persisted in `localStorage` (`wealth-engine-babylon-v2`) as:
- `incomes[]` — with precomputed `wealthShare` / `debtShare` / `expenditureShare`
- `expenses[]` — `need` | `desire`, mandatory `dueDate`, optional `budgetCategoryId`
- `debts[]` — `totalDebt`, `remainingDebt`, `monthlyAllocation` (required on create)
- `allocations[]` — historical events for charts
- `budgetTargets[]` — steward-configured planned caps for Necessary Expenditures buckets (starts empty)
- `displayName`

Hydration: load from localStorage when present; otherwise empty ledger + empty budget blueprint. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`. Desire expenses without `budgetCategoryId` map to the legacy discretionary id when present.

## Mutations (hook exports)
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active)
- `addExpense` — ID + Need/Desire + due date + required `budgetCategoryId`
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `addBudgetTarget` — ID + custom category name / planned cap / essential flag (persisted)
- `updateBudgetTarget` — adjust a category planned amount (persisted)
- `clearAllData` — wipe localStorage and reset in-memory ledger (including empty blueprint)
- `exportBackup` — download versioned `LedgerBackup` JSON
- `importBackup` — strict schema validation, overwrite vault, force state reset

## Derived budget metrics
- `budgetVariances` — current-month Planned vs. Actual per target (`buildBudgetVariances`)
- `budgetPlannedTotal` / `budgetActualTotal` — rollups for the blueprint header
- Amber tone when category used % ≥ 85 (`BUDGET_WARNING_PCT`)

## Command Deck utilities
- **Affordability Anchor** — discretionary amount → % of remaining Desires pool (`currentMonthRemaining`) + labor hours from `effectiveHourlyRate(incomes)`
- **Budget Blueprint** — steward-defined buckets with inline planned-cap edits + dual progress; empty state until categories are added via Manage Categories
- **Configure Budget Blueprint** — dialog launched from command bar to append custom buckets

## Known behaviors
- Recording income runs `allocateIncome()` and optionally `applyDebtAllocation()`.
- Deleting an income removes its allocation event but does **not** reverse prior debt reductions (by design for this SPA; reverse-amortization can be added later).
- Empty ledgers show a single guidance row; empty charts show placeholder copy (no synthetic Recharts data).
- Expenses due within the next 7 days show an amber “Due soon” tag in the ledger.
- Changing a budget cap, adding a category, or recording an expense immediately refreshes variances (single hook owner).
- Expense tribute requires at least one budget category; category dropdown reads live `budgetTargets`.

## Next candidates
- Debt payment waterfall visualization
- Recurring income scheduling automation
- Optional multi-profile vaults
- UI affordance for `clearAllData` (hook already exports it)
- Paid/settled toggle for expenses (due-soon currently treats all ledger expenses as open)
- Edit / delete budget buckets (add + update-cap already exist)
- Auto-scale budget caps from current-month 70% pool
