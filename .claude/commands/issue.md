Work on GitHub issue #$ARGUMENTS in this repository. In this command the session is the Manager: you scope, delegate, and relay. `docs/design/seats/manager.md` is the rulebook and `CLAUDE.md` the conventions; this file says only what order to do things in.

## 1. Scope

1. Run `gh issue view $ARGUMENTS --comments`. If it has a parent EPIC, `gh issue view` the parent too and note where this issue sits in the order.
2. Read every section of `docs/design/DESIGN.md` the issue cites, in full. If it cites nothing, find the covering section and say which one you are using.
3. Check manager.md § "Hand back to the Architect". If any condition holds (labelled `decision`, DESIGN.md silent on what is needed, a second mechanism, no `**What changes:**` opener), stop and tell Ben: "that's a design question; run `/decide N` to settle it before code" (N is the decision issue; if there isn't one yet, file it first, as a `decision` issue saying what is undecided, under its EPIC per CLAUDE.md § Repo hygiene, and give its number), with the reason. Build nothing. Then go to "Stopping for Ben".
4. If a Manager comment already holds a scoped prompt, that prompt is the plan (a later correction comment supersedes the parts it names). Otherwise write one in manager.md's shape (§ Writing the Claude Code prompt) and post it with `gh issue comment`.

## 2. Build

Before starting it, bring the checkout to the latest `main` as CLAUDE.md § Finishing a session says (`git fetch origin`, `git checkout main`, `git pull --ff-only`); if the tree is dirty or `main` won't fast-forward, go to "Stopping for Ben". Then start the `implementer` subagent with the issue number and the scoped prompt. It works on branch `issue-$ARGUMENTS-<slug>`, opens the PR, and returns the PR number. If it reports a blocker or a design question, go to "Stopping for Ben".

## 3. Review

Start the `reviewer` subagent with the PR number and the scoped prompt. It posts "ready to merge" or "changes needed" on the PR.

- **changes needed:** send the findings back to the `implementer` (same branch, same PR), then review again. The limit is five rounds in total (CLAUDE.md § Starting a session). At the limit, stop and write down what is blocking, for the Manager to re-scope. Then go to "Stopping for Ben".
- **ready to merge:** go to "Merge".

## 4. Merge

The steps are DESIGN.md § Working on the app → *How an issue reaches `main`*; this is the order.

1. **Migration?** If the PR adds an Alembic revision, stop for Ben first (see "Stopping for Ben"): ask him to restore the dev database from a fresh backup downloaded from the live app. On his word, run the branch's migration on that data through the normal start-up (behind its pre-migrate backup), check Data check is empty, then continue. Anything red stops unmerged.
2. **Local test gate, run by you, never taken on a subagent's word:** no uncommitted changes; the branch contains the latest `origin/main` (`git fetch origin`; if not, merge `origin/main` in, push, and run the gate again); if `frontend/package.json` changed, rebuild the frontend with fresh volumes; backend tests (`docker compose exec backend pytest`) and frontend tests (`docker compose exec frontend npm test`) both pass.
3. **Red gate:** send it back to the `implementer` (same branch, same PR) and review again; it counts as a round against the limit of five.
4. **Green gate:** `gh pr merge N --squash --delete-branch`. Then post the Done note on the issue (manager.md § Closing the session): one plain sentence of what now happens in the app, the PR link, both gates. File new issues for anything the session revealed, as manager.md says, each under an EPIC, never loose.
5. Send Ben the one-line push (below) carrying the Done note's sentence, naming the migration if the merge included one; after a migration, also tell him in chat what it did to the data. Merging is not deploying: the Pi changes only when Ben updates it.

## Stopping for Ben

Stop only for: a design question, a blocker, a gate that will not go green, five rounds without ready to merge, or the migration restore. Never approve a PR; merge only as in "Merge", with `--squash`. At each stop **first call the `PushNotification` tool** (load it with ToolSearch `select:PushNotification` if it is deferred; `status: "proactive"`), then **end the turn by asking Ben directly in chat** what is needed. The push message is one line under 200 characters that leads with what he must do or what happened, e.g. `Issue 33 needs a design decision: <what>`, `Issue 33 blocked: <why>`, `PR #261 has a migration: restore dev from a fresh live backup`, or, after a merge, `Merged #261: <Done note sentence> (includes a migration)`. The question in chat is still required; the push only gets his attention. If the tool reports "not sent", carry on, since he is at the terminal. Do not notify for routine progress, and do not ask for plan approval.

## Never

Edit `docs/design/`, `CLAUDE.md`, or the board (you and both subagents).
