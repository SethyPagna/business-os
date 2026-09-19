# GitHub, deployed and local comparison — September 19, 2026

## Scope and evidence

Read-only comparison for the owner's retention/publication decision. No deployment,
production data change, merge, push or further folder deletion in this comparison.
Fresh origin fetch succeeded. Local source: `cacb95e107d4`.

| Version | Source | Meaning |
|---|---|---|
| GitHub main | `ae0f517a9e40` | September 17; not the latest application source |
| Newest integration branch | `origin/integrate/p10`, `80034a08` | September 18; contains Program 11 |
| Last recorded live source | `de8c72fa9514` | Worker `9d5b1644-9f8f-4826-b6f7-043ddd5cf6c2`; migration tail 0183 |
| Local continuation | `cacb95e107d4` | Includes live source, one later runtime fix, tests/audits/recovery tooling |

Today's direct production `/api/runtime/version` request returned HTTP 403.
Therefore live provenance above is recorded evidence, not a fresh live confirmation.
GitHub main and local diverge (70 main-only / 92 local-only commits). The main-side
net change from their merge base affects 11 documentation/evidence files; preserve
these when integrating. Do not reset one side over the other.

## What GitHub is missing

These groups are absent from main but already in `origin/integrate/p10` and the
recorded deployment: membership/loyalty corrections; honest unknown lot balances;
stock-in payment review and contact invoice tables; all-time contact purchases;
delivery payer corrections; stale asset/shell recovery; receivable matching and
multiplied-paid correction (0181/0182); dashboard snapshot/charts/View more; Program
11 storefront/mobile improvements. Main being stale does not mean these are absent
from the running app.

The following are absent from **every origin branch** inspected, but are included
in the recorded deployed source:

| Change | Commits |
|---|---|
| Four confirmed supplier balances totaling $489 corrected; migration already applied, do not replay | `ae75fbad`, migration 0183 |
| Product-session payment terms, credit due-date validation and retained-lot explanation | `8f2685b1`, `f5301eb2`, `f7bdc71f` |
| Searchable supplier/category/unit/dated-count product selectors | `6da9d128` |
| Required public startup JS/CSS cached before offline service-worker activation | `96cdcb6b` |
| Storage access guards, signed-out shell recovery, blocked-storage guidance, early auth rejection handling | `b73788b4`, `ae40b86e`, `25e8e09f`, `de8c72fa` |

There are 28 local commits unreachable from any origin ref, not 28 missing features.
Many are tests, status, audits and recovery tooling.

## What local adds beyond recorded deployment

Exactly one application runtime file differs: `frontend/src/platform/runtime/clientRuntime.ts`.
Commit `0e1b7407` clears legacy account-specific POS search/category/brand/branch/
stock/group/supplier/initial keys, old POS order/active/counter keys, and nonempty
`bos_dashboard_filters:` keys during runtime reset. `45a0831b` adds browser regressions.
Deployment of this fix is not confirmed. This does **not** claim unresolved logout,
stale reads or offline queue account ownership are fixed.

All other post-deployment differences are tests, documentation, audit findings and
cleanup/recovery scripts/evidence, not application features.

## Local preview

`http://127.0.0.1:4319/` serves the existing frontend build using the repository's
synthetic E2E fixture backend. Listener is explicitly restricted to loopback.
No production API proxy, production database or real credentials are used.
Demo account: `admin`, any nonempty dummy password. Unknown fixture APIs return 404;
this is a UI demonstration, not full backend certification.

Observed browser result: login succeeded and `/pos` rendered synthetic product
cards, prices, stock and pagination. Left this page open for the owner. Dashboard
first reported an earlier-account read rejection; Refresh then reported missing
fixture route. Its newer summary endpoint is unsupported by this test backend.
Do not describe the dashboard preview as passing or infer a production outage.

Build metadata says `45a0831b9741`; tracked frontend/build-script source is unchanged
between that revision and `cacb95e107d4`. It is source-equivalent, not newly built.
Avoid ordinary localhost:5173/5174 development defaults: those can select the
production API. External links in demo content can leave the preview.

## Decision recommendation

Preserve and publish the deployed-but-unpushed work; integrate main's documentation
without discarding it. Keep the account-cache fix separately identifiable until its
release is verified. Retain one final `business-os-v1` working folder only after
unique dirty files/local data in other checkouts have verified recovery copies.
GitHub preserves commits, not uncommitted work, local databases or credentials.

Open audit issues (account-owned offline work, logout/stale-read behavior, inline
queue concurrency, transfer query budgets and Free-tier capacity) are not fixed
merely by choosing any of these versions. See the device-tier and maintainability
audits. This comparison is not an all-tasks-complete certificate.
