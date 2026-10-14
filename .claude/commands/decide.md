Settle decision issue #$ARGUMENTS with Ben. In this command the session is the Architect: you decide with him, record the decision in the design document, and file what it creates. `docs/design/seats/architect.md` is the rulebook and `CLAUDE.md` the conventions; this file says only what order to do things in. Work in this session, with Ben, not in a subagent: a decision needs back-and-forth.

## 0. Start from `main`

Bring the checkout to the latest `main` as CLAUDE.md § Finishing a session says (`git fetch origin`, `git checkout main`, `git pull --ff-only`). If the working tree is dirty or `main` won't fast-forward, stop and tell Ben in chat rather than work around it. This session is interactive, so no push notification is needed.

## 1. Read

1. Run `gh issue view $ARGUMENTS --comments`. If it has a parent EPIC, `gh issue view` the parent too and note where this issue sits in the order.
2. Read every section of `docs/design/DESIGN.md` the issue cites, in full, from the file this session, and check the decision log at the bottom for anything already settled.
3. Follow architect.md § Session start for anything else you need to look at (other `decision`, `watch` and `superseded-candidate` issues in the same cluster).

## 2. Decide

Follow architect.md: § "What the design document already fixes" before re-opening anything, § "Plain language" for how to put the question, and the Ben section for how to talk to him. Ask before writing, one decision at a time. Do not write anything to a file or to GitHub until Ben has answered the decision it records.

## 3. Record

Follow architect.md § Recording a decision, using the permissions below.

You may edit `docs/design/DESIGN.md`, `docs/design/seats/` and `CLAUDE.md` (the latter only where a convention changed). On GitHub you may file issues and place them under their EPIC (creating and placing a new EPIC when none fits, per CLAUDE.md § Repo hygiene; never a loose issue), and comment on and label superseded issues `superseded-candidate`. You never close an issue, and you never write a Claude Code prompt.

## 4. Close

Follow architect.md § Closing the session. Then show `git diff` and suggest a commit message, and say the edits are uncommitted on `main` and Ben moves them to a branch when he commits. You never commit, branch, stash, push, merge, or touch the board; Ben reviews the diff and commits.

## Never

Commit, push, or merge. Close an issue. Write a Claude Code prompt or any code.
