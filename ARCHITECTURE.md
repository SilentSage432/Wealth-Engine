# Architecture — Wealth Engine

## Composition
```
app/layout.tsx                              → fonts, metadata, dark shell
app/globals.css                             → luxury tokens, motion, grid atmosphere
app/page.tsx                                → thin client page composer
hooks/useBabylonEngine.ts                   → state, persistence, allocation actions, derived metrics
types/babylon.ts                            → canonical TypeScript contracts
lib/babylon/engine.ts                       → pure 10/20/70 allocation math + affordability / due helpers
lib/babylon/persistence.ts                  → localStorage load/save/clear + backup validate/build
lib/babylon/constants.ts                    → rates, wisdom, nav, labels, EMPTY_STATE
components/babylon/*                        → presentation zones (sidebar, triad, affordability, charts, ledgers, dialog)
components/ui/*                             → shadcn-styled Radix primitives
lib/utils.ts                                → cn, currency, ids
```

## Babylon Engine flow
```
Gross Income
    ├─ 10% → Wealth Archive (immutable keep)
    ├─ 20% → Debt pot
    │         ├─ if remainingDebt > 0 → apply to creditors (smallest first)
    │         └─ else → redirect into Wealth Archive
    └─ 70% → Expenditure Allowance
              └─ Expenses (Need | Desire, with dueDate) draw down remaining
```

## Ownership rules
- Allocation math is owned by `lib/babylon/engine.ts` (pure) and composed by `useBabylonEngine`.
- Charts and tables **consume** derived state; they never recompute splits.
- Presentation components render only; they never own ledger state.
- `RecordTributeDialog` owns ephemeral form fields; the hook owns durable ledger mutations (`addIncome` / `addExpense` / `addDebt` / `clearAllData` / `exportBackup` / `importBackup`).

## Persistence contract
Key: `wealth-engine-babylon-v2`  
Shape: `{ incomes, expenses, debts, allocations, displayName }`  
Expenses require `dueDate` (ISO). Cold start: empty arrays when no stored payload exists.  
Portable backup shape: `LedgerBackup` (`version: 1`, `exportedAt`, plus full persisted arrays).
