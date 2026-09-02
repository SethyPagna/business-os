# Checkpoints

This folder holds copies of sandbox checkpoint/leftover artifacts captured
from the main checkout (`C:\Users\mrkl6\Downloads\business-os-v1`), which is
read-only for this release-candidate effort (see
`docs/plans/coordinated-plan-2026-09-02.md` §0). It exists so those artifacts
are on record somewhere version-controlled before the main checkout's own
untracked copies are cleaned up.

## What's here

- [`CHECKPOINT-2026-09-01.md`](CHECKPOINT-2026-09-01.md) — a copy of the main
  checkout's untracked `CHECKPOINT.md` as of 2026-09-01 (continuation of an
  11:02 +07 checkpoint): a sandbox-recovery note about a corrupted
  `node_modules` zip-transfer, four backend test-harness fixes, and an
  update-package merge (account-security/password-manager feature) reconciled
  against `main`.
- [`unapplied-branch-transfer-search-patch-note.md`](unapplied-branch-transfer-search-patch-note.md)
  — the repo-root `README.md` as it actually was before 2026-09-02 (a leftover
  zip-patch instruction note, not a project README) — moved here when
  `README.md` was replaced with a real one. The fix it describes appears to
  already be present in current source (see the note's own source-check), but
  was not traced to a specific commit.

## What is NOT here (and why)

The main checkout also has these **untracked** root-level leftovers, which
this worktree cannot touch (read-only checkout — see the isolation protocol):

- `CHECKPOINT_CHANGES.patch` (~6.9 MB)
- `CHECKPOINT_GIT_STATUS.txt`
- `run-log.txt` (~250 KB)
- `tmp/` (~521 MB)
- `outputs/` (~4.7 MB)
- `Migration from old system/` (~219 MB)

These are **sandbox artifacts, not source** — patch/diff dumps, a captured
`git status` snapshot, a run log, and working scratch directories from prior
sessions.

**`CHECKPOINT_CHANGES.patch` — checked, do not apply (coordinator, read-only
from this worktree):** it has 96 `diff --git` entries and fails BOTH
`git apply --check` and `git apply --check --reverse` against committed HEAD
`57d8f1a2` — it is a mid-stream snapshot of a dirty tree, neither pending
work that cleanly applies nor already fully contained in HEAD. Treat it,
`CHECKPOINT.md`, `CHECKPOINT_GIT_STATUS.txt`, and `run-log.txt` as
**archive-only — delete candidates, owner's decision**, not something to
reconcile or reapply; this checkpoints folder's copies (`CHECKPOINT.md`'s
content as of 2026-09-01, above) are what preserve their substance.
`tmp/`/`outputs/`/`Migration from old system/` are working data, not
deliverables, and were not evaluated for reapplication (they aren't patches).

None of the six should ever be committed, and none were deleted from the main
checkout by this pass — it is read-only for this effort (see the isolation
protocol); only the owner can delete them there, after confirming they don't
need any of this content that isn't already captured above. `.gitignore` in
this worktree now has entries (`CHECKPOINT*.patch`, `CHECKPOINT_GIT_STATUS.txt`,
`run-log.txt`, `/tmp/`, `/outputs/`, `/Migration from old system/`) so an
accidental `git add` of any of them, in this or a future worktree, is a
no-op rather than a multi-hundred-MB commit.
