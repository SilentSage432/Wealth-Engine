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

- `components/babylon/*` (including the desktop quick-add bar, the phone header, bottom navigation, phone Home, phone Budget, and phone Ledger, and desktop Overview / Ledger / Financial Guidance)
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
- Discreet mask contract (`lib/babylon/discreet.ts`)
- Correlated Internal Movement (`lib/babylon/correlated-internal-movement.ts`) — derived reading of two Plaid observations. Not stored
- Observed repetition (`lib/babylon/observed-repetition.ts`) — derived reading of repeated posted observations. Not stored

**Responsible for**

- 10 / 20 / 70 allocation
- Budget variance and planned-cap scaling math
- Wealth, debt, and expenditure calculations
- Affordability Anchor computations
- Tribute engine aggregations rooted in domain classification
- 10/20/70 financial rules expressed as pure, testable logic

Allocation shares are penny-exact: wealth + debt + expenditure equals the gross deposit, including when the 20% redirects into wealth. `todayIso` is the user's local calendar day. The labor rate used by Affordability Anchor is the latest recurring deposit per income `source`, not the sum of historical deposits.

Financial Position (`lib/babylon/financial-position.ts`) is separate from that split. A manual account balance is money that already exists. Money Available is the rounded sum of those balances. It is not income, not Living Budget, and not safe-to-spend. Saving a balance does not call `allocateIncome`. Paying an expense does not change account balances.

Existing protected money (`lib/babylon/protected-money.ts`) is a designation inside that Money Available. Existing Wealth Building and Existing Emergency Fund say how much of the current balances is already set aside. Protected Money is their sum. It is included in Money Available. It is not extra money, and entering it does not change Money Available. The user-facing Wealth Building total adds tracked allocation wealth. The user-facing Emergency Fund total adds tracked month-close surplus. Historical allocations are not treated as cash still in the accounts. A designation that exceeds Money Available cannot be saved. If balances later fall below a stored designation, the amounts stay and the conflict is shown.

A monthly recurring obligation (`lib/babylon/recurring-obligations.ts`) describes a bill. It is not a second ledger. Wealth Engine materializes the current month and the next month as ordinary Upcoming expenses, starting at the rule's first month. The due day is a calendar day: day 31 in a short month uses that month's last day, and the rule stays 31. A deleted month is stored on the rule and is not created again. The rule amount is not added to Upcoming Needs. An occurrence reduces the Living Budget only after it is marked paid. Catch-up runs when the local vault loads and when the existing local-day clock moves into a new month. It does not add a recurrence timer, a service worker schedule, or a cron. Recurring rules are local. Generated occurrences are not cloud-written. Recurrence does not create income. An expected payday is not received income.

Actual spending is settled expenses only (`actualSpendTotals`, `buildBudgetVariances`). An unsettled expense is an upcoming obligation. Upcoming Needs sums every unpaid Need. Living Budget remaining is the 70% pool minus settled spending. Those figures are not subtracted from Money Available, and protected designations do not change them.

WE-ATTENTION-007B is the minimum in-app attention loop (`lib/babylon/attention.ts`). It reads vault truth the steward already declared. An unpaid expense whose civil due date is on or before the local financial day is eligible, whether that row was typed once or generated from a monthly rule. The Upcoming Needs card lists those rows apart from Coming Up and asks whether each has been paid. Paid calls `toggleExpenseSettled`. Still upcoming writes nothing, and the row stays eligible. On the last local calendar day of the open month, the command bar says that month is still open and ends today. Review close opens the existing three-step Close Month ritual. It does not call `closeMonth` by itself, and it does not close a previous month after the calendar rolls. Nothing in this loop is stored. There is no notification, no snooze, and no observational input. Both reasoners stay unwired. This is not Wealth Engine core-complete until the running UI is accepted.

Available After Planned Needs (`lib/babylon/available-after-planned-needs.ts`) is Money Available minus Protected Money minus Upcoming Needs, floored at zero. The shortfall is the positive gap when that difference is negative. It is recomputed and not stored. It does not subtract Living Budget remaining, tracked allocation wealth, tracked month-close Emergency Fund contributions, Upcoming Wants, or paid expenses. A recurring rule is not subtracted again; an unpaid Need occurrence already inside Upcoming Needs is. Paying a bill does not change account balances, so the user updates Financial Position when money leaves an account. A future payday is not included. A future Sindarin forecast may describe what reality appears to show. It does not replace the Wealth Engine plan, and this tranche does not call Sindarin.

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

WE-ATTENTION-007B implements the first in-app loop for decisions already in the vault: due unpaid obligations, and an open month on its last local day. Observational reasoners stay unwired. Wealth Engine is not core-complete until that running UI is accepted. Later attention over observations still has to preserve steward confirmation. The interaction remains Detect, Interpret, Surface, Confirm, Record.

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
- Plaid connection, transaction observations, and account descriptors (`supabase/migrations/20260808_plaid_tables.sql`, `supabase/migrations/20260926_plaid_transaction_sync.sql`, `supabase/migrations/20260927_plaid_accounts.sql`, `supabase/migrations/20260928_plaid_account_identity.sql`). The access token is plaintext and service-role only. It is not application-encrypted. Observation rows and account descriptors are not `vault_data` and do not store balances. A signed-in visit requests that sync once per Item from `hooks/usePlaidConnections.ts`. When that sync succeeds and the Item still has no descriptors, the server calls `/accounts/get` once and discards balances before writing identity. The transaction cursor is not part of that write. `20260928` is written and not applied from the app. Live descriptors are not accepted yet.
- Explicit bootstrap and empty-device hydration (`lib/babylon/cloud-setup.ts`)
- Typed database contracts (`lib/supabase/database.types.ts`)

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
| Existing protected money | `lib/babylon/protected-money.ts`; local `openingWealthBuilding` and `openingEmergencyFund` via `lib/babylon/persistence.ts` | Domain / Persistence |
| Monthly recurring obligations | `lib/babylon/recurring-obligations.ts`; local `recurringObligations[]` via `lib/babylon/persistence.ts` | Domain / Persistence |
| Available After Planned Needs | `lib/babylon/available-after-planned-needs.ts` | Domain |
| In-app attention eligibility | `lib/babylon/attention.ts` (`deriveDueAttention`, `deriveMonthCloseAttention`). Payment stays `toggleExpenseSettled`. Close stays the existing ritual. | Domain |
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
| Plaid schema + RLS | `supabase/migrations/20260808_plaid_tables.sql`, `supabase/migrations/20260926_plaid_transaction_sync.sql`, `supabase/migrations/20260927_plaid_accounts.sql`, `supabase/migrations/20260928_plaid_account_identity.sql` | Persistence |
| Plaid observational sync | `lib/babylon/plaid-transaction-sync.ts`, `lib/babylon/plaid-observation-store.ts`, `lib/babylon/plaid-account-bootstrap.ts`, `lib/babylon/plaid-sync-fetch.ts`, `app/api/plaid/sync-transactions/route.ts` | Infrastructure |
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
