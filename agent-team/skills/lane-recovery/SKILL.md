---
name: lane-recovery
description: Run many parallel lanes so that a usage limit, crash, account switch or new session loses nothing, and resume them afterwards. Use before launching several agents, after "you hit the limit", "resume", "read the handoff", "continue where we left off", on a new or switched account, or when worktrees hold uncommitted work nobody is tracking.
---

# Lane recovery

A usage limit kills every running agent at the same instant. What was committed survives; what was
only in an agent's head is gone; what was uncommitted survives on disk but is easy to forget or
overwrite. Agent ids do not carry across sessions.

## Before launching lanes
1. One worktree per lane from an agreed base; one writer per path.
2. Register every lane at launch in the **lane registry** (local records, never the public repo): lane, priority, agent id + session, worktree/branch, one-line brief, state.
3. Give every agent a shared rules file (commit small and often, exact-path staging, no push/deploy, red test first, gates, report format) and point to it from the brief.
4. Respect the harness's concurrency cap; queue the rest in the registry, not in your head.

## After a stop
1. **Snapshot first**: save each worktree's uncommitted diff and untracked files plus an index of branch, HEAD and dirty count. The snapshot changes no git state and skips secret files.
2. Read the newest handoff, the registry and `progress.md`.
3. Confirm no live peer still owns a worktree (peer list; newest file mtimes).
4. Resume release-critical lanes first. Same session: message the agent id. New session: start a fresh agent in the **same** worktree with its brief plus "the worktree already holds partial work; read `git status`/`git diff` first and continue".
5. For lanes that look finished, start a read-only refuter instead of the writer.
6. Update the registry state column on every change.

## Never
- Delete a worktree or branch holding unmerged commits or a dirty tree.
- Reset/stash/checkout away a stopped agent's changes.
- Trust a "done" in a handoff without looking at the commit.

## Handoff file (write before an account switch or at a checkpoint)
Production version + how to deploy/verify it · next release checkpoint with per-lane state · held/blocked items with reasons · new owner tasks · where records live. Keep it under two pages; the registry holds the detail.

This repository: registry and snapshot script live in the owner's local Records/Recovery folder (path in the owner's memory/handoff), never committed.
