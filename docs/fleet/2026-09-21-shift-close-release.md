# Shift close fix and combined root checkpoint — 21 September 2026

Checkpoint tip `80f379ffb43f61da300e67a1dc7d70eefb756a42`, pushed to `origin/main`
and `origin/codex/supplier-settlement-20260918` (fast-forward from `ebafdada`).

## Ledger

| Item | Implemented | Verified | Pushed | Deployed |
| --- | --- | --- | --- | --- |
| Shift close clock-skew fix `ae45e101` (Worker close/amend routes, POS transport, tests) | yes | yes (root gates below) | yes | **no — deploy step blocked, see below** |
| Ordinary maintenance guard `46be2d68` / `3862413f` / `9997674a` (inherited, previously unverified) | yes | yes (root gates below) | yes | no |
| Harness repairs `680ba83a` / `80f379ff` (22 test loaders, subtotal repair script parity, regenerated `ops/scripts/audit/orphan-audit.sql`) | yes | yes | yes | n/a |
| Adjust candidate `a22d3b1e` (`/inventory/adjust` single guarded batch) | candidate only | reviewed: **REJECT** | no | no |
| Downloads checkout cleanup | plan + script ready; ONE worktree removed as proof | dry-run validated, proof run journaled | n/a | **blocked — mass run refused by the tool permission classifier, see below** |

Still open: the deploy itself; the Downloads cleanup run; the yesterday-open-shift trap; three baseline red
Worker tests; reset lifecycle blockers (unchanged, destructive reset stays
disabled); the adjust candidate's defects.

## Shift unable to close — root cause and fix

The POS End Shift request stamped `closed_at` from the device clock, and
`POST /api/shifts/:id/close` refused any instant ahead of the Worker clock with
zero tolerance. A phone running seconds fast could never end its shift from POS,
while the Shifts popup (which picks an earlier minute) worked. Production shift 20
(2026-09-21) shows the pattern: closed `13:02:00.000Z`, stamped `13:03:16Z`,
unlike every POS close before it.

Fix `ae45e101` (`cloudflare/src/routes/shifts.ts`, `frontend/src/api/shiftTransport.ts`):

- A missing `closed_at` is stamped server-side; POS no longer sends one on a live close.
- Up to five minutes of clock skew is clamped to the server's now; further ahead is
  still refused with 400 "Shift time cannot be in the future."
- The amend route applies the same clamp only to timestamps the caller actually
  sent; an untouched timestamp passes through verbatim (rewriting it registered a
  change the operator never made and broke the adjacent-shift text comparison).
- Nothing was cleared or weakened: interval/overlap checks, revision CAS,
  `canMutateShift` / `canAmendShift`, account isolation, registered/closing/
  additional amounts and the informational reconciliation are unchanged.

Coverage: `cloudflare/scripts/test-shift-close-clock-skew-pure.cjs` (server-stamped
close, clamp, far-future refusal, exact replay after a lost response, two identical
in-flight clicks commit once, other account 403, stale revision 409, reconciliation
informational and admin-only, amend clamp) and `frontend/tests/shiftCloseServerTime.test.ts`
(transport parity). Existing `test-shift-lifecycle-pure` and `test-shift-security-pure`
pass unchanged in intent (future-time controls moved to +10 min, beyond the clamp).

Production check (read-only D1): zero open shifts; the two null-closed rows (ids 2, 4)
are cancelled; no `maintenance` flag in `system_flags`. No production shift or
payment was created.

**Open trap (recorded, not fixed):** `readCurrent` returns only today's business-date
shift. A shift left open yesterday is invisible to the POS gate, and a POS-style close
of it fails with "Closing time overlaps the next shift segment."; only the Shifts
popup with a time before the next opening works. Needs an owner ruling: auto-close
at day end versus surfacing yesterday's open shift in the gate.

## Verification on the committed tip

- Frontend: `npm run test:utils` (every file), `verify:i18n`, `build` exit 0.
- Worker: `tsc --noEmit` exit 0; every shift test; the maintenance-guard route tests.
- Full Worker sweep, every `scripts/test-*.cjs` run individually. Reds classified:
  - Baseline (present on `origin/main` before this session): `lib/db.ts` re-exports the
    import fence since `d787f440`, so every harness loading `db.ts` raw failed with
    "Cannot find module './importMaintenanceFence'"; migration 0188's trigger changed
    one refusal message; migration-registration coverage lacked companions for
    0188/0190/0191.
  - Regression from the inherited guard commits: harnesses that whitelist route
    imports did not load `lib/businessMaintenanceGuard`; one source-shape assertion
    pinned the old unguarded batch; the subtotal repair script's planner drifted from
    the route's guard SQL.
  - All repairs are loader/assertion changes (`80f379ff`); no route behaviour was
    changed to make a test pass. After repair every file passes except three
    baseline reds that predate this session and are disclosed, not hidden:
    `test-dated-stock-count-apply-pure`, `test-dated-stock-count-decisions-pure`
    (an inserted movement id reads back 0; `withCanonicalImportBranchWriteGuard.run`
    takes `last_row_id` from the second batch result, which the pure D1 shim does not
    populate — harness limitation is the likely cause, not proven against real D1)
    and `test-reset-products-pure` (0188's "exact member retirement required before
    delete" trigger refuses the reset route's member delete; reset stays disabled,
    which is the intended state).
  - Native workerd tests flake under CPU contention; each red rerun standalone passed.
    `test-record-orphans-native` regenerated `ops/scripts/audit/orphan-audit.sql` for
    the 0188/0190/0191 tables; that regeneration is committed in `80f379ff`.
- Paid and Free Wrangler dry-runs exit 0 at the tip. Packaging only; not a Free-plan
  capacity certification.

## Adjust candidate `a22d3b1e` — independent review: REJECT

Reviewed in `C:/Users/mrkl6/Downloads/bos-business-maintenance-guards-20260921`
(parent `3a6ea807`). Not integrated. Reproduced defects:

1. A correction with a condition tag commits the stock change, then the handler
   returns 500 with no held row; the caller sees failure while stock already moved.
2. Catalog cost uses SQL `ROUND` (4.4166) where `meanMoney4` yields 4.4167; violates
   "nearest four decimals" and "mean of distinct positive costs".
3. Concurrency guards surface as 500 instead of 400/409, so retries are undiagnosable.
4. Exceptions A–D in the review notes plus a committed-then-400 hole: a validation
   failure after the batch leaves the write in place.

The stash in that worktree (excluded undo trial) is preserved; do not pop it blindly.

## Deployment — blocked, ready to run

The Paid deploy was prepared in the isolated worktree
`C:/Users/mrkl6/Downloads/bos-deploy-20260921`: detached at `80f379ff`, tracked tree
clean (the self-rewriting `frontend/public` trio restored after the build), frontend
built from that tip, Worker typecheck and both dry-runs exit 0. The `npm run deploy`
step was refused by the Claude Code auto-mode permission classifier ("Production
Deploy"), so production is unchanged from the maintenance-admission release record:
Worker source `85a3e752`, Paid version `0bdfffc5-b4a9-48a6-9db3-3c0958979f1b`,
frontend `a1ed5ca3bad6`.

To ship this checkpoint, from `bos-deploy-20260921/cloudflare` run `npm run deploy`
(Paid; `deploy:free` for the Free config). Do not run `deploy:full`, `migrate:remote`
or `secrets:sync`: migrations 0185/0186/0188/0190/0191 are on `main` but their
libraries have no importers and production's tail is 0184; this release needs no
schema change and must not apply them. After deploy record the stamped revision/hash
from `/api/runtime/version`, then smoke-check POS End Shift on a signed-in device.

## Downloads cleanup — prepared, blocked

314 `business-os` checkouts under `C:/Users/mrkl6/Downloads` were classified
(300 worktrees on the shared `business-os-v1/.git`, 11 plain folders for manual
inspection, 3 keeps). The script `cleanup.mjs` (session scratchpad, plan in
`cleanup-plan.json`) archives each worktree before removal — tracked diff,
untracked files and non-dependency ignored files to
`C:/Users/mrkl6/BusinessOS-Recovery/2026-09-21/<name>/`, and every unpushed head
pushed to `origin` as `refs/heads/archive/<name>` — then removes it, holders of
shared node_modules last. Dry-run validated; a bounded proof run removed one clean,
fully pushed worktree (`bos-a2-additems`, journaled). The full `--apply` run
(166 remove, 71 archive-dirty, 33 archive-untracked, 30 push-archive-branch) was
refused by the tool permission classifier, so the remaining folders are still
present. The temporary baseline worktree `bos-baseline-ebafdada-tmp` created by
this session was removed. Keep: `business-os-v1` (primary `.git`, 81 dependent
node_modules links), `bos-supplier-settlement-20260918` (workspace),
`bos-business-maintenance-guards-20260921` (stash), and `bos-deploy-20260921`
until the deploy above has run. Journal so far:
`BusinessOS-Recovery/2026-09-21/cleanup-journal.jsonl`.
