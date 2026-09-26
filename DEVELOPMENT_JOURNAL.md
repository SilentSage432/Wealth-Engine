# Development Journal

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
