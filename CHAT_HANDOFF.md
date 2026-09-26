# Chat Handoff

## Project
**Wealth Engine** — personal ledger using a 10/20/70 split: Wealth Building, Debt Payoff, and a Living Budget. The method was inspired by *The Richest Man in Babylon*.

**Architecture map:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, dependency rules, canonical ownership matrix.

## Entry points
- App surface: `app/page.tsx` → `components/babylon/wealth-engine-dashboard.tsx`
- Domain hook: `hooks/useBabylonEngine.ts` (state, persistence, auth, actions, metrics). Sign-in does not itself upload or download. Later edits sync through the revision cycle.
- Pure engine: `lib/babylon/engine.ts`
- Speed-Tribute presets: `lib/babylon/presets.ts` (`QuickPreset`, `DEFAULT_PRESETS`, kind resolvers → domain)
- Quick Add bar: `components/babylon/speed-tribute-bar.tsx` (chips open Add; full 1-tap commit pending)
- Mobile focus: `components/babylon/spending-power-focus.tsx` (70% remaining + labor-hour readout)
- Phone shell: below `lg` (1024px), only the phone tree mounts. One local destination owns Home, Budget, Ledger, and More (`mobileDestination` in `wealth-engine-dashboard.tsx`). It is not synced with desktop `activeNav`. The bottom bar is `components/babylon/mobile-bottom-nav.tsx`. The compact header is `components/babylon/mobile-header.tsx`. Phone Home (`components/babylon/mobile-home.tsx`) is attention, Money Available, Protected Money, Available After Planned Needs, a three-item upcoming preview, and a short recent slice. Due actions stay Paid / Still upcoming. Last-day month-close Attention stays in the header. Budget holds the living-budget cards, 10/20/70, blueprint, debt freedom, analytics, and affordability. More holds account management, profile editing, Close Month, bank connection, Financial Guidance, and `VaultMaintenancePanel`. At `lg` and above only the desktop tree mounts (`hooks/useDesktopLayout.ts`): sidebar, `CommandBar`, and `SpeedTributeBar`. Those sticky surfaces stay opaque slate
- Security: `components/babylon/security-gate.client.tsx` (`next/dynamic` `ssr: false`) → `security-gate.tsx` + `vault-error-boundary.tsx` + `lib/babylon/security.ts` (fail-soft PIN setup, 1.5s WebAuthn timeout + PIN bypass, 3-min idle lock, multitasking privacy blur); Discreet Mode via the desktop CommandBar eye toggle and the phone header eye toggle
- Paycheck splitter: `components/modals/PaycheckSplitterModal.tsx` — `proposeIncomeSplit` → execute 10/20/70
- Debt freedom: `components/babylon/debt-freedom-engine.tsx` — Snowball/Avalanche + Freedom Date + velocity chart
- Monthly close sweeps: `split_50_50` | `wealth_boost` | `rollover` | `emergency_shield` (+ legacy `debt_wealth`)
- Plaid Link UI: `components/babylon/plaid-link-button.tsx` (always mounted; init toast fallback), `connected-banks-card.tsx`, `hooks/usePlaidConnections.ts` (command bar + Overview); API routes remain JWT + server-secret only
- Plaid (hardened prep): `app/api/plaid/*` (JWT + server secrets), `lib/babylon/plaid-server.ts`, `plaid-client.ts`, `plaid-schema.ts`, `plaid-foreground-sync.ts`, `plaid-account-bootstrap.ts`, migrations `20260808_plaid_tables.sql`, `20260926_plaid_transaction_sync.sql`, `20260927_plaid_accounts.sql`, and `20260928_plaid_account_identity.sql` (access_token plaintext, service-role only, never client-readable). After the signed-in Item list is ready, `hooks/usePlaidConnections.ts` calls `POST /api/plaid/sync-transactions` once per Item. The service worker does not. Account descriptors are observational metadata on `plaid_accounts`. Balances are not stored. A production incremental sync reported an empty `accounts` array (`accountsPresent=true`, `accountsCount=0`, `parsedAccountsCount=0`, `pageAccepted=true`). After that sync, an Item with no descriptors is read once from `/accounts/get`. The cursor stays independent. The temporary account probe is removed. `20260928` is written and not applied from the app. Live descriptors are not accepted yet.
- Observational stopping boundary (WE-ATTENTION-006): complete. The two committed reasoners stay unwired. On a fresh read-only export of 339 observations, 4 pending, 0 removed, and 7 account descriptors, the partition is Class A 94 movement participants, Class B 86 repetition participants after that exclusion, Class C 4 current pending, Class D 0 removed, and Class E 155 posted/current observations in neither reasoner. 94 + 86 + 4 + 0 + 155 = 339. A and B are disjoint. No pending or removed observation is in A or B. All 155 Class E observations are legitimate isolated posted/current observations (155 isolated, 0 ineligible). No eligible Class E observation shares a user, an account, and exact normalized signed cents with another. Isolation is a valid absence of a higher-order relationship, not a failure. Lifecycle pointers on current posted rows, exact one-to-many cent partitions, and same-sign same-cent cross-account same-date groups are each 0. One exact-cent opposite-sign pair outside Class A occurred once and failed multiple committed movement gates. Category text reused across differing amounts is not identity. The system should never know more than its evidence entitles it to know. Both reasoners remain unwired
- Minimum in-app attention (WE-ATTENTION-007B): `lib/babylon/attention.ts`. An unpaid expense with a civil due date on or before the local financial day appears in the Upcoming Needs card, apart from Coming Up. Paid calls `toggleExpenseSettled`. Still upcoming writes nothing and the row stays eligible. On the last local day of an open month, the command bar says that month is still open and ends today. Review close opens the existing Close Month ritual and does not call `closeMonth`. A previous month is not closed after the calendar rolls. No acknowledgement store, snooze, notification, schema change, or observational wiring. Not core-complete until the running UI is accepted
- Observed repetition: `lib/babylon/observed-repetition.ts` (`deriveObservedRepetitions`). Pure, derived, unwired, and semantic-free. Current posted observations that share a user, a Plaid account, a sign, and exact normalized cents. Two members are a repeated structure plus one civil-day gap. Three or more report whether those gaps agree or differ. Category text is evidence, not membership. No persistence, cadence label, prediction, or score. Optional excluded transaction ids omit movement participants without importing the movement reasoner. A recurring obligation stays a steward-declared plan rule. Positive cents are money out of that Plaid account. Negative cents are money in. WE-ATTENTION-005C accepted it on a fresh read-only export of 339 observations, 4 pending, 0 removed, and 7 account descriptors, after the movement reasoner again returned 47 / 24 / 23 / 94 / 0. Excluding those 94 ids produced 31 disjoint structures and 86 observations: 17 pairs, 9 of three, 2 of four, 1 of five, 2 of six (maximum 6); 30 positive and 1 negative; 17 single gaps, 5 agreeing, 9 differing; category text 23 equal, 8 differing, 0 absent. The posted subset of at least three members is 14, all positive, 52 observations. WE-ATTENTION-005A's discovery count of 15 remains historical because one group included one pending row and two posted rows. Four structures on one anonymous checking account have three posted members, gaps of 31 and 31, agreeing intervals, and equal category text. A fifth has those gaps and agreeing intervals with differing category text. The 17 pairs, including one negative pair, are one observed gap only. No negative structure reaches three members. The temporary runner is gone. The function remains unwired
- Correlated Internal Movement: `lib/babylon/correlated-internal-movement.ts` (`deriveCorrelatedInternalMovements`). Pure interpretation of two posted observations. Kinds are `internal_transfer` and `credit_card_payment`. Penny-exact cents. Ambiguous pairs are omitted. Not persisted and not wired. WE-ATTENTION-004C live-accepted it from a read-only production export: 339 observations, 4 pending, 0 removed, 7 account descriptors, 47 movements, 24 transfers, 23 card payments, 94 participating observations, 0 overlaps. No income, expense, transfer, or 10/20/70 write. Future inflow or outflow candidates may exclude the accepted transaction ids. The steward still decides what is recorded. WE-ATTENTION-005A reran that same function, reproduced 47 / 24 / 23 / 94 / 0, and subtracted those exact ids. The residual corpus is 245 observations: 241 posted/current, 4 pending, 0 removed; 232 positive, 13 negative, 0 zero. Fifteen same-account repeated groups are all positive (7 monthly, 7 mixed, 1 none, 0 weekly, 0 biweekly). Four posted groups on one anonymous checking account share one literal category, three occurrences, and gaps of 31 and 31 days. Residual negatives have no such group. Residual same-cent cross-account pairs are 0, so the predicate was not loosened. An observation is not semantic truth. Recurrence is not semantic truth. Plaid category text is evidence, not authority. Plaid sign is direction on that account, not whole-system meaning. Unknown remains valid. No income, paycheck, expense, bill, subscription, employer, merchant, or account purpose was established. WE-ATTENTION-005C accepted the separate observed-repetition reading. The historical discovery count of 15 groups remains 15. The accepted posted reading is 14 because one exploratory group included a pending row.
- Fail-soft toasts: `lib/babylon/vault-toast.ts` + `components/ui/vault-toast.tsx` (dismissible; `durationMs: 0` sticky)
- Add: `components/modals/RecordTransactionModal.tsx` (preventDefault + try/catch; buttons default non-submit)
- Types: `types/babylon.ts`
- Shell: `app/layout.tsx` → `app/providers.tsx` (TanStack Query), `app/globals.css`, `app/manifest.ts`
- Cloud client: `lib/supabase/client.ts`, `lib/supabase/auth.ts`, `lib/supabase/server.ts` (API JWT + service role), `lib/supabase/database.types.ts`
- Cloud vault: `lib/babylon/cloud-vault.ts`, `lib/babylon/cloud-owner.ts`, `supabase/migrations/20260925_wealth_engine_vault.sql`
- Cloud setup: `lib/babylon/cloud-setup.ts`. Relational ledger writes in `cloud-sync.ts` were removed.
- Revision sync: `lib/babylon/vault-sync.ts`. Baseline key `wealth-engine-cloud-sync`.
- Schema: `supabase/migrations/20260719_init_babylon_schema.sql`, `supabase/migrations/20260807_add_debts_archives_logs.sql` (`debt_entries`, `period_archives`; `activity_logs` from init), `supabase/migrations/20260925_wealth_engine_vault.sql` (one planning document per user)
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
- `toggleExpenseSettled(id)` — same row. Paying sets the transaction date to the local day and does not copy the due date. Reopening leaves that date unchanged. Due attention on the Upcoming Needs card calls this for Paid and does not call it for Still upcoming
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
- **Close Month** — desktop command-bar "Close Month", and the phone More "Close Month" button, open the 3-step modal. On the last local day of an open month, "Review close" in the desktop command bar and in the compact phone header opens that same modal
- **Ledger** — income, expenses, and debts; paid marks on expenses

## Known behaviors
- Recording income runs `allocateIncome()` (penny-exact 10/20/70; shares sum to gross) and optionally `applyDebtAllocation()`.
- Financial "today" is the local calendar day (`todayIso`), not UTC. The ledger hook advances that day at the next local midnight (and when a backgrounded tab returns on a new day). The visible CommandBar clock is a local one-second timer on the desktop branch and does not rerender the dashboard. The phone header does not run a clock.
- Main income rate is the latest recurring deposit per income source. Repeated paychecks from the same source do not stack into extra wages. `source` is the only way two simultaneous jobs stay separate.
- Sidebar cloud state says "Cloud account connected" before a vault link. After a verified match it says "Up to date · revision N". Unsent edits say they are waiting or saved offline. A conflict says both copies were preserved. Sign-in itself is not labeled synced.
- Plaid Link success means the institution link was saved. The signed-in app then requests one observation sync for each connected Item, including an Item that was just linked. Production has stored 339 observations across 5 Plaid account ids without changing vault revision 4 / schema 5. Those rows stay out of the vault. A negative Plaid amount is money in. It is not income until a future confirmation tranche says so. Account name, mask, type, and subtype are observational metadata once `20260927_plaid_accounts.sql` is applied. Live descriptors are not accepted until that verification.
- Deleting an income reverses its `debtShare` via `reverseDebtAllocation` (remainingDebt clamped ≤ totalDebt).
- The Living Budget card is **this month's** budget and spending.
- Unpaid expenses show Upcoming, Due soon (today through 7 days), or Overdue. Paid rows show Paid. Legacy vaults without the upcoming marker migrate unsettled rows to paid once.
- A month may be closed once per calendar month key; historical ledgers remain for charts.
- Overview does not embed the full Ledger.

## Next candidates (Phase 3)
- WE-ATTENTION-007B is implemented and waiting for acceptance in the running UI. Observational attention is still unwired. Do not start with another detector
- Multi-currency / shared household vaults
- Debt payment waterfall visualization
- Recurring income scheduling automation
- WE-SYNC-005 a deliberate choice between the two preserved copies after a conflict. This tranche only stops.

## Cloud vault — WE-SYNC-004
- The financial plan lives in `wealth_engine_vaults` (`user_id`, `schema_version`, `vault_data`, `revision`, `updated_at`). Schema version 5 matches backup generation. The localStorage key suffix `v2` is not that version.
- The desktop bootstrap is already revision 1. This code does not modify that row. A device with no sync baseline adopts revision 1 only when its document matches the cloud.
- Sign-in stores the Supabase user id only. The revision cycle runs after that, from startup, foreground, reconnect, or Check cloud. There is no polling and no realtime channel.
- Local edits still save immediately. If the cloud revision is still the verified one, the whole vault is pushed with compare-and-swap. The device becomes clean at N+1 only after the read-back matches. A failed read-back stays unverified and is not retried at revision N.
- If the cloud revision is newer and this device is clean, that document is saved locally and checked through the normal load path.
- If both sides changed, neither is overwritten. The sidebar asks for a backup before any later choice.
- An empty device can still confirm “Load my Wealth Engine from cloud.” A non-empty device that differs from the cloud is not replaced and is not uploaded.
- A different owner key, a newer schema, an invalid vault, or a cloud revision older than this device stops both directions.
- Sign-out clears only the session. The financial vault and the sync baseline stay.
- Plaid remains outside `vault_data`. Transaction sync does not write this table.
- Choosing which conflict copy to keep is not implemented.

## Path B polish (complete)
- Add hotkeys: `N` / `Ctrl+N` / `Cmd+N` via `useTributeHotkeys`
- Paid-state pulse + opacity transitions; inline category expand
- Income breakdown tooltips; Financial Guidance panel
