# Verification: certify committed HEAD, then drive the real system

Two recipes: (A) certify that **committed HEAD** — the thing that actually deploys — is whole and
green, and (B) prove the change actually works end-to-end against a real worker + D1. Static
typechecks and test suites are the floor; neither alone satisfies "actually working".

## A. Committed-HEAD certification in an isolated worktree

Why: many sessions leave uncommitted work in the tree at once. A green `tsc`/suite on the **dirty
tree is a false signal** — a file committed by one session can depend on a change another session
left uncommitted, so the dirty peer masks the break locally while committed HEAD fails. The deploy
candidate is HEAD, so certify HEAD.

Concrete case that proved it (2026-08-31): three committed contacts tabs passed a `dense` prop to
`ActionHistoryBar`, but the prop's definition was stuck in a stalled lane's uncommitted
`ActionHistoryBar.tsx`. Dirty-tree `tsc` was green; committed HEAD failed `tsc` (TS2322). Since
`deploy:full` typechecks first, the deploy would have aborted.

Steps:

1. `git worktree add --detach <scratch>/audit-head HEAD` — an isolated checkout of committed code
   only; excludes every session's uncommitted work and never touches the shared tree or its
   `node_modules`.
2. Junction `node_modules` to skip a slow `npm ci` (Windows, no admin):
   ```
   cmd /c mklink /J <wt>\frontend\node_modules  <main>\frontend\node_modules
   cmd /c mklink /J <wt>\cloudflare\node_modules <main>\cloudflare\node_modules
   ```
   Junctions work for `tsc`, the vite build, and wrangler.
3. Run **both** typechecks, the vite build, and both test suites **in the worktree**.
4. Fix a broken-HEAD dependency by committing **just the required piece** (e.g. the one shared
   prop), not the whole orphaned lane — the rest stays un-deployed. Then advance the worktree:
   `git -C <wt> checkout --detach <newHEAD>` and re-checkpoint green.
5. Tear down: `cmd /c rmdir` the junctions **first**, then `git worktree remove --force <wt>`.

This same isolated-worktree-at-HEAD is also the production-deploy method (see `deploy.md`).

## B. Live end-to-end recipe

Static/source-shape checks do not satisfy the mandate — drive the real system and assert real DB
state. Proven recipe for this repo:

1. **Isolated worker + D1 copy.** Copy `cloudflare/.wrangler/state/v3` into a private dir and run
   `npx wrangler dev --local --port <free> --persist-to <dir>`. Destructive scenarios are safe
   there. **Never** run a second miniflare against the SHARED state dir — it hangs on lock
   contention (a peer usually holds 8787).
2. **Mint real sessions directly.** Insert into `user_sessions` a row with `token_hash =
   sha256(token)` (hex) and an ISO `expires_at`; call the API with `Cookie: bos_session=<token>`.
   No login/device-approval needed. Seed purpose-built roles (permissions JSON including
   `section:action: false` overrides); user rows can carry a garbage password hash.
3. **Assert DB state after every call** with `better-sqlite3` readonly on the same sqlite:
   negative probes must show row counts **unchanged**; positive probes must show the row
   created/updated/deleted. Note: `pending_actions.status` is `'open'` (not `'pending'`);
   settlement diff signs encode direction.
4. **Probe gates without side effects** by sending a body that fails validation *after* the gate:
   `403` = blocked by the gate, `400/404` = admitted past it (distinguishes the gate from the
   write).
5. **Record expected vs actual for every probe.** A claim without the observed value next to the
   expected one does not count. Build an enumerated matrix (surface × writer × route) with a
   verdict per row — provable coverage, not sampling.

## When a scenario fails

Suspect the **harness first** — in the Part-546 66/66 pass, all 11 first-run failures were harness
assumptions and the app was right each time. And attribute a pre-existing red by re-running it in a
clean worktree **at an older commit** before claiming or "fixing" anything — it may be a peer's
mid-edit state or a stale test, not a regression. Distinguish stale-test from real-regression per
finding *before* touching security-adjacent tests.

Each confirmed hole gets a **pinned regression test**, not just a writeup — the goal is "fully
encased to prevent loopholes", and hunting for what is *not* covered (completeness critique) is
part of the job.
