# Wealth Engine

Executive personal ledger. Income is split 10% to Wealth Building, 20% to Debt Payoff, and 70% to a Living Budget. The 10/20/70 method was inspired by George S. Clason’s *The Richest Man in Babylon*. The product itself is Wealth Engine.

Money that already exists is a separate Financial Position: manually entered checking, savings, and cash balances. Money Available is their sum. It is not income, not the Living Budget, and not safe-to-spend. Existing Wealth Building and Existing Emergency Fund are portions of that Money Available already set aside. Protected Money is their sum. It is included in Money Available, not added to it and not subtracted from it. Paid expenses are actual spending. Unpaid expenses are upcoming obligations. Upcoming Needs is not subtracted from Money Available. A monthly bill can repeat as Upcoming for this month and the next. It is not spending until that month is marked paid. Recurrence does not create income.

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
