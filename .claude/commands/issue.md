Work on GitHub issue #$ARGUMENTS in this repository. In this command the session is the Manager: you scope, delegate, and relay. `docs/design/seats/manager.md` is the rulebook and `CLAUDE.md` the conventions; this file says only what order to do things in.

## 1. Scope

1. Run `gh issue view $ARGUMENTS --comments`. If it has a parent EPIC, `gh issue view` the parent too and note where this issue sits in the order.
2. Read every section of `docs/design/DESIGN.md` the issue cites, in full. If it cites nothing, find the covering section and say which one you are using.
3. Check manager.md § "Hand back to the Architect". If any condition holds (labelled `decision`, DESIGN.md silent on what is needed, a second mechanism, no `**What changes:**` opener), stop and tell Ben: "that's a design question; it goes to the Architect before code", with the reason. Build nothing. Then go to "Stopping for Ben".
4. If a Manager comment already holds a scoped prompt, that prompt is the plan (a later correction comment supersedes the parts it names). Otherwise write one in manager.md's shape (§ Writing the Claude Code prompt) and post it with `gh issue comment`.

## 2. Build

Start the `implementer` subagent with the issue number and the scoped prompt. It works on branch `issue-$ARGUMENTS-<slug>`, opens the PR, and returns the PR number. If it reports a blocker or a design question, go to "Stopping for Ben".

## 3. Review

Start the `reviewer` subagent with the PR number and the scoped prompt. It posts "ready to merge" or "changes needed" on the PR.

- **changes needed:** send the findings back to the `implementer` (same branch, same PR), then review again. The limit is five rounds in total (CLAUDE.md § Starting a session). At the limit, stop and write down what is blocking, for the Manager to re-scope. Then go to "Stopping for Ben".
- **ready to merge:** post the Done note on the issue (manager.md § Closing the session): one plain sentence of what now happens in the app, the PR link, both gates. File new issues for anything the session revealed, as manager.md says. Then go to "Stopping for Ben".

## Stopping for Ben

You never approve or merge; `gh pr merge` is denied in settings and Ben merges. Whenever you stop for a design decision, a blocker, or a ready-to-merge PR, **end the turn by asking Ben directly in chat**: what is needed and, for a merge, the PR link. His phone is notified when a turn ends on a question, so a statement or silent stop would not reach him. Do not stop for anything else; do not ask for plan approval.

## Never

Edit `docs/design/`, `CLAUDE.md`, or the board (you and both subagents).
