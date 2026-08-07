# Wealth Engine Architecture

Wealth Engine is organized as a layered architecture with explicit ownership boundaries. Each layer owns a single class of responsibility. Higher layers consume lower layers; they do not absorb or reimplement those responsibilities.

This document is the architectural map of the system. It explains how the application is organized, what each layer is responsible for, and where ownership belongs. It is not a roadmap, not a technical specification, and not an implementation guide.

The ownership matrix in this document is the canonical ownership reference for the project. It is derived from — and expands — the architectural ownership table maintained in `MASTER_ROADMAP.md`.

---

## Architectural Philosophy

Wealth Engine is built on a small set of non-negotiable principles:

**Single ownership.** Every concern has exactly one authoritative owner. When ownership is unclear, work stops until the owner is identified.

**Separation of concerns.** Presentation renders. Application coordinates. Domain decides. Persistence stores and retrieves. Infrastructure provides platform capability.

**Domain-first design.** Babylonian wealth laws — allocation, variance, affordability, and related financial rules — live in the domain layer. The rest of the system exists to express and preserve those rules, not to redefine them.

**Presentation never owns business logic.** React components, charts, forms, and dialogs communicate domain outcomes. They do not invent allocation math, ledger rules, or sync policy.

**Infrastructure never owns domain rules.** Supabase, TanStack Query, Next.js, authentication, storage, caching, and networking support the application. They do not define how wealth is allocated or how periods close.

**Business rules live in one place.** The domain layer is the single source of truth for Babylonian financial behavior. No other layer reimplements those formulas.

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

**Domain** contains the business. It owns type contracts and Babylonian financial rules.

**Persistence** stores and retrieves steward data across local vault and cloud relational surfaces. It owns mapping and hydration at the sync boundary.

**Infrastructure** supplies platform services. It enables the application; it does not define wealth law.

---

## Presentation Layer

**Responsible for**

- React components and dashboard composition
- UI primitives (including shadcn-based controls)
- Layout, brand shell, and visual hierarchy
- Charts, forms, dialogs, and interaction feedback
- Visual and ephemeral UI state (open panels, active tabs, focus)

**Owns**

- `components/babylon/*` (including `SpeedTributeBar`, `SpendingPowerFocus`, mobile Command Deck tabs)
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
- Babylonian financial rules
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

- User actions and tribute recording flows
- Ledger mutations and derived metric exposure
- Monthly close and surplus disposition workflows
- Auth session awareness and cloud dual-write timing
- Local vault lifecycle in concert with persistence adapters

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
- Babylonian financial rules expressed as pure, testable logic

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
- Cloud ↔ domain mapping (`lib/babylon/cloud-mappers.ts`)
- Cloud mutation primitives (`lib/babylon/cloud-sync.ts`)
- Local → cloud hydration (`lib/babylon/cloud-hydrate.ts`)
- Typed database contracts aligned to Path A schema (`lib/supabase/database.types.ts`)

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
- Networking and environment-gated client configuration (`lib/supabase/client.ts`, `lib/supabase/auth.ts`)

Infrastructure enables sessions, caching, and connectivity. It does not define Babylonian wealth laws, ledger semantics, or educational philosophy.

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
| Budget variance math | `lib/babylon/engine.ts` (`buildBudgetVariances`, `scaleBudgetCapsToPool`) | Domain |
| Affordability and tribute aggregations | `lib/babylon/engine.ts` | Domain |
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
| Cloud ↔ domain mappers | `lib/babylon/cloud-mappers.ts` | Persistence |
| Cloud mutation primitives | `lib/babylon/cloud-sync.ts` | Persistence |
| Local → cloud hydration | `lib/babylon/cloud-hydrate.ts` | Persistence |
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
- **Business rules are centralized.** Babylonian law is not scattered across UI, SQL, or adapters.
- **Composition over duplication.** Prefer assembling existing owners to creating parallel engines.
- **Infrastructure serves the domain.** Platforms are replaceable; wealth law is not.
- **Presentation communicates the domain.** The interface teaches and displays; it does not prescribe alternate math.

---

## Future Evolution

Future features — multi-currency, shared household vaults, Observatory views, and any later platform work — should fit into these existing layers whenever possible.

Do not introduce a new architectural pattern, parallel engine, or alternate ownership path because a feature is convenient to bolt onto the nearest file. Extend the layer that already owns the concern. If ownership is unclear, determine the authoritative owner before writing code.

The architecture evolves intentionally: by clarifying boundaries, composing existing owners, and recording ownership changes in this handbook and the Master Roadmap. It does not evolve by accidental accumulation.
