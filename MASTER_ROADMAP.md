# Master Roadmap — Wealth Engine

## Vision
A personal ledger that splits income 10% to Wealth Building, 20% to Debt Payoff, and 70% to a Living Budget. The method was inspired by *The Richest Man in Babylon*. The product name is Wealth Engine.

## Phase 1 — Foundation (Complete)
- [x] Next.js 15 App Router scaffold
- [x] Luxury dashboard shell (sidebar + viewport)
- [x] 10/20/70 allocation engine
- [x] 10/20/70 summary cards
- [x] Recharts analytics hub
- [x] Ledger matrices (income / expenses / debt)
- [x] Needs and Wants
- [x] localStorage persistence (empty-first, live input pipelines)
- [x] Financial Guidance
- [x] Graceful empty states for charts + tables

## Phase 2 — Depth (Complete)
- [x] Ledger export / import
- [x] Affordability Anchor (money left for wants + labor hours)
- [x] Expense due dates + due-soon indicator
- [x] Budget Blueprint (planned caps + Planned vs. Actual within 70%)
- [x] User-configured budget categories (`addBudgetTarget` via Add)
- [x] Clear-ledger UI control (confirmed purge via sidebar AlertDialog)
- [x] Budget bucket edit / delete (`updateBudgetTargetFull` / `deleteBudgetTarget`)
- [x] Responsive layout audit (mobile drawer, triad/charts wrap, table scroll, touch targets)
- [x] Progressive Web App (manifest + service worker + installable icons)
- [x] P0 trust math (reverse debt on income delete, current-month Triad expenditure, desires pool + primary rate)
- [x] Income stream kinds + Tribute Engines scoreboard
- [x] P2 Workflow Clarity (inline category create, expense date, mutation feedback, over-plan banner, orphan reassignment, overview ledger declutter)
- [x] Expense paid/settled toggle (`isSettled` + `toggleExpenseSettled`)
- [x] Recent activity strip on overview
- [x] Auto-scale budget caps from current-month expenditure pool
- [x] Monthly close ritual (summary → surplus disposition → archive & roll forward)

## Phase 3 — Platform
- [x] Accessibility audit & keyboard control loops (hotkeys, focus trap, aria-labels)
- [x] High-end micro-animations & UI polish (settled pulse, inline expand, wisdom console, engine tooltips)
- [x] Path A cloud schema foundation (`supabase/migrations/20260719_init_babylon_schema.sql`)
- [x] Path A client connectivity (Supabase SDK + TanStack Query + dual-write mutations)
- [x] Path A auth UI (AuthModal, sidebar vault anchor). The first-login financial migrator was removed in WE-SYNC-002.
- [x] Mobile layout (focus cards, compact 10/20/70 cards, Overview / Analytics / Ledger tabs)
- [x] Mobile runtime paint and mount (opaque scrolling surfaces, CommandBar-local clock, one layout tree per breakpoint)
- [x] Path A entity parity schema (`debt_entries`, `period_archives` — `20260807_add_debts_archives_logs.sql`)
- [x] Grand Suite: SecurityGate + Discreet Mode, Paycheck Splitter, Debt Freedom Engine, Monthly Close sweeps, Plaid schema prep
- [x] Plaid security harden (JWT API routes, access_token isolation, idle lock, privacy blur, fail-soft toasts)
- [x] Plaid Link on the command bar and banks card (needs live PLAID_* + service role env)
- [x] SecurityGate client-only mount (`ssr: false`) + PlaidLinkButton always-on DOM fallbacks
- [x] Financial Position — local manual account balances and Money Available, separate from 10/20/70 (WE-BUDGET-002)
- [x] Paid vs Upcoming — settled spending, upcoming Needs, one-time legacy migration (WE-BUDGET-003)
- [x] Existing protected money — designations inside Money Available, separate from tracked allocations (WE-BUDGET-004)
- [x] Monthly recurring obligations — upcoming occurrences only, current month and next month (WE-BUDGET-005)
- [x] Available After Planned Needs — derived from Money Available, Protected Money, and Upcoming Needs (WE-BUDGET-006)
- [x] WE-SYNC-002 versioned vault schema and revision primitives
- [x] WE-SYNC-003 explicit desktop bootstrap and empty-device hydration
- [x] WE-SYNC-004 revision sync, offline edits, and conflict stop
- [ ] WE-SYNC-005 choose cloud or this device after a conflict, with a backup first
- [ ] Speed-Tribute 1-tap commit (presets + bar mount; full amount autofill / zero-modal path still open)
- [x] Plaid observational transaction sync (WE-ATTENTION-002). `20260926_plaid_transaction_sync.sql` is written and not applied from the app. No attention UI
- [x] Plaid foreground observation sync (WE-ATTENTION-003A). One signed-in request per Item after the list is ready. No webhook, polling, or attention UI. Production stored 339 observations across 5 account ids. Vault stayed revision 4 / schema 5
- [x] Plaid account identity (WE-ATTENTION-003C). Observational name, mask, type, and subtype from the existing sync payload. `20260927_plaid_accounts.sql` is written and not applied from the app. No balances, interpretation, or attention UI. The temporary foreground probe is removed
- [x] Plaid account identity bootstrap (WE-ATTENTION-003D). Production incremental sync returned `accountsPresent=true`, `accountsCount=0`, `parsedAccountsCount=0`, `pageAccepted=true`. `/accounts/get` runs once after a successful sync when that Item has no descriptors. `20260928_plaid_account_identity.sql` is written and not applied from the app. Balances are discarded. The cursor is independent. Live descriptors are not accepted yet. The temporary account probe is removed
- [x] Correlated internal movement (WE-ATTENTION-004B). Pure derivation only: `internal_transfer` and `credit_card_payment`, penny-exact cents, ambiguity omitted. Not persisted and not wired. No financial mutation. Future inflow or outflow candidates may exclude accepted transaction ids. The steward still records income and expenses
- [x] Correlated internal movement live acceptance (WE-ATTENTION-004C). Passed on a read-only production export run locally through the committed reasoner: 339 observations, 4 pending, 0 removed, 7 account descriptors, 47 movements, 24 transfers, 23 card payments, 94 participating observations, 0 overlaps. Matches the prior SQL characterization. Production was not mutated. The reasoner remains unwired
- [x] Residual observation corpus characterization (WE-ATTENTION-005A). The committed reasoner was rerun first and reproduced 47 / 24 / 23 / 94 / 0. Residual membership is subtraction of those exact ids: 245 observations, 241 posted/current, 4 pending, 0 removed. Residual sign is 232 positive, 13 negative, 0 zero. Fifteen same-account repeated groups are all positive: 7 monthly, 7 mixed, 1 none, 0 weekly, 0 biweekly. Four posted groups on one anonymous checking account share one literal category, three occurrences, and gaps of 31 and 31 days. Residual negatives have no such group. Residual same-cent cross-account pairs are 0. The movement predicate was not loosened. No income, paycheck, expense, bill, subscription, employer, merchant, or account purpose was established. Observation and recurrence are not semantic truth. Plaid category text is evidence, not authority. Plaid sign is direction on that account only. Unknown remains valid
- [x] Pure observed repetition (WE-ATTENTION-005B). Complete. `deriveObservedRepetitions` reads current posted observations that share a user, a Plaid account, a sign, and exact normalized cents. Two members are one repeated structure plus one observed civil-day gap. Three or more report only whether those gaps agree or differ. Category text is evidence and does not decide membership. The result is derived, not stored, and not wired. It does not name a cadence, predict a date, or assign financial meaning. Recurring obligations stay steward-declared plan rules
- [x] Observed repetition production acceptance (WE-ATTENTION-005C). Accepted on a fresh read-only export: 339 observations, 4 pending, 0 removed, 7 account descriptors. Movement reproduction stayed 47 / 24 / 23 / 94 / 0. After excluding those 94 ids, the reasoner emitted 31 disjoint structures and 86 observations (17 pairs, 9 of three, 2 of four, 1 of five, 2 of six; maximum 6). Direction is 30 positive and 1 negative. The posted subset of at least three members is 14, all positive. WE-ATTENTION-005A's discovery count of 15 remains historical: one of those groups included a pending row, which this reasoner excludes. Four structures on one anonymous checking account have three posted members, gaps of 31 and 31 days, agreeing intervals, and equal category text. A fifth has the same gaps and agreeing intervals with differing category text. The reasoner was not changed and remains unwired
- [ ] Plaid attention confirmation / steward review
- [ ] Multi-currency
- [ ] Shared household vaults
- [ ] Institutional knowledge composition (read-only Observatory views)

## Phase 3 — Cloud vault
The planning document is one row per user. The cloud revision is the concurrency authority.
- Vault table and compare-and-swap — `supabase/migrations/20260925_wealth_engine_vault.sql`
- Explicit setup — `lib/babylon/cloud-setup.ts`. Sign-in does not upload or download.
- Revision sync — `lib/babylon/vault-sync.ts`. Local edits save first. A matching cloud revision can be pushed. A newer cloud revision is pulled only when this device is still clean.
- `wealth-engine-cloud-sync` remembers the last verified revision and document fingerprint. It is separate from the financial vault.
- If both sides changed, the screen stops. It does not pick a winner.
- An empty device still confirms a load. A non-empty device is adopted only when its document matches the cloud.
- Plaid stays outside the vault. The service worker does not sync it.
- Observational transaction sync reads Plaid and writes `plaid_transactions` only. It does not allocate income, settle expenses, or change account balances. Account descriptors, when the identity migrations are applied, are stored beside those rows and still are not Wealth Engine accounts. An incremental sync page can carry an empty `accounts` array. `/accounts/get` then supplies identity only, and it does not move the transaction cursor.
- The signed-in screen asks for that sync once after the Item list is ready, and once for an Item connected later in the same signed-in visit. Signing out clears the memory of those requests.
- Correlated Internal Movement is a pure reading of those observations. It is not stored, not shown, and not a ledger transfer. Ambiguous pairs are omitted. WE-ATTENTION-004C live-accepted that reading on a read-only production export. WE-ATTENTION-005A subtracted that reasoner's exact participating ids and characterized the remaining 245 observations. Same-cent cross-account residuals were zero, so the predicate stays as accepted. The function remains unwired. Observed repetition (`deriveObservedRepetitions`) is a separate pure reading of repeated posted structure. It is not stored, not shown, and not a cadence or a financial classification. WE-ATTENTION-005C accepted it on the same 339-observation corpus after excluding the 94 movement ids: 31 disjoint structures, 86 observations, and 14 posted structures of at least three members. The historical 005A discovery count of 15 stays 15 because one exploratory group included a pending row. Recurring obligations remain steward-declared plan rules.

## Architectural ownership

Canonical map: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (layers, dependency rules, ownership matrix).

| Concern | Owner |
|--------|--------|
| Allocation math | `lib/babylon/engine.ts` |
| Financial Position (manual balances, Money Available) | `lib/babylon/financial-position.ts` |
| Existing protected money | `lib/babylon/protected-money.ts` |
| Monthly recurring obligations | `lib/babylon/recurring-obligations.ts` |
| Available After Planned Needs | `lib/babylon/available-after-planned-needs.ts` |
| Correlated Internal Movement | `lib/babylon/correlated-internal-movement.ts` |
| Observed repetition | `lib/babylon/observed-repetition.ts` |
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) |
| Period close / surplus | `hooks/useBabylonEngine.ts` (`closeMonth`, `splitSurplusToDebtWealth`) |
| Ledger state + persistence | `hooks/useBabylonEngine.ts` |
| Type contracts | `types/babylon.ts` |
| Speed-Tribute presets | `lib/babylon/presets.ts` |
| Cloud relational schema | `supabase/migrations/*` |
| Supabase browser client | `lib/supabase/client.ts` |
| Auth session methods | `lib/supabase/auth.ts` |
| Versioned cloud vault | `lib/babylon/cloud-vault.ts` |
| Explicit cloud setup | `lib/babylon/cloud-setup.ts` |
| Revision sync | `lib/babylon/vault-sync.ts` |
| Plaid observational sync | `lib/babylon/plaid-transaction-sync.ts` |
| Plaid foreground observation sync | `lib/babylon/plaid-foreground-sync.ts`, `hooks/usePlaidConnections.ts` |
| Cloud owner binding | `lib/babylon/cloud-owner.ts` |
| Supabase id check | `lib/babylon/cloud-mappers.ts` |
| Server-state cache | `app/providers.tsx` (TanStack Query) |
| Auth onboarding UI | `components/modals/AuthModal.tsx` |
| Presentation | `components/babylon/*`, `components/dashboard/*`, `components/modals/*` |
| UI primitives | `components/ui/*` |
| Brand / shell | `app/layout.tsx`, `app/globals.css` |
