---
name: fleet-coordination
description: >-
  Operating playbook for running and coordinating many parallel Claude Code sessions on the
  shared business-os checkout — session roles (worker / coordinator / final reconciler),
  conflict-prevention on the one shared git index, the verify-before-trust confirmation
  layers, the staged commit→push→deploy cycle (deploys are batched by stage, never per
  commit), Stage-1 reconcile-and-audit vs Stage-2 live deploy gating, exhaustive + live
  testing, and the ≤300K auto-compaction rule. Use this whenever the user asks to coordinate
  sessions, reconcile parallel work, prevent collisions or conflicts, run the commit/push/
  deploy cycle, gate or run a staged deploy, do "Stage 1" or "Stage 2", confirm or re-verify
  another session's or a compaction's claims, certify committed HEAD, or manage session
  context/compaction — even if they don't name this skill.
---

# Fleet coordination for the shared business-os checkout

Many Claude Code sessions (five, ten, fifty) run against **this one git checkout at the same
time**, plus a ChatGPT/Codex surface working the GitHub repo. They share one working tree and
**one git index**. This skill is the standing playbook for making that fleet productive without
sessions conflicting, breaking `main`, deploying each other's half-finished work, or losing
changes.

## The one principle everything else follows from

**Verify before you trust — from the actual source, from more than one angle.** In a fleet, the
things you'd normally treat as ground truth are not:

- A **peer session's claim** ("3 security holes are live", "I already deployed", "0097 is
  included") is a *reference to re-verify*, never fact. Peers work from stale or compacted
  context and overstate. Re-derive it yourself from git and code.
- A **compaction / handoff summary** (including your own) is third-party reference, not truth.
  Re-verify its claims against the current source before acting on them.
- A **green typecheck/test run on the dirty working tree** is a *false signal* for what will
  deploy. The deploy candidate is **committed HEAD**, and a committed file can depend on a peer's
  *uncommitted* change — so HEAD can be broken while the dirty tree is green. Certify HEAD in an
  isolated worktree.
- **Your own session identity** can be wrong after a compaction/fork. Confirm it with
  `ListAgents` before signing board claims or reserving Part numbers.

When a claim matters, cross-check it from at least two independent angles (git history + running
code + live `/health`, for example) before you relay it to the user or act on it. Overstated
alarm from a peer is common; a quick independent read usually deflates or confirms it precisely.

## Which session are you?

Identify your role first — it decides what you're allowed to do.

- **Worker.** Owns one disjoint backlog item. Picks work whose file set is fully disjoint from
  every peer's in-flight edits, claims it in `progress.md`, commits each finished slice promptly,
  and stays out of other lanes. Never deploys.
- **Coordinator.** Watches the whole fleet continuously: maps who's editing what, polices
  commit-per-change, deconflicts shared files and Part numbers, catches a broken HEAD, and is the
  single point that runs (or gates) a deploy. There should be **exactly one** driver of deploys at
  a time — two coordinators both deploying is itself the top hazard. If a second coordinator
  appears, do not silently cede or silently race: surface the overlap to the user as a decision
  and hold deploys until they rule.
- **Final reconciler.** The end-of-run session that certifies committed HEAD is whole and green,
  reconciles every lane, and drives the staged deploy once the user opens the gate.

You may be handed a role by the user, or infer it. When unsure whether you're authorized to
deploy, you are not — confirm with the user.

## The confirmation layers (run them in order, cheapest first)

Testing/verification in this project is layered. Each layer is necessary but **not sufficient** —
the user has watched fixes pass a shallow check and still be broken, so the mandate is to go all
the way down when the work is being certified for deploy.

1. **Source-shape floor.** Typecheck both packages, run every test suite individually, run the
   real frontend build. This is the *floor*, not the bar.
2. **Committed-HEAD certification.** Re-run layer 1 against **committed HEAD in an isolated
   worktree**, not the dirty tree — this is what actually deploys. See `references/verification.md`.
3. **Exhaustive coverage.** An enumerated matrix of every surface / writer / route with a verdict
   per item — provable, not sampled. Edge cases, malformed input, concurrency/stress, D1 limits,
   and **both offline and online** paths. Record **expected vs actual** for every probe; a claim
   without the observed value next to the expected one does not count.
4. **Live end-to-end.** Drive the real system — isolated local worker + a copy of D1, minted real
   sessions, DB state asserted after every call with `better-sqlite3`. Static/source-shape checks
   alone never satisfy "actually working". Recipe in `references/verification.md`.

Scale the depth to the ask: a quick "does this look right" stops at layer 1–2; "verify/validate/
test thoroughly", a deploy certification, or a security review goes to layer 4. When a scenario
fails, **suspect the harness first** and attribute pre-existing reds by re-running them at an
older commit before "fixing" anything — the failure may be a peer's mid-edit state, not a bug.

## Conflict prevention on the shared index

The full mechanics — atomic pathspec commits, the diff-immediately-before-commit rule, the
never-delete-a-peer's-lines rule, Part-number reservation, the ChatGPT/Codex branch sweep — live
in `references/coordination.md`. The non-negotiables:

- **Never `git add -A` / `git add .`.** Stage exact paths only; all sessions share one index.
- For a **shared file** (progress.md, session-log, lang packs), commit atomically:
  `git commit -m "..." -- <paths>` — no index dwell time for a peer's commit to sweep your staged
  change into theirs.
- **Diff every file immediately before committing it** (`git -c core.pager=cat diff -- <file>`),
  even one you saw clean minutes ago — path-scoping stages the *whole current file*, foreign hunks
  and all. If a foreign hunk appears, wait for the peer or record the ride-along plainly in your
  message; **never rewrite a pushed commit** and **never delete a peer's in-flight lines** to
  isolate yours.
- **Claim before you code.** Flip the board item to in-progress with your (ListAgents-confirmed)
  session name before writing.
- **Commit-per-change is policed.** One commit per feature/fix/polish, in dependency order,
  scoped to only that task's files — never one big end-of-session commit. As coordinator, actively
  nudge lanes that stay dirty across checks; uncommitted work is at risk of absorption or loss.

## The staged ship cycle

The cycle is **fix → commit → push → (staged) deploy → live-verify → summarize**, repeated. The
part sessions get wrong is treating deploy as per-commit. It is not.

- **Commit and push continuously** (per change, in order). Pushing to `origin/main` is cheap and
  safe and is how the ChatGPT surface and other clones stay in sync.
- **Deploy is batched by stage, not per commit.** Deploys are real, irreversible, outward-facing
  events that push the live Worker and can apply migrations to the **remote production D1**. You
  batch many committed changes into one deploy at a stage boundary — never ship every commit.
- **Stage 1 = reconcile + audit (no deploy).** Reconcile all lanes, certify committed HEAD green
  (layers 1–4), root-cause every red as stale-test vs real-regression. Stage 1 runs until the user
  explicitly says "go for Stage 2".
- **Stage 2 = deploy (user-gated).** Only on the user's go. Deploy **from committed HEAD via an
  isolated git worktree** (never the dirty tree, never `full-automation`'s `npm ci` which nukes
  peers' node_modules). Exactly one driver. Then **live-verify**: poll `/health`, confirm the
  Worker version, run the post-deploy regression checks. Full pipeline and gating in
  `references/deploy.md`.
- **Don't let the deploy get pushed back forever, and don't rush it.** "Get it right" and "stop
  stalling" resolve as: verify quickly and correctly, then ship what genuinely needs shipping —
  never deploy on an unverified or overstated premise, never leave certified work unshipped once
  the gate is open.

After a deploy, record durable state (the `progress.md` board block + a `session-log` Part entry)
as **reference-to-verify**, not as a claim of truth — write commit hashes and the live version so
the next session re-checks against the git artifacts.

## Auto-compaction: stay under 300K

Sessions in this checkout **must not let context exceed 300K tokens**, and when compacting should
compact to the *lowest practical size*, not merely down to 300K. Context is a shared-fleet
resource: bloated sessions are slow to coordinate and lose the plot.

- **Persist before you compact.** Everything durable goes to files first — the board, the
  session-log Part, committed+pushed code — so a compaction loses nothing. Write it as third-party
  reference the next window re-verifies, never as ground truth.
- **Compact proactively**, at a natural checkpoint (a cycle just finished, HEAD is green and
  pushed), rather than waiting to be forced near a limit. You cannot self-invoke `/compact`; when
  you're near the ceiling and at a clean checkpoint, tell the user it's a good time to compact and
  confirm your state is fully persisted.
- After any compaction/restart: re-confirm session identity (`ListAgents`), re-grep Part numbers,
  and re-verify prior claims — a compaction resets your running registry.

## Continuous coordination cadence

Coordination is continuous, not per-batch. Quiet is a lull, not an ending — the user spins up new
session batches at any time.

- Idle at a **long cadence (~30–60 min ticks)** while the tree is clean and no lanes are
  committing; **tighten to ~15–25 min** while lanes are active or a stage is in motion.
- Stop only when the user says so or the session ends. If you posted a sign-off note on the board,
  **reopen it** when the watch resumes rather than leaving "no coordinator live".
- The sweep includes the **ChatGPT/Codex surface**: `git fetch` and check for unmerged topic
  branches on origin (see `references/coordination.md`).

## Role quick-starts

**Worker:** ListAgents (confirm name) → `git status` (map peers) → pick a disjoint item → claim it
in progress.md → build → diff-before-commit each slice → atomic pathspec commit → push → next.

**Coordinator:** ListAgents → map dirty files to lanes → police commits & Part numbers →
deconflict shared files → watch for a broken HEAD → hold/gate deploys (exactly one driver) →
surface stage decisions to the user → tick continuously.

**Final reconciler:** certify committed HEAD in an isolated worktree (layers 1–4) → reconcile
every lane → on the user's Stage-2 go, deploy from HEAD via isolated worktree → live-verify →
record durable reference state → offer the next cycle.

## Reference files

- `references/coordination.md` — shared-index git mechanics, Part-number protocol, shared-file
  hunk isolation, the ChatGPT/Codex branch sweep, dev-server/wrangler etiquette.
- `references/verification.md` — committed-HEAD worktree certification and the live end-to-end
  testing recipe (isolated worker + D1 copy, minted sessions, DB-state assertions).
- `references/deploy.md` — the isolated-worktree production deploy pipeline, Stage-2 gating, and
  post-deploy live verification.
