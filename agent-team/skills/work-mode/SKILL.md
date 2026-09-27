---
name: work-mode
description: The default operating mode for rigorous engineering in this repository. Use it at the start of any task that changes code, data, deploys, or claims something works — bug fixes, features, refactors, perf work, deploys, recovery after a usage limit, verification, forensics, cleanup, overnight/loop runs — even when the user does not name it. It matches the task to a playbook, copies that playbook's steps into the todo list verbatim, and routes to the other skills as steps need them. Sticky: once entered it stays on for the session until the user opts out.
---

# Work mode

Harness-neutral: works in Claude Code, Codex, Cursor, Copilot and Gemini CLI. Where a step names a
tool, use your harness's equivalent (table at the end).

## How to run it

1. Read `AGENTS.md` and the top of `progress.md` (live state; re-verify, never trust).
2. Pick **one** playbook below that matches the task. Several independent tasks → one playbook each,
   one lane each.
3. Copy the playbook's steps into your todo list **verbatim** as the first items. Add task-specific
   items after them.
4. Execute. When a step names a skill, load it. When a step fails twice, stop and report — do not
   improvise a third approach silently.
5. Finish with the report format at the bottom. Then apply **Principle 12**: turn any correction you
   received into a durable artifact (`skill-wiki`).

## Principles (one line each; the rule wins over convenience)

1. **Evidence over belief.** Reproduce before fixing; observe success after. Reasoning proposes, reality votes.
2. **Red first.** A bug fix starts with a test that fails on the base for the reported reason.
3. **Discriminating tests.** A test must fail for the plausible wrong implementation, not only for no implementation.
4. **Three gates, one job each.** `node agent-team/scripts/verify.mjs` is a lane's local done-check (`--fast` for the inner loop); `.github/workflows/gate.yml` on GitHub is the full both-package sweep for a release candidate; `run/verify-local.bat` is the heavier legacy local wrapper, which installs and builds, so use it intentionally. Never claim a gate you did not run.
5. **Committed HEAD is the product.** Green on a dirty tree proves nothing about what ships.
6. **Fresh eyes certify.** The writer never certifies its own work; a read-only refuter does (`review-change`).
7. **One writer per path.** Parallelize independent work in separate worktrees; never parallelize the same files.
8. **Root cause over symptom.** A fix that reappears treated a symptom.
9. **Sibling surfaces.** UI, API, import, bulk, undo, audit, permissions, offline, Telegram, both language packs (`blast-radius`).
10. **Deterministic work to scripts.** If a step is mechanical, script it; spend judgment only where judgment is needed.
11. **Shortest path = right path.** When agents keep taking a wrong shortcut, change the code layout or add a check so the easy path is correct.
12. **Every correction becomes an artifact.** Missing knowledge → AGENTS.md/skill; missing procedure → skill; escaped bug → regression test; repeated review comment → a CI/source check.
13. **Production is gated.** Deployments, remote migrations, secret sync and every remote D1 command (reads too) are production actions that need explicit user authorization; planning and review agents never run them (`AGENTS.md`, `deploy-provenance`). A harness's own user or session instructions may carry a specific owner grant; this skill never asserts one.
14. **Small commits, often.** A usage limit can kill every agent at once; uncommitted work is the only thing that is lost (`lane-recovery`).
15. **Code carries meaning; comments carry only what code cannot.** Names, types and tests explain first; keep a short why comment for an owner decision, an external constraint, a counter-intuitive workaround or a tool directive; the Golden Rules' readability bar wins (`no-comments`).

## Playbooks

### bug — "X is broken"
1. Capture the exact symptom (text, screenshot, request/response, receipt id).
2. Reproduce it (test, API call, or browser) and record the observed failure.
3. `debug-with-evidence`: narrow to the smallest failing case; read the code that actually executes.
4. Write the regression test; run it; see it fail for the reported reason.
5. Make the smallest justified fix at the root cause.
6. Rerun the reproduction and the test; see them pass.
7. `blast-radius`: fix every sibling surface with the same defect class.
8. `verify.mjs` green; inspect the final `git diff`.
9. Commit (exact paths). Request a refuter (`review-change`).

### feature — "add / change behaviour"
1. Find the closest existing pattern; reuse it before inventing one.
2. Write acceptance checks first (tests or scripted browser checks).
3. Implement the smallest coherent slice; both language packs; backend enforces every frontend rule.
4. `blast-radius` across sibling surfaces.
5. `verify.mjs` green; drive the UI in a browser when it renders (`browser-verify`).
6. Commit; refuter.

### lane — one bounded slice in parallel with others
1. Worktree from the agreed base; record the lane (agent id, worktree, brief, state) in the lane registry.
2. Claim paths with `team-state.mjs claim`.
3. Run the matching playbook (bug/feature/perf) inside the worktree only.
4. Commit small and often; never push or deploy from a lane.
5. Report: branch, HEAD, commits, gates run with counts, not-done, risks.

### refute — "is it really done?"
1. Read-only. Check out the exact committed HEAD, not a dirty tree.
2. List the claims; for each, try to make it false (crafted input, concurrency, sibling surface, other language, other role).
3. Run the real gates; confirm new tests are red on the base.
4. `git merge-tree` onto the release base; list conflicts.
5. Verdict: CERTIFIED / CERTIFIED WITH EXCEPTIONS / NOT CERTIFIED, each finding marked confirmed / plausible / style.

### checkpoint — assemble and ship a release
1. `deploy-provenance`: prove what production runs.
2. Fresh integration branch from main; merge only refuter-certified lanes, in the council's order.
3. Resolve conflicts by union, never by choosing a side blindly; after merging run every test file alone (the full sweep: `gate.yml` on GitHub).
4. Integrated refuter on the candidate.
5. With explicit user authorization, deploy from the committed candidate after trading close; smoke test live; record provenance in progress.md.

### recover — after a usage limit, account switch or new session
Load `lane-recovery` and follow it.

### forensics — "did this bug damage past records?"
1. Write read-only detection SQL per bug (bounded: keyset/date windows; D1 memory limits).
2. Prove each query on a local fixture with a known positive and a known negative.
3. A remote D1 read is a production action: with explicit user authorization, the lead runs the queries through the ops workflow; results stay encrypted/local.
4. Classify each hit: already compensated / partial / uncompensated / owner review.
5. Repairs only through the app's adjustment paths after owner approval; never ad-hoc SQL.

### perf — "make it faster / cheaper"
1. Measure first (timings, query counts, bundle sizes); write the number down.
2. Change one thing; measure again with the same method.
3. Keep only changes with a measured win and no behaviour change (tests green).

### cleanup — dead code, debloat, comments
1. Enumerate with evidence (grep for every reference incl. dynamic imports and dynamic i18n keys).
2. Classify safe / verify / keep; schedule removal after in-flight lanes that own those files merge.
3. Remove mechanically (script, not hand edits) in one lane; `verify.mjs` green; refuter.

### council — an owner idea, a decision, or a plan to challenge
1. Follow `docs/AI_COUNCIL_REVIEW.md`: independent perspectives (e.g. release manager, risk officer, skeptic, architect, user advocate) each answer alone.
2. Anonymized cross-critique; then one chair verdict with a ranked action list.
3. Say whether the seats were independent models or simulated. The council authorizes nothing; it advises.

### loop — overnight / unattended
1. Write the goal, stop conditions and the verify command at the top of the todo list.
2. Each iteration: pick the next item → playbook → verify → commit → update the registry.
3. Never deploy, delete, or run any production action unattended unless the user explicitly authorized exactly that action.
4. On repeated failure of the same item, park it with evidence and move on.

## Report format

```
Outcome: <one sentence>
Changed: <files / commits>
Verified: <command → result, each actually run>
Not verified / not done: <explicit list>
Risks: <what could still be wrong>
```

## Harness mapping

| Need | Claude Code | Codex | Cursor | Copilot |
|---|---|---|---|---|
| Subagent | Agent tool (`subagent_type`) | `.codex/agents/*.toml` | background agent / subagent | `.github/agents/*.agent.md` |
| Peer messaging | ListAgents / SendMessage | team-state.mjs | team-state.mjs | team-state.mjs |
| Skills dir | `.claude/skills` | `.agents/skills` | `.agents/skills` | `.github/skills` |
| Browser | Browser MCP / Playwright | Playwright | browser tool / Playwright | Playwright |
| Loop | `/loop` | exec loop | `/loop` | — |
Skills are generated from `agent-team/skills/`; edit there and run `node agent-team/scripts/sync-adapters.mjs`.
