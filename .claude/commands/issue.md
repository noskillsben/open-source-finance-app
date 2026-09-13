Work on GitHub issue #$ARGUMENTS in this repository, following CLAUDE.md.

1. Run `gh issue view $ARGUMENTS --comments`. If it has a parent EPIC (the body or the sub-issue panel names one), run `gh issue view` on the parent too and note where this issue sits in the order.
2. Read every section of `docs/design/DESIGN.md` the issue cites, in full. If the issue cites nothing, find the section that covers it and say which one you are using.
3. Write a short plan: the files you will touch, the schema outcome (nothing / additive / migration), and the bullet you expect to add or change in `docs/user/README.md`. Stop and wait for approval before writing code.
4. Implement on a branch named `issue-$ARGUMENTS-<short-slug>`. Keep to the issue; if you find something else wrong, note it for a new issue rather than fixing it here.
5. Run the backend tests (`docker compose exec backend pytest`, or `pytest` from `backend/` if a local venv exists). Do not report done with failing tests.
6. Update `docs/user/README.md` if the user can do something new or different.
7. Finish with the Done note in the form CLAUDE.md requires (schema gate, user-guide gate), the commit message including `Fixes #$ARGUMENTS`, and nothing else.
