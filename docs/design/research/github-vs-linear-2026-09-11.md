# GitHub Issues + Claude MCP vs. Linear + Claude MCP for a Solo Dev's Roadmap: Comparison & Recommendation

## TL;DR
- **Stay in GitHub Issues + GitHub Projects v2 as your single source of truth, and drive it from Claude Code (via the `gh` CLI and the official GitHub MCP server), not primarily from claude.ai chat.** For a solo hobbyist restarting an existing GitHub repo, this is zero migration, zero cost, no sync drift, and the tightest code-to-issue linkage. Linear is a genuinely better *planning* UI, but for one person already living in GitHub it adds a second system to maintain for benefits you mostly don't need yet.
- **The biggest single gotcha:** the official GitHub *connector in claude.ai chat* is effectively read-only today (writes commonly fail with `403 Resource not accessible by integration`), so "have Claude triage/create issues" reliably means **Claude Code**, where both the GitHub MCP server and the `gh` CLI can write. Linear's MCP, by contrast, does full create/update across all three Claude surfaces.
- **If you adopt Linear, use it in one-way "planning-only" mode or fully replace GitHub Issues — do not run both as writable trackers.** Dual-tracking with Linear's two-way GitHub sync is the main way solo devs create sync drift and busywork. Linear's Free tier (250 active issues, 2 teams) is enough for a hobby app, and the GitHub integration (PR/branch/commit linking, magic words) is free on all plans.

## Key Findings

1. **Roadmapping features are close enough that this isn't the deciding factor.** GitHub now has sub-issues, issue types, milestones, a Projects v2 Roadmap (timeline) view with iterations and custom fields, and issue relationships — all free on a personal repo. Linear has a cleaner, faster, more opinionated planning model (Cycles, Projects, Initiatives, Roadmaps) but caps the Free tier at 250 active issues and 2 teams.
2. **What Claude can *do* differs sharply by surface.** Linear's official remote MCP (`mcp.linear.app/mcp`) is a first-party connector that works across claude.ai chat, Cowork, and Claude Code and supports read+write (issues, projects, comments, initiatives, milestones, labels). GitHub's write path is reliable in Claude Code (MCP or `gh` CLI) but unreliable-to-read-only in claude.ai chat.
3. **Code linkage:** GitHub Issues is natively linked to your PRs/commits/branches (`Fixes #123`, auto-close, timeline references) with zero setup. Linear replicates this via its GitHub integration (branch names, PR titles, magic words, auto status transitions) but it is a bridge between two systems, not the same system.
4. **Cost:** GitHub Issues/Projects is $0 for what Ben needs. Linear is $0 on Free (sufficient) or $10/user/mo (Basic, billed annually) — for a solo dev the paid tier unlocks little that matters.
5. **Migration & lock-in:** Staying on GitHub = no migration. Linear import of open GitHub issues is possible but lossy (loses created/modified dates; recommended for open issues only). GitHub Issues are more portable/ownable via the REST/GraphQL API; Linear exports to CSV and has an API but is a hosted SaaS with no self-hosting.
6. **Context/token efficiency:** Both MCPs can blow the context budget on large issue lists. The GitHub MCP loads ~28,000 tokens of tool schemas per session; Linear MCP `list_issues` returns completed issues too, bloating context. Claude Code warns/caps oversized tool results. Scoped queries and the `gh` CLI are the mitigations.

## Details

### Option A — GitHub Issues + GitHub Projects v2 + Claude

**Native roadmapping (all free on a personal/public repo):**
- **Sub-issues** and **issue types** (Feature/Bug/etc.) reached general availability on April 9, 2025 (GitHub Changelog: "we're thrilled to announce the general availability of sub-issues, issue types, advanced search, and increased item limits in GitHub Projects"), giving a parent→child hierarchy and a shared classification vocabulary.
- **Milestones** group issues/PRs toward a release and show % complete (but are repo-scoped and lack start dates/velocity/burndown).
- **Projects v2** offers Table, Board, and **Roadmap (timeline)** views — roadmaps reached GA on March 23, 2023 (GitHub Changelog: "Today we are announcing the general availability (GA) of roadmaps in GitHub Projects!") — with custom fields, iterations, and markers for milestones/iterations/dates. The Projects item limit was raised from 1,200 to 50,000 in the April 9, 2025 GA release.
- **Issue relationships** ("Relates to," "Blocked by") and advanced search with AND/OR/parentheses.
- Known gap: milestones are per-repo (no cross-repo milestone); the Roadmap view doesn't unfold sub-issues well. Not relevant for Ben's single-repo app.

**What Claude can drive, by surface:**
- **Claude Code:** Strongest. Two paths — (1) the official `github/github-mcp-server` (remote endpoint `api.githubcopilot.com/mcp/` or local Docker `ghcr.io/github/github-mcp-server`), and (2) the `gh` CLI called directly in the terminal. Both support full issue writes. The MCP exposes `issue_read`, `issue_write` (create/update, with title/body/type/labels/assignees/milestone), `add_issue_comment`, `list_issues`, `search_issues`, `sub_issue_write` (add/remove/reprioritize sub-issues), `list_issue_types`, and a `projects` toolset (`projects_list/get/write`) that can list/retrieve projects and **update item fields**, e.g., move an issue from "To do" to "In progress," and add/remove issues from a project.
- **The remote GitHub MCP endpoint does NOT require a Copilot subscription** for core repo/issue/PR tools — per GitHub Docs it is "available to all GitHub users regardless of plan type" (PAT or OAuth); only Copilot-specific tools (e.g., the Copilot coding agent) need a paid Copilot seat.
- **Projects v2 quirks in the MCP:** The `projects` toolset is **not enabled by default** (you must add `projects` to the toolset config). Historically the MCP could not move items across board columns; the Oct 14, 2025 update added field updates including status ("Updating fields for items in a project, such as moving an issue from `To do` to `In progress`"), closing much of that gap. **Iteration fields** were still a weak spot (community feature requests open). So Claude can update Status and fields but sprint-iteration manipulation may need `gh`/GraphQL.
- **claude.ai chat + Cowork:** The **built-in GitHub integration is read/context-only** — Anthropic's help center says it syncs "only files (names and contents) in a repo on a specific branch… We do not retrieve commit history, PRs, or other metadata." A separate directory/MCP GitHub connector exposes write tools, but multiple user bug reports (e.g., anthropics/claude-ai-mcp #822: "all reads succeed, all writes fail with '403 Resource not accessible by integration'… the connector is effectively read-only," corroborated by anthropics/claude-code #80874) say writes fail, making chat-surface issue management unreliable. Cowork's GitHub connector is good for read/triage/summarize; treat writes as unreliable there.

**Rate limits / reliability / token cost:**
- Primary REST limit 5,000 req/hr (rarely binds; a PR-review chat is ~10–30 calls). The **secondary limits bite**: Search API ~30/min, and per GitHub Docs "no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour are allowed. This includes creating issues, posting comments, and modifying pull requests." Bulk "create 100 issues" runs trip these; the MCP surfaces a 403/429 as a tool error rather than auto-retrying.
- ~28,000 tokens of tool schemas per session with all toolsets loaded (~22% of a 128k window); trim via `--toolsets=context,repos,issues,pull_requests` to roughly halve it.
- Where `gh` CLI still wins over MCP: bulk content creation, and any REST field the MCP doesn't expose (e.g., setting issue type on create via `gh api … -f type=Bug`).

### Option B — Linear (Free / Basic) + Linear MCP + GitHub integration

**Pricing (as of Sept 2026, from Linear's own pricing page and corroborating trackers):**
- **Free:** $0 — unlimited members, **2 teams, 250 active issues** (non-archived; Done/Canceled/sub-issues count; hard stop on issue 251), 10 MB file uploads. Core features included: issues, projects, cycles, initiatives, roadmaps, List/Board views, GitHub integration, API/MCP, and the Agent platform.
- **Basic:** **$10/user/mo billed annually** (several 2026 trackers cite ~$12 month-to-month). Unlocks unlimited issues, 5 teams, unlimited file storage. CAD pricing is not separately published on Linear's page (USD-priced; card converts).
- **Business:** $16/user/mo — adds private teams, guests, Linear Insights, **Code Intelligence / agentic coding sessions**, Triage Intelligence.
- For a solo dev, Basic's marginal value is small: the only realistic reason to pay is exceeding 250 active issues or wanting >10 MB attachments.

**What Claude can do via Linear MCP (official, `mcp.linear.app/mcp`, Streamable HTTP; the old `/sse` endpoint is being fully removed — per Linear's Feb 5, 2026 changelog, "As all modern clients now support the more reliable HTTP streams, Linear MCP is fully removing SSE support"):**
- Documented scope: find/filter/create/update **issues** (status, assignment, labels), find/create/update **projects**, read/post **comments**, and — added Feb 5, 2026 — **initiatives, initiative updates, project milestones, project updates, and project labels** (Linear Changelog "Linear MCP for product management": "Create and edit initiatives; Create and edit initiative updates; Create and edit project milestones; Create and edit project updates; Manage project labels; Support for loading images").
- **Works across all three Claude surfaces** — it's a first-party connector in claude.ai (web/desktop, incl. Cowork) and adds to Claude Code with one command. Same OAuth login; no separate purchase (inherits your workspace permissions).
- Limits: **no bulk/batch create** (must loop `create_issue`, slow & token-heavy; `issueBatchCreate` requested but not in MCP), no event triggers (pull-based; stale between fetches), `list_issues` returns completed issues too (context bloat). Community devs sometimes swap to a tiny Linear CLI (`linctl`) in CLAUDE.md to cut token overhead vs. the MCP.

**GitHub integration (free on all plans):**
- Link PRs/commits to issues via branch name, PR title, or magic words (`fixes`, `closes`, etc.) in commit/PR; auto-moves issue status (In Progress on push, Done on merge to default branch). Configurable per team.
- **GitHub Issues Sync** supports one-way or two-way syncing of issues (title, description, status, labels, assignee, comments) — designed for OSS maintainers who want community issues in Linear. Historical import of open GitHub issues is supported (loses created/modified dates).
- Agentic coding sessions / Code Intelligence (delegate an issue to Claude Code/Codex to draft a PR from inside Linear) are **Business/Enterprise-only** and draw AI credits.

### Cross-cutting comparison

| Dimension | GitHub Issues + Projects v2 | Linear (Free/Basic) |
|---|---|---|
| Roadmap/planning | Sub-issues, issue types, milestones, Projects Roadmap view, iterations, relationships | Cycles, Projects, Initiatives, Roadmaps — cleaner/faster, but 250-issue Free cap |
| Claude in Claude Code | Full read+write (MCP + `gh` CLI) | Full read+write (MCP) |
| Claude in claude.ai chat/Cowork | Read/triage reliable; **writes unreliable (403)** | Full read+write (first-party connector) |
| Code linkage (PR/commit/branch) | Native, zero setup, same system | Bridge via magic words/PR titles; works well but two systems |
| Cost for a solo dev | $0 | $0 (Free) / $10-mo (Basic) — little solo upside |
| Migration effort | None (already there) | Import open issues (lossy); or start fresh |
| Dual-tracking / sync-drift risk | None (single system) | High if two-way sync + both used as writable |
| Token/context on large lists | ~28k schema; scope + `gh` to mitigate | `list_issues` bloats w/ done issues; no batch create |
| Lock-in / ownership | High portability via API; no self-host but data lives with your code | Hosted SaaS; CSV + API export; no self-hosting |

### Community signal (2025–2026)
- Solo devs and small teams repeatedly report Linear is a delight for planning but is often "maintained out of habit" when Claude Code is the primary loop, because the agent doesn't naturally create Linear issues and context has to be copy-pasted per session. Teams that *outgrew* GitHub Issues (500+ tickets, multi-repo, sprint velocity needs) moved to Linear and were happy — but noted the migration broke `Fixes #142` PR-linkage and that Linear's PR linking "isn't as seamless as GitHub's native reference system."
- Common hybrid patterns: (a) keep everything in GitHub with a Projects v2 roadmap; (b) Linear for planning with one-way GitHub Issues sync for OSS visibility; (c) Conductor-style tools injecting Linear/GitHub issues as Claude Code context. Home-grown Linear↔GitHub sync checkers exist precisely because two-way mirroring drifts.

## Recommendation

**For Ben specifically — solo hobbyist, restarting an existing GitHub repo (`noskillsben/bens_finance_app`), already using GitHub Issues with ADR/EPIC/label conventions and the GitHub MCP, working across claude.ai chat, Cowork, and Claude Code, on a hobbyist budget, and preferring self-hosted/open tooling — stay on GitHub Issues + Projects v2. Don't adopt Linear now.** The reasons that dominate: zero migration, zero cost, no sync-drift risk, native code linkage, and your existing conventions carry over untouched. Linear's advantages (speed, Cycles, cleaner roadmap UI) are real but are team-scale niceties that don't outweigh running a second system for one person. Linear also can't be self-hosted, which cuts against Ben's stated preference.

### Concrete suggested workflow
1. **Set up a Projects v2 board on the repo** with a **Roadmap view**. Use **issue types** for EPIC/Feature/Bug/Chore, **sub-issues** to break EPICs into tasks, and **milestones** for releases (e.g., "v0.1 salvage/restart"). Keep ADRs as issues/markdown with a dedicated `adr` label and/or `docs/adr/` files in-repo.
2. **Do the agentic issue work in Claude Code, not claude.ai chat.** In Claude Code, enable the GitHub MCP with a fine-grained PAT (`issues:write`, `contents:read`, `pull_requests:write`, `metadata:read`) and add the `projects` toolset. Trim toolsets (`context,repos,issues,pull_requests` + `projects`) to control token cost. Let Claude use `gh`/`gh api` for anything the MCP can't do (setting issue type on create; iteration fields; bulk creation to dodge secondary limits).
3. **Use claude.ai chat + Cowork for read-mostly roadmap thinking:** summarizing the backlog, drafting epic breakdowns, prioritization. Assume writes there may 403; when you want changes applied, hand the plan to Claude Code to execute.
4. **Link code natively:** reference issues in branch names and use `Fixes #NN` in PRs/commits so issues auto-close and the timeline stays connected — no extra tooling.
5. **Add a `CLAUDE.md`** documenting your conventions (label taxonomy, issue-type meanings, EPIC/sub-issue structure, ADR process) so all three surfaces behave consistently.

### When to revisit (thresholds that would change this)
- **Try Linear (Free) if:** you consistently feel GitHub's planning UI is slowing you down, you want Cycles/velocity, or you're doing enough roadmap-shaped planning that the timeline UX matters — and you stay **under 250 active issues**. If you do, run Linear **planning-only** (don't turn on writable two-way sync while also editing in GitHub) or commit fully to Linear and treat GitHub Issues as archived.
- **Pay for Linear Basic ($10/mo) only if:** you cross 250 active issues or need >10 MB attachments.
- **Consider Linear Business** *only* if you ever want Linear's in-app agentic coding sessions / Code Intelligence — overkill for a hobby project.
- **Reconsider the whole question if** you add collaborators, split into multiple repos, or the claude.ai GitHub connector's write path becomes reliably supported (which would make chat-surface issue management viable and tilt things back toward GitHub even more strongly).

## Caveats
- **Fast-moving surfaces.** Claude connectors, Cowork, the GitHub MCP, and the Linear MCP are all changing monthly. The claude.ai GitHub-connector write `403` is a *reported* behavior from user bug reports, not an official Anthropic statement, and could be fixed at any time — verify by testing a single write before relying on it.
- **Linear pricing** ($0 Free / $10 Basic / $16 Business, annual billing for paid) is confirmed on Linear's pricing page as of Sept 2026; exact CAD figures aren't separately published (USD-based). The 250-issue Free cap counts non-archived issues including Done/Canceled.
- **GitHub MCP Projects support** is newer and less battle-tested than its issues/PR tools; iteration-field manipulation in particular may still require `gh`/GraphQL. The `projects` toolset is off by default.
- **Token/reliability numbers** (~28k schema tokens; secondary limits ~30/min search, 80/min & 500/hr writes) come from GitHub docs and a well-sourced 2026 field-notes writeup; your actual usage will vary with toolset config and session shape.
- I did not independently verify the exact claude-code issue numbers originally cited for the connector bug; the corroborating evidence is strongest in anthropics/claude-ai-mcp #822 and anthropics/claude-code #80874.