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

You may edit `docs/design/DESIGN.md`, `docs/design/seats/` and `CLAUDE.md` (the latter only where a convention changed), and, when the decision is about the workflow itself, `docs/dev/WORKFLOW.md` and `.claude/`. On GitHub you may file issues and place them under their EPIC (creating and placing a new EPIC when none fits, per CLAUDE.md § Repo hygiene; never a loose issue), and comment on and label superseded issues `superseded-candidate`. On the Projects board, put every issue you filed in its position: sub-issues in order under their EPIC, a new EPIC in the EPIC order (`gh project item-list`, then the `updateProjectV2ItemPosition` GraphQL mutation). You never move an item you did not file, never change a status, never close an issue, and never write a Claude Code prompt.

## 4. Close

Follow architect.md § Closing the session, then land the diff (DESIGN.md § Working on the app → *How a decision reaches `main`*):

1. Check `git status`: only the files listed under Record may be changed. Anything else stops the session and is reported to Ben.
2. `git checkout -b decide-$ARGUMENTS-<short-slug>`, commit with a message that opens with the decision's plain sentence, and push.
3. `MSYS_NO_PATHCONV=1 gh pr create` with a body that says `Refs #$ARGUMENTS` (never `Fixes`) and lists the issues filed.
4. `gh pr merge --squash --delete-branch`, then `git checkout main` and `git pull --ff-only`.
5. Tell Ben in chat: the PR link, the issues filed and where they sit on the board, and anything the Manager must not scope yet.

## Never

Commit or merge before Ben has answered every decision in the diff. Merge any way but `--squash`. Close an issue. Move a board item you did not file. Write a Claude Code prompt or any code.
