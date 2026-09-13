# Open Source Finance App

A self-hosted envelope-budgeting app for Canadian finance nerds. A financial mirror, not a financial cage: it shows you where your money sits, whether you can afford what's coming, and whether you're making the trade-offs you actually want — and it never blocks you from recording what already happened.

**Status:** rebuild in progress, not usable yet. The design is complete; the code is being built against it.

## What it does (or will)

- Envelope budgeting on a ledger that can show any past date.
- Accounts with an on-budget floor, so overdraft and a slice of credit can be budgeted with.
- Goals as rules on categories — bills, targets, per-payday commitments — paid by a named pay.
- A pay screen that takes a paycheque from gross to net to envelopes in one pass, writing only ordinary transactions and earmarks.
- Categories that draw on a pool when they overspend, following the chain.
- Investment and registered accounts linked to long-term envelopes, with gains and losses flowing into them.
- Roommate and partner splits that keep your real cost in the right envelope.
- Balance checks instead of reconciliation; nothing locks.

Everything above is specified in [`docs/design/DESIGN.md`](docs/design/DESIGN.md). That document is the source of truth; if the code and the document disagree, the document wins and the code is the bug.

## Stack

Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2.0 · PostgreSQL · React 18 · Vite · Tailwind CSS · Docker Compose. Target: a Raspberry Pi 4, single user, behind a Cloudflare tunnel.

## Run it

```sh
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend health: http://localhost:8000/api/health

Migrations run at container start, after an automatic database dump.

## Repository layout

```
docs/design/   the design document, decisions, research — for whoever is building
docs/user/     the user guide — starts as a point-form README kept current per closed issue
backend/       FastAPI app, SQLAlchemy models, Alembic migrations, tests
frontend/      Vite + React + Tailwind
CLAUDE.md      how Claude Code works in this repo
```

## Working on it

Backlog and roadmap live in GitHub Issues and the Projects board — see `DESIGN.md` § Working on the app. Issue titles are one plain sentence of what a user can do afterwards.

## Licence

AGPL-3.0. See [LICENSE](LICENSE).
