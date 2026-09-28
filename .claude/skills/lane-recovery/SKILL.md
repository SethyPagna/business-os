---
name: lane-recovery
description: Run many parallel lanes so that a usage limit, crash, account switch or new session loses nothing, and resume them afterwards. Use before launching several agents, after "you hit the limit", "resume", "read the handoff", "continue where we left off", on a new or switched account, when a killed agent's findings must be recovered, or when worktrees hold uncommitted work nobody is tracking.
---

<!-- Generated from agent-team/skills/lane-recovery/SKILL.md. -->

# Lane recovery

A usage limit kills every running agent at the same instant. What was committed survives; what was
only in an agent's head is gone; what was uncommitted survives on disk but is easy to forget or
overwrite. Agent ids do not carry across sessions.

The limit is one budget per window, shared by every session and agent on the account. More agents
spend it faster; they add no capacity.

## Before launching lanes
1. Critical path first: launch the lanes the next release needs, a few agents at a time, and queue the rest.
2. One worktree per lane from an agreed base; one writer per path.
3. Register every lane at launch in the **lane registry** (local records, never the public repo): lane, priority, agent id + session, worktree/branch, one-line brief, state.
4. Give every agent a shared rules file (commit small and often, exact-path staging, no push/deploy, red test first, gates, report format) and point to it from the brief.
5. Respect the harness's concurrency cap; queue the rest in the registry, not in your head.

## Save as you go
- Writers commit after every green step; uncommitted work is what a stop loses.
- A read-only agent's report file in the local records **is** its deliverable. The brief names the file and explicitly authorizes writing it, whatever the agent type's default about creating files. The agent creates it first, marked `STATUS: IN PROGRESS`, appends each finding the moment it has it, and sets the final status and verdict at the end.
- Append in small pieces, one finding per write. One giant write (a single heredoc holding the whole report) fails on Windows with `ENAMETOOLONG` and loses all of it at once.

## After a stop
1. **Snapshot first**: save each worktree's uncommitted diff and untracked files plus an index of branch, HEAD and dirty count. The snapshot changes no git state and skips secret files.
2. Read the newest handoff, the registry and `progress.md`.
3. Confirm no live peer still owns a worktree (peer list; newest file mtimes).
4. Resume release-critical lanes first. Same session: message the agent id. New session: start a fresh agent in the **same** worktree with its brief plus "the worktree already holds partial work; read `git status`/`git diff` first and continue".
5. A killed or silent agent's findings survive in its transcript even when its report file is empty: extract them before running the work again.
6. For lanes that look finished, start a read-only refuter instead of the writer.
7. Update the registry state column on every change.

## Waves that survive stops
- Check the remaining budget before each wave. About 20 concurrent agents can empty a 5-hour window in under two hours; run the release-critical tier first and hold scans and designs.
- An auth or network blip (for example HTTP 403 "Request not allowed") kills every live agent in the same second without being a limit. Relaunch only the dead agents, after checking which are still alive.
- Wrap every agent call in a retry that re-sends the same prompt with a resume hint when the agent returns nothing. Keep the first attempt identical to the original so a cached result still replays.
- Orchestrators that cache by call order re-run every later call when an earlier prompt changes. Save finished results to the local records first, then relaunch only the failed work as a new run; never edit-and-resume past finished agents.
- Report and log files are append-only across attempts: keep an existing file (or copy it to `.prevN`) before writing; never overwrite it.
- Lanes run their related and composition-sensitive tests, not the full suite: several lanes sweeping on one machine produce timeout reds that are not real. The full suite runs once, on CI, for the composed candidate.

## Never
- Delete a worktree or branch holding unmerged commits or a dirty tree.
- Reset/stash/checkout away a stopped agent's changes.
- Trust a "done" in a handoff without looking at the commit.

## Handoff file (write before an account switch or at a checkpoint)
Production version + how to deploy/verify it · next release checkpoint with per-lane state · held/blocked items with reasons · new owner tasks · where records live. Keep it under two pages; the registry holds the detail.

## The local recovery kit
Each machine keeps a recovery kit outside the repository, never committed: a loop that snapshots every worktree on a timer, a session-checkpoint hook, and a tool that extracts an agent's findings from its transcript, next to the lane registry and the handoff. Each harness's user-level instructions say where it is: Claude Code's session-start hook, `~/.codex/AGENTS.md` for Codex, `~/.copilot/copilot-instructions.md` for Copilot. If yours names no kit, ask the user.
