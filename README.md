# Wealth Engine

Executive personal ledger. Income is split 10% to Wealth Building, 20% to Debt Payoff, and 70% to a Living Budget. The 10/20/70 method was inspired by George S. Clason’s *The Richest Man in Babylon*. The product itself is Wealth Engine.

Money that already exists is a separate Financial Position: manually entered checking, savings, and cash balances. Liquid Position (domain: Money Available) is their sum — the owned liquid position. An account may declare an Unavailable amount that is still owned but not deployable; Available to use is the derived deployable remainder. It is not income, not the Living Budget, and not safe-to-spend. Existing Wealth Building and Existing Emergency Fund are portions of that Liquid Position already set aside. Protected Money is their sum. It is included in Liquid Position, not added to it and not subtracted from it. Paid expenses are actual spending. Unpaid expenses are upcoming obligations. Upcoming Needs is not subtracted from Liquid Position. A monthly bill can repeat as Upcoming for this month and the next. It is not spending until that month is marked paid. Recurrence does not create income. Available After Planned Needs is deployable unprotected money after known unpaid Needs. It is not the Living Budget, and it is not a promise that the remainder is safe to spend.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- Next.js 15 (App Router)
- Tailwind CSS v4
- shadcn-styled Radix UI
- Recharts
- Lucide React
- localStorage persistence

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPMENT_JOURNAL.md](./DEVELOPMENT_JOURNAL.md)
- [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)
- [MASTER_ROADMAP.md](./MASTER_ROADMAP.md)
