---
name: review-change
description: Review a diff, branch or lane from fresh context and certify or refute it. Use when a writer reports done, before merging a lane into a release checkpoint, when asked to review a PR or "check this", or as the refuter step of work-mode. The reviewer is read-only and never the agent that wrote the code.
---

<!-- Generated from agent-team/skills/review-change/SKILL.md. -->

# Review a change (fresh-context refuter)

You did not write this code. Judge what is written, not what was meant.

## Setup
- Review the **committed** HEAD of the branch, in its own worktree. Note base and head shas.
- Read the brief/claims. List them as numbered claims to refute.
- Read raw source/diffs and acceptance artifacts before the author's verdict. Record peer-conclusion exposure; filter coordination output to claims rather than historical messages when preserving blind review.

## Checklist
1. Does the change satisfy the task as stated by the owner (not as reinterpreted)?
2. Can you reproduce the original bug on the base, and not on the head?
3. Are the new tests red on the base and green on the head? Would they pass for a plausible wrong fix?
4. Were existing tests weakened, deleted, or re-pinned to new wrong behaviour?
5. Edge cases: concurrency/double submit, retries after uncertain network, other role, other branch, Khmer, empty/zero/negative, legacy rows, undo/redo.
6. Sibling surfaces reached (`blast-radius`)? Backend enforces what the frontend checks?
7. Unnecessary complexity, duplicated existing utility, architectural boundary crossed?
8. Data: migrations append-only, LF-only trigger SQL, pre/post assertions, recovery notes; no silent data rewrite.
9. Security: auth/permission on every new route, no secret in responses/logs, input validated server-side.
10. Merge: `git merge-tree <release-base> <head>`; list conflicts.
11. Composition: a clean merge is not a working composition. When the change adds an import to a shared module or a new audit/settings writer, find the tests that would notice on the composed tree: strict harnesses that enumerate a module's imports, and drift guards that scan a whole directory. Run them on the merged tree, or ask the lead for `gate.yml` on the pre-candidate. Lane-scoped test runs missed both CP-3a-2 reds on 28 Sep 2026.
12. Test instruments: enumerate custom, recursive, extracted and inherited loaders, including permissive stubs. Execute a plausible wrong-helper control that preserves the original business assertions. A caught missing-function error returning400 is not proof of semantic validation; check the actual error and persisted state. A date review in October 2026 found a no-op helper silently ignoring a financial time filter.
13. Evidence layers: distinguish pure math, actual routes/database, negative/failure/race/replay controls, composed suites, browser behavior and live provenance. Preserve original failed runs and explicitly qualify source-equivalent checks. Temporary safe refusals and disabled slices cannot redefine the owner's full acceptance scope.

Run the gates yourself: `node agent-team/scripts/verify.mjs <terms>` for the touched area (its summary says `partial` and what ran). A release candidate is certified by the `.github/workflows/gate.yml` run on GitHub for that exact commit, the full both-package sweep.

## Output
Verdict: **CERTIFIED** / **CERTIFIED WITH EXCEPTIONS** / **NOT CERTIFIED**. Each finding is one of:
- **confirmed defect** — with reproduction or file:line evidence;
- **plausible concern** — why, and what would confirm it;
- **style preference** — listed last, never blocks.
Do not redesign acceptable code. Do not fix anything; the writer or a new lane fixes.
