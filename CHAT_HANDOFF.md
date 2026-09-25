# Chat Handoff

## Project
**Wealth Engine** — personal ledger using a 10/20/70 split: Wealth Building, Debt Payoff, and a Living Budget. The method was inspired by *The Richest Man in Babylon*.

**Architecture map:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, dependency rules, canonical ownership matrix.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, auth, actions, metrics). Sign-in does not hydrate or upload the vault.
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
- Cloud vault: `lib/babylon/cloud-vault.ts`, `lib/babylon/cloud-owner.ts`, `supabase/migrations/20260925_wealth_engine_vault.sql`
- Cloud setup: `lib/babylon/cloud-setup.ts`. Relational ledger writes in `cloud-sync.ts` were removed.
- Schema: `supabase/migrations/20260719_init_babylon_schema.sql`, `supabase/migrations/20260807_add_debts_archives_logs.sql` (`debt_entries`, `period_archives`; `activity_logs` from init), `supabase/migrations/20260925_wealth_engine_vault.sql` (one planning document per user; not applied to the new project yet)
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
- `openingWealthBuilding` / `openingEmergencyFund` — existing designations inside current Money Available. Missing on older vaults; loads as `0`. Not income, not allocation events, and not cloud-backed.
- `recurringObligations[]` — monthly bill rules. Missing on older vaults; loads as `[]`. Not spending and not cloud-backed. Generated months are ordinary expenses with `recurringObligationId` and `recurrenceMonth`. `skippedMonths` stops a deleted month from coming back.
- `activityLog[]` — mutation feed for Recent Activity (newest first, capped)
- `emergencyShield` — tracked Emergency Fund from Monthly Close surplus only
- `periodArchives[]` — sealed month snapshots
- `lastClosedMonthKey` — YYYY-MM of the last sealed period (or null)
- `displayName` — mirrored into vault for backup compatibility; canonical UI preference is `babylon_username`

Hydration: load ledger from localStorage when present; username from `babylon_username` (soft-migrates from vault `displayName` once). Empty ledger + empty budget blueprint. No demo seed.
Legacy expenses without `dueDate` soft-migrate to use `date`. Want expenses (`category: "desire"`) without `budgetCategoryId` map to the legacy discretionary id when present. Expenses without `isSettled` soft-migrate to `true`. Vaults without `expenseSemanticsVersion: 2` mark every remaining unsettled expense paid once, because those rows were already counted as spent.

## Mutations (hook exports)
- `addAccount` / `updateAccount` / `removeAccount` — Financial Position only. Never calls `addIncome`, `proposeIncomeSplit`, or `allocateIncome`
- `updateProtectedDesignations` — sets Existing Wealth Building and Existing Emergency Fund when their sum fits inside Money Available. Does not change balances, income, allocations, or the activity log
- `addIncome` — ID + 10/20/70 allocation (+ debt waterfall when active); appends activity log
- `addExpense` — Need/Want, due date, category, and Already Paid (`isSettled: true`) or Upcoming (`isSettled: false`). Upcoming may repeat monthly. Already Paid cannot. A monthly rule does not cloud-write its generated occurrences
- `updateExpenseOccurrence` — changes one expense amount and due date. A generated month does not rewrite the rule
- `updateRecurringObligation` — changes the rule for months generated after the save. Existing occurrences stay. `isActive: false` stops new months and keeps history
- `addDebt` — ID + creditor tracking with mandatory monthly allocation
- `addBudgetTarget` — ID + custom category; returns new id or `null`; optional `{ closeModal: false }` for inline create
- `updateBudgetTarget` / `updateBudgetTargetFull` — adjust caps / name / essential flag
- `deleteBudgetTarget(id, reassignToId?)` — remove bucket; reassign or uncategorize orphans
- `toggleExpenseSettled(id)` — same row. Paying sets the transaction date to the local day and does not copy the due date. Reopening leaves that date unchanged
- `autoScaleBudgetCaps()` — proportionally fit planned caps to `currentMonthExpenditurePool`
- `closeMonth(disposition)` — archive period, dispose 70% surplus, seal `lastClosedMonthKey`. Does not mark unpaid expenses paid, does not change existing protected designations, and does not generate or pay recurring bills
- `clearAllData` — wipe vault + reset workspace, including existing protected designations and recurring rules
- `exportBackup` / `importBackup` — versioned vault including activity log, shield, period archives, accounts, protected designations, and recurring rules. New exports are version 5. Version 1 imports with an empty account list. Versions 1 and 2 import unsettled expenses as paid. Versions 3–5 keep upcoming rows unpaid. Versions 1–3 import protected designations as 0. Versions 4 and 5 keep them. Versions 1–4 import with no recurring rules. A version 5 file missing rules or protected amounts is rejected. Older builds reject version 5. Import does not duplicate a rule month that is already present or skipped

## Financial Position vs allocation
- **Financial Position** — manually entered current account balances
- **Income** — newly received money that enters the 10/20/70 Allocation Engine
- **Living Budget** — the 70% allocation produced from new income
- **Money Available** — sum of current manual account balances. It is not safe-to-spend, not Living Budget remaining, and not net worth. Paying an expense does not change it. Existing protected designations are included in it and do not change it
- **Protected Money** — Existing Wealth Building plus Existing Emergency Fund. This is the portion of current Money Available the user has designated. It is not extra money, and it does not include historical allocations
- **Tracked Wealth Building** — sum of recorded allocation wealth. The Wealth Building card adds the existing designation to this. Allocation charts stay tracked-only
- **Tracked Emergency Fund** — `emergencyShield`, from month-close surplus only. The month-close balance adds the existing designation to this
- **Upcoming obligation** — an expense that is not yet paid (`isSettled: false`)
- **Actual spending** — a paid expense. Living Budget remaining subtracts only this
- **Upcoming Needs** — sum of every unpaid Need, including recurring occurrences already on the ledger and any unpaid Need dated further out. It is not limited to this month or the next seven days, and it is not subtracted from Money Available
- **Available After Planned Needs** — Money Available minus Protected Money minus Upcoming Needs, floored at zero. Planned Needs Shortfall is the amount by which those two claims exceed Money Available. It is derived and not saved. It does not subtract Living Budget Remaining, tracked Wealth Building, tracked Emergency Fund contributions, Upcoming Wants, or paid expenses. Recurring rules are not subtracted; their generated unpaid Need rows are. Future paychecks are not included. It is not a promise that the remainder is safe to spend
- **Recurring obligation** — a monthly rule. It is not spending and it is not added to Upcoming Needs
- **Occurrence** — one month's Upcoming expense generated from that rule. It becomes spending only when marked paid
- Overview places Financial Position, including Available After Planned Needs, then Upcoming Needs, then the Living Budget. Coming up, under Upcoming Needs, lists the next unpaid bills, including Wants. The derived figure uses the full Upcoming Needs total, not that preview. Month close does not settle unpaid expenses, change account balances, clear protected designations, or pay recurring bills
- An expected payday is not received income. Recurrence does not create income or run 10/20/70
- A future Sindarin forecast is external context. It may disagree with a Wealth Engine bill. The user confirms any change. Sindarin is not integrated

## Derived budget metrics
- `budgetVariances` / `budgetPlannedTotal` / `budgetActualTotal`
- Over-plan banner when planned total exceeds `currentMonthExpenditurePool`
- `recentActivity` — last 5 `activityLog` events
- `monthlyCloseSummary` — closing-month income/spend/10/20/70 rollup
- `emergencyShield` — tracked Emergency Fund from a monthly-close surplus choice. The represented total also includes `openingEmergencyFund`
- `availableAfterPlannedNeeds` — derived in the session from Money Available, Protected Money, and Upcoming Needs. Not persisted

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
- Sidebar cloud state says "Cloud account connected" until a confirmed revision exists. It then shows "Cloud vault revision N" and that new entries stay on this device. Sign-in itself does not upload or download.
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
- WE-SYNC-004 continuous sync after the confirmed revision. A later edit does not upload itself.

## Cloud vault — WE-SYNC-003
- The financial plan lives in `wealth_engine_vaults` (`user_id`, `schema_version`, `vault_data`, `revision`, `updated_at`). Schema version 5 matches backup generation. The localStorage key suffix `v2` is not that version.
- Sign-in stores the Supabase user id only. It does not upload or replace the vault.
- Initialize is offered only when this device has financial data, the cloud row is absent, and `wealth-engine-cloud-owner` is unset or already this user. The user must confirm. The app reads the row back, checks revision 1 and the document, then saves the owner key. The local vault stays.
- An empty device can confirm “Load my Wealth Engine from cloud.” A device that already has accounts, income, expenses, debts, allocations, categories, protected money, shield surplus, archives, a closed month, or recurring rules is not emptied and is not uploaded.
- A different owner key, a newer schema, or an invalid vault stops both directions.
- After the link, new entries stay local. `updateCloudVault` is not called from setup.
- Sign-up can still write `profiles.username`. Sign-out clears only the session.
- The migration `20260925_wealth_engine_vault.sql` is still not applied, and the desktop is not pointed at the new project.
- If the vault table is missing, the sidebar says the cloud vault is unavailable and does not treat that as an empty vault.

## Path B polish (complete)
- Add hotkeys: `N` / `Ctrl+N` / `Cmd+N` via `useTributeHotkeys`
- Paid-state pulse + opacity transitions; inline category expand
- Income breakdown tooltips; Financial Guidance panel
