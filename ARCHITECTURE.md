# Wealth Engine Architecture

Wealth Engine is organized as a layered architecture with explicit ownership boundaries. Each layer owns a single class of responsibility. Higher layers consume lower layers; they do not absorb or reimplement those responsibilities.

This document is the architectural map of the system. It explains how the application is organized, what each layer is responsible for, and where ownership belongs. It is not a roadmap, not a technical specification, and not an implementation guide.

The ownership matrix in this document is the canonical ownership reference for the project. It is derived from — and expands — the architectural ownership table maintained in `MASTER_ROADMAP.md`.

---

## Architectural Philosophy

Wealth Engine is built on a small set of non-negotiable principles:

**Single ownership.** Every concern has exactly one authoritative owner. When ownership is unclear, work stops until the owner is identified.

**Separation of concerns.** Presentation renders. Application coordinates. Domain decides. Persistence stores and retrieves. Infrastructure provides platform capability.

**Domain-first design.** The 10/20/70 rules — allocation, variance, affordability, and related financial behavior — live in the domain layer. The rest of the system exists to express and preserve those rules, not to redefine them. The method was inspired by *The Richest Man in Babylon*. The product name is Wealth Engine.

**Presentation never owns business logic.** React components, charts, forms, and dialogs communicate domain outcomes. They do not invent allocation math, ledger rules, or sync policy.

**Infrastructure never owns domain rules.** Supabase, TanStack Query, Next.js, authentication, storage, caching, and networking support the application. They do not define how wealth is allocated or how periods close.

**Business rules live in one place.** The domain layer is the single source of truth for 10/20/70 financial behavior. No other layer reimplements those formulas.

**Composition over duplication.** New behavior is assembled from existing owners whenever possible. Parallel services that recompute the same facts are architectural debt.

**Clear dependency direction.** Dependencies flow downward: Presentation → Application → Domain / Persistence → Infrastructure. Lower layers do not depend on higher ones.

---

## Layer Diagram

```text
Presentation Layer
        ↓
Application Layer
        ↓
   Domain Layer
        ↓
 Persistence Layer
        ↓
Infrastructure Layer
```

**Presentation** renders institutional and steward-facing state. It owns visual composition and interaction surfaces only.

**Application** coordinates workflows. It sequences user actions, ledger mutations, period rituals, and cloud synchronization without owning formulas or schema.

**Domain** contains the business. It owns type contracts and the 10/20/70 financial rules.

**Persistence** stores and retrieves steward data across local vault and cloud relational surfaces. It owns mapping and hydration at the sync boundary.

**Infrastructure** supplies platform services. It enables the application; it does not define wealth law.

---

## Presentation Layer

**Responsible for**

- React components and dashboard composition
- UI primitives (including shadcn-based controls)
- Layout, brand shell, and visual hierarchy
- Charts, forms, dialogs, and interaction feedback
- Visual and ephemeral UI state (open panels, the phone destination, desktop nav, focus, the desktop CommandBar wall clock)
- Which dashboard tree is mounted: the phone shell below Tailwind `lg`, and the desktop layout at `lg` and above (`hooks/useDesktopLayout.ts`). Phone destination (`home | budget | ledger | more`) lives on the phone branch only and is not synced with desktop `activeNav`

**Owns**

- `components/babylon/*` (including the desktop quick-add bar, the phone header, bottom navigation, phone Home, phone Budget, phone Ledger, and phone More, and desktop Overview / Ledger / Financial Guidance)
- `components/dashboard/*`
- `components/modals/*`
- `components/ui/*`
- `components/layout/*`
- `app/layout.tsx`
- `app/globals.css`
- `app/page.tsx` (surface mount)

**Never owns**

- Allocation math
- Ledger business logic
- 10/20/70 financial rules
- Cloud synchronization policy
- Database schema

Presentation consumes the Application layer. It displays what the engine and workflows produce; it does not become a second engine.

---

## Application Layer

**Responsible for** coordinating steward workflows end to end.

**Owns**

- `hooks/useBabylonEngine.ts` — primary application orchestrator
- Supporting interaction hooks that compose into the dashboard (for example keyboard control loops)

**Coordinates**

- User actions and recording flows
- Ledger mutations and derived metric exposure
- Monthly close and surplus disposition workflows
- Auth session awareness and revision sync (`lib/babylon/vault-sync.ts`). The sync baseline is not part of the financial vault.
- Local vault lifecycle in concert with persistence adapters
- The financial calendar day (`todayIso`), advanced at the next local midnight rather than once per second
- `GET /api/intelligence` (WE-MUSE-002). One read-only contract for the single steward, authorized by the server-only `INTELLIGENCE_READ_SECRET`. WE-MUSE-003 production acceptance succeeded: Sindarin authenticated through its Secure Vault connector and understood the contract without a sample payload. WE-MUSE-004 corrected one boundary code and recorded the v1 semantics below. WE-RECONCILE-001B2 moves the current contract to version `2`. Automated validation passed. Production acceptance is pending. The response is assembled fresh from the vault, the stored notification timezone, and owner-scoped stored balance evidence. It does not call Plaid. It does not return the vault, raw Plaid transactions, or notification internals. A failed balance-evidence read uses declarations and says the evidence is unavailable. It does not write. Unknown stays unknown. The secret is not set by this change.

**Never owns**

- Allocation formulas
- Presentation structure or styling
- Relational database schema
- Platform client configuration as a domain concern

The Application layer is the seam where human intent becomes ordered mutations. It may call Domain for rules and Persistence for storage. It does not relocate those responsibilities into itself.

---

## Domain Layer

This is the heart of Wealth Engine.

**Owns**

- `lib/babylon/engine.ts` — allocation, variance, affordability, and related pure calculations
- `types/babylon.ts` — canonical type contracts for ledger and derived models
- Domain constants that bound system vocabulary (`lib/babylon/constants.ts`)
- Speed-Tribute quick presets (`lib/babylon/presets.ts`) — chip vocabulary; resolvers map onto canonical kinds
- Debt freedom / surplus disposition math (`projectDebtFreedom`, `resolveSurplusDisposition` in `lib/babylon/engine.ts`)
- Read-only Intelligence Contract (`lib/babylon/intelligence-contract.ts`). It composes existing deterministic readings. The current contract is version `2`. Automated validation passed. Production acceptance is pending. Version `1` remains the previously accepted contract. It does not own allocation rules, Attention rules, or persistence. The semantic reference is below.
- Discreet mask contract (`lib/babylon/discreet.ts`)
- Correlated Internal Movement (`lib/babylon/correlated-internal-movement.ts`) — derived reading of two Plaid observations. Not stored
- Observed repetition (`lib/babylon/observed-repetition.ts`) — derived reading of repeated posted observations. Not stored
- Confirmed meaning (`lib/babylon/confirmed-meaning.ts`) — steward confirmation that one current posted Plaid observation corresponded to one existing budget category. Stored beside the observations, not in the vault
- Balance observation (`lib/babylon/balance-observation.ts`) — cached Plaid `current` and `available` for depository checking and savings, plus one steward association to a vault account. Comparison is exact cents. Accept is the only write into Financial Position

**Responsible for**

- 10 / 20 / 70 allocation
- Budget variance and planned-cap scaling math
- Wealth, debt, and expenditure calculations
- Affordability Anchor computations
- Tribute engine aggregations rooted in domain classification
- 10/20/70 financial rules expressed as pure, testable logic

Allocation shares are penny-exact: wealth + debt + expenditure equals the gross deposit, including when the 20% redirects into wealth. `todayIso` is the user's local calendar day. The labor rate used by Affordability Anchor is the latest recurring deposit per income `source`, not the sum of historical deposits.

Financial Position (`lib/babylon/financial-position.ts`) is separate from that split. `FinancialAccount.balance` and `asOf` are the steward's declaration and the fallback. `sumAccountBalances` remains that declaration sum. Operational Money Available is the rounded sum of effective account positions. It is not income, not Living Budget, and not safe-to-spend. Saving a declaration does not call `allocateIncome`. Paying an expense does not change a declaration.

WE-BALANCE-001 keeps a cached Plaid balance beside that figure. Foreground transaction sync does not record that balance. When descriptors are absent, identity bootstrap may read `/accounts/get` once and discard the balances. The cached balance is recorded by the signed-in visibility refresh and by the daily observer. Those recordings store `current` and `available` separately for depository checking and savings, with currency and the time Wealth Engine stored the cache. The source is `accounts_get`. This is Plaid's cached balance. An unchanged cached reading refreshes that stored time. WE-BALANCE-FRESHNESS-005 keeps this path for the daily observer and adds a separate foreground institution reading. A change in current, available, or currency keeps one superseded predecessor. Credit, loan, investment, and cash are not comparable. A null `current`, a missing ISO currency, an unofficial currency, or any ISO currency other than USD makes the comparison unknown. `available` is never used as `current`.

The steward associates one vault account with one Plaid account once. Wealth Engine does not infer that link from name, mask, or activity. Cash cannot be linked. Credit cannot be linked. One owner cannot link the same account twice. The derived fact is exact integer cents: observed current minus the recorded Financial Position balance. Zero is not a discrepancy. The difference is not an explanation of spending, income, a transfer, a hold, or a pending item. WE-BALANCE-001 let the steward copy an eligible current into the declaration. That copy is retired by WE-RECONCILE-001B2. Opening or reloading Wealth Engine still requests a foreground sync. WE-ATTENTION-008 also stores the same cached reading once a day from `GET /api/plaid/observe-balances`, on the Vercel schedule `0 15 * * *`, without a browser session. That route does not sync transactions, reconcile a cause, or write the vault. The reading is not Attention. Effective position derived from a stored reading is separate from the raw observation row. The steward manually applied `supabase/migrations/20261002_plaid_balance_observation.sql` on Wealth_Engine (`nklmgzxxdhuvqayhcigp`). Production acceptance succeeded: a real associated account showed the observed balance, the storage time, the deterministic difference, and the Accept action. WE-ATTENTION-008 is production accepted. Implementation is `0e79584e6fd54bd47d0de8eceb0a754011dabec3`. While Wealth Engine stayed closed, `GET /api/plaid/observe-balances` at `2026-09-27T07:13:15.446Z` returned HTTP 200, and a current balance observation was committed after that wake. HTTP 200 alone was not the acceptance evidence. That wake did not change Financial Position, accept a balance, create an association, sync transactions, call `/accounts/balance/get`, create Attention, or send a notification. WE-ATTENTION-008A is deployed at `9713358663d7c0b7b509a2a1125ee668956ce3ca`. The recorder returns `applied` only when the observation RPC accepts the payload, and the cron counts `items`, `attempted`, `applied`, and `notApplied`. The acceptance trigger did not retain that body. That is not an 008A failure. `plaid_account_associations` had no rows during the acceptance read. A Financial Position association demonstrated earlier under WE-BALANCE-001 is not currently present. The cause is not established. That absence is separate from this acceptance. The label `active_item_no_observation` does not prove an association exists, because its CASE ELSE branch also matches an empty association table.

WE-BALANCE-FRESHNESS-002, production acceptance pending, asks for that same cached reading when a signed-in document is visible and this page has not applied a balance recording in the last 60 seconds. The browser calls `POST /api/plaid/observe-balances`. The session is the owner. The body cannot choose an Item. The route lists that owner's `plaid_items`. WE-BALANCE-FRESHNESS-005 points that POST at the real-time recorder. It does not sync transactions and it does not use the cron secret. Foreground transaction sync does not call that recorder. Visibility is the only foreground balance owner. An Item that appears after the first ready Item list asks that same owner without waiting out the 60-second window. `GET /api/plaid/observe-balances` remains the daily 15:00 UTC wake and the background balance owner. A hidden document does not ask. An in-flight ask is not repeated. Only a summary where every attempted Item applied starts the 60-second window, and that mark is page memory, not stored state. The three existing evidence queries are invalidated after an applied result. Operational position is still derived from those reads. There is no poll and no new persistence in that tranche. Phone Home does not show one observation time for Money Available, because that figure can combine accounts with different provenance.

WE-BALANCE-FRESHNESS-005, production acceptance pending, changes the signed-in foreground ask to `/accounts/balance/get`. `GET /api/plaid/observe-balances` remains the daily cached `/accounts/get` observer. The browser still cannot choose a user, Item, or account. The server derives associated depository checking and savings ids and sends only those as `options.account_ids`. No association means no Balance request. One Item with several associated accounts is one request. Each qualifying Item is its own request. Identity bootstrap still uses `/accounts/get` and still discards balances. Transaction sync does not record balances. `/api/intelligence` does not call Plaid.

WE-PLAID-RECOVERY-001, production acceptance pending, recovers `ITEM_LOGIN_REQUIRED` without a new Item. Connections surfaces Reconnect for an owned local `plaid_items` row. `POST /api/plaid/link-token` with `{ item }` creates an update-mode Link token from the existing server-side `access_token` and omits initial-connect products. Repair Link success does not call public-token exchange. Wealth Engine then asks foreground Balance again. Recovery is a committed `balance_get`, not Link `onSuccess`. Page repair state is sticky per Item: WE-PLAID-RECOVERY-001A clears an Item only when that same Item returns `itemOutcomes[].result === "applied"` from foreground POST. Empty `repairs[]` is not recovery. There is no Item-health schema, webhook, or Attention kind for this condition. Cached provenance remains until real-time evidence commits.

`source` is `accounts_get` or `balance_get`. They share one current row and one superseded predecessor. A `balance_get` success may replace a cached current, or upgrade provenance in place when the cents and currency match. An `accounts_get` write cannot replace, supersede, downgrade, or restamp a current `balance_get` row. A failed or ineligible real-time payload does not destroy an eligible current row and does not fall back to `/accounts/get`. `observed_at` remains the time Wealth Engine committed the response. `REAL_TIME_BALANCE_FRESHNESS_MS` is five minutes, five times the 60-second duplicate guard. Inside five minutes the institution reading is fresh. After that it is aged. The 60-second guard is also checked from the stored `balance_get` `observed_at`, including after reload. Focus, becoming visible, and one timeout at the end of the fresh window re-evaluate the planner. The timeout does not call Plaid. There is no interval.

Operational Money Available still uses an eligible `current`. `available` stays context. While the evidence queries are loading, Money Available is labeled as the declared balance. A cached row is labeled as a cached Plaid balance. A fresh `balance_get` is labeled institution-refreshed. An aged `balance_get` is an earlier institution balance and is not described as fresh. `supabase/migrations/20261004_plaid_realtime_balance_source.sql` is repository source and is not applied. It does not add a table, a column, or a vault schema version.

WE-RECONCILE-001B1 is accepted. Balance evidence is three reads: Plaid account descriptors, current balance observations, and account associations (`lib/babylon/balance-evidence-load.ts`, `hooks/useBalanceObservation.ts`). A successful read with no rows is ready. A failed read is unavailable. An empty array is a successful empty read, and it is a different state from unavailable. If a complete success already happened in this session, a later refresh failure keeps that snapshot in session memory and the load stays unavailable. Retaining the snapshot does not turn the failed refresh into a successful read. A later successful read replaces the snapshot, including a successful empty read. A first failure with no prior success keeps no fabricated evidence. No new persistence was added.

WE-RECONCILE-001B2 implementation is complete. Automated validation passed. Production acceptance is pending. Operational Money Available is `deriveEffectiveMoneyAvailable` in `lib/babylon/balance-observation.ts`, applied by `operationalMoneyAvailable` in `lib/babylon/balance-evidence-load.ts`. For each account, eligibility stays inside `deriveEffectiveAccountPosition`. An eligible cached `accounts_get` current becomes the effective balance. Cash, an unlinked account, ineligible evidence, and a missing usable observation stay on the declaration. `available` is ignored. A superseded row is ignored. A ready load uses the successful evidence. An unavailable load with retained evidence uses that snapshot and keeps its `observedAt`, and the screen still says balance evidence is unavailable. An unavailable load with nothing retained, a loading load, and a signed-out load use declarations. A later successful empty read replaces retained evidence. An eligible current remains the effective amount after it ages. WE-BALANCE-FRESHNESS-005 labels a real-time reading fresh for five minutes and aged after that, without dropping it back to the declaration. Account rows say Cached Plaid balance, Institution-refreshed balance, or an earlier institution balance, with the stored time, or Declared with the as-of date. Edit Account still edits only the declaration. An eligible observation is not overridden by that edit, and there is no override flag. Associate and Remove link remain. Update balance is gone. Nothing writes an observed current into `FinancialAccount.balance` or `asOf`, and an observation does not change the vault revision. The cause of a balance change remains UNKNOWN.

Existing protected money (`lib/babylon/protected-money.ts`) is a designation inside that Money Available. Existing Wealth Building and Existing Emergency Fund say how much of the current balances is already set aside. Protected Money is their sum. It is included in Money Available. It is not extra money, and entering it does not change Money Available. The user-facing Wealth Building total adds tracked allocation wealth. The user-facing Emergency Fund total adds tracked month-close surplus. Historical allocations are not treated as cash still in the accounts. A designation that exceeds operational Money Available cannot be saved. If that Money Available later falls below a stored designation, including when an observed effective position is lower, the amounts stay and the conflict is shown. Nothing reduces Protected Money from a balance observation.

A recurring obligation (`lib/babylon/recurring-obligations.ts`) describes a bill. It is not a second ledger, a spending cap, or a reserve. WE-OBLIGATION-001 gives it a calendar-month interval anchored at its start month. A missing interval, and an interval of 1, mean every month. An interval of 3 means the start month and every third calendar month after it. Distance is calendar months, not a fixed number of days. Wealth Engine still materializes only the current month and the next month, and only when that month is due. A longer interval does not widen the horizon. A month the interval does not include is not generated and is not a skipped month. A skipped month is still a due occurrence the steward deleted. The due day is a calendar day: day 31 in a short month uses that month's last day, and the rule stays 31. The rule amount is not added to Upcoming Needs, and nothing is set aside in the months between occurrences. An occurrence reduces the Living Budget only after it is marked paid. Catch-up runs when the local vault loads and when the existing local-day clock moves into a new month. It does not add a recurrence timer, a service worker schedule, or a cron. Recurrence does not create income. An expected payday is not received income. This does not match bank observations. Confirmed meaning is a separate steward fact about one observation and does not change the rule.

A Monthly Plan revision (`lib/babylon/monthly-plan.ts`, `monthlyPlans` on the vault) is steward-approved historical intent for one explicit period. WE-PLAN-001 stores only finalized revisions. A later approval for the same period appends the next revision and leaves the earlier one unchanged. Planning Basis is an assumption used to derive the canonical 10/20/70 split through `allocateIncome`. It is not Income, and finalization does not create an income row, an allocation event, or any other ledger change. With no remaining debt, the debt share redirects to Wealth Building and that result is copied onto the revision. Every cent of the derived Living Budget share must already be assigned to explicit category purposes. Debt minimums and the remaining balance are copied as context. Minimums above the derived debt share reject finalization. Applicable recurring rules are copied for that period. Existing Wealth Building and Emergency Fund designations are copied as context and are not part of the Planning Basis. Finalization does not change live caps or other working settings. There is no draft store, no automatic month selection, no period-completeness flag, and no historical backfill. Month Close and the Honesty Report are unchanged. A stored schema-5 cloud vault becomes schema 6 only when the signed-in owner calls `upgrade_wealth_engine_vault_schema_5` (`supabase/migrations/20261003_wealth_engine_vault_schema_5_to_6.sql`). That function adds `monthlyPlans: []` and advances the revision by one. It does not accept a replacement document. The migration file is repository source and is not applied. Ordinary compare-and-swap still requires the stored schema to already match, so a schema-5 client cannot write a schema-6 vault. Production acceptance is pending.

WE-PLAN-UI-001 is an implementation candidate and is not production accepted. Desktop Overview and phone Budget share one planning surface (`components/babylon/monthly-plan-panel.tsx`). A first draft copies the current `BudgetTarget` id, name, essential flag, and planned amount into local state. Revise copies the latest revision for that period, even when live caps have since changed. `previewMonthlyPlan` reads the same Living cents, debt-minimum check, and due-rule snapshot that finalization uses. Finalize calls `finalizeMonthlyPlan` and appends a revision. It does not write `BudgetTarget`, income, allocations, or Money Available. There is no apply-to-caps action, no draft store, no new navigation item, and no change to Month Close or the Honesty Report. Planning Basis remains an assumption, not Income.

WE-PLAN-UX-003 redesigns that surface into an interactive financial map. The domain field remains `planningBasis`. The user-facing workspace says “Plan [Month] around” and treats the value as a working assumption. Canonical Wealth / Debt / Living shares stay derived through `previewMonthlyPlan` and `allocateIncome`. Living purposes remain editable draft amounts. Unassigned, exact, and overcommitted Living states are pure arithmetic from preview cents (`lib/babylon/monthly-plan-map.ts`). Wealth Building shows already-protected opening Wealth Building plus this plan’s Wealth share as an intention overlay labeled “If this plan is executed.” It does not add Emergency Fund, tracked allocations, Money Available, or account balances into that overlay. Known recurring commitments for the selected period remain context and do not auto-assign purpose amounts. Historical comparison, plan-vs-actual, Monthly Honesty, and suggested amounts are not in this tranche. The planner is useful without historical comparison. Historical comparison requires at least three complete comparable months and belongs to a future evidence-maturity tranche.

Actual spending is settled expenses only (`actualSpendTotals`, `buildBudgetVariances`). An unsettled expense is an upcoming obligation. Upcoming Needs sums every unpaid Need. Living Budget remaining is the 70% pool minus settled spending. Those figures are not subtracted from Money Available, and protected designations do not change them.

WE-ATTENTION-007B is the minimum in-app attention loop (`lib/babylon/attention.ts`). It reads vault truth the steward already declared. An unpaid expense whose civil due date is on or before the local financial day is eligible, whether that row was typed once or generated from a monthly rule. The Upcoming Needs card lists those rows apart from Coming Up and asks whether each has been paid. Paid calls `toggleExpenseSettled`. Still upcoming writes nothing, and the row stays eligible. On the last local calendar day of the open month, the command bar says that month is still open and ends today. Review close opens the existing three-step Close Month ritual. It does not call `closeMonth` by itself, and it does not close a previous month after the calendar rolls. Nothing in this loop is stored. There is no notification, no snooze, and no observational input. Both reasoners stay unwired. This is not Wealth Engine core-complete until the running UI is accepted. Closed-app delivery is separate: WE-NOTIFY-002 stores an enabled flag, an IANA timezone, and push endpoints only. It does not send, schedule, or change this loop.

Available After Planned Needs (`lib/babylon/available-after-planned-needs.ts`) is Money Available minus Protected Money minus Upcoming Needs, floored at zero. The shortfall is the positive gap when that difference is negative. It is recomputed and not stored. It does not subtract Living Budget remaining, tracked allocation wealth, tracked month-close Emergency Fund contributions, Upcoming Wants, or paid expenses. A recurring rule is not subtracted again; an unpaid Need occurrence already inside Upcoming Needs is. Paying a bill does not change a declared account balance, and a balance movement does not mark a Need paid. Only the Money Available input follows effective position. A future payday is not included. A future Sindarin forecast may describe what reality appears to show. It does not replace the Wealth Engine plan, and this tranche does not call Sindarin.

Correlated Internal Movement (`deriveCorrelatedInternalMovements` in `lib/babylon/correlated-internal-movement.ts`) is a derived reading of two posted Plaid observations on different known accounts of the same Plaid Item. Kinds are `internal_transfer` and `credit_card_payment`. Amounts compare as penny-exact cents through `roundMoney`. A pair is emitted only when each observation has exactly one qualifying partner. Anything ambiguous is omitted. The result is not stored and is not wired to a screen, a route, or a ledger write. It does not create income, expenses, or transfers, and it does not call `allocateIncome`. Future inflow or outflow candidate reasoning may treat accepted Plaid transaction ids as exclusions. The steward still decides what is recorded. WE-ATTENTION-004C live-accepted it on a read-only production export: 339 observations, 4 pending, 0 removed, 7 account descriptors, 47 movements, 24 internal transfers, 23 credit-card payments, 94 participating observations, and 0 overlaps. The export's single user identity was replaced in memory with a synthetic identity. Production data was not mutated, Plaid was not called, and the vault was outside the run. The temporary transport is gone. The function remains unwired.

WE-ATTENTION-005A characterized the observations that function leaves out. The same committed reasoner was rerun on a fresh read-only production export and reproduced 47 movements, 24 internal transfers, 23 credit-card payments, 94 participating observations, and 0 overlaps. Residual membership is subtraction of those exact ids: 245 observations, 241 posted/current, 4 pending, and 0 removed, from the 339-row corpus. No second matcher was written. Production was not mutated, Plaid was not called, and the single user identity was again replaced in memory with a synthetic identity. Identifiers and individual amounts were not emitted. The temporary runner is gone.

Of those 245, 232 are positive on their Plaid account, 13 are negative, and none are zero. Positive and negative describe direction relative to that account only. Fifteen same-account, same-sign, same-cent groups contain at least three residual observations, and all fifteen are positive. Under the predeclared cadence rules they are 7 monthly, 7 mixed, 1 none, 0 weekly, and 0 biweekly. Four posted groups on one anonymous checking account each keep one literal category, three occurrences, and gaps of 31 and 31 days. Literal category text is evidence and not authority. Residual negatives have no qualifying repeated group of three or more. Residual same-cent cross-account pairs are zero on the same day, the adjacent day, and the same sign, including ambiguous multiple counterparts. That does not justify loosening the movement predicate.

An observation is not semantic truth. Recurrence is not semantic truth. Unknown remains a valid state. This characterization did not establish income, a paycheck, an expense, a bill, a subscription, an employer, a merchant, or an account purpose.

Observed repetition (`deriveObservedRepetitions` in `lib/babylon/observed-repetition.ts`) is a derived reading of current posted observations that share a user, a Plaid account, a sign, and exact normalized cents from `roundMoney`. Two or more members form one structure. Category text is attached as evidence and does not decide membership. Consecutive gaps are civil-day counts from validated `YYYY-MM-DD` dates, using UTC calendar arithmetic. Two members produce one observed gap (`single_interval`). Three or more report whether those observed gaps agree (`intervals_agree`) or differ (`intervals_differ`). A later observation can withdraw interval agreement. The function does not name a cadence, predict a later date, or assign financial meaning. Positive cents are money out of that Plaid account. Negative cents are money in. An optional excluded-id set lets a caller omit observations. This module does not import the movement reasoner. The result is not stored and is not wired to a screen, a route, or a ledger write. A recurring obligation remains a steward-declared plan rule and is not changed by this reading. One observation does not establish repetition. Two eligible matches establish a repeated structure and one observed gap. Three or more establish only whether those gaps agree or differ. Interval agreement is not cadence. Recurrence is not financial meaning. Later evidence can withdraw interval agreement. Human financial meaning stays separate.

WE-ATTENTION-005C accepted that reading on a fresh read-only production export of 339 observations, 4 pending, 0 removed, and 7 account descriptors. The movement reasoner first reproduced 47 movements, 24 internal transfers, 23 credit-card payments, 94 participating observations, and 0 overlaps. Those 94 ids were excluded. The repetition reasoner then emitted 31 disjoint structures and 86 unique observations: 17 pairs, 9 of three, 2 of four, 1 of five, and 2 of six, with a maximum of 6. Direction is 30 positive and 1 negative. Interval evidence is 17 single gaps, 5 agreeing, and 9 differing. Category evidence is 23 equal, 8 differing, and 0 absent. The subset of at least three members is 14 structures, 52 observations, all positive, 5 agreeing and 9 differing. WE-ATTENTION-005A's discovery count of 15 groups remains the historical count. One of those groups contained two posted observations and one pending observation, which this reasoner excludes, so the accepted posted reading is 14. That is not a defect. Exactly four structures on one anonymous checking account have three posted members, gaps of 31 and 31 days, agreeing intervals, and equal category text. A fifth structure has the same gaps and agreeing intervals with differing category text, which shows that category text does not decide membership. The 17 pairs, including one negative pair, are repetition plus one gap only. No negative structure reaches three members. The temporary runner is gone. The function remains unwired. Production was not mutated and Plaid was not called.

WE-ATTENTION-006 is complete. It is the stopping boundary for observational relationship primitives. The same fresh read-only envelope — 339 observations, 4 pending, 0 removed, and 7 account descriptors — was partitioned by the committed reasoners in that order. Class A is the 94 Correlated Internal Movement participants. Class B is the 86 Observed Repetition participants after those movement ids were excluded. Class C is the 4 current pending observations. Class D is 0 removed observations. Class E is the 155 posted/current observations in neither reasoner. 94 + 86 + 4 + 0 + 155 = 339. A and B are disjoint. No pending or removed observation participates in A or B. All 155 Class E observations are legitimate isolated posted/current observations: 155 isolated and 0 ineligible. No eligible Class E observation shares a user, an account, and exact normalized signed cents with another eligible Class E observation. They are not unresolved failures. The higher-order relationship the evidence justifies is none.

The core observational model now recognizes three states. Correlated Internal Movement is the deterministic cross-account relationship. Observed Repetition is the deterministic across-time relationship. Isolated Observation is the valid absence of an established higher-order relationship. Isolation is not a failure state. A posted/current observation does not need to belong to a higher-order relationship. Do not add another relationship primitive merely to reduce the isolated population.

Further tests on that isolated corpus earned no primitive. Current posted rows with a nonblank pending-transaction pointer: 0. Current posted-to-current-pending lifecycle links: 0. Exact one-to-many cent partitions: 0. Same-sign, same-cent, different-account, same-date groups: 0. One exact-cent opposite-sign pair sat outside Class A. It occurred once and failed multiple committed movement gates. No repeated exact opposite-sign structure exists outside Class A. Category text is reused across isolated observations and across differing amounts. Category text is not identity. Using it as relationship authority would exceed the evidence.

The system should never know more than its evidence entitles it to know. WE-ATTENTION-006 is the practical stopping consequence of that principle. Further interpretation of the current isolated corpus would require evidence the system does not possess, such as semantic authority, an arbitrary amount or date tolerance, merchant interpretation, or probabilistic inference. Those mechanisms are not justified for the Wealth Engine core observational reasoning layer. Both reasoners remain unwired. This closeout did not change them.

Confirmed meaning (WE-MEANING-001) is that missing steward fact, and only that fact. One current posted Plaid observation can be confirmed as one existing `BudgetTarget`. The record stores the category id, the category name at that moment, and the observation evidence at that moment: signed integer cents, posted date, transaction name, reduced category text, and account identity. It lives in `plaid_observation_confirmations`, owner-scoped like the observations. It is not `vault_data`. A different category supersedes the current row. Revoking leaves no current row. Prior snapshots stay. Renaming or deleting the category does not rewrite or retag them. Pending and removed observations cannot be taught. A posted observation does not inherit a confirmation stored on a pending id. The same Plaid id can later change; the snapshot does not. The record does not create or settle an expense, change a cap, set `is_processed`, or give any other observation that meaning. Observed Repetition, Correlated Internal Movement, Isolation, Attention, and the Intelligence Contract do not read it. Sindarin cannot create, supersede, or revoke it. The steward opens teaching from the connected-bank surface. Unknown observations are not Attention. `supabase/migrations/20261001_plaid_confirmed_meaning.sql` was manually applied by the steward. The production implementation is deployed. Manual acceptance succeeded on a real Amazon Prime observation, and the confirmation persisted across close and reopen.

WE-ATTENTION-007B implements the first in-app loop for decisions already in the vault: due unpaid obligations, and an open month on its last local day. Observational reasoners stay unwired. Wealth Engine is not core-complete until that running UI is accepted. Later attention over observations still has to preserve steward confirmation. The interaction remains Detect, Interpret, Surface, Confirm, Record.

### Intelligence Contract v1

Contract version `1` is a read-only reading. WE-MUSE-003 accepted it in production. Sindarin authenticated through its Secure Vault connector, understood the authority model without a sample payload, and reported that no further contract data is required for its accountability job. WE-MUSE-004 renamed one boundary code. The previous code is not kept as an alias. No field was added in that tranche. The Money Available meaning in this version 1 section is the previously accepted contract. Version 2, below, replaces that meaning. Living Budget, Attention, obligations, and debt totals in this section remain current.

Plaid, and any other external context Sindarin holds, is external financial reality. Wealth Engine contributes financial purpose, recorded and declared internal truth, deterministic derivations, established Attention, and explicit uncertainty. Sindarin compares, synthesizes, explains, and surfaces discrepancies. The human steward holds authority over meaning, confirmation, and action. A Plaid disagreement does not become a Wealth Engine correction. This route has no write authority.

`internal_observational_reasoners_excluded` means Wealth Engine's own observational reasoners exist and their outputs are left out of this contract. It does not mean the consumer is disconnected.

Money figures already on the contract are integer cents of the existing rounded dollar readings. A missing civil month leaves the Living Budget figures null. Available After Planned Needs, the protected totals, the debt totals, and `protected_exceeds_money_available` stay numeric or boolean without a civil date. Unknown is null or an explicit boundary code, not a guessed amount.

Obligation `origin` is only `recorded` or `derived_from_rule`. `recorded` means the unpaid obligation is already in persisted Wealth Engine state, including a recurring occurrence that was stored earlier. `derived_from_rule` means this read materialized that occurrence in memory from a declared recurring rule and did not persist it. The rule is not a contract section. Materialization uses the shared recurrence owner, so an interval greater than one is not treated as monthly. The contract does not gain an interval field.

`attention.items` is recomputed on each read. An empty array means this read found no established Attention. Sindarin may explain or surface those items. It does not create Attention kinds. The only kinds are:

- `due_obligation` has `kind`, `civil_date`, and `subject_ref`. All three are present, and none are null. `civil_date` is this read's civil date, not the bill's due date. The due date and amount remain on the obligation.
- `month_close` has `kind`, `civil_date`, `month_key`, and `statement`. All four are present, and none are null. `statement` is the established sentence that this open month ends on this civil date. It does not close the month and it is not a recommendation.

When the civil date cannot be derived, Attention is empty.

Living Budget uses the civil month:

- Pool is the sum of recorded allocation expenditure for that month. A known month with no expenditure allocation is zero. The read does not run the 10/20/70 split again.
- Settled spend is persisted settled expenses, needs and wants, whose transaction date falls in that month. Unsettled rows are excluded. The transaction date is the payment date, not the due date. Occurrences materialized only for this read are not in this sum.
- Remaining is floored at zero: pool minus settled spend, after treating a negative settled spend as zero.
- Shortfall is floored at zero: settled spend minus pool. It is the excess over the pool, not a second copy of remaining. A negative settled spend is not treated as zero before this subtraction.

Available After Planned Needs:

- Raw difference is manual Money Available, minus opening Protected Money, minus Upcoming Needs. It keeps its sign.
- Available is that difference floored at zero.
- Shortfall is the positive gap when the raw difference is negative, and zero otherwise.
- Upcoming Needs is every unpaid Need on the reading list, at any due date. That list is persisted expenses plus occurrences materialized for this read. Wants are excluded. A recurring rule is not added by itself.
- Opening Protected Money is the Existing Wealth Building designation plus the Existing Emergency Fund designation. Those are designations inside manual balances. They are not additional cash. This subtraction does not use the tracked totals below.

Wealth Building total is the opening Wealth Building designation plus tracked allocation wealth from recorded allocations. Emergency Fund total is the opening Emergency Fund designation plus tracked month-close surplus. Those totals are representations. They are not extra cash, and Available After Planned Needs does not subtract them.

`protected_exceeds_money_available` in version 1 was true only when opening Protected Money, compared in integer cents, was strictly greater than manual Money Available. Tracked totals and Upcoming Needs were not part of the comparison. Each account kept its as-of date.

### Intelligence Contract v2

WE-RECONCILE-001B2 defined contract version `2`. Version `3` below is the current contract. Version `1` is not redefined. Version `2` is not redefined. Operational `money_available_cents` is the same effective sum the Wealth Engine screen uses when stored balance evidence was read successfully. A failed evidence read uses declarations and adds `balance_evidence_unavailable`. It does not report a successful empty observation list, and it does not fail the rest of the contract. The server reads `plaid_accounts`, current `plaid_balance_observations`, and `plaid_account_associations` for the single vault user. It does not call Plaid and it does not load transactions.

Each account keeps `declared_balance_cents` and `declared_as_of`. It also has `effective_balance_cents` and `effective_source` of `declared` or `observed`. An observed account adds `observed_current_cents`, `observed_at`, and `observation_kind` `cached_accounts_get`. Database ids, Plaid account ids, and access tokens are not on the contract.

`balances_are_manual` and `no_reconciliation` are no longer standing claims. `plaid_is_not_vault_truth` remains, because an observation is not copied into the vault declaration. Standing uncertainty also includes `cached_accounts_get_balance` and `balance_change_cause_unknown`. A cached balance does not establish spending, income, a transfer, a hold, a purpose, or a category. Sindarin remains read-only. `protected_exceeds_money_available` and Available After Planned Needs use the same operational Money Available. Living Budget is unchanged. Month close is unchanged.

### Intelligence Contract v3

WE-BALANCE-FRESHNESS-005 is the current contract. Production acceptance is pending. Version `2` is not redefined. Operational money is still `money_available_cents` and each account's `effective_balance_cents`. The position names those fields in `operational_balance_fields`. `declared_balance_role` is `provenance_fallback`. `declared_balance_cents` remains the steward declaration and the fallback when no eligible observation exists. It is not the preferred current figure when eligible observed evidence exists.

`observation_kind` is `cached_accounts_get` or `real_time_balance_get` for an observed account, and null for a declaration. A real-time account also has `institution_reading_age` of `fresh` or `aged`, compared with `REAL_TIME_BALANCE_FRESHNESS_MS` at read time. A cached or declared account has `institution_reading_age` null. An aged real-time reading is not a new institution reading. `cached_accounts_get_balance` is included only when at least one effective observed account is still a cached reading. `plaid_is_not_vault_truth` remains on every contract. The route still does not call Plaid.

Debt original total is the sum of recorded original balances. Debt remaining total is the sum of recorded remaining balances. Debt cleared is original total minus remaining total, floored at zero.

**Never owns**

- React rendering
- Network transport
- Schema migrations
- Session management

Nothing else reimplements these rules. If a surface needs a financial fact, it consumes Domain output through Application composition.

---

## Persistence Layer

**Responsible for** storing and retrieving steward data without deciding wealth law.

**Owns**

- Local vault persistence (`lib/babylon/persistence.ts`)
- Cloud relational schema (`supabase/migrations/*`)
- Supabase user-id check (`lib/babylon/cloud-mappers.ts`)
- Versioned per-user vault (`lib/babylon/cloud-vault.ts`, `supabase/migrations/20260925_wealth_engine_vault.sql`)
- Plaid connection, transaction observations, and account descriptors (`supabase/migrations/20260808_plaid_tables.sql`, `supabase/migrations/20260926_plaid_transaction_sync.sql`, `supabase/migrations/20260927_plaid_accounts.sql`, `supabase/migrations/20260928_plaid_account_identity.sql`). The access token is plaintext and service-role only. It is not application-encrypted. Observation rows and account descriptors are not `vault_data`. Descriptors still do not store balances. A signed-in visit requests that sync once per Item from `hooks/usePlaidConnections.ts`. When that sync succeeds and the Item still has no descriptors, the server calls `/accounts/get` and discards balances before writing identity. The same successful sync then calls `/accounts/get` again, including when descriptors already exist, and stores cached depository checking and savings balances in `plaid_balance_observations`. That second read does not move the transaction cursor. `20260928` is written and not applied from the app. Live descriptors are not accepted yet. The steward manually applied `20261002_plaid_balance_observation.sql`. Production acceptance of a real association and observed balance succeeded. WE-ATTENTION-008 adds a separate daily cron, `GET /api/plaid/observe-balances` at `0 15 * * *`, that calls the same recorder for each server-listed Item. It does not advance `transactions_cursor`. That cron is deployed and not production accepted. Its first wake returned HTTP 200 without moving a known Stored timestamp. WE-ATTENTION-008A adds an `applied` / `not-applied` recorder result and is not yet deployed.
- Explicit bootstrap and empty-device hydration (`lib/babylon/cloud-setup.ts`)
- Notification preference and push subscription records (`supabase/migrations/20260929_notification_foundation.sql`, `lib/babylon/notification-records.ts`, `lib/babylon/notification-store.ts`, `app/api/notifications/*`). One preference row holds an explicit enabled flag and an IANA timezone. Push rows hold an endpoint and its keys. Neither is `vault_data`. Production already has `notification_preferences` and `push_subscriptions`. WE-NOTIFY-003 lets this browser opt in from More → Data and cloud, save that endpoint through the existing API, and teach `/sw.js` to show fixed generic copy that opens `/`. Turning off this device removes its endpoint and does not clear the steward-wide enabled flag.
- Deterministic Attention delivery (WE-NOTIFY-004, not production-accepted). `GET /api/notifications/evaluate` is protected by `CRON_SECRET`, and Vercel runs it once daily at `0 15 * * *` UTC. For the current steward that schedule is about 8:00 America/Boise in winter and about 9:00 in summer. A second cron path on the same schedule, `GET /api/plaid/observe-balances`, stores cached balances and does not run inside this evaluator. The job does not hard-code that zone. Each enabled preference supplies its own IANA timezone, and an invalid zone skips that steward. The evaluator reads the current vault through `parseCloudVaultData`, materializes recurring obligations in memory only, and calls `deriveDueAttention` and `deriveMonthCloseAttention`. It does not write the vault, revision, or any financial record. Eligible subjects for one steward and one run share one generic Web Push. A successful delivery is one row per subject in `notification_deliveries` (`supabase/migrations/20260930_notification_deliveries.sql`), unique only when `status = 'succeeded'` for that user, attention key, and civil date. That success row is inserted only after at least one endpoint accepts the push. Delivery is operationally at-least-once across that boundary (WE-NOTIFY-004A). If the success insert does not commit, the same civil day can send the generic notification once more. A stored success remains final. A rare duplicate generic notification is preferable to suppressing legitimate Attention. Failed attempts stay retryable. The same run deletes that steward's delivery rows older than 14 civil days. An endpoint that returns 404 or 410 is deleted. Other failures do not change the global preference. The push payload is empty. `/sw.js` still shows “Wealth Engine” / “Wealth Engine needs your attention.” and opens `/`. `POST /api/notifications/test` sends that same generic push to the signed-in steward's stored subscriptions and does not record an Attention delivery. Production `notification_deliveries` has been independently verified present and structurally equivalent to the repository's `20260930_notification_deliveries.sql`. The verification operation did not apply or replay the migration. Supabase CLI migration history still does not record repository migrations. Do not replay `20260930`. Do not run `supabase db push`. Do not infer migration application history merely from object existence. The repository file remains the canonical schema definition. The steward has configured `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `CRON_SECRET` in the Wealth Engine Vercel project and redeployed after the subject and cron secret were added. WE-NOTIFY-004 is not production accepted.
- Typed database contracts (`lib/supabase/database.types.ts`)

**Canonical production database.** Wealth Engine has one Supabase production project: Wealth_Engine, ref `nklmgzxxdhuvqayhcigp`, `https://nklmgzxxdhuvqayhcigp.supabase.co`, organization Wealth_Engine. A database operation must fail closed when that identity cannot be proven. Historical or shared Supabase projects are not Wealth Engine targets. Files in `supabase/migrations/` remain the schema definitions. Production does not currently have `supabase_migrations.schema_migrations`, so the CLI can report those files as unapplied even when the objects exist. Supabase CLI migration history still does not record repository migrations. Verify production object existence before applying a migration. Do not use `supabase db push`, and do not replay a migration only because CLI history says it is unapplied, until that history is deliberately reconciled. Do not infer migration application history merely from object existence. `notification_deliveries` is one such case: it is present and structurally equivalent to `20260930_notification_deliveries.sql`, and that verification did not apply the file. Do not replay `20260930`. Local development credentials must all belong to this project before database or API development is trusted.

**Never owns**

- Business rules or allocation formulas
- Presentation decisions
- Workflow orchestration (owned by Application)

Persistence preserves identity and history. Domain defines meaning; Persistence defines durable shape and transport of records.

---

## Infrastructure Layer

**Responsible for** platform services that support the application.

**Examples currently in use**

- Next.js App Router runtime
- Supabase (Auth, Postgres access via browser client)
- TanStack Query (server-state cache defaults via `app/providers.tsx`)
- Browser storage for local vault and auth session persistence
- Production service worker (`public/sw.js`): document navigations are network-first, with the last successful document kept only as an offline fallback. Cache `babylon-engine-v2` replaces older shell caches on activate. `/api/*` and cross-origin calls are not cached. The worker does not touch the local ledger.
- Networking and environment-gated client configuration (`lib/supabase/client.ts`, `lib/supabase/auth.ts`)

Infrastructure enables sessions, caching, and connectivity. It does not define the 10/20/70 rules, ledger semantics, or educational philosophy.

---

## Dependency Rules

1. **Presentation may consume Application.** Components receive coordinated state and actions; they do not reach around Application to invent domain behavior.

2. **Application may consume Domain.** Workflows call pure domain functions for authoritative calculations.

3. **Application may consume Persistence.** Workflows persist and sync through persistence owners; they do not embed SQL or mapping policy inline as a second persistence system.

4. **Persistence may consume Infrastructure.** Mappers and sync primitives use Supabase clients and platform storage.

5. **Domain consumes nothing above itself.** Domain does not import Presentation, Application orchestration, or cloud transport.

6. **Infrastructure never owns business rules.** Platform libraries remain servants of the domain, not sources of financial truth.

7. **Business logic never exists in Presentation.** Visual feedback may reflect domain outcomes; it must not redefine them.

8. **Business logic is never duplicated.** A second copy of allocation, variance, or affordability math — in UI, hooks, or SQL — is a violation of ownership.

---

## Ownership Matrix

Canonical ownership reference for Wealth Engine:

| Concern | Owner | Layer |
|--------|--------|--------|
| Allocation math | `lib/babylon/engine.ts` | Domain |
| Financial Position | `lib/babylon/financial-position.ts` (`sumAccountBalances`); local `accounts[]` via `lib/babylon/persistence.ts` | Domain / Persistence |
| Balance observation | `lib/babylon/balance-observation.ts`; `supabase/migrations/20261002_plaid_balance_observation.sql`. Cached Plaid evidence and one steward association. Accept uses the existing account update. | Domain / Persistence |
| Existing protected money | `lib/babylon/protected-money.ts`; local `openingWealthBuilding` and `openingEmergencyFund` via `lib/babylon/persistence.ts` | Domain / Persistence |
| Monthly recurring obligations | `lib/babylon/recurring-obligations.ts`; local `recurringObligations[]` via `lib/babylon/persistence.ts` | Domain / Persistence |
| Finalized monthly intent | `lib/babylon/monthly-plan.ts` (`finalizeMonthlyPlanRevision`, `previewMonthlyPlan`); `monthlyPlans[]` via `lib/babylon/persistence.ts`. The hook action is `finalizeMonthlyPlan`. The planning surface is `components/babylon/monthly-plan-panel.tsx`. | Domain / Persistence / Presentation |
| Available After Planned Needs | `lib/babylon/available-after-planned-needs.ts` | Domain |
| In-app attention eligibility | `lib/babylon/attention.ts` (`deriveDueAttention`, `deriveMonthCloseAttention`). Payment stays `toggleExpenseSettled`. Close stays the existing ritual. | Domain |
| Notification preference and push subscriptions | `supabase/migrations/20260929_notification_foundation.sql`, `lib/babylon/notification-records.ts`, `lib/babylon/notification-device.ts`, `app/api/notifications/*`. Operational records and this browser's opt-in. They do not decide Attention, send Web Push, or write the vault. | Persistence / Infrastructure |
| Correlated Internal Movement | `lib/babylon/correlated-internal-movement.ts` (`deriveCorrelatedInternalMovements`) | Domain |
| Observed repetition | `lib/babylon/observed-repetition.ts` (`deriveObservedRepetitions`) | Domain |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) | Domain |
| Affordability and income-type totals | `lib/babylon/engine.ts` | Domain |
| Type contracts | `types/babylon.ts` | Domain |
| Domain vocabulary / bounds | `lib/babylon/constants.ts` | Domain |
| Speed-Tribute quick presets | `lib/babylon/presets.ts` | Domain |
| Debt freedom / surplus disposition math | `lib/babylon/engine.ts` | Domain |
| Discreet mask contract | `lib/babylon/discreet.ts` | Domain |
| Vault PIN / WebAuthn gate | `lib/babylon/security.ts`, `components/babylon/security-gate.tsx`, `components/babylon/security-gate.client.tsx` (`ssr: false`), `components/babylon/vault-error-boundary.tsx` | Infrastructure / Presentation |
| Vault toast bus | `lib/babylon/vault-toast.ts`, `components/ui/vault-toast.tsx` | Infrastructure / Presentation |
| Plaid public contracts | `lib/babylon/plaid-schema.ts`, `lib/babylon/plaid-errors.ts`, `lib/babylon/plaid-client.ts` | Persistence / Application |
| Plaid Link workflow | `hooks/usePlaidConnections.ts` | Application |
| Plaid foreground observation sync | `lib/babylon/plaid-foreground-sync.ts`, `lib/babylon/plaid-client.ts` (`requestPlaidObservationSync`), `hooks/usePlaidConnections.ts` | Application |
| Plaid Link UI | `components/babylon/plaid-link-button.tsx`, `components/babylon/connected-banks-card.tsx` | Presentation |
| Plaid secrets + REST | `lib/babylon/plaid-server.ts`, `app/api/plaid/*` | Infrastructure |
| Plaid schema + RLS | `supabase/migrations/20260808_plaid_tables.sql`, `supabase/migrations/20260926_plaid_transaction_sync.sql`, `supabase/migrations/20260927_plaid_accounts.sql`, `supabase/migrations/20260928_plaid_account_identity.sql`, `supabase/migrations/20261001_plaid_confirmed_meaning.sql`, `supabase/migrations/20261002_plaid_balance_observation.sql` | Persistence |
| Plaid observational sync | `lib/babylon/plaid-transaction-sync.ts`, `lib/babylon/plaid-observation-store.ts`, `lib/babylon/plaid-account-bootstrap.ts`, `lib/babylon/plaid-balance-record.ts`, `lib/babylon/plaid-sync-fetch.ts`, `app/api/plaid/sync-transactions/route.ts` | Infrastructure |
| Period close / surplus workflow | `hooks/useBabylonEngine.ts` (`closeMonth`; composes domain surplus helpers) | Application |
| Ledger state coordination | `hooks/useBabylonEngine.ts` | Application |
| Interaction composition (e.g. hotkeys) | `hooks/useTributeHotkeys.ts` (composed by dashboard) | Application |
| Local vault read/write | `lib/babylon/persistence.ts` | Persistence |
| Cloud relational schema | `supabase/migrations/*` | Persistence |
| Supabase id check | `lib/babylon/cloud-mappers.ts` | Persistence |
| Versioned cloud vault | `lib/babylon/cloud-vault.ts` | Persistence |
| Explicit cloud setup | `lib/babylon/cloud-setup.ts` | Application |
| Revision sync | `lib/babylon/vault-sync.ts` | Application |
| Cloud owner binding | `lib/babylon/cloud-owner.ts` | Persistence |
| Typed DB contract | `lib/supabase/database.types.ts` | Persistence |
| Supabase browser client | `lib/supabase/client.ts` | Infrastructure |
| Supabase server auth / service role | `lib/supabase/server.ts` | Infrastructure |
| Auth session methods | `lib/supabase/auth.ts` | Infrastructure |
| Server-state cache | `app/providers.tsx` (TanStack Query) | Infrastructure |
| Presentation surfaces | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` | Presentation |
| Auth onboarding UI | `components/modals/AuthModal.tsx` | Presentation |
| UI primitives | `components/ui/*` | Presentation |
| Brand / shell | `app/layout.tsx`, `app/globals.css` | Presentation |

When a new concern appears, it must be assigned to exactly one row in this matrix before implementation proceeds.

---

## Architectural Principles

- **One responsibility.** Each module answers for one coherent duty.
- **One owner.** Ambiguous ownership is a defect, not a negotiation after the fact.
- **One source of truth.** Financial facts originate in Domain; durable records originate in Persistence; workflows originate in Application; pixels originate in Presentation.
- **Business rules are centralized.** The 10/20/70 rules are not scattered across UI, SQL, or adapters.
- **Composition over duplication.** Prefer assembling existing owners to creating parallel engines.
- **Infrastructure serves the domain.** Platforms are replaceable; wealth law is not.
- **Presentation communicates the domain.** The interface teaches and displays; it does not prescribe alternate math.
- **Evidence bounds knowledge.** The system should never know more than its evidence entitles it to know. WE-ATTENTION-006 stops the observational relationship layer at Correlated Internal Movement, Observed Repetition, and Isolated Observation. Isolation is a valid absence, not a failure. Do not add a relationship primitive merely to reduce the isolated population.

---

## Future Evolution

Future features — multi-currency, shared household vaults, Observatory views, and any later platform work — should fit into these existing layers whenever possible.

Do not introduce a new architectural pattern, parallel engine, or alternate ownership path because a feature is convenient to bolt onto the nearest file. Extend the layer that already owns the concern. If ownership is unclear, determine the authoritative owner before writing code.

The architecture evolves intentionally: by clarifying boundaries, composing existing owners, and recording ownership changes in this handbook and the Master Roadmap. It does not evolve by accidental accumulation.
