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
- Visual and ephemeral UI state (open panels, active tabs, focus, the CommandBar wall clock)
- Which dashboard tree is mounted: mobile tabs below Tailwind `lg`, desktop layout at `lg` and above (`hooks/useDesktopLayout.ts`)

**Owns**

- `components/babylon/*` (including the quick-add bar, spending focus, and mobile Overview / Ledger / Financial Guidance)
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
- Auth session awareness and cloud dual-write timing
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

Available After Planned Needs (`lib/babylon/available-after-planned-needs.ts`) is Money Available minus Protected Money minus Upcoming Needs, floored at zero. The shortfall is the positive gap when that difference is negative. It is recomputed and not stored. It does not subtract Living Budget remaining, tracked allocation wealth, tracked month-close Emergency Fund contributions, Upcoming Wants, or paid expenses. A recurring rule is not subtracted again; an unpaid Need occurrence already inside Upcoming Needs is. Paying a bill does not change account balances, so the user updates Financial Position when money leaves an account. A future payday is not included. A future Sindarin forecast may describe what reality appears to show. It does not replace the Wealth Engine plan, and this tranche does not call Sindarin.

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
| Plaid Link UI | `components/babylon/plaid-link-button.tsx`, `components/babylon/connected-banks-card.tsx` | Presentation |
| Plaid secrets + REST | `lib/babylon/plaid-server.ts`, `app/api/plaid/*` | Infrastructure |
| Plaid schema + RLS | `supabase/migrations/20260808_plaid_tables.sql` | Persistence |
| Period close / surplus workflow | `hooks/useBabylonEngine.ts` (`closeMonth`; composes domain surplus helpers) | Application |
| Ledger state coordination | `hooks/useBabylonEngine.ts` | Application |
| Interaction composition (e.g. hotkeys) | `hooks/useTributeHotkeys.ts` (composed by dashboard) | Application |
| Local vault read/write | `lib/babylon/persistence.ts` | Persistence |
| Cloud relational schema | `supabase/migrations/*` | Persistence |
| Supabase id check | `lib/babylon/cloud-mappers.ts` | Persistence |
| Versioned cloud vault | `lib/babylon/cloud-vault.ts` | Persistence |
| Explicit cloud setup | `lib/babylon/cloud-setup.ts` | Application |
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

---

## Future Evolution

Future features — multi-currency, shared household vaults, Observatory views, and any later platform work — should fit into these existing layers whenever possible.

Do not introduce a new architectural pattern, parallel engine, or alternate ownership path because a feature is convenient to bolt onto the nearest file. Extend the layer that already owns the concern. If ownership is unclear, determine the authoritative owner before writing code.

The architecture evolves intentionally: by clarifying boundaries, composing existing owners, and recording ownership changes in this handbook and the Master Roadmap. It does not evolve by accidental accumulation.
