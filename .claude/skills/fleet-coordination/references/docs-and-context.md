# Docs and context: progress.md, session-log, CLAUDE.md, memory, compaction

Four durable homes, each with one job. Putting state in the wrong one is how fleets lose the plot:
a peer reads a stale claim as fact, a compaction drops the only copy of a decision, or CLAUDE.md
bloats with in-flight status that every session then pays to load.

| Home | Holds | Never holds |
|---|---|---|
| `progress.md` | Current state: status snapshot, live lane claims, the open queue, Golden Rules, DONE archive | Narrative reasoning; anything already archived |
| `docs/history/session-log.md` | The per-session narrative (`## Part N`): ask, changes, findings, verification, not-done | Board state (that is progress.md's) |
| `CLAUDE.md` (repo root) | Short, durable, project-wide operating facts every session must know on load — as pointers | Task status, lane claims, Part numbers, copies of sections that live elsewhere |
| Auto-memory (`~/.claude/projects/.../memory/`) | User preferences and corrections that must survive across sessions | Project state, findings about code, your own mistakes |

Everything written to these files after a compaction or by another session is a **reference to
re-verify**, not truth. Write it that way too: commit hashes, wrangler version ids, the command that
proves it — so the next reader can check instead of trust.

## progress.md

Read it top-to-bottom at session start; it is kept short enough for that on purpose.

- **Claim before you code.** In *Current status*, add a lane block headed by status glyph + lane
  name + your `ListAgents`-confirmed session name, listing the files you own and whether you work
  in the main checkout or your own `rc/*` worktree. Flip the queue item `[ ]` → `[~]`. Peers pick
  disjoint work by reading these blocks — a missing claim is a collision.
- **Keep the block current** as the lane moves: ✅ with commit hashes when done, "NOT deployed /
  Stage-1" until a deploy ships it, the follow-ups you are leaving.
- **Ending a session, do all three:** append the session-log Part; move finished items to the DONE
  archive (one line each — nothing is deleted, only moved); update *Current status* and, after a
  deploy, the *Status snapshot* (commit hash, wrangler version id, highest applied migration).
- **Shared-file discipline** — diff immediately before committing, atomic pathspec commit, never
  delete a peer's lines; the hunk-isolation mechanics are in `coordination.md`.
- **Transient ledgers do not go in the repo root.** Checkpoints, run logs, verify ledgers live in the
  scratchpad until they become a Part entry or a `docs/` audit. (`CHECKPOINT.md`, `run-log.txt`,
  `tmp/`, `outputs/` at the root are the anti-pattern.)

## Session-log Part entry

Take the number with the max+1 grep in `coordination.md` ("Part numbers race" — it also covers
reserved ranges and double-claims). Then append:

```
## Part N (Mon DD YYYY, session business-os-v1-XX, <role>) — <one-line outcome>

**Ask** — what was actually requested, quoted where wording matters.
**What changed** — per file/subsystem, with the reason, not just the edit. Commit hashes.
**What was found** — real bugs met along the way and how each was confirmed (two angles).
**Verified** — the exact commands/probes run and their real results (the ledger summary:
expected vs actual, counts like 147/147, the wrangler version observed). Never "should work".
**Not done** — everything still open, including asymmetries waiting on a user decision.
```

Commit the docs last, atomically. If progress.md and the session-log both carry only your hunks,
one pathspec commit covers both:
`git commit -m "docs: Part N — ..." -- progress.md docs/history/session-log.md`; otherwise commit
each alone. Never bake the Part number into code comments or the board before the entry exists.

## CLAUDE.md

CLAUDE.md is loaded into **every** session's context at start, including all your peers'. That makes
it powerful and expensive: one durable pointer there saves fifty sessions a mistake; one line of
status there costs fifty sessions tokens and ages into a lie.

- Keep it a **pointer document**, well under 60 lines: read progress.md first; invoke
  `/fleet-coordination` when parallel; where the Golden Rules, the commands and the conventions are
  specified. The only rules restated in full are the ones whose violation damages peers within
  minutes (the shared-index rules).
- **Update it when a durable fact changes** — a renamed script, a new mandatory check, a new skill,
  a new canonical file (e.g. `businessDateWindow.ts`). Do not update it for lane progress.
- Never duplicate a section that lives elsewhere; link to it. Duplicates drift, and the copy in
  CLAUDE.md is the one nobody re-reads.
- Path-scoped commit, diff first, like any shared file.

## Compaction and handoff (≤300K, compact to the lowest practical size)

Context is a shared-fleet resource. A session must not exceed 300K tokens, and when it compacts it
goes as low as is practical, not merely under the ceiling. Check the number with `/context` (or the
status-line indicator) at every natural checkpoint; a transcript full of large tool results is near
the ceiling before the number looks alarming.

**Before** (at a clean checkpoint — cycle finished, HEAD green, pushed):
1. Commit and push every finished slice (path-scoped).
2. Update the progress.md lane block and, if the session is ending, the Part entry.
3. Write the handoff (in the board block or a scratchpad ledger) as **third-party reference**: what
   to re-verify, with the hashes/commands that let the next window verify it.
4. Save any memory the user's messages taught this session.
5. Tell the user it is a good moment to compact and that state is fully persisted (Claude cannot
   self-invoke `/compact`).

**After** (any compaction, resume, or fork):
1. `ListAgents` — confirm your session name; a fork may be using your old one. (Main-session tool;
   subagents do not have it — a subagent reports under the name you give it.)
2. Re-read progress.md top: snapshot + Current status. Re-grep Part numbers.
3. `git status`, `git log --oneline -15`, `git worktree list` — what moved while you were away;
   whose dirty files are whose.
4. Re-verify every claim you are about to act on against source/runs. The summary is a pointer.
5. Re-claim or release your board block explicitly.

## Memory

Save a memory only for a durable, applicable, legible lesson the **user** taught (a correction, a
standing preference) — one topic per file, with the why. Not project state, not code findings, not
your own mistakes. Do it in the same turn the lesson arrives; writing the rule into progress.md or
CLAUDE.md ships the change but does not keep the preference.
