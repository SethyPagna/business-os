# Conflict prevention on the shared index

Sessions working in the main checkout share one working tree and **one git index**. That single
fact drives every rule here: anything you stage sits in the shared index until *your* commit fires,
and a peer's commit in that window can sweep it into theirs.

Some lanes instead work in their **own git worktree on an `rc/*` branch** (`git worktree list`
shows them — e.g. `bos-rc` on `rc/coordinated-…` and `bos-rc-workers/sec-*` on `rc/sec-*`). They
escape the shared index, but they still land on the same `main`: their unmerged branches are part of
every sweep and of reconciliation, and a lane must say on the board which model it is using.

## Talk before you touch: the peer-message protocol

The user's instruction is that talking to the other sessions (and to ChatGPT) is the *first*
instinct, before any file is opened for editing. The mechanics:

- **Who.** `ListAgents` lists every live session by name; that name is the `SendMessage` address.
  Message each live peer individually (a cross-session message goes to one session).
- **What.** First line: what you are about to do and to which files, as one sentence — the
  recipient's user sees only that line in the preview. Then: the exact paths, the one-line intent,
  the question ("do you have any of these dirty, staged, or planned?"), and how you will commit
  (path-scoped, diffed first). Example:

  ```
  business-os-v1-80 is about to edit frontend/package.json (remove the dead verify:ui /
  verify:performance entries), append Part 580 to docs/history/session-log.md, and edit
  .claude/skills/fleet-coordination/*. Do you have any of these dirty, staged, or planned?
  Reply with the file if there is overlap so I hold off; no reply = no objection.
  ```

- **Wait, briefly.** For a small slice, one tool round of silence is enough to proceed — a peer that
  is mid-build may not answer for minutes and the tree is not frozen for it. A reply that names a
  file is **binding**: do not touch that file; split the lane, agree an order, or hand the file over
  in the same thread. Answer incoming messages within one tool round; a peer waiting on you is a
  stalled lane.
- **The ChatGPT/Codex surface** is part of "everyone". Sweep its branches before starting (command
  in "The ChatGPT / Codex surface" below) and diff any candidate against your files; when the
  user's live chat is reachable, tell it what you are taking; when it is not, report that plainly.
- **Then claim** on the progress.md board and start. Talk again before restarting a shared server,
  before a docs commit that rides along a peer's hunk, before reconciling a live owner's lane, and
  before overwriting anyone's committed work.
- **Permissions do not travel.** A peer cannot approve what your session was denied and you cannot
  approve it for them; route such asks back to the user.

## Staging and committing

- **Never `git add -A` or `git add .`.** They stage every session's work. Stage exact paths only.
- **Shared files get atomic pathspec commits.** For any file more than one session touches
  (`progress.md`, `docs/history/session-log.md`, `frontend/src/lang/en.json` / `km.json`), use:

  ```bash
  git commit -m "message" -- <path> [<path> ...]
  ```

  This stages *and* commits in one step — no index dwell time for a peer to absorb your change (or
  for an `--autostash` pull to pull theirs into yours).

- **Diff every file immediately before committing it** — even one you saw clean minutes ago:

  ```bash
  git -c core.pager=cat diff -- <file>
  ```

  Path-scoping stages the **whole current file**, so it cannot isolate your hunks from a peer's
  within the same file. If every hunk is yours, commit. If a foreign hunk appears:
  - it's a *shared* file → accept the ride-along and record it plainly in your commit message /
    session-log ("includes peer's balanced en/km keys for lane X"); **never** rewrite the pushed
    commit; or
  - you must isolate → `git apply --cached <one-hunk.patch>` to stage only your lines to the index
    (regenerate the patch against current HEAD each time — peers' commits move the baseline and a
    stale patch fails to apply). **Never delete a peer's in-flight lines from the working tree to
    "isolate" your commit** — the tree is shared; you disrupt them live and risk their broad commit
    capturing your deletion and shipping broken (e.g. a committed feature referencing lang keys you
    removed). After any absorption, run a no-loss audit: every one of your markers is in HEAD, and
    the peer's committed feature is internally consistent.

## Part numbers race

`docs/history/session-log.md` uses `## Part N` headers, written concurrently by many sessions.

- Before claiming a number, **grep ALL `^## Part` headers and take max+1** — checking only the
  tail is not enough, because rebases interleave peers' appended entries *above* yours (four of
  your numbers can be taken while the tail looks consistent):

  ```bash
  grep -oE "^## Part [0-9]+" docs/history/session-log.md | awk '{print $3}' | sort -n | tail -1
  ```

  (`awk` first — a bare `sort -n` on the whole header string sorts lexically.)
- Re-grep after any compaction/restart — it loses your running registry.
- The one exception to max+1: a peer has **explicitly reserved a range by message** ("you keep
  Part 389+"). Then take the next free number *inside your range* and leave theirs alone. Never bake
  a Part number into code comments or a board entry before the log entry is actually written.
- On a double-claim, the **write-order rule** decides: the later writer renumbers its entry **in a
  follow-up commit**. Never rewrite a pushed commit to fix a number.

## Picking disjoint work

- `git status` dirty files = peers' in-flight units. Read the diffs to identify which backlog
  items they are, then take the highest-ordered open item whose file set is **fully disjoint** —
  including shared files like lang packs and page components.
- **Message the live peers with the file set (protocol above), then claim it in `progress.md`**
  (flip `[ ]` → `[~]` with your session name) before writing code. Answer peers' cross-session
  messages dividing files — they're precise and reliable.
- A failing sweep may be a peer's mid-edit state. Attribute failures by **file ownership** before
  fixing: a red in a file another session is editing is theirs and transient; a red your schema
  change causes in a shared fixture is yours even if the file isn't in your lane.

## Session identity

- Verify your session name with `ListAgents` at session start and **after every compaction/
  resume**. The user forks sessions: a compacted session can resume under a new short name while a
  live fork keeps the old name and keeps claiming board items under it. A board claim bearing
  "your" old name may belong to a different live session — reconcile identity explicitly in
  messages before trusting it.

## Commit-per-change is policed

One commit per feature/fix/polish, in dependency order (schema/backend before the frontend that
consumes it, shared helpers before callers), scoped to only that task's files. Never checkpoint
`.zip` archives, never one large end-of-session commit. The docs entries (board block, Part) are
committed last and atomically — in one pathspec commit when both shared files carry only your hunks,
otherwise one commit per file (`docs-and-context.md`). As coordinator, actively nudge any lane that stays dirty across multiple
checks — long-lived "mid-rebuild" lanes are the classic forgotten case, and uncommitted work is at
risk of absorption or silent loss.

## The ChatGPT / Codex surface

Coordination covers the GitHub repo surface too:

- ChatGPT/Codex works via **kebab-case topic branches on `origin`** (and has left many local
  `codex/recovery/*` branches). Sweep both remotes and local branches, and the lane worktrees:

  ```bash
  git fetch --prune && git branch -r --no-merged origin/main && git branch --no-merged main && git worktree list
  ```

  Merge or flag every unmerged `rc/*`, `codex/*`, `claude/*` branch — don't let them drift.
- The user's live chatgpt.com session is read via the user-level `chatgpt` skill's browser route
  (drives the user's real Chrome through the claude-in-chrome tools; needs the Claude-in-Chrome
  extension connected, which is the usual blocker). There's no `OPENAI_API_KEY` on this machine,
  and the API route can't read existing chat history.

## Dev-server / wrangler etiquette

- **Don't start dev servers casually** — they lock `node_modules` and can break a peer's
  concurrent `npm install`/build.
- One shared `wrangler dev` on **8787** is community property: every Vite dev server proxies its
  `/api`, `/uploads`, `/health`, `/ws` to it (`frontend/vite.config.ts`), and it serves the
  **last-built** `frontend/dist` itself (`cloudflare/wrangler.toml` `[assets]`) — so 8787 never
  shows unbuilt edits. Ask who owns it before killing/restarting. **Never start a second wrangler against the
  shared `cloudflare/.wrangler/state` dir** — two miniflares on the same Durable-Object SQLite
  files crash each other with `SQLITE_BUSY`. If a session truly needs its own worker, give it its
  own state with `--persist-to <dir>` and shut it down when done.
- `/assets/*` all failing while `/api/*` works is usually a stale service worker in that Browser
  tab, not the server — see the traps in `browser-verification.md` before blaming wrangler.

## Reconciling parallel lanes

Reconciliation is the step where many sessions' output becomes one coherent HEAD. It is not
last-writer-wins and it is not a merge of whatever is dirty.

- **Timing.** A true reconciliation happens when the lanes have actually finished. With sessions
  still active, committing the tree would bundle half-done peer work — reconcile only committed
  slices, and only the dirty files whose owner has confirmed they are done.
- **Precedence.** When two changes target the same thing, the **later, more-specific** change wins —
  *provided you verify it is valid and genuinely the better result* (the user's example: "fix
  adjust" loses to a later "fix adjust, using the Branches-page design"). Verify before letting it
  overwrite; when it is not clearly better, flag the pair for the user instead of guessing.
- **Nothing goes missing.** For every superseded change, list what it did that the survivor does
  not; either the survivor absorbs it or the loss is recorded as a deliberate decision. Run the
  no-loss audit: every marker you expected in HEAD is in HEAD.
- **Root cause, not symptom.** A re-opened or recurring issue during reconciliation means an
  earlier fix treated a symptom (the `0037` migration recorded fixed three times; the resurrecting
  `googleDrive.ts` duplicate). Find the structural cause and prove the fix with a real run.
- **Two angles per decision.** No finding enters the reconciliation report, and no overwrite is
  executed, on a single pass — confirm from a second independent source (code + run, or two
  verifiers). If any angle raises doubt on something irreversible (a production data migration),
  hold and surface it; granted authority to decide is not licence to skip the comparison.
- **Output.** A reconciliation ends with: committed HEAD certified green in an isolated worktree
  (`verification.md`), a matrix of lanes → surviving commits → verdicts, the flagged pairs awaiting
  the user, and a Part entry that reads as reference to re-verify.
