# Shift close fix and combined root checkpoint — 21 September 2026

Checkpoint tip `80f379ffb43f61da300e67a1dc7d70eefb756a42`, pushed to `origin/main`
and `origin/codex/supplier-settlement-20260918` (fast-forward from `ebafdada`).

## Ledger

| Item | Implemented | Verified | Pushed | Deployed |
| --- | --- | --- | --- | --- |
| Shift close clock-skew fix `ae45e101` (Worker close/amend routes, POS transport, tests) | yes | yes (root gates below) | yes | **yes — ce056cc0, see below** |
| Ordinary maintenance guard `46be2d68` / `3862413f` / `9997674a` (inherited, previously unverified) | yes | yes (root gates below) | yes | yes |
| Harness repairs `680ba83a` / `80f379ff` (22 test loaders, subtotal repair script parity, regenerated `ops/scripts/audit/orphan-audit.sql`) | yes | yes | yes | n/a |
| Adjust candidate `a22d3b1e` (`/inventory/adjust` single guarded batch) | candidate only | reviewed: **REJECT** | no | no |
| Downloads checkout cleanup | 300 worktrees archived then removed; 11 plain folders + 6 loose files moved to the recovery archive | journal reconciled against disk | archive branches pushed for every unpushed head | n/a |

Still open: the yesterday-open-shift trap; three baseline red
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

## AI Council and debloat gates (simulated: one model, five labelled perspectives)

Disclosed per AGENTS.md: a single model simulated the five perspectives and the
cross-critique; this is not five independent reviewers.

- **Contrarian Skeptic:** the five-minute clamp hides how far a device clock drifts;
  a badly drifting phone now closes successfully with a server-stamped time and
  nobody is told. Plausible, low loss: the stored time is the truer one. Real
  remaining failure: a shift left open yesterday still cannot be closed from POS.
- **First-Principles Engineer:** invariant is "stored shift times never exceed the
  server clock"; the server is the only time authority. The tolerance is the same
  window offline sale timestamps get, so it should be one constant, not two.
- **Expansionist (aspirational):** return the measured skew so the POS can warn the
  operator; auto-close or surface stale open shifts at business-day rollover.
- **Outsider:** why did a live close send a client time at all? It no longer does.
  Missing context: no rule yet for shifts spanning the day boundary.
- **Executor:** one POS End Shift on a real device on the deployed build; success is
  the shift closing with a server-stamped time within seconds of the tap.
- **Cross-critique:** the Skeptic's silent-clamp point stands but does not block;
  the Engineer's shared-constant point was acted on (below). The Expansionist's
  skew warning is deferred; nobody defended keeping two constants.
- **Chairman:** decision within the hour: ship (done, `80f379ff`). Biggest risk:
  the yesterday-open-shift trap, needs an owner ruling. Number-one next step: the
  owner's signed-in End Shift smoke on the live build.

Dead-code / debloat inspection of the touched surfaces: `withinServerClock` had
redefined the five-minute tolerance that `lib/clientTimestamp` already exports;
follow-up commit `be19267a` makes the shifts route import that constant (one
window for "device clock skew" system-wide) while keeping its own clamp semantics,
because sale timestamps fall back to the server clock rather than clamp. No new
unused export, helper or listener was added; the harness edits are import
mappings only. Reset, permission and financial rules untouched. That refactor is
behaviour-identical to the deployed `80f379ff` and ships with the next checkpoint.

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

## Deployment — DONE (Paid), 21 September 2026 14:39Z

Deployed from the isolated worktree `C:/Users/mrkl6/Downloads/bos-deploy-20260921`
(detached at `80f379ff`, tracked tree clean, frontend built from that tip, Worker
typecheck and Paid/Free dry-runs exit 0) with `npm run deploy` (wrangler.toml, Paid),
after the owner granted permission in chat; the first two attempts were refused by
the auto-mode permission classifier. No `deploy:full`, `migrate:remote` or
`secrets:sync`; migrations 0185/0186/0188/0190/0191 remain unapplied by design.

- Source: `80f379ffb43f61da300e67a1dc7d70eefb756a42`.
- Worker version: `ce056cc0-ceba-44b0-b42c-177c7aa41247`; live
  `/api/runtime/version`: revision `80f379ffb43f`, hash `670972707d43682e`,
  built `2026-09-21T14:39:47.302Z`, tier `paid`. Startup 22 ms; exit 0.
- Frontend: `business-os-build.json` revision `80f379ffb43f`, hash
  `42f5adb0b7dbd0ce`, built `2026-09-21T14:19:10.501Z`; entry
  `index-BVUic7Xo.js`. 208 assets uploaded (113 already present).
- Live smoke (browser pane, signed out): admin shell renders the login screen and
  loads `index-BVUic7Xo.js` / `index-DYvo3wTI.css` with 200; the only console
  error is the expected 401 session probe. Public storefront renders About/contact.
  No sign-in was performed and no transaction touched; a signed-in POS End Shift
  smoke on a real device is the owner's remaining check.
- Previous production: `85a3e752` / `0bdfffc5-b4a9-48a6-9db3-3c0958979f1b`.

## Downloads cleanup — DONE

314 `business-os` checkouts under `C:/Users/mrkl6/Downloads` were classified: 300
worktrees on the shared `business-os-v1/.git` to remove, 11 plain (non-git) folders,
3 keeps. After the owner's permission, `cleanup.mjs --apply` (plan in the session
scratchpad) archived every worktree before removing it: tracked diff, untracked
files and non-dependency ignored files to
`C:/Users/mrkl6/BusinessOS-Recovery/2026-09-21/<name>/`, and every head absent from
`origin` pushed as `refs/heads/archive/<name>` first. Two apply runs overlapped
(the first blocked attempt was executed once permission arrived, alongside a second
start); the duplicate was stopped and the journal reconciled: all 300 worktrees are
removed with archive evidence (293 clean, 7 left empty directory shells from the
race that were then deleted). The 11 plain folders (review snapshots, QA tooling,
an unpushed-lanes bundle, a pre-ChatGPT source copy) and 6 loose zips/logs were
moved, not deleted, into `BusinessOS-Recovery/2026-09-21/plain/` and `loose/`.
The temporary `bos-baseline-ebafdada-tmp` and `bos-deploy-20260921` worktrees
were removed after the deploy. Downloads now holds exactly three checkouts:
`business-os-v1` (primary `.git`, still backs 98 worktrees under `.codex`,
`.claude` and Temp), `bos-supplier-settlement-20260918` (workspace; its dangling
`cloudflare/node_modules` junction was repointed at the primary's real install,
typecheck green) and `bos-business-maintenance-guards-20260921` (rejected
candidate, stash preserved). Journal:
`BusinessOS-Recovery/2026-09-21/cleanup-journal.jsonl`.
