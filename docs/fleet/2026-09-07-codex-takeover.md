# September 7 Codex takeover

Current request/status index: [owner task register](2026-09-07-owner-task-register.md).

Status: implementation and integration in progress. No deployment or production
mutation has been performed by this takeover.

## Functional release verification, 07:50 UTC

The exact failed stock session was reproduced on the older frozen build and
then retried once on `eb06b80b`: three products with two images each committed
successfully. Each product exists once, each has two correct gallery references,
all six assets return 200, and the library physical file count did not increase
on retry. Offline rejection retained the draft; minimize/reopen/discard passed.
Evidence remains in the private local takeover outputs, outside this public repo.

Sales browser checks passed Records placement inside sale details, return to the
same detail after closing Records, removal of the redundant eye, and the tested
gross 200 / discounts 15 / revenue 185 reconciliation. Structured history values
now have readable product and payment lines. Independent review identified two
remaining history integrity issues: replay audit retention and mutable historical
product labels. Those are assigned and remain release blockers until verified.

Combined application gates at `95657f16`: both package typechecks, bilingual
key verification and frontend build passed; frontend 302/305 suites and Worker
267/271 suites passed. The seven failures are assigned to the owning upload and
permission lanes. The complete 131-file migration chain applies locally with
integrity and foreign-key checks passing. Production still has migrations through
0127; no migration, deployment, secret mutation, historical correction or duplicate
merge has been executed by this takeover. The owner signed into the production
browser for the requested supported duplicate merge after release.

## Additional owner instructions, September 7

Latest priority: functional errors first; broad layout polish waits until after
the next verified release. Sales Records belongs inside expanded sale details,
and must explain product additions/quantity changes, status, payment methods and
amounts, customer delivery fee and actual courier cost with actor/before/after.
The session screenshot proves an upload save failure for a percent-encoded
filename. This is a release blocker: validate upload, draft, session commit,
persisted asset and PWA reconnect together. Offline/update notices need dismissal
without lying about connection state or suppressing failed-save feedback.

Queued layout follow-up: compact start/end dates with all-day 00:00–23:59 default;
place dates beside stats/actions on Dashboard, Sales, Expenses, Returns and
Branches; date/time before IDs; subpage icons; compact report presets; consistent
button heights and compact payment-method action. These are recorded, not done.

The owner requested a network retry and the next verified checkpoint deployment
as soon as ready. This authorizes the next deployment; it does not waive tests,
historical-data evidence, or the outstanding portal privacy repairs. New GitHub
commits must describe individual fixes, rather than checkpoint or unrelated batch
commits. Existing lane histories and original dirty worktrees remain preserved.

- When adding again within the same session, recognize a product by normalized
  barcode **or** name against saved and queued session entries. Show “Duplicate:
  You added this item already.”; show green availability only after a successful
  lookup finds no session duplicate. Preserve explicit quantity-edit workflows.
- Remove the redundant eye button beside Print on sale rows.
- Branch inventory and POS branch options use branch quantities for stock alerts.
  Aggregate POS, Dashboard and public catalogue displays use the Shop + Warehouse
  quantity they show. Changes to alert settings must invalidate relevant results.
- Add a minus/minimize control next to Close on editable add/edit/set/stock/session
  actions; preserve drafts and make Back/discard/restore cooperate. Trace roles and
  permissions across every affected action. Read-only policy dialogs are separate.
- Gross sales, discounts, refunds and net revenue must agree between the chart,
  tooltip and headline stats; the supplied chart showed 190 gross and 185 net.

Assignments: sales owner for the eye button; identity owner for session duplicate
feedback; media owner with independent accounting audit for stock and revenue
semantics; Terra medium explorer for the shared minimize/action scope. Production
health was retried after the owner's network update and still returned HTTP 403
from the direct host path. A subsequent Wrangler retry through the original
repository's existing API-token wrapper succeeded (account identity confirmed).
The expired OAuth fallback is no longer a deployment blocker. The original
checkout's first CLI requests failed on deployment listing, but invoking
the candidate's installed Wrangler through that same auth wrapper succeeded
and confirmed the unchanged production version. Use the candidate CLI and its
lockfile (the installed version is 4.116; package.json allows ^4.112).
Credentials remain in their existing ignored file; none were copied into the
candidate or browser.

Canonical base: `ea9f0d1b7d67891be519fbe74c91a8bdf4102593`, isolated branch
`codex/takeover-20260907`. This contains the prior Codex integration `9ab9fd7a`
and checkpoint 2 `b6a0cff8`; the dirty shared main and original Claude lanes are
preserved. Eight initial specialists returned bounded audits. Seven implementation
owners are handling accounting, sales, identity, media/stock, reports, public portal,
and remaining importer/ledger/date/interaction lanes in separate worktrees.

## Verified observations

- Cloudflare control-plane GET on September 7 confirms active Worker version
  `6c3f9a35-9b38-4f00-bc7d-bae28bb0ef76` at 100%, deployed 01:55:43 UTC.
- Read-only production schema query confirms migrations through `0127`; `0128`
  and `0129` in the base are not applied. Portal `0130` remains a prepared lane.
- All-time read-only census: 15,096 sales, 36,340 lines; 15,066 fully Shop-scoped
  sales, six sales with no relational lines, 23 missing header branches, one
  Warehouse header, two sales with Warehouse lines, one multibranch sale, and
  21 delivery sales without a driver. Walk-in driver absence is expected.
- Exact anomalies include Warehouse sale 16894 (returned), multibranch sale
  16896 (completed), and missing branches in 16842–16863. Corrections require
  movement/return/allocation evidence, not a bare header rewrite.
- Fees: 2,556 delivery and 1,726 expense rows, all without relational sale links;
  2,536 delivery and 1,719 expense rows lack branches. These observations do not
  prove all unlinked rows are automatically sale-derived; manual and historical
  provenance must be distinguished before writing links.
- Exact trimmed-name and leading-zero-normalized nonempty-barcode census:
  2,007 candidate duplicate clusters, 4,034 active non-group products, maximum
  cluster size three. This is a discovery census, not a certified merge manifest.
- Public settings confirm trade name Leang Cosmetics, address 136 St 215,
  Phnom Penh, phone 017 611 168; public email is blank. Legal registration/name,
  licensing, image rights and target-market facts remain unverified.
- Baseline frontend and Cloudflare typechecks pass on the isolated base.
- Baseline native subtotal runtime test passes three actual Miniflare/D1 cases.
- Baseline shift lifecycle script fails to resolve the real shiftReconciliation
  helper; assigned to accounting owner for a correct harness import repair.
- Browser, direct HTTP, and local Wrangler OAuth probes receive Cloudflare 403
  challenges. Connected Cloudflare API read-only calls succeed with zero writes.

## Lane requirements

| Owner | Required outcome |
|---|---|
| accounting | Recognized positive credit, report-only cash counts, valid close, concise Telegram, no double delivery deduction |
| sales | Reopened payment correction, exact Shop enforcement, useful expense sale links, Records with before/after, dual delivery edits, compact actions |
| identity | Compatible identity enforced, global distinct-nonzero mean, maxima, atomic undo/audit, bounded one-confirm merging and scanner parity |
| media/stock | Canonical persisted asset path, reliable stock-session request, accurate library physical totals, paginated/resetting dashboard alerts |
| responsive | Selectable/exportable Shift Report, centered gutters, concise highlighted credit/profit, English receipt table headings |
| portal | Truthful policies and consent, minimal data, controlled third parties, accessible responsive public UI, verified business-fact readiness |
| remainder | Preserve and repair importer, ledger, date, product-row, text-affordance and profit allocation lane behavior |

## Integrated verification checkpoint

All seven implementation lanes are composed in the isolated candidate. Additional
review fixes preserve independent blank shift counts, immutable duplicate-cluster
cost plans across retries, authoritative Shop enforcement in ordinary/imported/
replacement/generated sales, and stale dashboard pagination invalidation.

Independent route testing completed 1,600 duplicate folds in 64 local requests;
the injected partial-failure retry preserves the original 5 USD / 5,000 KHR mean.
Changed source members refuse the retry. Incomplete Undo finalization leaves an
action non-reversible and is reported by the UI. These are local measurements,
not a production performance promise or evidence that production was merged.

The initial combined frontend run passed 264/283 files and the initial Worker
sweep passed 241/259. Findings were assigned and repaired; final pinned sweeps
are still required. The complete 25-case credit/revenue parity test passes.
Both language packs resolve every referenced key at this checkpoint.

Local browser verification uses schema-only copies and synthetic records. No
customer rows or production credentials were copied. All Worker bindings run
locally and Sentry is disabled in an untracked local config. At 375px the portal
heading occupies one 22.5px line, document overflow is zero, 50/15 product paging
works, and initial public loading makes no third-party requests or embeds. The
footer policy reader works; keyboard focus restoration and additional server-side
privacy findings remain assigned to the portal owner before release.

## Not done

The combined candidate still requires final certification, queued import authority
enforcement and the newly reported no-delivery sale correction. Portal privacy
repairs are locally verified. Historical corrections and bulk product changes have not been applied. No guarantee
of legal compliance or immunity from claims is made; policies must reflect actual
operations and applicable law, with missing business facts explicitly recorded.

Detailed read-only evidence is retained in the original workspace under
`outputs/takeover-20260907/`; original worktrees and dirty patches remain untouched.
