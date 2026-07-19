# Architecture — Wealth Engine

## Composition
```
app/layout.tsx                              → fonts, metadata, dark shell
app/globals.css                             → luxury tokens, motion, grid atmosphere
app/page.tsx                                → thin client page composer
hooks/useBabylonEngine.ts                   → state, persistence, allocation actions, derived metrics
types/babylon.ts                            → canonical TypeScript contracts
lib/babylon/engine.ts                       → pure 10/20/70 allocation math + affordability / due / budget / surplus helpers
lib/babylon/persistence.ts                  → localStorage load/save/clear + backup validate/build
lib/babylon/constants.ts                    → rates, wisdom, nav, labels, EMPTY_STATE, username key
components/babylon/*                        → presentation zones (sidebar, triad, affordability, charts, ledgers)
components/modals/RecordTransactionModal.tsx → universal entry (income / expense / debt / budget)
components/modals/MonthlyCloseModal.tsx     → period close ritual (summary → surplus → archive)
components/dashboard/BudgetBlueprint.tsx    → Necessary Expenditures planning (+ auto-scale)
components/dashboard/RecentActivityStrip.tsx → Command Deck mutation feed
components/ui/*                             → shadcn-styled Radix primitives
lib/utils.ts                                → cn, currency, ids, relative time
hooks/useTributeHotkeys.ts                  → global Record Tribute keyboard shortcuts
components/ui/tooltip.tsx                   → accessible micro-tooltips
```
## Babylon Engine flow
```
Gross Income
    ├─ 10% → Wealth Archive (immutable keep)
    ├─ 20% → Debt pot
    │         ├─ if remainingDebt > 0 → apply to creditors (smallest first)
    │         └─ else → redirect into Wealth Archive
    └─ 70% → Expenditure Allowance
              ├─ BudgetTargets (planned caps per operational bucket)
              └─ Expenses (Need | Desire, dueDate, budgetCategoryId, isSettled) draw down remaining

Monthly Close surplus (unspent 70%)
    ├─ Debt/Wealth multiplier (⅓ wealth / ⅔ debt when active; else all wealth)
    └─ Emergency Shield reservoir
```

## Ownership rules
- Allocation math is owned by `lib/babylon/engine.ts` (pure) and composed by `useBabylonEngine`.
- Budget variance (`buildBudgetVariances`) and cap scaling (`scaleBudgetCapsToPool`) are owned by the pure engine; the hook selects current-month expenses and persists `budgetTargets`.
- Charts and tables **consume** derived state; they never recompute splits.
- Presentation components render only; they never own ledger state.
- `RecordTransactionModal` owns ephemeral form fields (including inline category draft + form feedback); the hook owns durable ledger mutations (`addIncome` / `addExpense` / `addDebt` / `addBudgetTarget` / `updateBudgetTarget` / `updateBudgetTargetFull` / `deleteBudgetTarget` / `toggleExpenseSettled` / `autoScaleBudgetCaps` / `closeMonth` / `clearAllData` / `exportBackup` / `importBackup`).
- Budget Blueprint edit dialog owns ephemeral edit fields and orphan-reassignment choice; durable changes go through `updateBudgetTargetFull` / `deleteBudgetTarget(id, reassignToId?)`.
- `MonthlyCloseModal` owns ritual step UI; `closeMonth` owns archive + surplus application + period seal.
- Overview Command Deck composes KPIs + analytics + Recent Activity; `LedgerMatrices` mounts only under Ledger Matrices nav.

## Persistence contract
Key: `wealth-engine-babylon-v2`  
Shape: `{ incomes, expenses, debts, allocations, budgetTargets, displayName, activityLog, emergencyShield, periodArchives, lastClosedMonthKey }`  
Expenses require `dueDate` (ISO), `isSettled` (legacy → `true`), and optionally `budgetCategoryId`.  
Cold start: empty ledger arrays + empty `budgetTargets` + empty activity/archives + zero shield.  
Profile name: dedicated `babylon_username` preference (may be empty); greeting falls back to “Steward” visually only.  
Portable backup shape: `LedgerBackup` (`version: 1`, `exportedAt`, plus full persisted arrays; Phase-2 fields optional on import).
