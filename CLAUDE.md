# CLAUDE.md — how Claude Code works in this repo

This file points; it does not restate. **`docs/design/DESIGN.md` is the source of truth** for what the app does and why. If this file, an issue, or the code disagrees with it, the design document wins and the other thing is the bug. Never edit anything under `docs/design/` from a Claude Code session — the design document and the seat instructions in `docs/design/seats/` belong to the Architect; raise a question in the issue instead.

## Starting a session

1. **When Ben names an issue** ("issue 145", "let's work on #145"), before anything else run `gh issue view 145 --comments`, then read the DESIGN.md sections the issue cites. If the issue is a sub-issue, also `gh issue view` its parent EPIC for the order it sits in. There is also `/issue 145`, which runs the whole routine.
   - **If a comment from the Manager contains a scoped prompt, that prompt is the plan** — its "read first", "build", "do not build" and "tests" sections are binding. If there is no such comment, write the plan yourself and wait for Ben's approval before coding.
2. Issue state comes from GitHub every session, never from memory or an earlier conversation.
3. One sub-issue per session, one commit. More than about five rounds on one issue means stop, write down what's blocking, and let the Manager re-scope.

## Finishing a session — the Done note

Every issue closes with a comment that answers two gates aloud. Silence is not an answer.

- **Schema:** nothing changed / additive with a default / migration written, tested on a *populated* database, and idempotent on a second run.
- **User guide:** which bullet in `docs/user/README.md` was added or changed, or "no user-facing change".

Work on a branch named `issue-N-<short-slug>`, push it, and open the pull request with `gh pr create --fill` (the template asks for both gates). `Fixes #N` in the PR body so the merge closes the issue. The Manager reviews the PR; Ben merges.

## Conventions that are not negotiable

**Money and data**
- Integer cents everywhere; dollars only at the display layer. Wherever a rate multiplies cents, state the rounding.
- Direction is the sign of a line and nothing else — no type flags, no from/to pairs.
- The invariant (DESIGN.md § Transactions): category lines sum to the budget movement; enforced in the service layer on every write; the integrity check reports drift.
- No stored balances. Every balance is a sum of dated lines up to the picker date. Slow → materialised view, never a balance column.
- Non-ledger rows archive, never delete (DESIGN.md § General concepts). Every non-ledger table uses the shared `NonLedger` mixin (`created_on`, `archived_on`) from the revision that creates it, and its unique-name index is partial on `archived_on IS NULL`. A non-ledger table without the mixin is a bug.
- Defaults (Me, default categories, domains, "Debt payments") are inserted by the one seed step at container start, never by a migration. A new default is a line in that list.
- Settings never rewrite history: a transaction's on-budget cents are computed at write time and stored on the line; changing a floor, boundary category, pool or link affects later writes only.
- Never call `date.today()` / `datetime.now()` to decide what day it is for business logic or form defaults — the app-wide picker date is the only "today". Wall-clock `created_at` / `updated_at` are provenance only.
- Null means unknown, never zero, on every rate or term field.
- Structural validation of a record (missing date, lines that don't add up) is validation. Refusing to record money that exists is a block, and blocks are not allowed on the recording surface.

**Backend**
- Pydantic models are the API shape; SQLAlchemy models are the stored shape. Never persist a Pydantic model; never return an ORM object from a router.
- All data access through the per-request session (`app/db.py`); no raw SQL or file I/O in a router. Commit on normal return, roll back on any exception; validate everything, then persist.
- Create and edit share one write path. Lines a rule generates (splits, pool draws, deposit moves) are regenerated on edit, never hand-edited.
- Every table has `owner_id` (default 1 in single-user mode), `created_at`, `updated_at`. Enums are plain strings. Every FK column is indexed. The DB enforces only what the service already enforces with a matching 4xx.
- Every schema change is an Alembic revision. Migrations run at container start behind an automatic `pg_dump`; the app refuses to start if the database is newer than the code. Test fixtures live under `backend/tests/fixtures/`, never in runtime data.
- No `scripts/` of one-off fixes someone must remember to run on the Pi.

**Frontend**
- Functional components only. Every `fetch` goes through `src/api.js` and its one request helper, which surfaces the backend's error `detail` on every non-OK response.
- Tailwind tokens only, no hex in JSX. One `formatCents` and one date formatter in `src/utils/format.js` (`en-CA`; parse ISO dates at noon UTC).
- Money inputs are never `type="number"` (phone keypads have no minus key). Nothing is hover-only. Every picker that could hold more than five items is searchable; drop-downs are alphabetical unless the values have a real order.
- Works on a narrow phone, a desktop, and a foldable's inner screen.

**Repo hygiene**
- No new Python dependency without `requirements.txt`; no new npm package without a stated reason in the PR.
- This file records conventions, never build state. Build state lives in issues and the Projects board.
- Terminology: "ready to assign", "balance check", "pay screen", "named pay". Never "reconcile", "waterfall", "run", "commit" in user-facing copy.

## Running things

```sh
docker compose up --build              # everything
docker compose exec backend pytest     # backend tests
docker compose exec backend alembic revision --autogenerate -m "..."
docker compose exec frontend npm test  # when tests exist
```

Backend on http://localhost:8000 (`/api/health`, `/docs`), frontend on http://localhost:5173. Vite is configured with file polling because the source lives on a Windows drive bind-mounted into Linux containers.
