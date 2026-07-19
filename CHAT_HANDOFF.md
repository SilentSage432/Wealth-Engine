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
- Feature UI: `components/babylon/*`
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
- `expenses[]` — `need` | `desire`, plus mandatory `dueDate` (ISO date)
- `debts[]` — `totalDebt`, `remainingDebt`, `monthlyAllocation` (required on create)
- `allocations[]` — historical events for charts
- `displayName`

Hydration: load from localStorage when present; otherwise empty arrays. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`.

## Mutations (hook exports)
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active)
- `addExpense` — ID + Need/Desire category + mandatory due date
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `clearAllData` — wipe localStorage and reset in-memory ledger
- `exportBackup` — download versioned `LedgerBackup` JSON
- `importBackup` — strict schema validation, overwrite vault, force state reset

## Command Deck utilities
- **Affordability Anchor** — discretionary amount → % of remaining Desires pool (`currentMonthRemaining`) + labor hours from `effectiveHourlyRate(incomes)`

## Known behaviors
- Recording income runs `allocateIncome()` and optionally `applyDebtAllocation()`.
- Deleting an income removes its allocation event but does **not** reverse prior debt reductions (by design for this SPA; reverse-amortization can be added later).
- Empty ledgers show a single guidance row; empty charts show placeholder copy (no synthetic Recharts data).
- Expenses due within the next 7 days show an amber “Due soon” tag in the ledger.

## Next candidates
- Debt payment waterfall visualization
- Recurring income scheduling automation
- Optional multi-profile vaults
- UI affordance for `clearAllData` (hook already exports it)
- Paid/settled toggle for expenses (due-soon currently treats all ledger expenses as open)
