# Conflict prevention on the shared index

All sessions share one working tree and **one git index**. That single fact drives every rule
here: anything you stage sits in the shared index until *your* commit fires, and a peer's commit
in that window can sweep it into theirs.

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
  your numbers can be taken while the tail looks consistent).
- Re-grep after any compaction/restart — it loses your running registry.
- Peers reserve ranges by message ("you keep Part 389+"); honor them. Never bake a Part number
  into code comments or a board entry before the log entry is actually written.
- On a double-claim, the **write-order rule** decides: the later writer renumbers. Never rewrite a
  pushed commit to fix a number.

## Picking disjoint work

- `git status` dirty files = peers' in-flight units. Read the diffs to identify which backlog
  items they are, then take the highest-ordered open item whose file set is **fully disjoint** —
  including shared files like lang packs and page components.
- **Claim it in `progress.md` immediately** (flip `[ ]` → `[~]` with your session name) before
  writing code. Answer peers' cross-session messages dividing files — they're precise and reliable.
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
`.zip` archives, never one large end-of-session commit. The board/session-log entry is its own
commit, committed last. As coordinator, actively nudge any lane that stays dirty across multiple
checks — long-lived "mid-rebuild" lanes are the classic forgotten case, and uncommitted work is at
risk of absorption or silent loss.

## The ChatGPT / Codex surface

Coordination covers the GitHub repo surface too:

- ChatGPT/Codex works via **kebab-case topic branches on `origin`**. `git fetch` and check for
  **unmerged** branches — merge or flag them; don't let them drift.
- The user's live chatgpt.com session is read via the user-level `chatgpt` skill's browser route
  (drives the user's real Chrome through the claude-in-chrome tools; needs the Claude-in-Chrome
  extension connected, which is the usual blocker). There's no `OPENAI_API_KEY` on this machine,
  and the API route can't read existing chat history.

## Dev-server / wrangler etiquette

- **Don't start dev servers casually** — they lock `node_modules` and can break a peer's
  concurrent `npm install`/build.
- One shared `wrangler dev` on **8787** is community property (it proxies everyone's vite dev
  server). Ask who owns it before killing/restarting. **Never start a second wrangler against the
  shared `cloudflare/.wrangler/state` dir** — two miniflares on the same Durable-Object SQLite
  files crash each other with `SQLITE_BUSY`. If a session truly needs its own worker, give it its
  own state with `--persist-to <dir>` and shut it down when done.
- Asset diagnosis caveat: `/assets/*` all failing with `net::ERR_FAILED` while `/api/*` works is
  usually a stale service worker (`business-os-app-shell` / `business-os-static` caches) in that
  Browser tab, **not** the server. Unregister the tab's service workers + delete its caches and
  reload before blaming wrangler.
