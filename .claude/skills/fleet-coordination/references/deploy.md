# Staged production deploy

Deploys are real, irreversible, outward-facing events: they push the live Cloudflare Worker and
can apply migrations to the **remote production D1**. Confirm scope before running, verify against
current source rather than these notes, and only ever have **one driver** at a time.

Live domain: **leangbeauty.com** / **admin.leangbeauty.com** (rebranded from LeangCosmetics; old
`*.leangcosmetics.dpdns.org` routes are kept during transition but are **not** the health-check
target).

## Stage gating

- **Stage 1 — reconcile + audit, no deploy.** Reconcile every lane, certify committed HEAD green
  through verification layers 1–4 (`verification.md`), root-cause each red as stale-test vs real
  regression. Stage 1 continues until the user explicitly says **"go for Stage 2"**.
- **Stage 2 — deploy, user-gated.** Only on the user's go. Deploys are **batched by stage** — many
  committed changes ship together at the stage boundary; never deploy per commit.
- A second coordinator claiming the driver role, or a disputed severity behind a "we must deploy
  now" push, is a **stop-and-ask**, not a proceed. Hold all deploy/migrate, surface it to the user,
  and re-verify the premise from committed code first.

## The pipeline

`npm run deploy:full` runs, in order: `typecheck` → `build:frontend` → `migrate:remote` (remote D1
`business-os`) → `migrate:import:remote` (second remote D1 `business-os-import`) → `secrets:sync`
(pushes `cloudflare/.dev.vars` to Cloudflare) → `deploy` (wrangler) → poll live `/health`. It
authenticates non-interactively from `cloudflare/.wrangler-auth.local` (+ `.dev.vars`), which are
gitignored local files.

**Do not run `run/full-automation.bat` as-is in this shared checkout** — its `npm ci` deletes
`node_modules` wholesale and kills every peer's dev server mid-build, and a working-tree deploy
would ship uncommitted peer code to production unreviewed.

## Deploy from committed HEAD via an isolated worktree (the chosen method)

1. `git worktree add --detach <path> HEAD` — committed code only; excludes every session's
   uncommitted work, never touches the shared tree or `node_modules`.
2. Copy the gitignored `cloudflare/.wrangler-auth.local` and `cloudflare/.dev.vars` into the
   worktree (they aren't in the checkout and the deploy needs them).
3. `npm ci` in the worktree (isolated — safe, no dev-server EPERM), then a typecheck+build
   **checkpoint before** the irreversible `migrate:remote`/`deploy`.
4. If a critical fix lands mid-deploy, `git -C <worktree> checkout --detach <newHEAD>` to advance
   to a HEAD that includes it.
5. Run the pipeline (`deploy:full`, or the steps manually) → poll `/health` → then
   `git worktree remove --force <path>` (which also clears the copied secret files).

Coordinate by message: tell peers a deploy is happening but that an **isolated-worktree deploy does
not require them to pause** (their local envs are untouched); ask only that nobody else run
`migrate:remote` / `wrangler deploy` concurrently.

## Post-deploy live verification

A deploy ships the **entire committed HEAD** — every committed lane's work, not just your fixes.
Verify the live result, don't assume it:

- Poll `/health` for `status: ok`.
- Confirm the live **Worker version id** matches the deploy you just ran.
- Run the post-deploy regression checks (e.g. the leak-seal / permission-gate probes) against the
  live surface.
- Record the deployed **commit hash** and **live version** to the board + a session-log Part entry
  as *reference-to-verify* — so the next session re-checks against the git artifacts rather than
  trusting the writeup. State the highest applied migration explicitly (a claim that "migration
  00NN is live" must be checked against what's actually in HEAD, not asserted).
