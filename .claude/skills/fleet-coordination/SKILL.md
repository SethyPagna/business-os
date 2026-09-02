---
name: fleet-coordination
description: >-
  The operating playbook for the shared business-os checkout: coordinating many parallel Claude
  Code sessions (worker / coordinator / final-reconciler roles on one shared git index), layered
  verification of every task — source-shape checks, committed-HEAD certification, exhaustive
  matrices, live API end-to-end, and live-browser screenshot→verify→fix→continue loops —
  consistency audits of code logic, buttons, pages and sibling surfaces, reconciliation of parallel
  lanes, the staged commit→push→deploy cycle (Stage 1 audit vs user-gated Stage 2), and the
  docs/context discipline (progress.md board, session-log Parts, CLAUDE.md, ≤300K compaction).
  Use it whenever the user asks to coordinate or reconcile sessions, prevent collisions, verify /
  validate / test / check anything ("does it actually work", "screenshot and verify", "test it in
  the browser", "check consistency", "make sure every page / button / section…", "continue" after
  a check), certify committed HEAD, run Stage 1 or Stage 2 or a deploy, compact or hand off
  context, or update progress.md / the session log / CLAUDE.md — even when they don't name this
  skill or say "sessions".
---

# Fleet coordination for the shared business-os checkout

Many Claude Code sessions (five, ten, fifty) run against **this one git checkout at the same
time** — most in the main working tree on **one shared git index**, some in their own worktrees on
`rc/*` branches — plus a ChatGPT/Codex surface working the GitHub repo. This skill is the standing
playbook for making that fleet productive without sessions conflicting, breaking `main`, deploying
each other's half-finished work, shipping fixes that only look fixed, or losing changes and context.

## The one principle everything else follows from

**Verify before you trust — from the actual source, from more than one angle.** In a fleet, the
things you'd normally treat as ground truth are not:

- A **peer session's claim** ("3 security holes are live", "I already deployed", "0097 is
  included") is a *reference to re-verify*, never fact. Peers work from stale or compacted context
  and overstate. Re-derive it yourself from git, code, and a run.
- A **compaction / handoff summary** (including your own) is third-party reference. Re-verify its
  claims against the current source before acting on them.
- A **green typecheck/test run on the dirty working tree** is a *false signal* for what will
  deploy. The deploy candidate is **committed HEAD**, and a committed file can depend on a peer's
  *uncommitted* change. Certify HEAD in an isolated worktree.
- A **green build is not a working screen.** The user has watched "verified" fixes arrive broken
  on the page. What renders gets driven in a real browser and the observed value written next to
  the expected one.
- **Your own session identity** can be wrong after a compaction/fork. Confirm it with `ListAgents`
  (a main-session tool; subagents don't have it) before signing board claims or reserving Part
  numbers.

When a claim matters, cross-check it from at least two independent angles (git history + running
code + live probe; source + rendered page; frontend rule + backend rule) before relaying or acting
on it. When a fix is needed, fix the **cause** — a recurring or re-opened issue means the earlier
fix treated a symptom.

## Which session are you?

Identify your role first — it decides what you're allowed to do.

- **Worker.** Owns one disjoint backlog item. Picks work whose file set is fully disjoint from
  every peer's in-flight edits, claims it in `progress.md`, commits each finished slice promptly,
  verifies its own surfaces (and their siblings) before commit, and stays out of other lanes.
  Never deploys.
- **Coordinator.** Watches the whole fleet continuously: maps who's editing what, polices
  commit-per-change, deconflicts shared files and Part numbers, catches a broken HEAD, runs the
  stage-level verification, and is the single point that runs (or gates) a deploy. There should be
  **exactly one** deploy driver at a time — two coordinators both deploying is itself the top
  hazard. If a second appears, surface the overlap to the user as a decision and hold deploys.
- **Final reconciler.** The end-of-run session that reconciles every lane, certifies committed
  HEAD is whole and green through every layer, and drives the staged deploy once the user opens
  the gate.

You may be handed a role or infer it. When unsure whether you're authorized to deploy, you are not.

## The verification ladder

Verification is layered. Each layer is necessary but **not sufficient** — the mandate is to go all
the way down when work is being certified, and to go at least to the browser for anything that
renders. Cheapest first:

1. **Source-shape floor.** Typecheck both packages, run every test file individually (the chained
   `test:utils` stops at the first red and hides the rest), run the real `vite build`. Commands in
   `references/verification.md`. This is the *floor*, not the bar.
2. **Committed-HEAD certification.** Re-run layer 1 against **committed HEAD in an isolated
   worktree** — this is what actually deploys. Recipe in `references/verification.md`.
3. **Exhaustive coverage.** An enumerated matrix of every surface / writer / route with a verdict
   per item — provable, not sampled. Edge cases, malformed input, concurrency, D1 limits,
   **offline and online** paths. **Expected vs actual** for every probe.
4. **Live API end-to-end.** Drive the real system — isolated local worker + a copy of D1, minted
   real sessions, DB state asserted after every call with `better-sqlite3`. Recipe in
   `references/verification.md`.
5. **Live browser.** Open the real page in the Browser pane, read console/network, confirm the DOM,
   click the control, screenshot what only eyes can judge, at desktop and 375px, and record
   observed vs expected. Then fix, re-run, and continue. Recipe in
   `references/browser-verification.md`.

Alongside every layer, the **consistency audit** (`references/consistency-audit.md`): the fix that
landed here also landed on every sibling surface, and the rule the frontend applies is the rule the
backend applies.

**Scale depth to the ask and the moment:**

| When | Minimum depth |
|---|---|
| A slice you just edited (worker, before each commit) | Layer 1 + layer 5 on the changed surfaces **and their siblings** + the mechanical consistency locks |
| A lane you are finishing | Above + layer 3 for the lane's routes/writers + a consistency matrix for the rule/capability touched |
| "verify / validate / test thoroughly", a security review | Layers 1–5, all of them, with the ledger |
| Stage 1 (coordinator / reconciler) | Layers 1–5 on committed HEAD + the page matrix + reconciliation output |
| Post-deploy (Stage 2) | `/health`, the wrangler version id, the regression probes, a **read-only** browser pass on production |

When a scenario fails, **suspect the harness first** and attribute pre-existing reds by re-running
at an older commit in a clean worktree before "fixing" anything — the failure may be a peer's
mid-edit state or a stale test, not a bug.

## Screenshot → verify → fix → continue

The loop that turns "it should work" into "it works, observed". Per surface the change touches (and
per sibling): reload → console/network errors → `read_page` structure and translated labels →
interact and confirm the persisted result (the toast is not the evidence, the row is) → screenshot
→ mobile viewport and, where colors changed, dark mode → ledger row. Red? Find the cause, fix,
re-run that surface from the top, then move to the next item on the board. Never stop at a green
screenshot without the ledger row, and never hand the check back to the user ("see if it looks
right") — that is this loop's job. Which port shows what (5173 = live edits, 8787 = last build),
the traps, and the ledger format are in `references/browser-verification.md`.

## Consistency: logic, buttons, pages

The user's binding rule: **a capability on one surface is on every sibling surface in the same unit
of work** — modals, bulk flows, imports, the storefront, the permission editor — and **one rule has
one implementation** that every layer shares. Enumerate mechanically, matrix surface × capability,
confirm each finding from two angles, fix parity in the same commit. Run the existing locks first
(`verify:i18n`, permission-actions, mutation-success, floating-filters, scroll-roots,
section-navigation, dense-tables, rule-parity tests). The convention checklist with grep leads is
in `references/consistency-audit.md`.

## Conflict prevention on the shared index

Mechanics in `references/coordination.md` (atomic pathspec commits, hunk isolation, Part-number
protocol, the branch/worktree sweep, dev-server etiquette). The non-negotiables: never `git add -A`
or `git add .`; shared files commit atomically with `git commit -m "..." -- <paths>`; **diff every
file immediately before committing it**; never rewrite a pushed commit or delete a peer's in-flight
lines; claim the board item under your confirmed name before writing code; one commit per change in
dependency order, and coordinators nudge lanes that stay dirty.

## Reconciling parallel lanes

Reconcile committed, finished slices — not whatever is dirty. The **later, more-specific** change
wins *after* you verify it is valid and genuinely better; otherwise flag the pair for the user.
Nothing goes missing: list what each superseded change did that the survivor doesn't, and either
absorb it or record the loss as a decision. Two angles per decision; hold anything irreversible on
any doubt. Unmerged `rc/*` / `codex/*` / `claude/*` branches are part of the reconciliation. The
output is HEAD certified in an isolated worktree, a lanes → surviving commits → verdicts matrix,
and a Part entry written as reference to re-verify. Procedure in `references/coordination.md`.

## The staged ship cycle

**fix → commit → push → (staged) deploy → live-verify → summarize**, repeated. Deploy is **not**
per commit. Commit and push continuously; deploy in batches at a stage boundary, because a deploy
pushes the live Worker and can migrate the **remote production D1**.

- **Stage 1 = reconcile + audit, no deploy.** Lanes reconciled, committed HEAD certified green
  through layers 1–5, every red root-caused as stale-test vs real regression. Runs until the user
  explicitly says "go for Stage 2".
- **Stage 2 = deploy, user-gated.** From committed HEAD via an isolated worktree with a real
  `npm ci` (never the dirty tree, never `full-automation`'s `npm ci` in the shared tree). Exactly
  one driver. `deploy:full` ends at `wrangler deploy`: note the version id it prints, then poll
  `/health` yourself and run the read-only probes. Pipeline in `references/deploy.md`.
- **Don't stall it, don't rush it.** Verify quickly and correctly, then ship what genuinely needs
  shipping — never on an unverified premise, never leaving certified work unshipped once the gate
  is open.

Afterwards, record the commit hash, the wrangler version id and the highest applied migration in
the board block and the Part entry as **reference-to-verify**.

## Docs and context: progress.md, session-log, CLAUDE.md, ≤300K

Four homes, one job each — templates and checklists in `references/docs-and-context.md`:

- **progress.md** holds state: claim your lane block before coding (say whether you're in the main
  tree or an `rc/*` worktree), keep it current, and at session end do all three (Part entry
  appended, finished items moved to the DONE archive, Current status updated). Transient ledgers
  live in the scratchpad, not the repo root.
- **`docs/history/session-log.md`** holds the narrative `## Part N` entry: Ask / What changed /
  What was found / Verified (real commands, real results, the ledger) / Not done. Take max+1 from
  **all** Part headers; commit the docs last, atomically.
- **`CLAUDE.md`** is the short pointer every session loads. Update it only when a durable fact
  changes; never put lane status or copies of other sections there.
- **Compaction.** Sessions must not exceed **300K tokens** and compact to the lowest practical
  size at a clean checkpoint. Persist first (commit + push, board block, Part entry, any memory
  the user taught), write the handoff as reference-to-verify, then tell the user it's a good time
  to compact. After any compaction or fork: `ListAgents`, re-read progress.md top, re-grep Parts,
  `git status` / `log` / `worktree list`, and re-verify prior claims before acting.

## Continuous coordination cadence

Coordination is continuous, not per-batch. Quiet is a lull, not an ending — the user spins up new
session batches at any time. Idle at **~30–60 min ticks** while the tree is clean and no lanes are
committing; **~15–25 min** while lanes are active or a stage is in motion. Stop only when the user
says so or the session ends; if you posted a sign-off note, **reopen it** when the watch resumes.
Every sweep includes the branch/worktree check in `references/coordination.md`.

## Role quick-starts

**Worker:** ListAgents → `git status` (map peers) → pick a disjoint item → claim it in progress.md →
build → layer 1 + browser loop on changed surfaces and siblings + consistency locks → diff each
file → atomic pathspec commit → push → ledger row into the board block → next slice.

**Coordinator:** ListAgents → map dirty files and `rc/*` worktrees to lanes → police commits and
Part numbers → deconflict shared files → watch for a broken HEAD → run stage verification (layers
1–5 on HEAD, page matrix) → hold/gate deploys (one driver) → surface stage decisions → tick.

**Final reconciler:** reconcile committed lanes and unmerged branches (precedence + no-loss audit)
→ certify HEAD in an isolated worktree (layers 1–5) → on the user's Stage-2 go, deploy from HEAD via
isolated worktree → live-verify incl. read-only production browser pass → record reference state →
offer the next cycle.

## Reference files

- `references/coordination.md` — shared-index git mechanics, Part-number protocol, hunk isolation,
  the branch/worktree sweep (ChatGPT/Codex, `rc/*`), dev-server/wrangler etiquette, reconciling
  parallel lanes.
- `references/verification.md` — the layer-1 commands, committed-HEAD worktree certification, and
  the live API end-to-end recipe (isolated worker + D1 copy, minted sessions, DB-state assertions).
- `references/browser-verification.md` — the live-browser loop: which `launch.json` target shows
  what, the traps, the per-surface steps, viewports/modes, the expected-vs-actual ledger, the page
  matrix.
- `references/consistency-audit.md` — the sibling-surface/logic-parity method, the mechanical
  locks to run first, the convention checklist with grep leads, how to report a finding.
- `references/docs-and-context.md` — what goes in progress.md vs session-log vs CLAUDE.md vs
  memory, the templates, the compaction/handoff checklist.
- `references/deploy.md` — the isolated-worktree production deploy pipeline, Stage-2 gating, and
  post-deploy live verification.
