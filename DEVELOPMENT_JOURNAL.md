# Development Journal

## 2026-09-29 — WE-PAYCHECK-FUNDING-002 monthly purpose temporal decomposition

### What changed
- Pure `lib/babylon/paycheck-funding.ts`: finalized `MonthlyPlanRevision` purposes decompose across same-period `ExpectedPayday[]` into derived `PaycheckFundingPlan` / responsibilities.
- Living: each `categories[]` purpose independently conserved. Wealth: `wealthShare`. Debt: aggregate `debtShare` (not per-creditor `monthlyAllocation`).
- Cent split uses earliest-occurrence remainder. `expectedAmount` and obligation due dates do not weight. Zero paydays → `no_expected_funding`. Not persisted. No UI / Income / Allocation / Position mutation. Backup v10; cloud schema 6; IC v3 unchanged.

### Validation
- Focused paycheck-funding tests: 22 passed.
- Relevant monthly-plan / pay-schedule / position / debt isolation: 113 passed.
- Full suite: 50 files, 719 tests passed.
- `tsc --noEmit` passed; eslint on touched files clean; production build passed; `git diff --check` clean.

### Not in this tranche
- No commit, push, deploy, UI, due-before-next-payday, matching, Attention, or Supabase work.

## 2026-09-29 — WE-PAY-SCHEDULE-001 expected pay schedule domain

### What changed
- Steward-authored `PaySchedule` rules (`weekly` / `biweekly` / `semimonthly` / `monthly`) with pure `deriveExpectedPaydays` → `ExpectedPayday` (not Income).
- Anchor for weekly/biweekly is recurrence **phase**, not a hard start cutoff.
- Semimonthly supports day pairs and `last`; weekend stays on declared civil date.
- Persist schedule rules only (`paySchedules[]`); backup **v10**; cloud schema **6** soft-add (no SQL). IC v3 unchanged. No funding UI.

### Validation
- Focused pay-schedule tests passed (21).
- Full suite: 49 files, 697 tests passed.
- `tsc --noEmit` passed; eslint on touched files clean; production build passed; `git diff --check` clean.

### Not in this tranche
- No commit, push, deploy, funding plan, Attention, or Supabase work.

## 2026-09-29 — WE-FINANCIAL-POSITION-HIERARCHY-001 promote actionable position

### What changed
- When aggregate Unavailable > 0, Financial Position hero becomes Available to use (DeployablePosition); Liquid Position + Unavailable move to supporting composition with − on Unavailable.
- Zero-restriction keeps Liquid Position as the only hero (no duplicate Available to use).
- Desktop and phone Home share adaptive hierarchy via `deriveAvailableToUsePresentation.heroKind`. No domain, schema, IC, or arithmetic change.

### Validation
- Focused composition / restriction / AAPN / IC tests passed.
- Full suite: 48 files, 676 tests passed.
- `tsc --noEmit` passed; eslint on touched files clean; production build passed; `git diff --check` clean.

### Not in this tranche
- No commit, push, deploy, or Supabase work.

## 2026-09-29 — WE-FINANCIAL-POSITION-LANGUAGE-001 owned / unavailable / available-to-use presentation

### What changed
- Steward-facing owned-liquid aggregate label is now Liquid Position (presentation only). Domain `moneyAvailable` and IC `money_available_cents` unchanged.
- When Unavailable > 0, Financial Position shows Unavailable and derived Available to use (DeployablePosition). Zero-restriction stays quiet.
- Already Set Aside remains full ProtectedOwned. AAPN context no longer uses a naïve Liquid − Protected − Needs minus waterfall.
- Shortfall copy no longer duplicates the amount; Candidate A wording; `formatCurrency` always shows two fraction digits (`$921.20`).
- Desktop Overview and phone Home share the vocabulary. No domain arithmetic, schema, SQL, or IC change.

### Validation
- Focused composition / restriction / protected / AAPN / IC tests passed.
- Full suite: 48 files, 669 tests passed.
- `tsc --noEmit` passed; eslint on touched files clean; production build passed; `git diff --check` clean.

### Not in this tranche
- No commit, push, deploy, or Supabase work.

## 2026-09-29 — WE-RESTRICTED-POSITION-003 owned vs unavailable vs deployable

### What changed
- Optional steward `FinancialAccount.restrictedAmount` (Unavailable). OWNED ≠ DEPLOYABLE. EAP unchanged by restriction.
- Money Available remains Σ full EAP (owned liquid). Deployable / DeployableProtected / FreeBeforeNeeds feed AAPN (Candidate A).
- ProtectedOwned keeps full purpose positions + residual openings. Residuals stay fully DeployableProtected (location UNKNOWN).
- Restriction conflict when declared > EAP: keep declaration, effective min, deployable 0, inline UI only.
- Backup version 9. Cloud schema 6 soft field. No SQL. IC v3 unchanged. Plaid `available` not used. No Expenses purpose, Attention, or credit-card model.

### Validation
- Focused restriction + AAPN + persistence tests passed.
- Full suite: 48 files, 660 tests passed.
- `tsc --noEmit` passed; eslint on touched files clean; production build passed; `git diff --check` clean.

### Not in this tranche
- No commit, push, deploy, or Supabase work.

## 2026-09-29 — WE-WEALTH-POSITION-003 account-backed purpose position

### What changed
- Optional steward `FinancialAccount.purpose`: `wealth_building` | `emergency_fund` (absent = ordinary liquid). Kind does not imply purpose. Plaid does not infer purpose.
- Purpose position = sum of EffectiveAccountPosition for matching accounts (`lib/babylon/account-purpose.ts`).
- Already Set Aside = purpose positions + residual openings. First designation with opening > 0 requires keep-remainder / replace-Existing / cancel reconciliation.
- Purpose set/clear/change preserves MA ($0 delta). goldRetained / emergencyShield / Monthly Plan / allocations unchanged by purpose.
- Backup version 8 (fail-closed unknown purpose). Cloud schema remains 6 (soft field on accounts[]). No SQL. IC v3 unchanged. Movement and Attention not wired.

### Validation
- Focused purpose/position/composition/persistence tests passed.
- Full suite: 47 files, 637 tests passed.
- `tsc --noEmit`, eslint on touched files, production build, `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, or Supabase work.
- No movement wiring, Attention, IC v4, OPERATING purpose, or temporal purpose history.

## 2026-09-29 — WE-ALLOCATION-EXECUTION-005 debt purpose vs position transition

### What changed
- All-or-nothing debt-position epoch: legacy vaults with debts keep `applyDebtAllocation` mutation until steward declares current owed for every debt; then `remainingDebt` is authoritative POSITION and allocation stops mutating it.
- Post-epoch: `addIncome` / `closeMonth` record aggregate `AllocationEvent.debt` plus per-creditor `DebtPurposeAttribution`; `deleteIncome` removes attributions without increasing owed. Over-allocation keeps full aggregate purpose; attribution caps at owed room.
- Steward rebase modal + banner; Golden Triad distinguishes purpose allocated vs currently owed after epoch; Financial Position Recorded Debt copy updated.
- Persistence: backup version 7; local/cloud JSON fields `debtSemanticsVersion`, `debtPositionEpochAt`, `debtPurposeAttributions`, optional `legacyModeledRemaining`. Cloud schema version stays 6 (soft-fill missing debt keys; no SQL).
- No debt execution, settlement, payment instruments, or Plaid→DebtEntry authority. Intelligence Contract v3 preserved with clarified field notes.

### Validation
- Focused: debt-semantics, allocation-execution-copy, financial-position-composition, cloud-vault, monthly-plan, engine — passed.
- Full suite: 46 files, 615 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, Supabase SQL, or execution model during implementation review.
- Finalized on main after acceptance (this finalize step).

## 2026-09-29 — WE-ALLOCATION-EXECUTION-002 semantic lock + truthful language

### What changed
- Locked Allocation ≠ Execution in ARCHITECTURE / CHAT_HANDOFF / roadmap: purpose vs execution vs position vs observation; three-share truth; debt waterfall documented as modeled purpose progress (historical compatibility), not creditor settlement.
- Truthful copy only via `lib/babylon/allocation-execution-copy.ts`: Month Close no longer claims it marks open expenses paid; Golden Triad / paycheck / phone Budget / ledgers remove "% paid off" / "Applied to…" overclaims; Wealth tracked vs Already Set Aside kept distinct; Emergency Fund / Debt Freedom qualified; Recorded Debt sibling wording clarified.
- No change to allocateIncome, applyDebtAllocation, reverseDebtAllocation, 10/20/70 math, Money Available, Protected Money, AAPN, Monthly Plan, month-close mutations, Plaid, schema, or persistence. Intelligence Contract schema/version unchanged; architecture documents that allocated/cleared fields are not settlement.
- Settlement / payment-instrument work remains blocked until historical compatibility of allocation-driven `remainingDebt` is deliberately resolved.

### Validation
- Focused: allocation-execution-copy, financial-position-composition, mobile-budget, monthly-plan-ui, engine, protected-money, available-after-planned-needs, financial-position — 8 files, 101 tests passed.
- Full suite: 45 files, 601 tests passed (was 44 / 590; +1 file, +11 tests).
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, debt math correction, settlement model, or schema.

## 2026-09-29 — WE-FINANCIAL-POSITION-003 compose existing Financial Position truth

### What changed
- Composition and wording only. No Money Available, AAPN, Protected Money math, account kinds, Plaid, or debt calculations changed.
- Desktop Financial Position and phone Home now state liquid scope (checking/savings/cash; not net worth), rename the steward-facing Protected Money block to Already Set Aside, clarify that tracked Wealth Building / Emergency Fund progress is separate, and surface Recorded Debt as sibling context (`engine.remainingDebt`) without subtracting it from Money Available or AAPN.
- Shared labels/copy live in `lib/babylon/financial-position-composition.ts`. Domain field names (`protectedMoney`, openings) unchanged.

### Validation
- Focused: financial-position-composition, mobile-home, protected-money, available-after-planned-needs, financial-position, effective-financial-position — 6 files, 70 tests passed.
- Full suite: 44 files, 590 tests passed (was 43 / 576; +1 file, +14 tests from composition contracts).
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, credit-card model, liability accounts, schema, or net worth.

## 2026-09-29 — WE-IDENTITY-UX-001 relocate steward name configuration

### What changed
- Removed the duplicate Profile name `<Input>` from desktop `CommandBar` (left of Close Month). Greeting still presents the colored steward name.
- Phone header already presented only; unchanged. Configuration stays on phone More → Financial setup.
- Desktop configuration now lives on the sidebar management surface (`AppSidebar` + shared `ProfileNameField`), above vault maintenance.
- Persistence unchanged: `engine.setUsername` → `babylon_username` / vault `displayName` mirror. No schema, auth, or financial changes.

### Validation
- Relevant: mobile-more / attention / mobile-home / layout-viewport — 4 files, 31 tests passed.
- Full suite: 43 files, 576 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, header redesign, or Settings architecture.

## 2026-09-29 — WE-VISUAL-ICONS-001 remove cartoon/emoji application icons

### What changed
- Audited user-facing TS/TSX for emoji used as application iconography. Only Quick Add presets in `lib/babylon/presets.ts` (rendered by `SpeedTributeBar`) were in scope.
- Replaced emoji strings with `lucide-react` components, matching `NAV_ITEMS` / mobile nav conventions (`ComponentType<{ className?: string }>`, `h-3.5 w-3.5`, `aria-hidden`, currentColor from chip text).
- Mapping: paycheck → `Banknote`, groceries → `ShoppingCart`, gas/transit → `Fuel`, coffee/treat → `Coffee`, rent/housing → `Home`.
- Labels, ids, kinds, categories, and `onSelectPreset` behavior unchanged. No new icon package.

### Validation
- Full suite: 43 files, 576 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.
- No test assertion updates required (no emoji markup assertions existed).

### Not in this tranche
- No commit, push, deploy, layout redesign, or financial semantics change.

## 2026-09-29 — WE-PLAN-UX-003A populated map acceptance prep

### What changed
- Confirmed empty Living purposes in acceptance were repository-correct: local vault `budgetTargets: []` (EMPTY_STATE). Wiring of `engine.budgetTargets` → `MonthlyPlanPanel` is intact. No invented defaults.
- Acceptance path: Add → Category → create BudgetTargets. First-draft drafts now merge newly created live categories into open purposes without overwriting steward amounts (`mergeFirstDraftPurposes`). Revise drafts stay on revision seed.
- Clarified empty-state copy. Tightened epistemic helper lines. Sticky Living completion banner for phone scrolling.
- Added deterministic `$1,000,000` Bills overcommit + restore coverage, and working-amount change with preserved purpose assignments.

### Validation
- Targeted: 4 files, 57 tests passed.
- Full suite: 43 files, 576 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, schema change, historical comparison, or planner redesign.

## 2026-09-29 — WE-PLAN-UX-003 interactive monthly financial map

### What changed
- Replaced the sequential Monthly Planning form with an interactive financial-map workspace on the shared `MonthlyPlanPanel`.
- Domain field `planningBasis` is unchanged. User-facing language is “Plan [Month] around.” Preview still flows through `previewMonthlyPlan` and does not create Income, AllocationEvent, Money Available, or BudgetTarget changes.
- Canonical Wealth / Debt / Living shares are a structural map element with relative widths and exact cents. Living purposes remain the interactive assignment surface. Unassigned / exact / overcommit states derive from preview cents via `lib/babylon/monthly-plan-map.ts`.
- Wealth Building shows already-protected opening Wealth Building + this plan’s Wealth share as an intention overlay (“If this plan is executed”). Emergency Fund stays separate context. Known recurring commitments remain context and do not auto-assign.
- No historical comparison, plan-vs-actual, Monthly Honesty, suggested amounts, or gamification. The planner is useful without historical comparison; that requires at least three complete comparable months later.

### Validation
- Targeted: `monthly-plan.test.ts`, `monthly-plan-ui.test.ts`, `monthly-plan-map.test.ts`, `mobile-budget.test.ts` — 4 files, 54 tests passed.
- Full suite: 43 files, 573 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, or Supabase apply.

## 2026-09-28 — WE-PLAID-RECOVERY-001A sticky Item-scoped repair clear

### What changed
- Blocking false-clear: wholesale `setRepairs(summary.repairs)` could erase `ITEM_LOGIN_REQUIRED` when a 200 summary returned empty `repairs[]` after generic failure.
- Foreground POST now returns Item-scoped `itemOutcomes` keyed by local `plaid_items.id` with `applied` | `skipped` | `not-applied`. Only `applied` (committed `balance_get`) may clear that Item.
- Client merges with `reconcilePlaidItemRepairs`. Absence from `repairs[]` is not recovery. Background GET still returns empty `itemOutcomes` and cannot clear foreground repair state.

### Validation
- Focused repair/balance suites passed (88 tests across 6 files).
- Full suite: 42 files, 563 tests passed.
- `tsc --noEmit`, lint, production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, Supabase apply, or manual Plaid call.

## 2026-09-28 — WE-PLAID-RECOVERY-001 ITEM_LOGIN_REQUIRED update-mode repair

### What changed
- Production Balance diagnostics proved `/accounts/balance/get` returns HTTP 400 `ITEM_LOGIN_REQUIRED`. Cached `accounts_get` evidence is retained.
- `POST /api/plaid/link-token` now supports CONNECT (unchanged initial Link) and REPAIR (owned local `plaid_items.id` → update-mode Link with the existing server-side `access_token`, no initial `products`).
- Foreground observe POST returns a safe `repairs` collection for `ITEM_LOGIN_REQUIRED` only. Page/session repair state drives Connections copy and Reconnect. No schema, no Attention kind, no public-token exchange on repair success.
- Repair Link success asks Balance again. Institution-refreshed provenance requires a committed `balance_get`. Link success alone is not recovery.

### Validation
- Focused and full suites passed: 41 files, 544 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No commit, push, deploy, Supabase apply, or manual Plaid call. No durable Item-health columns. No webhook. No automatic credential repair.

## 2026-09-28 — WE-BALANCE-FRESHNESS-005 foreground real-time financial position

### What changed
- Implementation is complete. Production acceptance is pending. The migration is repository source only and was not applied.
- A signed-in visible Wealth Engine now asks `/accounts/balance/get` for steward-associated depository checking and savings accounts. The browser cannot choose a user, Item, or account. An Item with no association makes no Balance request. Several associated accounts on one Item share one request. Each qualifying Item is its own request.
- `accounts_get` remains the cached `/accounts/get` source. `balance_get` is the institution reading. They share one current observation row. A real-time success may replace or upgrade a cached row. A cached write cannot replace, supersede, downgrade, or restamp a current `balance_get` row. A failed or ineligible real-time read leaves the stored row in place and does not call `/accounts/get` as a fallback.
- Freshness is `REAL_TIME_BALANCE_FRESHNESS_MS`, five minutes, which is five times the existing 60-second duplicate guard. The duplicate guard is also enforced from the stored `balance_get` `observed_at`, so a reload or a second tab inside 60 seconds does not pay for another extraction. Focus, visibility, and a single wake when that five-minute window ends re-evaluate. The wake does not call Plaid by itself. There is no interval.
- Money Available still uses eligible `balances.current`. While evidence is loading, the screen says the figure is the declared balance. A cached row is labeled cached. A fresh institution row is labeled institution-refreshed. An older institution row is not described as fresh.
- The Intelligence Contract is version `3`. Operational money remains `money_available_cents` and `effective_balance_cents`. `declared_balance_cents` is provenance and fallback. `institution_reading_age` is `fresh` or `aged` for a real-time reading, and null otherwise. `cached_accounts_get_balance` is present only when an effective observed account is still cached. The route still does not call Plaid.
- The daily observer stays on `/accounts/get`. Transaction sync and identity bootstrap are unchanged. `available` is still not Money Available. The vault is not written.

### Validation
- Focused balance, contract, and recorder tests passed.
- The full suite passed: 39 files, 529 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No migration apply, commit, push, or deploy. No transaction matching, semantic classification, vault schema change, copy into `FinancialAccount.balance`, paid cron Balance call, Intelligence Plaid call, webhook, refresh button, or switch to `balances.available`.

## 2026-09-27 — WE-PLAN-UI-001 monthly planning ritual

### What changed
- Implementation candidate. Production acceptance is pending. Desktop Overview and phone Budget now open one Monthly Planning ritual. There is no new navigation item.
- A Monthly Plan remains historical intention. `BudgetTarget` remains live operating capacity. The first draft copies current category id, name, Need/Want, and planned amount into local state. Revise copies the latest revision for that period, not caps that have since drifted. Finalize calls `finalizeMonthlyPlan` and appends a revision. It does not update live caps. There is no apply-to-caps action.
- `previewMonthlyPlan` is a pure read. It uses the same cent comparison, `allocateIncome` split, debt-minimum sum, and due-rule snapshot as finalization. Planning Basis is an assumption for that split. It is not Income. Protected Money is shown as context and is not part of the basis. A purpose smaller than its due bills is visible and does not block. Drafts are not stored.
- Month Close and the Honesty Report are unchanged. No schema or cloud-vault generation change.

### Validation
- Focused tests passed, including `lib/babylon/monthly-plan-ui.test.ts` and the existing monthly-plan, phone Budget, and phone Ledger suites.
- The full suite passed: 37 files, 506 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No Month Close, Honesty Report, draft persistence, category editor inside the ritual, plan-to-live cap write, revision browser, schema change, or production acceptance.

## 2026-09-27 — WE-PLAN-001A schema 5 cloud vault becomes schema 6

### What changed
- A signed-in schema-6 client can read a valid schema-5 cloud vault. `getCloudVault` recognizes schema 5, refuses any other foreign generation, and calls `upgrade_wealth_engine_vault_schema_5`.
- The function is owner-scoped. It copies the stored document, sets `monthlyPlans` to `[]`, sets schema 6, and advances the revision by one when the expected revision still matches. It does not accept a replacement document. No historical plan is inferred.
- `cas_update_wealth_engine_vault` is unchanged. A schema-5 client still cannot write a schema-6 row. An invalid schema-5 document is not upgraded. Two racing upgrades leave one revision advance.
- Unsupported-vault copy no longer says the vault is newer.
- `supabase/migrations/20261003_wealth_engine_vault_schema_5_to_6.sql` is repository source only. It was not applied.

### Validation
- Focused schema-transition tests passed: `lib/babylon/cloud-vault-schema-upgrade.test.ts`, 15 tests. Monthly-plan, cloud-vault, and vault-sync tests passed with them.
- The full suite passed: 36 files, 489 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No Monthly Plan behavior change, no planning UI, no generic migration framework, and no production mutation.

## 2026-09-27 — WE-PLAN-001 finalized monthly intent

### What changed
- Implementation candidate. Production acceptance is pending. Wealth Engine can now store a steward-finalized Monthly Plan revision: historical intent for one explicit period, kept apart from later financial reality.
- `monthlyPlans` lives on the vault document. Revision 1 has no predecessor. A later approval for the same period appends the next revision and leaves the earlier revision unchanged. Drafts are not stored. The period is supplied by the caller. Nothing detects a new month, and Month Close does not write a plan.
- Planning Basis is an assumption. `allocateIncome` derives the canonical 10/20/70 shares, including the debt-free redirect into Wealth Building, and those shares are copied onto the revision. Finalization does not create income, allocation events, debt payments, or protected-money changes. Live category caps stay as they were.
- A revision finalizes only when the planned category purposes equal the derived Living Budget share in cents. Debt minimums and the remaining balance are copied as context. Minimums above the derived debt share reject the revision. Due recurring rules for that period are copied. Existing Wealth Building and Emergency Fund designations are copied as context and are not added to the Planning Basis.
- Older vaults and backup versions 1–5 load `monthlyPlans: []`. Nothing is inferred from current settings. Backup version 6 and cloud schema version 6 require the list. The schema-5 cloud unreadability from this tranche is the subject of WE-PLAN-001A. No historical plans were backfilled.

### Validation
- Focused tests passed: `lib/babylon/monthly-plan.test.ts`, 21 tests. Allocation, recurrence, vault, and intelligence tests were included in the full run.
- The full suite passed: 35 files, 474 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No planning UI, persisted drafts, Honesty Report, Month Close change, time awareness, maturity flag, Intelligence Contract change, or automatic funding.

## 2026-09-27 — WE-BALANCE-FRESHNESS-002 foreground cached balance refresh

### What changed
- Production use showed an operational Financial Position staying on an older cached balance because Wealth Engine rarely asked again. A later `/accounts/get` of the same cached source already contained the newer cents, and WE-RECONCILE-001B2 propagated that stored evidence. Acceptance of 001B2 is unchanged and still pending.
- A signed-in document that is visible, or becomes visible, now asks `POST /api/plaid/observe-balances` when this page has no applied balance recording in the last 60 seconds. That window matches the balance-evidence query staleTime. It lives in page memory only. A failure or a not-applied result does not start it. A hidden document does not ask. There is no interval.
- The route reuses `recordPlaidBalanceObservations` for the session user's Items. It does not sync transactions and does not use `CRON_SECRET`. The daily `GET` cron is unchanged. Foreground transaction sync does not record balances. Visibility owns that ask, including when sync succeeds, fails, or is incomplete. An Item connected after the first ready list asks the same owner once and does not wait out the 60-second window. A hidden document still does not ask.
- An applied result invalidates the existing descriptor, observation, and association queries. Money Available still comes from that evidence. Phone Home does not gain an observation time: Money Available can mix accounts whose evidence times differ, and one timestamp would not describe the figure.
- `/accounts/get` remains cached. There is no live balance product, webhook, poll, new persistence, or vault write. Production acceptance is pending.

### Validation
- Focused tests passed: `foreground-balance-refresh.test.ts`, `background-balance-observation.test.ts`, `plaid-foreground-sync.test.ts`, `balance-observation.test.ts`, `plaid-account-identity.test.ts`, and `effective-financial-position.test.ts`, 6 files, 103 tests.
- The full suite passed: 34 files, 453 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- No cron change. No `/accounts/balance/get`. No `/transactions/refresh`. No Month Close or Honesty Report work.

## 2026-09-27 — WE-RECONCILE-001B2 effective financial position

### What changed
- Implementation complete. Automated validation passed. Production acceptance is pending. Operational Money Available is the rounded sum of effective account positions. `FinancialAccount.balance` and `asOf` stay the declaration and the fallback. An eligible cached `accounts_get` current can establish the effective amount. Cash, unlinked accounts, and ineligible evidence stay declared.
- A ready load uses that evidence. An unavailable load keeps a retained successful snapshot, including its `observedAt`, and still says balance evidence is unavailable. Loading, signed-out, and a failure with nothing retained use declarations. A successful empty read replaces retained evidence. There is no staleness threshold and no new persistence.
- Account rows show the effective amount as Observed with the stored time, or Declared with the as-of date. Edit Account still edits only the declaration and does not override an eligible observation. Associate and Remove link remain. Update balance is removed. Nothing copies an observation into the vault.
- Protected Money and Available After Planned Needs use the same operational Money Available. A stored designation above that amount stays a conflict. Living Budget and month close are unchanged. The cause of a balance change remains UNKNOWN.
- The Intelligence Contract is version `2`. `money_available_cents` matches the screen under the same successfully loaded evidence. Each account carries declared and effective amounts. An observed account carries cached `accounts_get` provenance. A failed server evidence read falls back to declarations and reports `balance_evidence_unavailable` without failing the rest of the contract. `balances_are_manual` and `no_reconciliation` are no longer standing claims. `plaid_is_not_vault_truth` remains. Sindarin stays read-only.

### Validation
- Focused tests passed: `effective-financial-position.test.ts`, `balance-evidence-load.test.ts`, `balance-observation.test.ts`, `intelligence-contract.test.ts`, and `confirmed-meaning.test.ts`, 91 tests.
- The full suite passed: 33 files, 425 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- Production acceptance is pending. Monthly Honesty Report is not built. No migration, override flag, transaction reconciliation, or background vault writer.

## 2026-09-27 — WE-RECONCILE-001B1 observation load truth

### What changed
- Accepted. A successful read of Plaid accounts, current balance observations, and account associations with zero rows stays ready. A failed read is unavailable. Those states no longer share an empty list.
- A first failure in the session fabricates no empty success. A failed refresh keeps the last complete successful evidence in session memory and stays unavailable. Retaining that snapshot is not a successful read. A later successful empty read replaces it.
- Unavailable evidence does not offer Update balance. A retained observation keeps its original `observedAt`.
- Money Available remains `sumAccountBalances(accounts)`. Account rows still show `FinancialAccount.balance`. The Intelligence Contract stays version 1 and declaration-only. `deriveEffectiveAccountPosition` stays unwired. No migration or new stored fact.

### Validation
- Focused tests passed: `balance-evidence-load.test.ts` and `balance-observation.test.ts`, 55 tests.
- The full suite passed: 32 files, 419 tests.
- `tsc --noEmit`, lint, the production build, and `git diff --check` passed.

### Not in this tranche
- WE-RECONCILE-001B2 Effective Financial Position is pending. It is not implemented.

## 2026-09-27 — Home balance update

### What changed
- An associated checking or savings account whose observed current already differs, and whose existing Accept action is eligible, now appears under Money Available on desktop Overview and phone Home. The steward still authorizes the write. The action is labeled Update balance. Each account is separate. There is no update-all action.
- The row shows the vault account name, the recorded balance, the observed current, the signed difference, and the stored observation time. Unlinked, unknown, matching, cash, and negative currents are omitted. An empty list takes no space.
- Update balance and the account-row control both call `observedBalanceUpdate`, which calls `acceptObservedBalance`. Financial Position, comparison rules, Attention, Plaid observation, and the vault schema are unchanged.

## 2026-09-27 — WE-ATTENTION-008 production acceptance

### What changed
- WE-ATTENTION-008 is production accepted. Wealth Engine woke in production and committed a cached Plaid balance observation while the application stayed closed. Financial Position was not changed. No balance was accepted. No association was created. No transaction sync, live balance pull, Attention, or notification was part of that wake.
- Implementation is `0e79584e6fd54bd47d0de8eceb0a754011dabec3`. `GET /api/plaid/observe-balances` at `2026-09-27T07:13:15.446Z` returned HTTP 200. A current `plaid_balance_observations` row has `observed_at` later than that wake. HTTP 200 alone was not the acceptance evidence. The Vercel cron trigger did not retain the count body.
- WE-ATTENTION-008A is deployed at `9713358663d7c0b7b509a2a1125ee668956ce3ca`. The recorder returns `applied` or `not-applied`, and the cron counts `items`, `attempted`, `applied`, and `notApplied`. The missing response body is the invocation tooling, not an 008A failure.
- `plaid_account_associations` had no rows. An earlier WE-BALANCE-001 demonstration of a Financial Position association is not currently present. The cause is not established. That absence is separate from this acceptance. The label `active_item_no_observation` does not prove an association exists, because its CASE ELSE branch also matches an empty association table.

## 2026-09-27 — WE-ATTENTION-008A recorder outcome contract

### What changed
- WE-ATTENTION-008A adds the recorder outcome contract. Acceptance of background observation is recorded in the closeout above.
- `recordPlaidBalanceObservations` now returns `applied` only when `apply_plaid_balance_observations` returns its accepted success result, and `not-applied` on every earlier exit. The cron counts `items`, `attempted`, `applied`, and `notApplied`. Foreground sync still ignores that result and keeps its previous HTTP contract. No balance semantics, schema, Attention, or notification change.

## 2026-09-27 — WE-ATTENTION-008 daily cached balance observation

### What changed
- WE-BALANCE-001 production acceptance succeeded. A real associated account showed the observed balance, the storage time, the deterministic cent difference, and the Accept action. Financial Position changed only when the steward accepted.
- Wealth Engine can now store that same cached `/accounts/get` reading once a day without a signed-in browser. `GET /api/plaid/observe-balances` reuses cron authorization, the canonical Wealth_Engine project check, and the service-role client. It lists `plaid_items` as `id, user_id` and calls the existing balance recorder. Vercel cron is `0 15 * * *`, beside the notification cron and not inside it.
- A failed Item leaves the previous observation in place. Other Items are still attempted. The response is counts only. There is no transaction sync, no live balance pull, no vault write, no Accept, and no new Attention or notification. No new table or migration. Production acceptance is recorded in the closeout above.

## 2026-09-26 — WE-BALANCE-001 minimum balance observation

### What changed
- A signed-in foreground sync can now keep a cached Plaid balance without making that balance Financial Position. After a successful transaction sync, the server calls `/accounts/get` even when descriptors already exist. Depository checking and savings readings store `current` and `available` separately, with currency and the time Wealth Engine stored them. The source is `accounts_get`. Identity parsing still drops balances. The transaction cursor does not move. `/accounts/balance/get` is not called.
- An unchanged reading refreshes the stored time. A change in current, available, or currency keeps one superseded predecessor and does not grow a series.
- The steward associates one vault checking or savings account with one Plaid depository checking or savings account. The link is stored outside the vault. Cash and credit cannot be linked. A second live link in either direction is rejected. A link whose vault account is gone can be replaced. Name and mask are not used.
- The account row shows the observed current, the storage time, and the signed cent difference when the two figures differ. Zero shows no accept action. Unknown stays unknown. Accept writes the observed current into that account and sets `asOf` to the local civil date through the existing vault update. A negative current cannot be accepted. Available is never the accepted figure.
- Opening or reloading Wealth Engine is the refresh. There is no new timer, cron, notification, Home Attention, reconciliation, or Intelligence Contract field.

### Production status
- The steward manually applied `20261002_plaid_balance_observation.sql` on Wealth_Engine (`nklmgzxxdhuvqayhcigp`). The SQL Editor reported success. Application deployment is pending this ship. Manual production acceptance of a real association and observed balance is still pending.

### Confirmed meaning record
- WE-MEANING-001 is production accepted. The steward manually applied `20261001_plaid_confirmed_meaning.sql`. The implementation is deployed. Manual acceptance succeeded on a real Amazon Prime observation, and the confirmation persisted across close and reopen.

## 2026-09-26 — WE-MEANING-001 confirmed meaning

### What changed
- A posted Plaid observation had no durable place to remember that the steward said it corresponded to an existing budget category. `is_processed` is not that fact, and the vault does not store Plaid identity.
- `plaid_observation_confirmations` stores one owner-scoped confirmation beside the observations. The current row points at a `BudgetTarget` id and keeps the category name and observation evidence from the moment of confirmation. A different category supersedes that row. Revoking leaves no current row. Earlier snapshots stay.
- Only a current posted observation can be taught. Pending and removed observations cannot. A posted observation does not inherit a pending observation's confirmation. Later changes to the observation, and later renames or deletions of the category, do not rewrite the snapshot.
- The steward opens this from the connected-bank surface on desktop and on phone Connections. The same confirmation path serves both. It does not create an expense, settle an obligation, change a cap, set `is_processed`, classify another observation, or enter Attention or the Intelligence Contract.

### Not in this tranche
- No production migration, commit, or deploy. No automatic matching. No new Attention kind. No contract field.

## 2026-09-26 — WE-OBLIGATION-001 non-monthly declared obligations

### What changed
- A monthly bill rule could not say that a purpose occurs every three calendar months. Skipping intervening months would have meant those months were deleted. A monthly category cap is still only a spending cap.
- A recurring obligation may now carry `intervalMonths`. Absent, and `1`, mean every calendar month from the start month. A larger positive integer means every that many calendar months. The count is calendar months, not days.
- Generation still looks only at the current month and the next month. It creates an occurrence only when that month is due. A non-due month is not stored as a skip. A skip is still a due month the steward deleted. The rule does not divide the amount, reserve money, or change a category cap.
- The Intelligence Contract uses the same materializer and does not gain fields. No new Attention kind. No Plaid match and no confirmed observational meaning.

### Not in this tranche
- No vault schema bump, database migration, sinking fund, amount range, notification, or contract expansion.

## 2026-09-26 — WE-MUSE-004 Intelligence Contract v1 semantic finalization

### What changed
- WE-MUSE-003 production acceptance succeeded. Sindarin authenticated through its Secure Vault connector, understood contract version `1` without a sample payload, and reported that no further contract data is required for the accountability job.
- One boundary code was misleading. `observational_reasoners_unwired` now reads `internal_observational_reasoners_excluded`. The reasoners exist. Their outputs stay out of the authoritative contract. The old code is not an alias.
- `ARCHITECTURE.md` now records the existing v1 derivation semantics, the two Attention item shapes, and the obligation origins `recorded` and `derived_from_rule`. No payload field was added. Attention behavior is unchanged.
- The route still does not write. Plaid remains external reality. The steward remains the authority over meaning, confirmation, and action.

### Not in this tranche
- No new capability, persistence, database change, dependency, Muse or Meta code, production change, commit, or deploy.

## 2026-09-26 — WE-MUSE-002 read-only Intelligence Contract

### What changed
- `GET /api/intelligence` returns contract version `1`. A pure assembler composes the existing 10/20/70 readings, Living Budget, protected money, manual Financial Position, Available After Planned Needs, unpaid obligations, recorded debts, and established Attention. Amounts are integer cents. The civil date comes only from the stored IANA timezone.
- The route is read-only. It requires `INTELLIGENCE_READ_SECRET`, which is distinct from the scheduler secret and from the browser session. It reads the single steward's vault and notification timezone. It does not write, and it does not read Plaid or notification delivery rows. Recurring occurrences needed for the reading stay in memory. Unknown is an explicit code, including a withheld APR of 0 that cannot be told from the soft-migrated fallback.
- This is a Wealth Engine capability. It is not a Muse or Sindarin client. How Muse would store the secret or call the route is still unknown.

### Not in this tranche
- No production secret, deploy, database change, persistence, or production acceptance. No LLM, agent, or Muse SDK.

## 2026-09-26 — WE-NOTIFY-004C production state closeout

### What changed
- Production `notification_deliveries` has been independently verified present and structurally equivalent to the repository's `20260930_notification_deliveries.sql`. The verification operation did not apply or replay the migration. The table had zero rows. `notification_preferences` and `push_subscriptions` each remained one unchanged row. Vault and Plaid state were not modified.
- Supabase CLI migration history still does not record repository migrations. `supabase_migrations.schema_migrations` remains absent. Do not replay `20260930`. Do not run `supabase db push`. Do not infer migration application history merely from object existence. The repository file stays the canonical schema definition.
- The steward has configured `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CRON_SECRET` in the Wealth Engine Vercel project. The application was redeployed after `VAPID_SUBJECT` and `CRON_SECRET` were added. No secret values are recorded here. WE-NOTIFY-004 is not production accepted.

### Not in this tranche
- No production write, migration replay, migration-history repair, commit, or push. No transport test was run.

## 2026-09-26 — WE-NOTIFY-004A delivery atomicity edge

### What changed
- No send, dedupe, retention, or schema behavior changed. Web Push delivery stays operationally at-least-once across the send to success-record boundary.
- A `succeeded` row is inserted only after at least one endpoint accepts the push. If that insert does not commit, a later run on the same civil day can send the same generic notification again. A stored success remains final. A rare duplicate generic notification is preferable to suppressing legitimate Attention the steward never received.
- The current `notification_deliveries` model cannot close that window. Suppression is the partial unique index on `status = 'succeeded'`. Committing `succeeded` before the push would hide Attention when the push then fails. A `failed` row does not suppress a retry. No reservation, outbox, or extra status was added.

### Not in this tranche
- No migration apply, Vercel change, environment change, commit, or push.

## 2026-09-26 — WE-NOTIFY-004 deterministic Attention delivery

### What changed
- A protected daily evaluator can read the current vault, derive the steward's civil date from the stored IANA timezone, and reuse Due Attention and Month-Close Attention. Recurring occurrences needed for that reading are materialized in memory and discarded.
- One generic Web Push covers every still-eligible subject for that steward and run. Successful dedupe is one `notification_deliveries` row per subject, user, and civil date. Failed attempts can retry. Rows older than 14 civil days are deleted by that same run. Endpoints that return 404 or 410 are removed. The push body is empty, and `/sw.js` keeps the fixed copy.
- More → Data and cloud can send that same generic notification as a transport test when this device is enabled. The test does not record an Attention delivery.
- Vercel cron is `0 15 * * *` UTC, about 8:00 or 9:00 in America/Boise depending on daylight saving. The schedule is not financial logic.

### Not in this tranche
- This code change did not apply the migration or write Vercel secrets. Production acceptance is not complete. No financial record, vault revision, or Plaid row is written by the evaluator. Later production evidence is in the WE-NOTIFY-004C entry.

## 2026-09-26 — WE-NOTIFY-003 device opt-in

### What changed
- Phone More → Data and cloud can enable notifications on this browser. Permission is requested from that tap. An existing PushSubscription is reused. A new one is stored through the authenticated preference and subscription routes, along with the browser's IANA timezone.
- Turning off this device deletes that endpoint and unsubscribes the browser. It does not clear the steward-wide enabled flag, because that flag covers every device.
- `/sw.js` shows “Wealth Engine” / “Wealth Engine needs your attention.” and opens `/`. The cache policy is unchanged. Nothing in the app sends Web Push.

### Not in this tranche
- No private VAPID key, `web-push` send, cron, delivery history, Attention change, vault change, or database migration. A real phone still has to prove the prompt and the stored row. Next delivery tranche is WE-NOTIFY-004.

## 2026-09-26 — WE-NOTIFY-002D canonical database closeout

### What changed
- The canonical Supabase production target is recorded in `ARCHITECTURE.md`. Database operations must fail closed when that identity cannot be proven. Historical or shared projects are not Wealth Engine targets.
- WE-NOTIFY-002 is committed at `e8ff5430d2aab416609dcd1da1d504cc4eaeba90`. That verification found production `notification_preferences` and `push_subscriptions` present and empty, and `notification_deliveries` absent. It did not apply `20260929_notification_foundation.sql`. Later evidence is in the WE-NOTIFY-004C entry.
- Production has no `supabase_migrations.schema_migrations` table. Do not `supabase db push` or replay repository migrations until that history is deliberately reconciled. Local development credentials must all belong to the canonical project before database or API development is trusted.

### Not in this tranche
- No database mutation, migration-history repair, credential change, permission prompt, browser subscription, Web Push send, or scheduler. Next implementation tranche is WE-NOTIFY-003.

## 2026-09-26 — WE-NOTIFY-002 notification persistence foundation

### What changed
- A steward can have one notification preference row: an explicit enabled flag and an IANA timezone. Push subscription rows store one endpoint and its keys for that authenticated user.
- Authenticated routes read the preference, save it, register or update an endpoint, and remove the caller's own endpoint. The session user id is the owner. Request bodies cannot choose another user.
- Invalid timezones and malformed subscription input are rejected. Status responses do not return subscription keys.

### Authority
- These rows are operational configuration. They are not `vault_data`, they do not change the vault revision, and they are not part of WE-SYNC. Attention rules are unchanged. Nothing in this tranche can mark a bill paid, close a month, or send a push.

### Not in this tranche
- No permission prompt, browser `PushManager` subscription, service-worker push handler, Web Push send, VAPID keys, cron, delivery history, Plaid change, or mobile information-architecture change. Notifications are not live. This tranche wrote `20260929_notification_foundation.sql` and did not apply it. Later production verification is recorded above.

## 2026-09-26 — WE-MOBILE-007 phone More

### What changed
- Phone More is now a utility surface in five groups: Financial setup, Connections, Guidance, Data and cloud, and Danger zone.
- Financial setup keeps the profile name, account and protected-money editing, and Close Month. The phone account card omits the Home orientation readings. Guidance and the 10/20/70 reference stay closed until opened. Reset ledger sits apart from export and import, and still asks before deleting.
- Desktop sidebar still composes `VaultMaintenancePanel`, including cloud, backup, reset, and the 10/20/70 card. Desktop Financial Position still shows Money Available and Available After Planned Needs.

### Authority
- No allocation, account, protected-money, month-close, cloud, or backup behavior changed. More still opens the existing Close Month ritual and the existing maintenance handlers.

### Not in this tranche
- No Home, Budget, or Ledger redesign, notification work, or new financial capability. This closes the mobile information-architecture composition.

## 2026-09-26 — WE-MOBILE-006 phone Ledger

### What changed
- Phone Ledger now lists Income, Expenses, and Debts as stacked records. A local three-way selector fits the phone width. Ordinary review does not depend on a sideways table.
- Paid, Upcoming, Overdue, and Due soon stay the words the desktop row already used. A generated expense still offers Edit rule, and that dialog still edits the monthly rule rather than the occurrence.
- Desktop Ledger still uses `LedgerMatrices`: the wide tables, the Income Streams / Expenses Archive / Debt Ledger tabs, the add buttons, and Budget Blueprint on that nav. Home and Budget are unchanged.

### Authority
- No income, expense, debt, or recurring-obligation model changed. Settlement still calls `toggleExpenseSettled`. Occurrence and rule edits still call the existing update handlers.

### Not in this tranche
- No Home or Budget redesign, search, filters, new payment status, or change to allocation, Attention, vault, or Plaid.

## 2026-09-26 — WE-MOBILE-005 phone Budget

### What changed
- Phone Budget now leads with Living Budget remaining, then a vertical 10/20/70 purpose, category caps, and the debt payoff plan. Income breakdown, charts, and the affordability check stay closed until the steward opens them. The payoff chart stays closed until asked.
- When there is no active debt, the 20% row says that share goes to Wealth Building. The amounts are the existing month allocations.
- Home is unchanged. Desktop Overview still mounts Spending Power, the 10/20/70 cards, Budget Blueprint, Debt Freedom with its chart, Analytics, and Affordability.

### Authority
- No allocation, Living Budget, category variance, or debt math changed. Phone Budget reads the figures the engine already derived.

### Not in this tranche
- No Home redesign, Snowball/Avalanche correction, notification work, or new financial figure.

## 2026-09-26 — WE-MOBILE-004 phone Home

### What changed
- Phone Home is now a short orientation surface: due obligations when any exist, Money Available with Protected Money, Available After Planned Needs, the next three unpaid bills after those due rows, and up to three recent ledger changes.
- Paid still uses `toggleExpenseSettled` through `applyDueAttentionDecision`. Still upcoming still writes nothing. Last-day month-close Attention stays in the phone header and still opens the existing ritual.
- Living-budget cards, the 10/20/70 summary, debt freedom, analytics, and affordability stay on Budget. Account management is on More with the existing Financial Position card. Desktop Overview is unchanged.

### Authority
- No new financial figure. Home reads `moneyAvailable`, `protectedMoney`, `availableAfterPlannedNeeds`, `upcomingNeeds`, `dueAttention`, and the existing activity feed. Upcoming preview order is `comingUpObligations`.

### Not in this tranche
- No shell redesign, notification work, Plaid attention, or change to Attention derivation or month close.

## 2026-09-26 — WE-MOBILE-003 phone shell and single navigation

### What changed
- Below the `lg` breakpoint, Wealth Engine uses one phone destination: Home, Budget, Ledger, or More. That state lives in the dashboard and is not synced with desktop `activeNav`. The Command / Analytics / Ledgers strip and the phone drawer are gone.
- The phone header keeps the greeting, Discreet Mode, Add, and the last-day month-close Attention line. Profile editing, Plaid, Close Month, and the drawer maintenance actions are on More. Quick Add stays on the desktop branch only.
- The fixed bottom bar is hidden at `lg` and above. The viewport uses `viewport-fit: cover`, and the bar plus the page padding account for the bottom safe area. Desktop sidebar, Overview, Ledger, and Financial Guidance are unchanged in composition.

### Authority
- No allocation, vault, Plaid sync, Attention derivation, or month-close mutation changed. Review close and Close Month still open the existing ritual. They do not call `closeMonth` by themselves.

### Not in this tranche
- Home content hierarchy, Quick Add preset prefill, keyboard/`visualViewport` handling, service worker, and push notifications.

## 2026-09-25 — WE-ATTENTION-007B minimum in-app attention loop

### What changed
- Wealth Engine now asks about two decisions the steward already established. An unpaid declared obligation whose due date is today or earlier is listed under Due on the Upcoming Needs card, separate from Coming Up. Paid uses the existing `toggleExpenseSettled` mutation. Still upcoming writes nothing, and that row stays eligible.
- On the last local calendar day of a month that is still open, the command bar says that month is still open and ends today. Review close opens the existing three-step Close Month ritual. It does not call `closeMonth`, and it does not invent a way to close a previous month after the calendar rolls.
- Eligibility lives in `lib/babylon/attention.ts` and is recomputed from the vault and the local financial day. Nothing new is stored.

### Authority
- The only statement the due row makes is that the steward declared the obligation, its due date has arrived or passed, and it is not recorded as paid.
- The month row says the current month is open and today is its last local day. Surplus disposition stays inside the existing ritual.
- No Plaid observation, movement, or repetition reading is consulted. No bill is marked paid, deleted, or matched to a transaction by this loop.

### Not in this tranche
- No acknowledgement persistence, snooze, notification, service-worker notification behavior, schema or vault change, migration, or observational wiring.
- Wealth Engine is not core-complete. 007B still needs acceptance in the running production UI.

## 2026-09-25 — WE-ATTENTION-006 observational stopping boundary

### What changed
- WE-ATTENTION-006 is complete. It establishes the stopping boundary for observational relationship primitives. No reasoner, test, schema, sync path, vault, or screen was changed. The temporary characterization runner was removed. Production was not mutated. Plaid was not called.
- A fresh read-only production export was partitioned by the two committed reasoners, in order. `deriveCorrelatedInternalMovements` ran first. `deriveObservedRepetitions` then ran with those movement ids excluded. `pending_transaction_id` was not an input to either function. The export's single user identity was replaced in memory with a synthetic identity.

### Accepted partition
- Fresh corpus: 339 observations, 4 pending, 0 removed, 7 account descriptors.
- Class A, Correlated Internal Movement participants: 94.
- Class B, Observed Repetition participants after that exclusion: 86.
- Class C, current pending: 4.
- Class D, removed: 0.
- Class E, posted/current observations in neither reasoner: 155.
- 94 + 86 + 4 + 0 + 155 = 339. Every observation is in exactly one class. A and B are disjoint. No pending or removed observation is in A or B.

### Class E
- All 155 Class E observations are legitimate isolated posted/current observations. Isolated: 155. Ineligible: 0.
- No eligible Class E observation shares a user, an account, and exact normalized signed cents with another eligible Class E observation.
- These observations are not unresolved failures. The higher-order relationship the evidence currently justifies is none.
- Isolation is a valid absence. A posted/current observation does not need to belong to a higher-order relationship. Another primitive is not added merely to shrink this population.

### Candidate primitives
- Lifecycle identity: 0 current posted rows carry a nonblank pending-transaction pointer. 0 current posted rows link to a current pending row. No lifecycle primitive is earned.
- Exact one-to-many cent partition: 0 structures. No primitive is earned.
- Same sign, same exact cents, different accounts, same civil date: 0 structures. No primitive is earned.
- Opposite sign outside the established movement reasoner: one exact-cent pair sat outside Class A. It occurred once and failed multiple committed movement gates. No repeated exact opposite-sign structure exists outside Class A. No primitive is earned.
- Category text is reused across isolated observations and across differing amounts. Category text is not identity. Using it as relationship authority would exceed the evidence.

### Architectural conclusion
- The core observational model now recognizes three states. Correlated Internal Movement is the deterministic cross-account relationship. Observed Repetition is the deterministic across-time relationship. Isolated Observation is the valid absence of an established higher-order relationship.
- The system should never know more than its evidence entitles it to know. Further interpretation of this isolated corpus would require evidence the system does not possess, such as semantic authority, an arbitrary amount or date tolerance, merchant interpretation, or probabilistic inference. Those mechanisms are not justified for the core observational reasoning layer.

### Next
- WE-ATTENTION-007 is Attention Surfacing / Human Confirmation Design. The observational reasoning layer is sufficient for the core product. 007 does not begin by creating another detector. Its purpose is to determine how established observations and derived relationships become useful human attention without replacing steward judgment. The interaction remains Detect, Interpret, Surface, Confirm, Record. This closeout does not design or implement 007.

### Not in this tranche
- No reasoner change, test change, UI, persistence, migration, vault, backup, WE-SYNC, recurring-obligation, or income change.

## 2026-09-25 — WE-ATTENTION-005C production corpus acceptance of observed repetition

### What changed
- WE-ATTENTION-005B, the pure observed repetition reasoner, is complete. WE-ATTENTION-005C accepted it on a fresh read-only production export. The reasoner was not changed. The temporary runner was removed. Production was not mutated. Plaid was not called. The vault was outside the run.
- The function stays pure, derived, unwired, and semantic-free. It is not persisted. It does not classify cadence, predict a later date, assign a score, or write the UI, vault, or WE-SYNC. One observation does not establish repetition. Two eligible matches establish a repeated structure and one observed civil-day gap. Three or more establish only whether those gaps agree or differ. Interval agreement is not cadence. Recurrence is not financial meaning. Later evidence can withdraw interval agreement. Human financial meaning stays with the steward. A recurring obligation remains a steward-declared plan rule.

### Acceptance corpus
- 339 observations, 4 pending, 0 removed, 7 account descriptors. The established movement reasoner reproduced 47 movements, 24 internal transfers, 23 credit-card payments, 94 participating observations, and 0 overlaps. Those 94 ids were the exclusion set.
- After that exclusion, `deriveObservedRepetitions` emitted 31 structures with at least two members and 86 unique participating observations. The structures are disjoint. Member counts: 17 with two, 9 with three, 2 with four, 1 with five, and 2 with six or more. The longest structure has 6 members. Direction, on that Plaid account: 30 positive, 1 negative. Interval evidence: 17 `single_interval`, 5 `intervals_agree`, 9 `intervals_differ`. Category evidence: 23 equal, 8 differing, 0 absent.
- The subset with at least three members is 14 structures, 52 unique observations, 14 positive, 0 negative, 5 with agreeing gaps, and 9 with differing gaps.

### 005A reconciliation
- WE-ATTENTION-005A reported 15 same-account, same-sign, same-cent groups with at least three observations. That historical discovery count stays 15. It is not rewritten as 14.
- The accepted posted reading is 14 structures with at least three eligible members. One of the 15 exploratory groups contained two posted observations and one pending observation. The 005A residual count admitted pending rows. `deriveObservedRepetitions` excludes pending rows from membership, so that group currently has only two eligible posted members. This is an evidence-quality refinement, not a reasoner defect. No reasoner change is indicated.
- The strongest 005A finding reproduced. Exactly four structures on one anonymous checking account each have three eligible posted members, gaps of 31 and 31 days, `intervals_agree`, and `category_text_equal`.
- A fifth structure has gaps of 31 and 31 days and `intervals_agree`, with differing category text. Category text remains supporting evidence and does not decide membership.
- Seventeen pair-only structures establish repetition plus one observed gap. They do not establish interval agreement or cadence. One of them is negative. No negative structure in this corpus reaches three members. None of these readings is a financial classification.

### Ownership
- Interpretation remains `lib/babylon/observed-repetition.ts`. This acceptance did not change it.

### Not in this tranche
- No UI, persistence, migration, vault, backup, WE-SYNC, recurring-obligation, or income-interval change.
- No steward confirmation of financial meaning.

## 2026-09-25 — WE-ATTENTION-005B pure observed repetition reasoner

### What changed
- `deriveObservedRepetitions` reads current posted observations that share a user, a Plaid account, a sign, and exact normalized cents. Two or more members form one repeated structure. The result lists ordered transaction ids, civil dates, consecutive civil-day gaps, category text including null, and a closed evidence list.
- Repetition is not cadence. Two observations establish a repeated structure and one observed gap (`single_interval`). Three or more establish only whether those observed gaps agree (`intervals_agree`) or differ (`intervals_differ`). A later observation can change interval agreement. The function does not predict a next date, assign a score, or name weekly, biweekly, or monthly.
- Cadence is not financial meaning. Category text is supporting evidence and does not decide membership. Positive cents mean money out of that Plaid account. Negative cents mean money in. The output does not say income, expense, bill, subscription, or paycheck.
- The result is derived on each call and is not persisted. An optional excluded-id set defaults to empty. The module does not import the movement reasoner. It is not called from a hook, route, screen, sync path, or vault write.
- Human financial meaning stays with the steward. `RecurringObligation` remains a steward-declared planning rule. This tranche does not modify recurring obligations or income intervals.

### Ownership
- Interpretation: `lib/babylon/observed-repetition.ts`
- Tests: `lib/babylon/observed-repetition.test.ts`

### Not in this tranche
- Production corpus acceptance is not done. No production export was read. Plaid was not called.
- No UI, persistence, migration, vault, backup, WE-SYNC, recurring-obligation, or income-interval change.
- No learned pattern, cadence classifier, amount tolerance, or merchant match.

## 2026-09-25 — WE-ATTENTION-005A residual observation corpus characterization

### What changed
- Residual observation corpus characterization is complete. A fresh read-only production export was run locally through the exact committed `deriveCorrelatedInternalMovements` before any residual work. The corpus was 339 observations, 4 pending, 0 removed, and 7 account descriptors.
- The reasoner reproduced 47 movements, 24 internal transfers, 23 credit-card payments, 94 participating observations, and 0 overlapping accepted observations. Participating ids came only from that function. Residual membership is the export minus those exact ids: 245 observations, 241 posted/current, 4 pending, and 0 removed. No second SQL matcher was created.
- The export had one user identity. It was replaced in memory with a synthetic identity before the reasoner ran. Production was not mutated. Plaid was not called. Raw transaction ids, account ids, and individual amounts were not emitted. The temporary runner was removed. The reasoner stays pure and unwired.
- Residual sign, relative to each Plaid account: 232 positive, 13 negative, and 0 zero-amount. Positive means money out of that account. Negative means money into that account. That direction is not whole-system economic meaning.
- Fifteen residual groups have at least three observations on the same anonymous account, the same sign, and the same normalized absolute cent amount. All 15 are positive. Predeclared cadence: 7 monthly, 7 mixed, 1 none, 0 weekly, and 0 biweekly. Four posted/current groups on one anonymous checking account (Account C in that run) each share that account, a positive sign, one cent amount, one literal Plaid category, three occurrences, and date gaps of 31 and 31 days. Those category strings are observational evidence, not authority.
- Residual negatives contain no qualifying same-account repeated amount group of three or more. Residual same-cent cross-account structures are 0 for opposite sign on the same day, opposite sign on an adjacent day, same sign on the same day, and ambiguous multiple counterparts. That is not evidence for loosening the committed movement predicate.
- An observation is not semantic truth. Recurrence is not semantic truth. Plaid category text is evidence, not authority. Unknown and uninterpreted remain valid. This tranche did not establish income, a paycheck, an expense, a bill, a subscription, an employer, a merchant, or an account purpose.

### Ownership
- Interpretation remains `lib/babylon/correlated-internal-movement.ts`. This tranche did not change it. Residual membership is subtraction of that function's returned ids. No new owner was created.

### Not in this tranche
- WE-ATTENTION-005B is not implemented. Its question is: when repeated observations share stable structural characteristics, what evidence is sufficient to recognize that recurrence as an environmental pattern without assigning financial semantics. It does not ask which bills or subscriptions exist.
- No UI, persistence, migration, vault, backup, or WE-SYNC change.

## 2026-09-25 — WE-ATTENTION-004C live corpus acceptance

### What changed
- Live corpus acceptance passed. A read-only production export was run locally through the exact committed `deriveCorrelatedInternalMovements`. The export had 339 observations, 4 pending, 0 removed, and 7 account descriptors.
- The reasoner returned 47 correlated internal movements: 24 `internal_transfer`, 23 `credit_card_payment`, 94 unique participating observations, and 0 overlapping accepted observations. That matched the earlier independent SQL characterization.
- The export had one user identity. It was replaced in memory with a synthetic identity before the reasoner ran. Production rows were not mutated. Plaid was not called. The vault was not part of the run.
- The temporary acceptance transport was removed. The reasoner stays pure, derived, and unwired.

### Ownership
- Interpretation remains `lib/babylon/correlated-internal-movement.ts`. This tranche did not change it.

### Not in this tranche
- No UI, hook, sync, persistence, vault, backup, or candidate generator calls the reasoner.
- No income detection and no steward confirmation.

## 2026-09-25 — WE-ATTENTION-004B correlated internal movement

### What changed
- `deriveCorrelatedInternalMovements` reads posted Plaid observations and known account descriptors. It returns pairs that look like opposite sides of one movement. Kinds are `internal_transfer` and `credit_card_payment`.
- Comparison uses integer cents from `roundMoney`. Source is the positive Plaid amount. Destination is the negative amount.
- A pair is kept only when each observation has exactly one qualifying partner. Duplicate ids, missing identity, pending rows, and removed rows are omitted.
- The function is not called from a hook, route, or screen. Nothing is written to `plaid_transactions`, `plaid_accounts`, or the vault.

### Ownership
- Interpretation: `lib/babylon/correlated-internal-movement.ts`
- Tests: `lib/babylon/correlated-internal-movement.test.ts`

### Not in this tranche
- The reasoner is not live-accepted. Production data was not read or written.
- No persisted pair, migration, UI, confirmation, or steward override.
- No income, expense, transfer, balance change, or 10/20/70 invocation.
- Future inflow and outflow candidate reasoning may treat accepted transaction ids as exclusions. That reasoning is not built here. The steward still decides what is recorded.

## 2026-09-25 — WE-ATTENTION-003D account identity bootstrap

### What changed
- A fresh production incremental sync returned HTTP 200 with `[WE-ATTENTION-ACCOUNT-PROBE]` `accountsPresent=true`, `accountsCount=0`, `parsedAccountsCount=0`, `pageAccepted=true`. The parser and page persistence were already correct. That page had no descriptors to store, so `plaid_accounts` stayed empty.
- After a synced or incomplete observation sync, an owned Item with zero descriptor rows is read once from `/accounts/get`. Identity fields are `account_id`, `name`, `mask`, `type`, and `subtype`. Balances and the rest of the Plaid account object are discarded before persistence.
- `upsert_plaid_account_identity` writes those rows. It does not take the sync lock, move `transactions_cursor`, or change `plaid_transactions`.
- A failed identity fetch or write leaves the successful transaction-sync result in place. Zero rows remain the retry signal for the next fresh foreground sync.
- The temporary account probe log is removed. Link and token exchange are unchanged.

### Ownership
- Descriptor parsing and bootstrap decision: `lib/babylon/plaid-transaction-sync.ts`
- `/accounts/get` fetch: `lib/babylon/plaid-sync-fetch.ts`
- Service-role count, token load, and upsert: `lib/babylon/plaid-account-bootstrap.ts`
- Durable function: `supabase/migrations/20260928_plaid_account_identity.sql`

### Not in this tranche
- Live account descriptors have not been accepted. `20260928` is written and not applied from the app.
- No balances, no Wealth Engine account mapping, and no interpretation of the 339 observations.
- No webhook, polling, or cursor reset.

## 2026-09-25 — WE-ATTENTION-003C temporary account identity probe

### What changed
- `fetchPlaidTransactionSyncPage` logs `[WE-ATTENTION-ACCOUNT-PROBE]` once per parsed `/transactions/sync` page.
- The log is four fields: `accountsPresent`, `accountsCount`, `parsedAccountsCount`, and `pageAccepted`.
- Parsing, persistence, and the vault are unchanged. This does not backfill `plaid_accounts`.

### Ownership
- Temporary log: `lib/babylon/plaid-sync-fetch.ts`

### Not in this tranche
- No Plaid call, no migration, and no client, route, RPC, or SQL instrumentation.

## 2026-09-25 — WE-ATTENTION-003C observational account identity

### What changed
- The first production observation sync stored 339 Plaid rows (335 posted, 4 pending, 0 removed) across 5 Plaid account ids, dated 2026-06-28 through 2026-09-25. The vault stayed revision 4 / schema version 5. Backup version stayed 5.
- `/transactions/sync` already returns account descriptors. The page parser now keeps `account_id`, `name`, `mask`, `type`, and `subtype` as text. Balances stay out.
- `public.plaid_accounts` stores those descriptors for the signed-in owner of a `plaid_items` row. The same page function upserts them with the observations and cursor. A repeated descriptor updates the row. It does not rewrite existing transaction rows.
- Authenticated users may select their own descriptors. They cannot insert, update, or delete them, and they still cannot read the access token, cursor, or lock.
- `listPlaidAccounts()` is the browser read. There is no new UI.
- The temporary `[WE-ATTENTION-PROBE]` logs are removed. Foreground sync still asks once per ready Item.

### Ownership
- Descriptor parsing and in-memory upsert: `lib/babylon/plaid-transaction-sync.ts`
- Durable table and page function: `supabase/migrations/20260927_plaid_accounts.sql`
- Browser read: `lib/babylon/plaid-schema.ts`, `lib/babylon/plaid-client.ts`

### Not in this tranche
- Live account descriptors have not been accepted in production. This migration is written and not applied from the app.
- No balances, no transaction interpretation, no Financial Attention candidates, and no Wealth Engine account mapping.
- Observations are still not income, expenses, or `vault_data`.

## 2026-09-25 — WE-ATTENTION-003A foreground observation sync

### What changed
- After a signed-in operator's Plaid Items finish loading, Wealth Engine asks `POST /api/plaid/sync-transactions` once for each Item.
- The request body is the `plaid_items` UUID. The bearer token is the existing Supabase session. The browser does not see the Plaid access token.
- A re-render, a list refetch, or a second effect pass does not ask again. Signing out clears that memory. A newly connected Item is included when the list next becomes ready.
- A failed or successful observation sync does not change the vault, backup version 5, or WE-SYNC-004.

### Ownership
- When to ask: `lib/babylon/plaid-foreground-sync.ts`
- Authenticated request: `lib/babylon/plaid-client.ts`
- Trigger: `hooks/usePlaidConnections.ts`

### Not in this tranche
- No live Plaid call was made. No webhook, polling, cron, or attention UI.
- Observations are still not income, expenses, or `vault_data`.

## 2026-09-25 — WE-ATTENTION-002 observational transaction sync

### What changed
- A signed-in user can ask `POST /api/plaid/sync-transactions` to store what Plaid reports for one of their Items.
- The server loads the access token, walks `/transactions/sync` until `has_more` is false, and stores added, modified, and removed rows. The cursor advances in the same database transaction as those rows.
- A second device that asks at the same time gets a busy result. It does not move the cursor backward.
- Re-linking an Item updates the token only when the Item already belongs to that user.
- The access token remains plaintext, service-role only. It is not application-encrypted.
- Observations can be read later with the existing owner select on `plaid_transactions`. Removed rows stay stored and are left out of that read. They are not part of backup version 5.

### Ownership
- Sync rules: `lib/babylon/plaid-transaction-sync.ts`
- Durable lock and cursor: `supabase/migrations/20260926_plaid_transaction_sync.sql`
- Route: `app/api/plaid/sync-transactions/route.ts`

### Not in this tranche
- The migration was not applied. No live Plaid call was made.
- No webhook, polling, cron, attention UI, or automatic income, bill, or balance changes.
- WE-SYNC-004 and `vault_data` are unchanged.

## 2026-09-25 — WE-SYNC-004 revision sync

### What changed
- After a device has a verified cloud revision, a later local edit saves immediately and then tries one compare-and-swap upload of the whole vault.
- A clean device that finds a newer cloud revision downloads that document, checks the local round trip, and moves its baseline forward.
- The baseline lives in `wealth-engine-cloud-sync` (`revision` and `fingerprint` only). It is not inside the financial vault or a version 5 backup.
- A desktop already bound at revision 1, with no baseline yet, adopts that revision when the local document matches the cloud. It does not upload. If the documents differ, both copies stay put.
- A non-empty second device is adopted only when its document matches the cloud. Otherwise it stops. An empty device still has to confirm a load.
- If the cloud revision moved and this device also has unsent edits, neither side is overwritten.
- Offline edits stay on the device. The verified revision does not change. The next foreground, reconnect, or Check cloud tries again.
- An upload of an older snapshot does not mark a newer local edit clean.
- If compare-and-swap reports the next revision but the read-back fails, the device stores that reported revision as unverified. It does not become clean, and it does not upload again at the old revision. The next check confirms the cloud document before trusting it.

### Ownership
- Revision cycle: `lib/babylon/vault-sync.ts`
- The screen calls that cycle from `hooks/useBabylonEngine.ts` after the local vault is saved. Individual actions do not call Supabase.
- Sidebar status: `components/babylon/app-sidebar.tsx`

### Not in this tranche
- No merge and no “use cloud” / “use this device” buttons.
- No new migration. The real vault row was not modified from this working tree.
- Plaid, backup version 5, and the financial formulas are unchanged.

## 2026-09-25 — WE-SYNC-003 desktop bootstrap and empty-device hydration

### What changed
- Income, one-time expenses, paid toggles, and budget auto-scale no longer write the old relational tables. `lib/babylon/cloud-sync.ts` is gone. The unused row mappers are gone too. `isUuid` remains.
- A signed-in device can classify local data, the cloud vault, and the local owner key. It does not upload or download by itself.
- The only upload is an explicit “Use this device to initialize cloud state” when this device has a financial vault, the cloud vault is absent, and the owner key is unset or already this account. Success requires a revision 1 read-back that matches, and only then is the owner key saved.
- An empty device can explicitly load a valid cloud vault. A device that already has financial data is not replaced and is not uploaded.
- A different owner key blocks both directions. A newer or unreadable cloud vault blocks both directions and is not treated as empty.
- After a link, the sidebar shows the cloud revision and says new entries stay on this device. Later edits are not uploaded yet.

### Ownership
- Classification, verification, bootstrap, and hydration: `lib/babylon/cloud-setup.ts`
- Session and button handlers: `hooks/useBabylonEngine.ts`
- Sidebar copy: `components/babylon/app-sidebar.tsx`

### Not in this tranche
- No continuous sync, no merge, and no phone-replace action.
- The Supabase migration was not applied. The desktop was not pointed at the new project.
- Backup export stays version 5. Financial formulas are unchanged.

## 2026-09-25 — WE-SYNC-002 cloud vault foundation

### What changed
- Signing in no longer copies local income, expenses, or budget categories to Supabase. `migrateLocalLedgerToCloud` is gone.
- The repository now has one vault table, `wealth_engine_vaults`: one row per user, schema version, JSON document, revision, and `updated_at`.
- Initialize creates revision 1 only when that user has no row. A second initialize does not overwrite.
- A later edit is a single database update that succeeds only when the stored revision and schema version still match. Revision 17 becomes 18. A stale 17 does not change the row.
- The application does not call those primitives yet. The desktop vault was not uploaded. The new Supabase project was not migrated.
- A separate local key, `wealth-engine-cloud-owner`, can remember which Supabase user owns a future sync. Sign-in does not write it.
- Sign-up can still save a display name on `profiles`. That is not financial state.
- Backup export stays version 5. Available After Planned Needs stays derived.

### Ownership
- Vault schema: `supabase/migrations/20260925_wealth_engine_vault.sql`
- Read, create-only init, and revision update: `lib/babylon/cloud-vault.ts`
- Unset owner binding: `lib/babylon/cloud-owner.ts`
- Sign-in no longer migrates: `hooks/useBabylonEngine.ts`

### Not in this tranche
- No cloud hydration, no desktop bootstrap, and no upload after each edit.
- Plaid tables and financial formulas are unchanged.
- WE-SYNC-003 must confirm before the first upload, and must refuse a different signed-in user once the owner key is set.

## 2026-09-24 — WE-BUDGET-006 available after planned needs

### What changed
- Available After Planned Needs is Money Available minus Protected Money minus Upcoming Needs, floored at zero.
- When that difference is negative, the headline stays $0 and Planned Needs Shortfall shows the gap.
- The number is derived whenever those three inputs change. It is not saved, and it does not create activity.
- It does not subtract Living Budget Remaining, tracked Wealth Building, tracked Emergency Fund contributions, Upcoming Wants, paid expenses, or recurring rules.
- Paying a bill removes it from Upcoming Needs and does not change account balances. The figure asks the user to update Financial Position when money leaves an account.

### Ownership
- Formula: `lib/babylon/available-after-planned-needs.ts`
- Composition: `hooks/useBabylonEngine.ts`
- Presentation: `components/babylon/financial-position.tsx`

### Distinction
- Living Budget Remaining is tracked 70% capacity after settled spending.
- Available After Planned Needs is current observed money after current protection and known unpaid Needs.
- A future payday is not included. This is not a promise that the remainder is safe to spend.

## 2026-09-24 — WE-BUDGET-005 monthly recurring obligations

### What changed
- A monthly rule describes a bill: name, amount, Need or Want, category, due day, first month, and whether it is active.
- Wealth Engine creates one Upcoming expense for the current month and one for the next month. It does not create earlier months, and it does not mark those rows paid.
- The rule is not added into Upcoming Needs or the Living Budget. Only the expense occurrence counts, and only after it is marked paid does it become spending.
- Deleting one month remembers that month so a reload does not create it again. The rule stays until the user turns it off.
- Editing one month changes that expense only. Editing the rule changes months generated after the save. Months already on the ledger stay as they are.
- Backups are version 5. Versions 1–4 import with no recurring rules. Version 5 keeps the rules and skipped months.

### Ownership
- Rule, calendar day, horizon, and skip: `lib/babylon/recurring-obligations.ts`
- Local vault and backup version 5: `lib/babylon/persistence.ts`
- Add, catch-up, pay, and edit: `hooks/useBabylonEngine.ts`
- Upcoming entry and ledger: `components/modals/RecordTransactionModal.tsx`, `components/babylon/ledger-matrices.tsx`

### Distinction
- Recurrence creates obligations. It does not create spending, income, allocations, or account changes.
- An expected payday is not received income. This tranche does not generate income.
- Recurring rules are local. They are not a Supabase table and they are not inferred from Plaid.
- A future Sindarin forecast may compare an expected bill with what reality shows. Wealth Engine still waits for the user to confirm a change. No Sindarin code was added.

## 2026-09-24 — WE-BUDGET-004 existing protected money

### What changed
- Existing Wealth Building and Existing Emergency Fund are amounts of current Money Available already designated before Wealth Engine tracked them. They default to 0. They are not income, allocation events, expenses, or accounts.
- Protected Money is those two existing amounts. It does not include historical allocation totals or tracked month-close surplus.
- The Wealth Building card total is the existing designation plus tracked allocation wealth. Allocation charts stay tracked-only.
- The Emergency Fund balance shown at month close is the existing designation plus tracked surplus. Closing a month still adds surplus only to the tracked reservoir.
- A new designation that exceeds Money Available is rejected and left unchanged. If accounts are later reduced below a stored designation, the amounts stay and Financial Position explains the conflict.
- A full local reset clears the designations. Month close, expenses, and deleting income do not.
- Backups are version 4. Versions 1–3 import the designations as 0. Version 4 keeps them. Versions 3 and 4 keep upcoming expenses unpaid.

### Ownership
- Designation totals and the fit check: `lib/babylon/protected-money.ts`
- Local vault and backup version 4: `lib/babylon/persistence.ts`
- Edit and conflict warning: `components/babylon/financial-position.tsx`
- Saved fields and displayed totals: `hooks/useBabylonEngine.ts`

### Distinction
- Protected Money is included inside Money Available. It is not extra money, and it is not subtracted from Money Available.
- Historical Wealth Building allocations are not treated as cash still sitting in the accounts.
- Living Budget and Upcoming Needs are unchanged.
- This is not safe-to-spend. It is not cloud-backed, and it is not inferred from an account type.

## 2026-09-24 — WE-BUDGET-003 paid vs upcoming

### What changed
- A paid expense (`isSettled: true`) is actual spending. It reduces Living Budget remaining, category actuals, and Need or Want totals for the transaction month.
- An upcoming expense (`isSettled: false`) is a known unpaid obligation. It does not reduce those totals. Upcoming Needs is the sum of every unpaid Need, in any month.
- Add Expense asks for Already Paid or Upcoming. Marking an upcoming row paid updates that same row and sets the transaction date to the local payment day, not the due date.
- Month close no longer marks unpaid expenses paid. An unpaid bill stays upcoming into the next month and does not spend that month's Living Budget until it is paid.
- Older local vaults and version 1–2 backups, where unsettled rows were already counted as spent, are migrated to paid once. Version 3 backups keep upcoming rows unpaid.

### Ownership
- Spending and upcoming totals: `lib/babylon/engine.ts`
- One-time migration and backup version 3: `lib/babylon/persistence.ts`
- Add and pay workflow: `hooks/useBabylonEngine.ts`, `components/modals/RecordTransactionModal.tsx`
- Ledger status and Overview Upcoming Needs: `components/babylon/ledger-matrices.tsx`, `components/babylon/upcoming-needs.tsx`

### Distinction
- Financial Position is money entered as currently in accounts. Paying an expense does not change those balances.
- Upcoming Needs is not subtracted from Money Available.
- Money Available is not safe-to-spend. Protected starting amounts are still WE-BUDGET-004.
- Income still allocates 10/20/70. Upcoming obligations and payments do not.

## 2026-09-24 — WE-BUDGET-002 financial position

### What changed
- The local ledger can store manually entered accounts: name, kind (checking, savings, or cash), balance, and the local calendar date that balance was accurate.
- Money Available is the rounded sum of those balances. It is not saved as its own field.
- Adding, editing, or removing an account changes only that list. It does not create income, allocations, expenses, or debt payments.
- Overview shows Financial Position above the Living Budget cards on both the mobile Command tab and the desktop overview. Account balances are local only.

### Ownership
- Types: `types/babylon.ts` (`FinancialAccount`)
- Sum, date label, and list edits: `lib/babylon/financial-position.ts`
- Local vault and backup version 2: `lib/babylon/persistence.ts`
- Mutations: `hooks/useBabylonEngine.ts`
- Presentation: `components/babylon/financial-position.tsx`

### Distinction
- Financial Position is money the user says currently exists.
- Income is newly received money and still runs 10/20/70.
- Living Budget is the 70% produced from that income.
- Money Available is not safe-to-spend. Upcoming bills and protected starting amounts are later work.

## 2026-09-24 — WE-LANGUAGE-002 modern financial language

### What changed
- User-facing copy now uses Wealth Building, Debt Payoff, Living Budget, Needs, Wants, Emergency Fund, and Income.
- Navigation is Overview, Ledger, and Financial Guidance. The nine guidance lines are original plain-language notes on the 10/20/70 split.
- Public product name is Wealth Engine. Babylon, Arkad, and Laws of Gold are gone from the operating UI.
- Stored ids, formulas, and historical journal entries are unchanged.

### Ownership
- Display strings live in components, `STREAM_KIND_LABELS`, `NAV_ITEMS`, `BABYLON_WISDOM`, activity templates, and metadata.
- Domain math remains `lib/babylon/engine.ts`. Persistence keys are unchanged.

## 2026-09-24 — WE-PERF-002 mobile runtime

### What changed
- **Scroll paint** — sticky header, CommandBar, SpeedTributeBar, and shared Card no longer use backdrop blur. Those surfaces are opaque slate. Dialog and sidebar blur are unchanged.
- **Clock** — the one-second wall clock lives in `CommandBar`. `useBabylonEngine` keeps a local-calendar day and advances it at the next local midnight, or when the tab becomes visible on a new day. It does not rerender the dashboard every second.
- **Mounting** — below Tailwind `lg` (1024px) only the mobile tab tree mounts. At `lg` and above only the desktop tree mounts. `useSyncExternalStore` plus `matchMedia` stays aligned with resize and avoids a hydration mismatch by rendering mobile on the server.

### Ownership
- Clock display: `components/babylon/command-bar.tsx`
- Financial day: `todayIso` and `msUntilNextLocalMidnight` in `lib/babylon/engine.ts`; day state in `hooks/useBabylonEngine.ts`
- Breakpoint mount: `lib/babylon/layout-viewport.ts` and `hooks/useDesktopLayout.ts`, used by `wealth-engine-dashboard.tsx`
- Allocation formulas are unchanged

## 2026-09-24 — WE-RELIABILITY-001 deployment-safe shell

### What changed
- **Navigation** — `public/sw.js` fetches the HTML document from the network (`cache: "no-store"`) and stores that response only as an offline fallback. A cached `/` can no longer win while the network is up, so it cannot point at `/_next/static` hashes from a previous build.
- **Scope** — `/api/*`, `/sw.js`, non-GET, and cross-origin requests are not handled by the worker. Hashed `/_next/static/*` files may be cache-first.
- **Lifecycle** — live cache is `babylon-engine-v2`. Activate deletes every other cache, including `babylon-engine-v1`, then claims clients and reloads open windows once. Install does not precache `/`. Registration uses `updateViaCache: "none"` and still skips localhost.

### Ownership
- Worker: `public/sw.js`
- Policy tests: `lib/babylon/sw-policy.ts`
- Registration: `components/layout/ServiceWorkerRegistrar.tsx`
- Ledger, PIN, WebAuthn, Supabase, and Plaid are unchanged

## 2026-09-24 — WE-LOCK-001 financial truth

### What changed
- **Local calendar day** — `todayIso` uses local year/month/day. Evening hours west of UTC no longer roll the financial day forward.
- **Labor rate** — `effectiveHourlyRate` / `primaryHourlyRate` use the latest recurring deposit per trimmed `source`. Historical repeats of the same paycheck no longer multiply the wage. One-time rows do not define or erase that rate.
- **Penny-exact 10/20/70** — `allocateIncome` rounds in integer cents and assigns any leftover penny to the 70% share so wealth + debt + expenditure equals gross. Debt-free redirect keeps that sum.
- **Presentation** — sidebar says "Cloud connected"; Plaid success and the banks card describe a connection, not imported transactions; the archive chart is "Cumulative Closed-Month Allocations".
- **Tests** — `lib/babylon/engine.test.ts` via Vitest (`npm test`, `TZ=America/Denver`).

### Ownership
- Domain math: `lib/babylon/engine.ts`
- Copy: `app-sidebar.tsx`, `connected-banks-card.tsx`, `plaid-client.ts`, `debt-freedom-engine.tsx`, `MonthlyCloseModal.tsx`
- No schema, sync, or Plaid-ingestion changes

## 2026-08-07 — SecurityGate SSR bypass + forced Plaid mount

### What changed
- **SecurityGate client-only** — `security-gate.client.tsx` mounts via `next/dynamic({ ssr: false })` so WebAuthn/storage never participate in SSR; dashboard imports the client wrapper
- **No blank gate boot** — `!ready` renders `VaultLoading` instead of `null` (mobile freeze surface)
- **PlaidLinkButton always on DOM** — never returns null; ConnectedBanksCard always mounts the control (Sign In / Connect Bank labels) instead of swapping it off

### Ownership
- Gate mount policy: `security-gate.client.tsx` + `security-gate.tsx`
- Plaid presentation: `plaid-link-button.tsx`, `connected-banks-card.tsx`

## 2026-08-07 — Record Tribute submit + Plaid button visibility

### What changed
- **Form reload harden** — `Button` defaults to `type="button"`; Select triggers are `type="button"`; Record Tribute `handleSubmit` always `preventDefault` + try/catch + sticky success toasts (`durationMs: 0`)
- **Plaid always mounted** — CommandBar / ConnectedBanksCard never hide Link controls; initializing click toasts *"Initializing Plaid connection..."*; compact `VaultErrorBoundary`
- **Dismissible toasts** — VaultToastHost keeps `durationMs: 0` until steward dismisses

### Ownership
- UI primitives: `components/ui/button.tsx`, `select.tsx`, `vault-toast.tsx`
- Tribute form: `components/modals/RecordTransactionModal.tsx`
- Plaid presentation: `plaid-link-button.tsx`, `command-bar.tsx`, `connected-banks-card.tsx`

## 2026-08-07 — Plaid Link on Command Deck

### What changed
- **PlaidLinkButton** — CommandBar icon control next to Discreet Mode; launches Link via `usePlaidConnections`
- **ConnectedBanksCard** — Command Deck quick-action showing synced count / empty state; opens Link or Auth
- **usePlaidConnections** — Application owner for link-token → Link → exchange + public item list (`access_token` never client-side)
- Dependency: `react-plaid-link`

### Ownership
- Presentation: `plaid-link-button.tsx`, `connected-banks-card.tsx`, `command-bar.tsx`, dashboard mounts
- Application: `hooks/usePlaidConnections.ts`
- Client helpers: `lib/babylon/plaid-client.ts`

## 2026-08-07 — SecurityGate PIN setup crash harden

### What changed
- **Fail-soft storage/crypto** — localStorage/sessionStorage + `crypto.subtle` wrapped; `setVaultPin` returns `{ ok }` instead of throwing into React
- **PIN setup path** — `handleCreatePin` unlocks immediately after hash write; never awaits WebAuthn during setup
- **Defensive WebAuthn** — all `navigator.credentials` / `PublicKeyCredential` access guarded; unavailable → PIN mode
- **VaultErrorBoundary** — catches client crashes in the gate and offers PIN recovery UI

### Ownership
- Vault lock policy: `lib/babylon/security.ts`, `components/babylon/security-gate.tsx`, `components/babylon/vault-error-boundary.tsx`

## 2026-08-07 — SecurityGate WebAuthn domain lockout fix

### What changed
- **1.5s WebAuthn race** — `unlockWithWebAuthn` returns `success | timeout | failed | unavailable`; never hangs the gate
- **Gate phases** — `setup` | `authenticating` | `pin_entry` with always-visible **Use 4-Digit PIN** under the spinner
- **Master PIN setup** — origin without `babylon_vault_pin_hash` shows **Set Vault Master PIN**
- **Domain recovery** — failed biometrics clear stale cred + `needsBioReenroll`; PIN unlock re-registers for the current hostname

### Ownership
- Vault lock policy: `lib/babylon/security.ts` + `components/babylon/security-gate.tsx`

## 2026-08-07 — Plaid security & architecture harden

### What changed
- **Secret isolation** — `PLAID_SECRET` / service role confined to `lib/babylon/plaid-server.ts` + `lib/supabase/server.ts` (`server-only`); JWT-gated `/api/plaid/link-token` + `/api/plaid/exchange-token`; responses return `PlaidItemPublic` only (never `access_token`)
- **RLS harden** — `20260808_plaid_tables.sql`: column grants hide `access_token`; JWT clients SELECT/DELETE item metadata only; transactions SELECT + UPDATE(`is_processed`); inserts via service role
- **SecurityGate** — 3-minute idle auto-lock (`VAULT_IDLE_LOCK_MS`) + multitasking privacy blur (`visibilitychange` / `blur` / `focus`)
- **Fail-soft** — `plaid-errors` / `plaid-client` + `VaultToastHost`; Plaid failures toast without crashing the offline vault or leaking stack traces

### Ownership
- Server auth + service client: `lib/supabase/server.ts`
- Plaid REST + secrets: `lib/babylon/plaid-server.ts`
- Client Plaid helpers: `lib/babylon/plaid-client.ts`
- Toast bus: `lib/babylon/vault-toast.ts` → host `components/ui/vault-toast.tsx`
- Vault lock policy: `lib/babylon/security.ts` + `components/babylon/security-gate.tsx`

## 2026-08-06 — Babylon Ledger Grand Suite (features 1–5 foundation)

### What changed
- **SecurityGate** + `lib/babylon/security.ts` — WebAuthn + hashed 4-digit PIN vault lock; session unlock via `sessionStorage`
- **Discreet Mode** — `isDiscreetMode` in `useBabylonEngine`, Eye toggle in CommandBar, masks on focus cards / triad / freedom / paycheck / monthly close
- **PaycheckSplitterModal** — income tribute stages via `proposeIncomeSplit` → review 10/20/70 → `executePaycheckSplit` commits vault + cloud dual-write
- **DebtFreedomEngine** — Snowball/Avalanche, Freedom Date projection (`projectDebtFreedom`), extra tribute slider, velocity chart from `periodArchives`
- **MonthlyCloseModal** — surplus sweeps: 50/50, 100% wealth, rollover to next month pool, emergency shield; domain `resolveSurplusDisposition`
- **DebtEntry.interestRate** — soft-migrate + debt form APR for Avalanche
- **Plaid prep** — `supabase/migrations/20260808_plaid_tables.sql`, `lib/babylon/plaid-schema.ts`, DB types + `.env.example` keys (no live Link yet)

### Ownership
- Domain: `lib/babylon/engine.ts`, `types/babylon.ts`, `lib/babylon/discreet.ts`
- Security infra: `lib/babylon/security.ts`
- Plaid schema prep: migration + `plaid-schema.ts`
- Application: `hooks/useBabylonEngine.ts`
- Presentation: security gate, paycheck modal, debt freedom, command bar, monthly close

## 2026-08-07 — Path A entity parity schema (debts + archives)

### What changed
- Migration `supabase/migrations/20260807_add_debts_archives_logs.sql` — `debt_entries` + `period_archives` with RLS (`FOR ALL` owner policies), indexes, and comments mapping to domain `DebtEntry` / `PeriodArchive`
- `period_archives.snapshot_data` JSONB holds sealed-month totals; `activity_logs` already covers `ActivityEvent` from init migration (no duplicate table)
- `lib/supabase/database.types.ts` extended with debt/archive Row/Insert contracts + `PeriodArchiveSnapshotDb`
- Dual-write primitives / hydrate / hook composition for debts, archives, and activity logs **not yet wired** (schema + types only)

### Ownership
- Schema: `supabase/migrations/20260807_add_debts_archives_logs.sql`
- Typed DB contract: `lib/supabase/database.types.ts`
- Domain models unchanged: `types/babylon.ts`

## 2026-08-06 — Mobile Command Deck redesign

### What changed
- **SpendingPowerFocus** (`components/babylon/spending-power-focus.tsx`) — big 70% living-pool remaining + labor-hour equivalent via domain `laborHoursForAmount`
- **SpeedTributeBar** (`components/babylon/speed-tribute-bar.tsx`) — sticky preset chips from `DEFAULT_PRESETS`; currently opens Record Tribute in income/expense mode (1-tap commit still open)
- **GoldenTriad** — mobile horizontal scroll strip with compact 10/20/70 labels; fuller cards from `sm` up
- **WealthEngineDashboard** — mobile (`lg:hidden`) Command / Analytics / Ledgers tabs; focus cards + triad + activity on Command; analytics/blueprint/engines on Analytics; ledgers tab for matrices; desktop sidebar layout retained with focus cards promoted to top
- Sticky stack: CommandBar + SpeedTributeBar share one sticky header zone

### Ownership
- Presentation: dashboard + new babylon surfaces
- Preset vocabulary: `lib/babylon/presets.ts`
- Metrics still from `useBabylonEngine` / `lib/babylon/engine.ts`

## 2026-08-06 — Speed-Tribute presets foundation

### What changed
- Added `lib/babylon/presets.ts` — `QuickPreset` contract, `DEFAULT_PRESETS` (Lowe's paycheck, groceries, gas, coffee/treat, rent/housing), and resolvers that map preset kinds onto canonical `IncomeStreamKind` / `ExpenseKind` without duplicating domain unions
- Docs: ownership rows in `ARCHITECTURE.md` / `MASTER_ROADMAP.md`; handoff entry for presets path
- UI Speed-Tribute Bar / chip wiring not yet mounted (config-only step)

### Ownership
- Preset vocabulary: `lib/babylon/presets.ts` (Domain)
- Canonical stream/expense kinds remain: `types/babylon.ts`

## 2026-07-19 — Auth listener deadlock insulation

### What changed
- `useBabylonEngine` `onAuthStateChange` now defers session React state via `setTimeout(0)` so work exits the auth client's exclusive lock before any follow-on effects run
- Removed parallel `getSession` race; `INITIAL_SESSION` from the listener is the sole bootstrap signal
- Gated local→cloud hydration on `authReady` so migrate/upsert never races the initial mobile auth sweep
- Deferred timers cleared on unmount

### Ownership
- Application composition: `hooks/useBabylonEngine.ts`

## 2026-07-19 — Architecture handbook

### What changed
- Added root `ARCHITECTURE.md` — layered ownership map (Presentation → Application → Domain → Persistence → Infrastructure)
- Canonical ownership matrix expanded from Master Roadmap; roadmap now points to the handbook
- No code or runtime behavior changes

## 2026-07-19 — Phase 3 Path A: Auth UI + local→cloud hydration (complete)

WE-SYNC-002 later removed this financial migrator. The notes below describe what that July session added.

### What changed
- **Auth modal:** `components/modals/AuthModal.tsx` — Sign In / Create Steward Account with username (create), email, password; validation + error/success feedback; Supabase `signInWithPassword` / `signUpWithPassword`
- **Auth primitives:** `lib/supabase/auth.ts` — sign-in, sign-up (+ profile upsert), sign-out (session only)
- **Hydration engine:** `lib/babylon/cloud-hydrate.ts` — on first session, if local ledger has data and cloud vault is empty, batch-upserts `budget_targets`, `income_entries`, `expense_entries`; remints legacy non-UUID ids when needed
- **Hook:** `useBabylonEngine` composes auth listener + one-time migrate + `authOpen` / `signOutCloud` / `cloudHydrating`
- **Sidebar anchor:** Connect Cloud Vault ↔ username + green Synced dot + Sign Out (local cache preserved)
- **Dashboard:** mounts `AuthModal`; hotkeys disabled while auth dialog open

### Ownership
- Auth UI: `components/modals/AuthModal.tsx`
- Auth methods: `lib/supabase/auth.ts`
- Hydration: `lib/babylon/cloud-hydrate.ts`
- Composition: `hooks/useBabylonEngine.ts`
- Shell: `components/babylon/app-sidebar.tsx`, `wealth-engine-dashboard.tsx`

## 2026-07-19 — Phase 3 Path A: Frontend cloud connectivity

### What changed
- **Deps:** `@supabase/supabase-js`, `@tanstack/react-query`
- **Client:** `lib/supabase/client.ts` — env-gated browser singleton (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`); warns and returns null when unset
- **Types:** `lib/supabase/database.types.ts` — typed table/enum contract for Path A schema
- **Cache:** `app/providers.tsx` wraps root layout with TanStack Query (`staleTime` 5m, `gcTime` 30m, no focus refetch)
- **Mappers / sync:** `lib/babylon/cloud-mappers.ts`, `lib/babylon/cloud-sync.ts` — snake_case ↔ camelCase + upsert/update primitives
- **Dual-write:** `useBabylonEngine` listens via `onAuthStateChange`; when `cloudUserId` is set, `addIncome` / `addExpense` / `toggleExpenseSettled` / `autoScaleBudgetCaps` also fire TanStack mutations; local vault always updates (offline-first)
- **IDs:** `generateId()` prefers `crypto.randomUUID()` for Postgres PK compatibility
- **Env template:** `.env.example`

### Ownership
- Client: `lib/supabase/*`
- Sync boundary: `lib/babylon/cloud-mappers.ts`, `lib/babylon/cloud-sync.ts`
- Composition: `hooks/useBabylonEngine.ts`
- Cache shell: `app/providers.tsx` ← `app/layout.tsx`

## 2026-07-19 — Phase 3 Path A: Cloud schema foundation

### What changed
- **Init migration:** `supabase/migrations/20260719_init_babylon_schema.sql`
- **Enums:** `income_stream_kind`, `income_interval` (cloud-normalized intervals including `semi_monthly`), `budget_category_group`
- **Tables:** `profiles` (auth.users 1:1), `budget_targets`, `income_entries`, `expense_entries`, `activity_logs`
- **FKs:** user rows cascade on auth delete; expense `category_id` → `budget_targets` ON DELETE SET NULL
- **RLS:** enabled on all tables; owner policies (`auth.uid() = id` on profiles; `auth.uid() = user_id` elsewhere) for SELECT/INSERT/UPDATE/DELETE
- **Indexes:** `user_id`, `month_key`, and `(user_id, month_key)` composites for high-frequency month-scoped dashboard reads

### Ownership
- Schema: `supabase/migrations/20260719_init_babylon_schema.sql`
- App contracts remain in `types/babylon.ts` (local vault still authoritative until sync cutover)
- Engine math / presentation unchanged — no client wiring in this step

### Notes
- Allocation shares (`wealthShare` / `debtShare` / `expenditureShare`) stay engine-computed; not persisted as columns
- Cloud `income_interval` / activity `type` values are Path A canonical DB bounds; adapters will map local TS unions at sync time

## 2026-07-19 — Path B: Accessibility & UI polish

### What changed
- **Hotkeys:** `useTributeHotkeys` — bare `N` (outside editable fields) and `Ctrl/Cmd+N` open Record Tribute; disabled while tribute/close modals are open.
- **Focus / Esc:** Radix Dialog focus trap retained; Record Tribute auto-focuses the active tab; Esc closes via Dialog without mid-draft corruption (reset only on reopen).
- **ARIA:** Stream-kind pills (`aria-pressed`/`aria-label`), settled toggles, ledger/command actions, wisdom tabs, Auto-Scale, inline category expand (`aria-expanded`/`aria-controls`).
- **Micro-motion:** Settled check spring pulse + `duration-300 ease-out` row opacity/line-through; inline category `animate-expand-fade`.
- **Tooltips:** Accessible Radix tooltips on Tribute Engines badges (Side Hustle / Passive / Primary / Other).
- **Wisdom console:** Floating depth (`wisdom-console` inset highlight + soft emerald glow) without layout shift.

### Ownership
- Hotkeys: `hooks/useTributeHotkeys.ts` composed in dashboard
- Tooltip primitive: `components/ui/tooltip.tsx`
- Motion tokens: `app/globals.css`
- Surfaces: modal, ledger, TributeEnginesPanel, WisdomBox, CommandBar

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
