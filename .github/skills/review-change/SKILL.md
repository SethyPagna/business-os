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

Run the gates yourself: `node agent-team/scripts/verify.mjs <terms>` for the touched area (its summary says `partial` and what ran). A release candidate is certified by the `.github/workflows/gate.yml` run on GitHub for that exact commit, the full both-package sweep.

## Output
Verdict: **CERTIFIED** / **CERTIFIED WITH EXCEPTIONS** / **NOT CERTIFIED**. Each finding is one of:
- **confirmed defect** — with reproduction or file:line evidence;
- **plausible concern** — why, and what would confirm it;
- **style preference** — listed last, never blocks.
Do not redesign acceptable code. Do not fix anything; the writer or a new lane fixes.
