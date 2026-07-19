# Chat Handoff

## Project
**Wealth Engine** — executive financial budgeting SPA based on *The Richest Man in Babylon* 10/20/70 formula.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, actions, metrics)
- Pure engine: `lib/babylon/engine.ts`
- Types: `types/babylon.ts`
- Shell: `app/layout.tsx`, `app/globals.css`, `app/manifest.ts`
- PWA: `public/sw.js`, `components/layout/ServiceWorkerRegistrar.tsx`, `public/icons/*`
- Primitives: `components/ui/*`
- Feature UI: `components/babylon/*`, `components/dashboard/BudgetBlueprint.tsx`, `components/dashboard/TributeEnginesPanel.tsx`, `components/modals/RecordTransactionModal.tsx`
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
- `displayName` — mirrored into vault for backup compatibility; canonical UI preference is `babylon_username`

Hydration: load ledger from localStorage when present; username from `babylon_username` (soft-migrates from vault `displayName` once). Empty ledger + empty budget blueprint. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`. Desire expenses without `budgetCategoryId` map to the legacy discretionary id when present.

## Mutations (hook exports)
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active)
- `addExpense` — ID + Need/Desire + due date + required `budgetCategoryId`
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `addBudgetTarget` — ID + custom category name / planned cap / essential flag; returns new id or `null`; optional `{ closeModal: false }` for inline Expense-tab create
- `updateBudgetTarget` — adjust a category planned amount (persisted)
- `updateBudgetTargetFull` — edit name / cap / essential flag
- `deleteBudgetTarget(id, reassignToId?)` — remove bucket; reassign linked expenses to another category or leave Uncategorized
- `clearAllData` — wipe localStorage and reset in-memory ledger (including empty blueprint); exposed via sidebar AlertDialog confirmation
- `exportBackup` — download versioned `LedgerBackup` JSON
- `importBackup` — strict schema validation, overwrite vault, force state reset

## Derived budget metrics
- `budgetVariances` — current-month Planned vs. Actual per target (`buildBudgetVariances`)
- `budgetPlannedTotal` / `budgetActualTotal` — rollups for the blueprint header
- Amber tone when category used % ≥ 85 (`BUDGET_WARNING_PCT`)
- Over-plan banner when planned total exceeds `currentMonthExpenditurePool`

## Command Deck utilities
- **Affordability Anchor** — discretionary amount → % of remaining Desires pool (`currentMonthRemaining`) + labor hours from `effectiveHourlyRate(incomes)`
- **Budget Blueprint** — steward-defined buckets; pencil opens Modify Budget Bucket (edit / delete + orphan reassignment)
- **Record Tribute** — universal entry modal; Expense tab supports inline category create + explicit transaction date; mutation failures surface inline alerts
- **Ledger Matrices** — detailed flat ledgers live only under Ledger Matrices nav (not on overview)

## Known behaviors
- Recording income runs `allocateIncome()` and optionally `applyDebtAllocation()`.
- Deleting an income reverses its `debtShare` via `reverseDebtAllocation` (remainingDebt clamped ≤ totalDebt) and removes its allocation event.
- Golden Triad Necessary Expenditures card is **current-month** pool/spend; wealth/debt cards remain lifetime archive metrics.
- `desiresPoolRemaining` is the discretionary slice of the 70% pool (after needs reservation), not the full unspent allowance.
- Affordability labor hours use **primary** recurring income only.
- Incomes carry `IncomeStreamKind` (`primary` | `side_hustle` | `passive` | `other`); legacy rows soft-migrate to `primary`.
- Empty ledgers show a single guidance row; empty charts show placeholder copy (no synthetic Recharts data).
- Expenses due within the next 7 days show an amber “Due soon” tag in the ledger.
- Changing a budget cap, adding/editing/deleting a category, or recording an expense immediately refreshes variances (single hook owner).
- Expense tribute requires a selected budget category (create inline on Expense tab or via Budget Category tab); category dropdown reads live `budgetTargets`.
- Viewport shell uses a mobile drawer (<1024px) and locked desktop sidebar; ledger tables scroll horizontally on narrow screens.
- Overview Command Deck does not embed full Ledger Matrices — use Ledger Matrices nav for detailed record lists.

## Next candidates
- Debt payment waterfall visualization
- Recurring income scheduling automation
- Optional multi-profile vaults
- Paid/settled toggle for expenses (due-soon currently treats all ledger expenses as open)
- Auto-scale budget caps from current-month 70% pool
- Recent activity strip on overview (lightweight, not full ledgers)