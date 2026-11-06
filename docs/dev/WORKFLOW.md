# Which command, skill or agent, and when

A guide for Ben. It says what to reach for at each step of building this app. It does not restate the rules: those live in `CLAUDE.md`, `docs/design/DESIGN.md` § Working on the app (the source of truth for this workflow), and the seat files in `docs/design/seats/`. If this page disagrees with them, they win and this page is the bug.

Three kinds of thing are named below:

- **Commands** are this repo's own, in `.claude/commands/`: `/issue` and `/decide`.
- **Agents** are this repo's own, in `.claude/agents/`: `architect`, `implementer`, `reviewer`. You rarely start them yourself; `/issue` does.
- **Skills** come from the `mattpocock-skills` plugin (enabled in `.claude/settings.json`) or are built into Claude Code. If a plugin skill's short name does not complete, type it with the prefix, e.g. `/mattpocock-skills:tdd`. In a session, `/ask-matt` will route you if you are unsure.

## Cheat sheet

| Situation | Reach for |
|---|---|
| "I have an idea but it's vague" | `/grill-me` |
| Same, and it touches the design document | `/grill-with-docs` (ask-and-write-nothing outside `/decide`) |
| Claude said something and it didn't land | `/wait-what` |
| I want to understand a concept or how some code works | `/teach` |
| I don't know which skill fits | `/ask-matt` |
| "Should it still be like this?" or review an EPIC | `architect` agent |
| An issue is labelled `decision` | `/decide N` |
| Build an issue | `/issue N` |
| Red/green tests while building | `/tdd` (the implementer uses it; you don't start it) |
| Something is broken and the cause isn't obvious | `/diagnosing-bugs` |
| Look over a diff or PR by hand | `/code-review` (built-in), `/simplify`, `/security-review` |
| See a change working in the real app | `/run` |
| Is the code getting tangled? | `/improve-codebase-architecture` (report only) |
| A session went badly | `/retro` |
| A session is running long | `/handoff` |
| Same prompt on a timer | `/loop` or `/schedule` |
| Answer a throwaway design question with code | `prototype` |

## 1. Idea or question

**Run:** `/grill-me` when you have a half-formed idea; it interviews you until the plan is sharp. `/grill-with-docs` is the same but reads the design document as it goes. `/wait-what` after any reply you did not follow. `/teach` to learn something without changing anything. Use the `architect` agent for "review this EPIC" or "does this section still hold?": it is read-only and hands back questions with a recommendation for each.

**Wrong tool when:** you already know what you want built (go to step 4), or the answer is a decision that must be recorded (step 2). `/grill-with-docs` and `domain-modeling` must not create `GLOSSARY.md` or an ADR file here; DESIGN.md says they point at it and write only inside `/decide`.

**Example:** #404 asks which common money tasks get a guided flow. That is still open, and the right first move is a `/grill-me` pass on it before `/decide 404`.

## 2. Decide

**Run:** `/decide N`, where N is an issue labelled `decision`. In that session Claude acts as the Architect, works with you in the main chat (not a subagent), and edits `docs/design/` plus one dated line in the decision log. You review every change in the session; it then commits, opens the PR, squash-merges it, and puts the issues it filed on the Projects board in their place. It never closes an issue.

**Wrong tool when:** the design is already clear. Then go straight to `/issue`. If `/issue` finds DESIGN.md silent on something, it stops and tells you to run `/decide`.

**Example:** #449 was decided this way (a reviewed PR merges itself after a local test gate), and the session also settled #450. The result is the 2026-11-03 line in the decision log.

## 3. Plan big work

**Run:** nothing from the plugin. Big work is an EPIC with sub-issues in build order, each with a scoped prompt from the Manager (`docs/design/seats/manager.md`). Open questions become `decision` issues under the EPIC.

**Wrong tool when:** you are tempted by `/wayfinder`, `/to-spec` or `/to-tickets`. They produce a second kind of plan and a second kind of ticket; DESIGN.md lists them as unused.

**Example:** #448 is the EPIC for how issues get built and merged. Its children are #449 (decision), #450 (install skills), #451 (this page) and #452 (auto-merge). Each is a sub-issue, built one at a time.

## 4. Build

**Run:** `/issue N`. It reads the issue and its EPIC, scopes a prompt if the Manager comment is missing, starts the `implementer` (tests first, red then green, using `/tdd`), starts the `reviewer`, runs the local test gate itself, then squash-merges and posts the Done note. You get a push only when it needs you: a design question, a blocker, tests that will not pass, five rounds, or a migration.

**Wrong tool when:** the issue is a `decision` (use `/decide`), or you want an experiment that will be thrown away (use `prototype`).

**Example:** #452 went through `/issue 452` and landed as a squash commit on `main`. #454 (PR titles starting with a slash command arrive intact) is a small one of the same kind.

## 5. Bugs

**Run:** `/diagnosing-bugs` when the cause is not obvious: it builds a loop that reproduces the bug, then narrows it. File the bug as an issue under an EPIC first (CLAUDE.md: no loose bugs), then `/issue N` fixes it, test first.

**Wrong tool when:** the fix is obvious. Just file it and run `/issue`. Claude Code may also offer a built-in `/debug`; it is not in this repo's workflow, so check it exists in your version before relying on it.

**Example:** #440 (Categories took seconds to load because each category's numbers were fetched one at a time) is the kind of bug where finding the cause comes before any fix. #434 (backfilled shared bills vanishing from a balance) is a data bug, where the first step is reproducing it.

## 6. Check work by hand

**Run:** the `reviewer` already checks every PR from `/issue`; these are for your own extra look. Built-in `/code-review` (add a level, e.g. `/code-review high`, and a PR number), `/simplify` for cleanup of a diff, `/security-review` before anything exposed to the network, `/run` to start the app and see a change working.

**Wrong tool when:** you want a verdict that gates merging. Only the `reviewer` agent's "ready to merge" does that. Matt's `code-review` skill is a second review and is unused in `/issue`; DESIGN.md allows running it by hand.

**Example:** after #452 you could run `/code-review` on its PR to see what a second pair of eyes finds, then compare it with the reviewer's comment.

## 7. Look after the codebase

**Run:** `/improve-codebase-architecture` every few days; it only reports, and you choose whether anything becomes an issue (under an EPIC). `/retro` after a session that went badly, to find what to change in the workflow. `/handoff` when a session runs long, to carry the state to a fresh one.

**Wrong tool when:** you want it to refactor straight away. Refactors go through an issue and `/issue` like any other change; #394 (splitting Transactions, Accounts and the pay screen into smaller pieces) is the shape.

**Example:** none yet from a scan. #394 is the closest: a cleanup issue with nothing changing on screen.

## 8. Recurring jobs

**Run:** `/loop 5m <prompt>` repeats a prompt in the open session; `/schedule` sets up a cloud routine. Neither is used in the workflow today.

**Wrong tool when:** the job needs your machine or the app's database. Sessions run on your machine (see the seat table), and cloud routines do not.

**Example:** none in this repo yet. If one appears, file it under #448 so it is a decision rather than a habit.

## Overlapping skills: which one this repo uses

From DESIGN.md § Working on the app → *Outside skills add no second mechanism*; not re-decided here.

Used where they do a step the workflow already has: `/tdd`, `/grill-me`, `/diagnosing-bugs`, `/improve-codebase-architecture` (report only), `/retro`, `/wait-what`, `/handoff`, `/teach`, `prototype`, and `/research` (posts its finding on the issue).

Unused, because each is a second way to do something done here one way:

- Matt's `code-review` in `/issue`: the `reviewer` is the review (running it by hand is fine).
- `/implement`, `/implement-spec`: `/issue` builds, one sub-issue per PR.
- `/to-spec`, `/to-tickets`, `/wayfinder`: scoped prompts, sub-issues under an EPIC, and `decision` issues do this.
- `pr`: the PR template is the only PR shape.
- `/triage`: labels here are kinds, not states.

## Practice

Open issues are few, so some of these are exercises rather than tickets. Check `gh issue list` first.

- **#404** (decision): try `/grill-me` on it, then `/decide 404`. A first use of both.
- **#7** (EPIC, "to be challenged"): ask the `architect` agent to review it; you have not used that agent on its own.
- **`/teach`**: ask it to explain how the invariant in DESIGN.md § Transactions is enforced in the service layer. No issue needed.
- **`/diagnosing-bugs`**: next time something looks wrong in the app, file it under an EPIC and try it before `/issue`.
- **`/improve-codebase-architecture`**: run it once on `frontend/src`; it only reports.
- **`/retro`**: after the next long `/issue` session.

## Not installed or not checked

- Every plugin skill named above was present in `mattpocock-skills` 1.3.1 when this page was written.
- The built-in `/debug` was not verified in this version (see step 5).
- A `CLAUDE.md` pointer to this page is wanted by #451 but is Ben's to add, since no seat edits `CLAUDE.md`.
