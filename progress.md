# progress.md — Business OS live ledger

*Lean board, reorganised 27 Oct 2026 (6.0.998), reconciled 28 Oct (6.0.1009), owner review scope updated 28 Oct (6.0.1010). Read it every session; the detail lives in the linked files. All 212 queue IDs remain open under their recorded states. Never put customer names, phone numbers or other personal data in this file or any tracked file.*

**Contents:** [Status](#status-snapshot--28-oct-2026-cambodia-utc7) · [Lanes](#current-status) · [Release process](#release-process) · [Owner questions](#open-owner-questions) · [Golden Rules](#golden-rules) · [Queue](#queue) — elsewhere: [owner decisions](docs/owner-decisions.md) · [queue details](docs/queue-details.md) · [releases, holds, history](docs/history/releases.md) · [session log](docs/history/session-log.md)

Ending a session: update Status snapshot and the queue here, reserve versions in `Records/Recovery/COMMIT-VERSIONS.json`, and write narrative to `docs/history/session-log.md`. Never put customer names, phone numbers or other personal data in this file or any tracked file: those belong in the private local Records only.

## Status snapshot — 28 Oct 2026 (Cambodia, UTC+7)

- **Last verified deployment:** RC3 `a9ba6f20a3cc36b45466c079db3fd9c545234c02`, Paid, [run 40528438213](https://github.com/SethyPagna/business-os/actions/runs/40528438213), published 27 Oct 17:21:59Z = **28 Oct 00:21 Cambodia / 01:21 Hong Kong**. It contains 6.0.988, 6.0.992 (+990), 6.0.994 and the restore deletion/maintenance fixes, on deployed RC2b. It does **not** contain 982, 997, 999, 1000 or the performance lanes.
- **Release evidence and limits:** that deployment's sweep passed Worker 1084/1084 and frontend 985/985. Cloudflare API identity matched Worker `cf59f491-f154-4547-bcf9-2b51470f8aaf`; eight business-table counts matched. Site, `/health` and admin HTTP checks met bot challenges. Deployment/API and count postflight passed; a full semantic health pack and device acceptance are **not certified by this evidence**. Reconcile the actual Cambodia publish date before counting release slots.
- **Git state:** remote main last freshly fetched is `1e38ae527`; main alone is not deployment evidence. Local integration includes deployed RC3, backend 1004 `1df07bfbd` and receipt-reader fix `338c03529`. The 1004 composition passed 27 focused/composition checks and package checks; the reader passed native recovery, atomic/pricing neighbors, fast checks and independent source review. Full release certification remains pending. Original dirty worktrees and the separate legacy repository remain preserved.
- **Current focus (latest owner correction, 6.0.1011):** fixes first, one bounded slice at a time; do not edit unrelated parts. The 1004 local checkpoint and large-receipt reader repair are integrated locally. Complete the held size-admission follow-up, then backend 1001 reads and reviewed reliability composition. Preserve the preferred POS interaction and accepted main Dashboard layout. Design/refinement and further prototype work wait until functional fixes are finished and go last.
- **Prototype status:** Stats v1 and the large-sale safety prototype are preserved, **unapproved and unapplied**, with further design work deferred. Stats fixture checks remain isolated prototype evidence, not owner approval or application verification. The large-sale defect remains open and its backend fix must preserve the preferred POS interaction. Sales, Products/Branch subpages, Inventory, Contacts and Stats design reviews remain queued for the final design phase; no UI change is approved by this correction.
- **Free deadline and backup:** the owner switches to Free on **30 Oct, no extension**; the reduced-read build must be live by Cambodia 29 Oct. Keep Free/Paid configurations, local testing and separate deployment approval. External encrypted backups on Free are selected; workflow/recovery verification and changed in-app guidance remain open. 1004's bounded checks do not certify CPU, daily quotas or whole-app Free readiness.
- **Migrations:** release evidence confirms 0272 from RC2b and 0273 from RC3. 0274 remains held for the unapproved customers index; 997 S2's 0275 is not deployed. Never apply a migration from a lane's existence alone.

## Current status

States distinguish local implementation, bounded review, integrated verification and deployment. Earlier live lanes are in the [release history](docs/history/releases.md); the newer RC3 evidence is recorded above. A deployed subpart does not close a compound queue item.

| version | lane | state | branch / sha | blocker |
| --- | --- | --- | --- | --- |
| RC2b / RC3 | deployed release line, migrations 0272 / 0273 | deployed, qualified postflight | `a8dbbe1fc` / `a9ba6f20a` | HTTP/semantic health and device acceptance remain separate |
| 6.0.982 | sale payments S4: checkout/settle payment events, instalments | review; not deployed | `claude/pay-s4-20261026` @ `dff9f02d7` | exact-tip review/gates and composition; later payment slices remain open |
| 6.0.988 | Conflicts lists unknown-cost and empty-barcode products (0273) | deployed in RC3 | `29428256b` | cost-reader sweep and unanswered mark questions remain open |
| 6.0.992 (+990) | locked old returns: managers update money details; paged Sales | deployed in RC3 | `a06239cb6` | current-format editing and residual obligations remain separate |
| 6.0.994 | RC2 P3 follow-ups | deployed in RC3 | `54a2b03fa` | number-probe headroom and deferred P3s remain open |
| 6.0.996 | RC3 dry-run compose (read-only) | historical rehearsal | `7d06eeff4`, not pushed | actual release is RC3 above; rehearsal is not release evidence |
| 6.0.997 | hand-edit current-format returns | S1/S2 committed; not deployed | S1 `eb64ca1de`; S2 `e54d42ab7` | Q1–Q4 answered; S3/S4, integration, prototypes and acceptance remain pending |
| 6.0.998 | lean task board | merged into remote main | `82be2aefa` | stale status/decisions reconciled by 1009; all 212 obligations retained |
| 6.0.999 | return edit Undo/Redo keeps damaged handling and notes | review; not deployed | `dd882ebbd` | exact-tip/composition verification and old-client admission ruling |
| 6.0.1000 | bootstrap settings visibility | reviewed with notes; not deployed | `9a3e0394b` | gate recorded green; integrate and verify on the release candidate |
| 6.0.1001 | Dashboard/Sales Worker reads | preserved unfinished work; not certified | `claude/perf-reads-20261027` | row consumption, oversized results, parity and Free/Paid certification |
| 6.0.1002 | transport coalescing and read recovery | earlier tip READY-WITH-NOTES; delta pending | `1893baf98` | recheck latest delta, account boundaries and composition |
| 6.0.1003 | Dashboard/Sales screens and bell | **NOT READY; prototype approval pending** | `9ff25546a` | IME search, prefetch cancellation, stale explicit refresh, actor isolation and refresh starvation |
| 6.0.1004 | physical D1-call accounting and staging cleanup | locally verified; full release gate pending | lane `1df07bfbd`, integration `cc02e34a1` | not deployed or full-release/Free-readiness certified |
| 6.0.1005 | middleware reads and counts-only bell | READY-WITH-NOTES; not deployed | `f5b3629c3` | index-presence preflight, latest delta and integration verification |
| 6.0.1006 | whole-hundreds riel cash | committed; not deployed | `cab83488f` | owner residuals, review, 982 dependency and visible prototype approval |
| 6.0.1007 | Telegram received by actual payment day | committed; not deployed | `aa522b9dd` | payment-event dependencies, review and composition |
| 6.0.1008 | Free-budget operations; large-sale failure | committed; release blockers remain | `a7a5412a0` | large-sale defect open; safety prototype unapproved; preserve POS interaction; CPU and independent verification pending |
| 6.0.1009 | takeover board, decisions and queue reconciliation | local documentation checkpoint | this three-document change | no queue closures; app verification belongs to 1004 |
| 6.0.1012 | large-receipt recovery and size admission | reader integrated locally; admission draft held | reader `338c03529`; isolated draft `b9ba17576` | complete-row/delivery-path coverage and browser prerequisite remain open; no deployment or UI adoption |
| analysis | app-wide page/function/float analysis (8 read-only areas) | complete code analysis; design approval pending | private analysis evidence | Stats v1 fixture browser-checked, owner approval pending; Sales, Products/Branch subpages, Inventory and Contacts reviews queued |
| 6.0.969, 980–981 | multi-client line: merge main in; first admin and client secrets at deploy | in progress | `claude/mc-merge-20261023`, `claude/first-admin-at-deploy-20261025` | branch only; 980–981 not pushed |

## Release process

- Every candidate: exact-SHA full GitHub gate, independent review, threat review and secrets scan, `deploy.yml` with the explicitly selected Free/Paid plan, matching runtime-tier verification, independent postflight and health pack; never infer that main is deployed. Implementation approval is not production-deployment or migration approval. Follow the [deploy-provenance skill](.claude/skills/deploy-provenance/SKILL.md) before any deploy.
- At most two deploys per Cambodia date (07:00, and one after 20:00 with fresh `open_today=0`); since 22 Oct a daytime deploy is allowed once work is finished, gated and reviewed.
- Remote D1 only through the ops workflows; never wrangler `--remote` or a D1 connector from an agent. Migrations are append-only, LF-only, with pre/post assertions; a new number must clear `d1_migrations` and every ref.
- Versions are reserved in `Records/Recovery/COMMIT-VERSIONS.json`; titles are `n.n.n — concise description`; never rewrite pushed history.
- Holds (held migrations, never rerun the cutover, data repairs only with owner approval) and the full process text: [docs/history/releases.md](docs/history/releases.md#holds-and-production-only-actions).

## Open owner questions

Newest first. **Owner decisions:** every ruling, newest first, is in [docs/owner-decisions.md](docs/owner-decisions.md); read it before planning, never re-ask a settled question, and move answers there.

**Settled 27 Oct:** 997 Q1–Q4 are in [owner decisions](docs/owner-decisions.md): correction defaults to today's drawer with an explicit original-day typo choice; no return date edits; refund follows items; old cancels count today as a separate lane. Implementation remains pending. The remaining question numbers below retain their earlier identities.

5. **Approving a rename (6.0.985):** should the other queued changes (price, image, cost) apply too when the admin may make them? Should Undo give the retired product its old name and barcode back?
6. **Password again (6.0.986):** should other money-changing settings also ask for the password, like replacing a payment method?
7. **Returns export (6.0.989):** are 20,000 returns per export, one year, 250 rows per page on Free right? Accept that old returns cannot detect a later whole-sale discount? Keep refusing restores after an item is added to a discounted sale? Review-tier staff cannot export returns: confirm.
8. **Conflict marks (6.0.988):** keep "$0 is real" and "no barcode is correct" marks forever in the audit log? List word barcodes like "N/A" too? Add a list of marks to un-mark?
9. **Customers index (6.0.983):** may the customers list get a new index (migration 0274) to cut reads?
10. **Cancelled sales:** statuses are only Completed and Not Paid (20 Oct); lanes keep Cancelled as it was. Confirm.
11. **Older questions (BC §4, non-blocking unless noted).** BC-Q2, Q3/Q4, Q7, Q10 and Q11 were answered 13 Oct and Q5 by the "replacements use the ORIGINAL sale FX" ruling; the rest are listed in [queue details](docs/queue-details.md#older-owner-questions-bc-4).

## Golden Rules

*Permanent. Read every session. Never traded against each other.*

- **Priority order when writing or editing any code, frontend or
  backend, in this order and never traded against each other**:
  1. **Correctness** — every edge case is actually handled and the code
     runs without errors; a write either fully succeeds or fully fails
     and is reported as such (no silent partial writes, no swallowed
     errors, no fake/optimistic success toasts ahead of a confirmed
     response).
  2. **Readability** — another engineer (including a future session of
     this same assistant) understands what the code is doing and why in
     under 10 seconds, without having to trace call sites.
  3. **Maintainability** — changing one feature later is a localized
     change and does not silently break an unrelated page/consumer (this
     is the same "find every reader/writer first" method Tracks A/F use,
     applied while writing code, not just while auditing it).
  4. **Brevity** — the fewest lines that don't compromise the three
     rules above; never the first thing optimized for.
- **The Goldilocks calibration for how much code to write**: too long
  is repetitive/copy-pasted boilerplate that hides the actual business
  logic (the fix is to extract the shared part, as `renderFilterFields()`
  did for the portal filter rail); too short is a clever/cryptic one-liner
  that costs the reader more time to decode than a plain version would
  have taken to write; just right is idiomatic code with self-documenting
  names and clear step-by-step logic — boring on purpose.
- **No shortcuts on writes/mutations, either side of the stack**:
  backend routes don't return a success response before a D1 write is
  actually committed; frontend code doesn't optimistically mark an action
  done before the network response confirms it; a partial failure in a
  multi-step operation (bulk action, import, transfer, backup/restore) is
  surfaced as partial, not swallowed into an overall "success."
- **Diff before trusting an uploaded update package.** Every
  `update_code` merge in this project's history that skipped a real
  content diff against the destination file (matching by content, not
  just filename) shipped a real bug at least once (Part 273's
  content-vs-filename misroute, Part 240's missing-file broken import).
  Always diff every incoming file against its actual destination before
  copying it in, and never assume a same-named file in an update package
  targets the same-named file at the obvious path — confirm via imports/
  relative-path depth like Part 273's `ProductDetailModal.tsx` case.
- **Verify for real, every session, both packages, before claiming
  anything works.** `tsc --noEmit` in both `frontend/` and `cloudflare/`,
  every relevant frontend test file run individually (not just the
  chained `npm run test:utils`, which stops at the first failure and
  hides everything after it — including the one pre-existing, unrelated
  `assetCompression.test.ts` icon-budget failure that should NOT block
  the other 96), every backend `test-*.cjs` script, and a real `vite
  build` (not just a type-check) — a clean typecheck alone is not proof
  the app builds or runs. Report exactly what ran and what its real
  result was; never say "should work" or "this looks right" in place of
  an actual run.
- **No zombie/orphaned code.** A new symbol, file, or component that
  nothing imports, an old one nothing calls anymore, or a duplicate
  parallel implementation of something that already exists elsewhere
  (the same class of bug as Part 251's `BulkAddStockModal` running its
  own smaller copy of `BranchStockAdjuster`'s Add/Remove/Set UI) gets
  found and either wired in or removed in the same session it's noticed
  — not left for a future session to rediscover.
- **Scope discipline: build what's confirmed, flag what's guessed.**
  When a request spans multiple files/surfaces and the exact intended
  behavior isn't fully determinable from what's already in source (an
  ambiguous ask, a missing screenshot, a design decision with more than
  one reasonable shape), write the concrete finding/design option into
  progress.md and flag it back rather than guessing and shipping the
  wrong thing — matches this project's established pattern (Part 271's
  import-mode question, Part 276's unidentified items 8/5/4).

## Queue

One line per open item: `Q### [area] title — state — details`. **owner-decided** = the owner has ruled on what to build; **needs owner** = at least one part waits on an owner answer, action, data approval or device check; **ready** = workable without owner input (not a claim that it is done). Full text, evidence pointers and 27 Oct notes are in [docs/queue-details.md](docs/queue-details.md); done or superseded items move to the session log.

### Sales & money
- Q001 [sales] Paid basket growth (CONSOL-F): added items on a paid sale; S4 is 6.0.982 — owner-decided — [details](docs/queue-details.md#q001)
- Q002 [sales] POS: payment method on completing unpaid, receipt times, unit price, AR panel — needs owner — [details](docs/queue-details.md#q002)
- Q003 [sales] Sales timestamps, POS print queue, admin crash recovery, precision-review key — needs owner — [details](docs/queue-details.md#q003)
- Q004 [sales] Show-all paging, revenue allocation, pricing/sale-return kernels, tax on added line — needs owner — [details](docs/queue-details.md#q004)
- Q005 [sales] Verify S4R4/S4R5 legacy sale-detail items closed by the 10–11 Sep releases — ready — [details](docs/queue-details.md#q005)
- Q006 [sales] Loyalty redeem step, forward-only rates with a test and editor note — needs owner — [details](docs/queue-details.md#q006)
- Q007 [sales] Courier cost on receipts, delivery-fee authority, delivery reports — needs owner — [details](docs/queue-details.md#q007)
- Q008 [sales] Data forensics: riel-twin refunds, inflated lots, fake undo, header-only sales — needs owner — [details](docs/queue-details.md#q008)
- Q009 [sales] Data forensics: driver links, settlement repairs, identity census, N45–N54 — needs owner — [details](docs/queue-details.md#q009)
- Q010 [sales] BH-1 bug hunt fix lanes (27 Sep) — ready — [details](docs/queue-details.md#q010)
- Q011 [sales] Status-update actor (S4-11b), cancelled receipts in /report, 0115 window check — ready — [details](docs/queue-details.md#q011)
- Q012 [sales] money-surfaces-r2 leftovers: courier on /records, rounding on cards, $0.00 strip — ready — [details](docs/queue-details.md#q012)
- Q013 [sales] Report Center breadth, two-version reports, 5xx edge message — ready — [details](docs/queue-details.md#q013)
- Q014 [sales] Discount report port, export options, UTC export filenames — needs owner — [details](docs/queue-details.md#q014)
- Q015 [sales] Receipt paper sizes on a real printer, print/reprint scroll — needs owner — [details](docs/queue-details.md#q015)
- Q016 [sales] Statement exports, date semantics, Sep 3 sale-detail asks (KHR toggle) — needs owner — [details](docs/queue-details.md#q016)
- Q017 [sales] Receipt KHR defaults: owner toggles or approves a one-time normalisation — needs owner — [details](docs/queue-details.md#q017)
- Q018 [sales] 22 zero-subtotal legacy sales repair (staged, not run); delivery fields UI — needs owner — [details](docs/queue-details.md#q018)
- Q019 [sales] P581 leftovers incl. user-gated production forward fixes — needs owner — [details](docs/queue-details.md#q019)
- Q020 [sales] Revenue definition drift: compat.ts copies and Dashboard tiles — ready — [details](docs/queue-details.md#q020)
- Q021 [sales] Sale payments S5–S8 and the five flagged old short sales — owner-decided — [details](docs/queue-details.md#q021)
- Q022 [sales] 6.0.982 P3 follow-ups: credit-only sale in linked rename; count tests — ready — [details](docs/queue-details.md#q022)
- Q023 [sales] Normalise past sale statuses to Completed / Not Paid plus tags — owner-decided — [details](docs/queue-details.md#q023)
- Q024 [sales] Exchange replacement loyalty follows the switch; SELECT-only postflight audits — ready — [details](docs/queue-details.md#q024)
### Stock & products
- Q025 [stock] Unknown cost and empty barcode in Conflicts; sweep every cost reader (6.0.988) — owner-decided — [details](docs/queue-details.md#q025)
- Q026 [stock] Import approve ~2,170 statements vs Paid 1,000 limit: verify before large imports — ready — [details](docs/queue-details.md#q026)
- Q027 [stock] 150-row CSV Add makes a 301-statement batch: fold into the import lane — ready — [details](docs/queue-details.md#q027)
- Q028 [stock] Multilot deploy-window revert and the 0250 runbook gaps — ready — [details](docs/queue-details.md#q028)
- Q029 [stock] Release-2 follow-ups: multilot revert lots, import-returns, ui-polish-r2 — ready — [details](docs/queue-details.md#q029)
- Q030 [stock] Return restock raises received_quantity; stock_revert audit order (N5) — ready — [details](docs/queue-details.md#q030)
- Q031 [stock] Worker default received date is the UTC day; triage 38 sites (N6) — ready — [details](docs/queue-details.md#q031)
- Q032 [stock] Product cluster undismiss; same-day supplier lots (BC-Q6); FIFO mirror (N8) — needs owner — [details](docs/queue-details.md#q032)
- Q033 [stock] Counted-stock family: HOLD, ships in slices (root chain only) — owner-decided — [details](docs/queue-details.md#q033)
- Q034 [stock] Stock reason codes, session retry handle, pin refetch, merge cost warning — ready — [details](docs/queue-details.md#q034)
- Q035 [stock] Undated lot word, batch number on TEXT, cost-forked twins, session defaults (BC-Q16) — needs owner — [details](docs/queue-details.md#q035)
- Q036 [stock] Stock stats scope (BC-Q20), labels manage (BC-Q19), no-supplier lots, batch view — needs owner — [details](docs/queue-details.md#q036)
- Q037 [stock] Bulk discount/expiry (BC-Q18), transfer example, two-branch writer, stock kernel — needs owner — [details](docs/queue-details.md#q037)
- Q038 [stock] G1 filter/preview — ready — [details](docs/queue-details.md#q038)
- Q039 [stock] Product detail movement filters, supplier search, date row — ready — [details](docs/queue-details.md#q039)
- Q040 [stock] Rename cascade preview, regroup on rename, auto-merge evidence, edit layout — needs owner — [details](docs/queue-details.md#q040)
- Q041 [stock] Mobile descriptions, duplicate click acceptance, excision leftovers, POS price tiers — ready — [details](docs/queue-details.md#q041)
- Q042 [stock] Edit-form section jumps (K7) — ready — [details](docs/queue-details.md#q042)
- Q043 [stock] Official names Excel, duplicate correction remainder — needs owner — [details](docs/queue-details.md#q043)
- Q044 [stock] Adjust sibling identity; Sep 1–3 legacy sales stay un-deducted (HOLD) — owner-decided — [details](docs/queue-details.md#q044)
- Q045 [stock] Two legacy invoices one line short; Program 3 defaults — needs owner — [details](docs/queue-details.md#q045)
- Q046 [stock] Verify catalog integrity items 2–5 and the batches set-sign bug — ready — [details](docs/queue-details.md#q046)
- Q047 [stock] Verify duplicates reopen and the 2x similar-cost guard — ready — [details](docs/queue-details.md#q047)
- Q048 [stock] Sep 4 measured merges; placeholder product delete; confirm 0112 ran — owner-decided — [details](docs/queue-details.md#q048)
- Q049 [stock] 2 Sep production apply leftovers: zeroed RECON lots, Delivery contact (data) — needs owner — [details](docs/queue-details.md#q049)
- Q050 [stock] Unverified corruption claims wait for a concrete record from the owner — needs owner — [details](docs/queue-details.md#q050)
- Q051 [stock] Main Inventory page (Inventory lanes shipped from 21 Oct: verify against live) — owner-decided — [details](docs/queue-details.md#q051)
- Q052 [stock] Resumable count sessions (verify against live) — owner-decided — [details](docs/queue-details.md#q052)
- Q053 [stock] Image-only upload received-date filters (verify against live) — owner-decided — [details](docs/queue-details.md#q053)
- Q054 [stock] Configurable Inventory permissions (verify against live) — owner-decided — [details](docs/queue-details.md#q054)
- Q055 [stock] Inventory acceptance: EN/KM, widths, keyboards, devices, Free/Paid, tests — owner-decided — [details](docs/queue-details.md#q055)
- Q056 [stock] Import retries, re-import adds stock, calculation choices, one entry point — ready — [details](docs/queue-details.md#q056)
- Q057 [stock] Inventory ADD import columns, wholesale through import, M6 historical ledgers — ready — [details](docs/queue-details.md#q057)
- Q058 [stock] Legacy barcode normaliser, CSV replace wizard, CSV cost tolerance — needs owner — [details](docs/queue-details.md#q058)
- Q059 [stock] Import review parity (BC-Q26), gallery choice, live import checks — needs owner — [details](docs/queue-details.md#q059)
- Q060 [stock] Sales/returns import search fold, adjust kernel, commission rule — needs owner — [details](docs/queue-details.md#q060)
- Q061 [stock] Untranslated XLSX/CSV mode tabs and import row codes — ready — [details](docs/queue-details.md#q061)
- Q062 [stock] Legacy barcode key bound; 0106 alias migration HOLD — ready — [details](docs/queue-details.md#q062)
- Q063 [stock] Parked migrations 0185–0191; consistent sibling reports — ready — [details](docs/queue-details.md#q063)
- Q064 [stock] 31 Aug day report import never recorded applied (commission BC-Q22) — needs owner — [details](docs/queue-details.md#q064)
- Q065 [stock] Import verdict drift 500; UTC-dated import lots — ready — [details](docs/queue-details.md#q065)
- Q066 [stock] 6.0.991 P3 follow-ups: scanner test, residual race, expiry seeks — ready — [details](docs/queue-details.md#q066)
### Returns
- Q067 [returns] Findings C/D/E: imported qty capacity, Not Paid partial return, replacement as Cash — owner-decided — [details](docs/queue-details.md#q067)
- Q068 [returns] Findings F/G/M: paid sale growth, restore after reprice (6.0.989), id collision — owner-decided — [details](docs/queue-details.md#q068)
- Q069 [returns] Not Paid returns, atomic create/edit, replacement chooser, cancel policy — needs owner — [details](docs/queue-details.md#q069)
- Q070 [returns] Sale/return id equality, v0 N+1 reads, mixed CREATE budget, edit asymmetries — ready — [details](docs/queue-details.md#q070)
- Q071 [returns] Returns endpoint integration, row caps, Precision v1 rulings — needs owner — [details](docs/queue-details.md#q071)
- Q072 [returns] F-register F69–F73 and U16–U20 — ready — [details](docs/queue-details.md#q072)
- Q073 [returns] Exchange budget headroom: number-probe retries (6.0.994 E1) — ready — [details](docs/queue-details.md#q073)
### Contacts
- Q074 [contacts] Blank gender, General customer membership, cleanup, duplicate-phone pairs — needs owner — [details](docs/queue-details.md#q074)
- Q075 [contacts] Membership prefix, compare/bulk review, identity index, Khmer for duplicates — needs owner — [details](docs/queue-details.md#q075)
- Q076 [contacts] Unknown phone (BC-Q14), supplier invoice residual, lot backfills (data) — needs owner — [details](docs/queue-details.md#q076)
### Shift, receipts, Telegram
- Q077 [shift] Shift-cash leftovers: opened_at amend, sales between close and reopen, time edits — ready — [details](docs/queue-details.md#q077)
- Q078 [shift] Receipt TIN and licence fields (Khmer and English) — owner-decided — [details](docs/queue-details.md#q078)
- Q079 [shift] Per-cashier shift report — owner-decided — [details](docs/queue-details.md#q079)
- Q080 [shift] Telegram full phone only to a verified admin-only audience — owner-decided — [details](docs/queue-details.md#q080)
- Q081 [shift] Shift 20 count, Sep 4 shift close, expense note (data) — needs owner — [details](docs/queue-details.md#q081)
- Q082 [shift] Shift open/close cash semantics and field sizing (N43/N44) — ready — [details](docs/queue-details.md#q082)
- Q083 [shift] Fees K backlog: label replace, sale cancel fees, contact-merge repoint — ready — [details](docs/queue-details.md#q083)
- Q084 [shift] Review audit best-effort, device naming, action-history flip, K8b migration — ready — [details](docs/queue-details.md#q084)
- Q085 [shift] Khmer wording unification (stock-in session, audit labels, "sale") — ready — [details](docs/queue-details.md#q085)
- Q086 [shift] Telegram topic ids write, live shift close, status actor, astral fixture, queue errors — needs owner — [details](docs/queue-details.md#q086)
- Q087 [shift] /settopic broadcast, Telegram settings permission (BP-10), old status actor — needs owner — [details](docs/queue-details.md#q087)
- Q088 [shift] /report date input must accept day-first — owner-decided — [details](docs/queue-details.md#q088)
### Permissions
- Q089 [perms] Admin one-time reset code — owner-decided — [details](docs/queue-details.md#q089)
- Q090 [perms] Neutral forced password-change copy — owner-decided — [details](docs/queue-details.md#q090)
- Q091 [perms] Before/after record for every action and a record viewer — owner-decided — [details](docs/queue-details.md#q091)
- Q092 [perms] review-r3 F1/F2/F4/F6 (F3 and F5 are in 6.0.985) — ready — [details](docs/queue-details.md#q092)
- Q093 [perms] Merged-alert false positive, alert rate limit, create-fold needs merge permission — owner-decided — [details](docs/queue-details.md#q093)
- Q094 [perms] Retention drift-guard hardening — ready — [details](docs/queue-details.md#q094)
- Q095 [perms] Stock Set undo/redo audit row; retention owner questions — needs owner — [details](docs/queue-details.md#q095)
- Q096 [perms] sale_refused vocabulary and Khmer label, Server page text, rate limit — ready — [details](docs/queue-details.md#q096)
- Q097 [perms] Courier cost write-side gate — ready — [details](docs/queue-details.md#q097)
- Q098 [perms] actorReadScope org field shape (NOTE C) — ready — [details](docs/queue-details.md#q098)
- Q099 [perms] Non-aborting product/import/avatar uploads — ready — [details](docs/queue-details.md#q099)
- Q100 [perms] Account isolation 2: server switch resets the account; pending keys carry the server — ready — [details](docs/queue-details.md#q100)
- Q101 [perms] Fee/Branch draft keys recomputed per render — ready — [details](docs/queue-details.md#q101)
- Q102 [perms] Profile page, server-side drafts, persistent callbacks outside the HTTP fence — needs owner — [details](docs/queue-details.md#q102)
- Q103 [perms] Permission refresh coalescing, OTP live check (mail domain owner-confirmed) — ready — [details](docs/queue-details.md#q103)
- Q104 [perms] Customer self-service password reset (Telegram share + Resend email) — owner-decided — [details](docs/queue-details.md#q104)
- Q105 [perms] Post-upload permission recheck; drain then remove offline code — owner-decided — [details](docs/queue-details.md#q105)
- Q106 [perms] Optional Settings entry for wiring images — ready — [details](docs/queue-details.md#q106)
- Q107 [perms] Frontend cache freshness fixes not integrated (archive-only SHAs) — ready — [details](docs/queue-details.md#q107)
- Q108 [perms] Review-queue slice A approve-performs-merge (6.0.985 in RC2b) — ready — [details](docs/queue-details.md#q108)
- Q109 [perms] Permission catalog copy and the open owner calls Q1–Q12 — needs owner — [details](docs/queue-details.md#q109)
- Q110 [perms] R2 security conditions F3–F5 (unlockPricing mirror, role editor, picker photo) — ready — [details](docs/queue-details.md#q110)
- Q111 [perms] Create-fold barcode spelling (BC-Q8); English review refusal codes — needs owner — [details](docs/queue-details.md#q111)
- Q112 [perms] Branch-scoped visibility, cashier visibility, undo broadcasts, review preview — needs owner — [details](docs/queue-details.md#q112)
- Q113 [perms] Audit per record, audit filter cap, server undo/redo appliers — ready — [details](docs/queue-details.md#q113)
- Q114 [perms] Per-action editor (BC-Q12), custom permissions, security settings key, repair gate — needs owner — [details](docs/queue-details.md#q114)
- Q115 [perms] Library fallback, import contradiction, review source sections, import step 2 — ready — [details](docs/queue-details.md#q115)
- Q116 [perms] Records cascades, permission deep-walk, organisation concept removal — needs owner — [details](docs/queue-details.md#q116)
- Q117 [perms] Approved discount rounding (H3); false "account changed" lock (H7) — ready — [details](docs/queue-details.md#q117)
- Q118 [perms] Dead SQL tails in grouped totals and sales ranking (H6) — ready — [details](docs/queue-details.md#q118)
### Public site
- Q119 [public] Returns policy page (7 days, unopened, receipt) — owner-decided — [details](docs/queue-details.md#q119)
- Q120 [public] Storefront minimum age 16 — owner-decided — [details](docs/queue-details.md#q120)
- Q121 [public] Public zoom only, retailer line, EN/KM overhaul, admin landing design — owner-decided — [details](docs/queue-details.md#q121)
- Q122 [public] Stale policy text, assistant first, front-page ranks (BC-Q23b), forgot password — needs owner — [details](docs/queue-details.md#q122)
- Q123 [public] Public rows per page, editor preview promotions/page size, portal shop name — needs owner — [details](docs/queue-details.md#q123)
- Q124 [public] Portal details, preferences scope (BC-Q23a), sticky page size, guest accounts — needs owner — [details](docs/queue-details.md#q124)
- Q125 [public] Shopper scanner, old-domain DNS, stories and promotions editor (deferred) — needs owner — [details](docs/queue-details.md#q125)
- Q126 [public] Website Editor sign-up toggle — owner-decided — [details](docs/queue-details.md#q126)
### Platform & ops
- Q127 [ops] Full task ledger reconciliation (CONSOL-RECONCILE; register re-verified 26 Oct) — ready — [details](docs/queue-details.md#q127)
- Q128 [ops] Executor authority and import recovery (CONSOL-J) — ready — [details](docs/queue-details.md#q128)
- Q129 [ops] SheetJS 0.20.3: rework the reader, re-run parity — owner-decided — [details](docs/queue-details.md#q129)
- Q130 [ops] LICENSE file: All rights reserved — Leang Cosmetics — owner-decided — [details](docs/queue-details.md#q130)
- Q131 [ops] Offline queue removal slices S0, S5, S6 — owner-decided — [details](docs/queue-details.md#q131)
- Q132 [ops] Free-plan paths over 50 statements; E-* efficiency lanes — ready — [details](docs/queue-details.md#q132)
- Q133 [ops] Comments sweep and small shared helpers — ready — [details](docs/queue-details.md#q133)
- Q134 [ops] fees-k leftovers and storefront leftovers — ready — [details](docs/queue-details.md#q134)
- Q135 [ops] K8b migration number — ready — [details](docs/queue-details.md#q135)
- Q136 [ops] Privacy purge of history; repository private later — owner-decided — [details](docs/queue-details.md#q136)
- Q137 [ops] DU-C daily-use UI and remaining sole-branch chip sites — owner-decided — [details](docs/queue-details.md#q137)
- Q138 [ops] Physical iOS/Android photo, keyboard and installed-PWA acceptance — needs owner — [details](docs/queue-details.md#q138)
- Q139 [ops] Owner-UI umbrella, responsive pass, live verification after deploy — ready — [details](docs/queue-details.md#q139)
- Q140 [ops] Universal minimize, Save at page end, Discard/Back contract (QuickAdd guard done) — ready — [details](docs/queue-details.md#q140)
- Q141 [ops] Khmer line height, scan button, stats sweep, palette, toolbar chip row — needs owner — [details](docs/queue-details.md#q141)
- Q142 [ops] Currency contrast, receipt settings, spacing, selection columns — needs owner — [details](docs/queue-details.md#q142)
- Q143 [ops] Touch targets (BC-Q24), pager and theme visual checks — needs owner — [details](docs/queue-details.md#q143)
- Q144 [ops] Viewer locale survivors, backup path input, short ids (BC-Q15), i18n keys — needs owner — [details](docs/queue-details.md#q144)
- Q145 [ops] Native dialog sweep, unmount timers (contacts hiding #128 done in 6.0.987) — ready — [details](docs/queue-details.md#q145)
- Q146 [ops] Stat fold persistence, unnamed defaults, U1 backlog — needs owner — [details](docs/queue-details.md#q146)
- Q147 [ops] Service-worker residuals, storefront console 404 — ready — [details](docs/queue-details.md#q147)
- Q148 [ops] Device smokes (upgrade, End Shift, print, iOS lag); Khmer duplicate key check — needs owner — [details](docs/queue-details.md#q148)
- Q149 [ops] Khmer workbook HOLD, Playwright expected reds, compact public polish — ready — [details](docs/queue-details.md#q149)
- Q150 [ops] Sep 7 owner adds, browser API warning, tell staff about day-first typing — needs owner — [details](docs/queue-details.md#q150)
- Q151 [ops] Dead i18n keys list, retained UI requests, Sales/Returns scan live check — ready — [details](docs/queue-details.md#q151)
- Q152 [ops] Parity sweep across surfaces (Track F) — ready — [details](docs/queue-details.md#q152)
- Q153 [ops] Infra live checks (wrangler tail, real device, two-tab race): owner or ops run — needs owner — [details](docs/queue-details.md#q153)
- Q154 [ops] Aug 25–27 request batches: verify closure — ready — [details](docs/queue-details.md#q154)
- Q155 [ops] Mobile card description, reports hub visual, amendment dates day-first — ready — [details](docs/queue-details.md#q155)
- Q156 [ops] Layering: InfoHint under Modal, buried modals, inline overlays — ready — [details](docs/queue-details.md#q156)
- Q157 [ops] UTC-midnight date sites and locale digit grouping — ready — [details](docs/queue-details.md#q157)
- Q158 [ops] Unguarded fetch-then-setState, timers, native dialogs, POS settings reload — ready — [details](docs/queue-details.md#q158)
- Q159 [ops] Storefront native confirm; import review parity; failed job "Queued 0%" — ready — [details](docs/queue-details.md#q159)
- Q160 [ops] Efficiency W1–W3: product PUT reads, v0 return N+1, Telegram snapshot rereads — ready — [details](docs/queue-details.md#q160)
- Q161 [ops] Efficiency W4–W5 and A1–A5 cleanups — ready — [details](docs/queue-details.md#q161)
- Q162 [ops] C3v2 A0 metrics, A1 hygiene, A2 retention — owner-decided — [details](docs/queue-details.md#q162)
- Q163 [ops] C3v2 A3–A7: catalog scan, dashboard cache, search, thumbnails, R2 lifecycle — ready — [details](docs/queue-details.md#q163)
- Q164 [ops] C3v2 read models, offline snapshot loop, polling, backups bucket decision — needs owner — [details](docs/queue-details.md#q164)
- Q165 [ops] Sale-create round trips, production counts, analytics token, location check — needs owner — [details](docs/queue-details.md#q165)
- Q166 [ops] Duplicate receipt numbers possible without UNIQUE — ready — [details](docs/queue-details.md#q166)
- Q167 [ops] Release-3 efficiency lanes E-TG, E-RET, E-ECHO, E-SNAP, E-PUT, E-STOCKIN, E-CLEAN — ready — [details](docs/queue-details.md#q167)
- Q168 [ops] SW fallback limits, Free CPU measurement, non-sargable and unpaged reads — ready — [details](docs/queue-details.md#q168)
- Q169 [ops] Movement search diacritics, Paid cpu_ms, live R2 staging, Sentry — ready — [details](docs/queue-details.md#q169)
- Q170 [ops] K7 performance, media umbrella, storage baseline, Sentry events — ready — [details](docs/queue-details.md#q170)
- Q171 [ops] Sentry decision, deferred bloat GC, Free budgets near 50 — needs owner — [details](docs/queue-details.md#q171)
- Q172 [ops] Free capacity and readiness; Free measurement rulings — needs owner — [details](docs/queue-details.md#q172)
- Q173 [ops] Sync coalescing (U-SYNC) and C3v4 new items — ready — [details](docs/queue-details.md#q173)
- Q174 [ops] P4 wave 2 round trips; stop pre-downloading routes (CP3B1-F3) — ready — [details](docs/queue-details.md#q174)
- Q175 [ops] D1 bloat and non-sargable date sites — ready — [details](docs/queue-details.md#q175)
- Q176 [ops] audit_logs indexes, unpaged reads and N+1 — ready — [details](docs/queue-details.md#q176)
- Q177 [ops] Frontend chunk policy candidate (archive-only) — ready — [details](docs/queue-details.md#q177)
- Q178 [ops] Security audit and licence audit follow-ups (THIRD_PARTY_NOTICES etc.) — owner-decided — [details](docs/queue-details.md#q178)
- Q179 [ops] Compliance gap review remediation — ready — [details](docs/queue-details.md#q179)
- Q180 [ops] Public-repo customer data: scrub the session log, purge history later, private copy — owner-decided — [details](docs/queue-details.md#q180)
- Q181 [ops] 5xx message redaction, admin Vary header, image validation parity — ready — [details](docs/queue-details.md#q181)
- Q182 [ops] Image cap race, abuse bindings (BC-Q25), AI quota, CSP rollout, metrics — needs owner — [details](docs/queue-details.md#q182)
- Q183 [ops] Origin admission; owner security checklist (admin user, 2FA, old zone) — needs owner — [details](docs/queue-details.md#q183)
- Q184 [ops] Cloudinary secret, malformed secret name, build-state evidence, old R2 bucket — needs owner — [details](docs/queue-details.md#q184)
- Q185 [ops] SEC-SALES donor (cashier LIKE filter, timestamp bound) — ready — [details](docs/queue-details.md#q185)
- Q186 [ops] Dead portal schema cleanup (portal findings already done) — ready — [details](docs/queue-details.md#q186)
- Q187 [ops] Branch cleanup: revalidate before any further deletion — ready — [details](docs/queue-details.md#q187)
- Q188 [ops] PR9, P-public merge, unmerged candidates, parked lanes, private main repo — needs owner — [details](docs/queue-details.md#q188)
- Q189 [ops] rc/* lines and 24 Sep branch deletions — needs owner — [details](docs/queue-details.md#q189)
- Q190 [ops] Website posts API branch needs its frontend (HOLD) — ready — [details](docs/queue-details.md#q190)
- Q191 [ops] CP-3d held lanes: re-check each against the cleanup manifest — needs owner — [details](docs/queue-details.md#q191)
- Q192 [ops] Documentation debt, hygiene, zombie routes, debloat lists, per-lane checklist — ready — [details](docs/queue-details.md#q192)
- Q193 [ops] Zombie/orphan cleanup lane (list for the owner, never delete on sight) — ready — [details](docs/queue-details.md#q193)
- Q194 [ops] Orphaned language keys; session-log backfill; stale test — ready — [details](docs/queue-details.md#q194)
- Q195 [ops] Dataset lifecycle (N7): unbounded listObjects, reset text, growing tables — ready — [details](docs/queue-details.md#q195)
- Q196 [ops] Restore UI and dry run (replace with the backup); Drive owner-managed — owner-decided — [details](docs/queue-details.md#q196)
- Q197 [ops] Drive asset mirror, R2 finalized sets, live reset/restore checks, migration recovery — ready — [details](docs/queue-details.md#q197)
- Q198 [ops] Video pipeline, image variants, A2 live checklist — ready — [details](docs/queue-details.md#q198)
- Q199 [ops] POS live receipt check; month-first stored lots rewrite (data job) — ready — [details](docs/queue-details.md#q199)
- Q200 [ops] Dataset lifecycle legacy; never apply 0188 remotely — ready — [details](docs/queue-details.md#q200)
- Q201 [ops] Restore TOCTOU, restore confirm and Free capacity — ready — [details](docs/queue-details.md#q201)
- Q202 [ops] A2 live verification and A3 Google Drive (owner) — needs owner — [details](docs/queue-details.md#q202)
- Q203 [ops] Owner statements of 8 Sep; image-rights and market facts register — needs owner — [details](docs/queue-details.md#q203)
- Q204 [ops] Owner-only actions (DNS, secrets, Sentry, portal fields, token scope, zone) — needs owner — [details](docs/queue-details.md#q204)
- Q205 [ops] 5–6 Oct rulings not in code: changed-fields saves, returns link a sale, Not Paid return — owner-decided — [details](docs/queue-details.md#q205)
- Q206 [ops] 5–6 Oct rulings: day-first import dates, crossing alerts (6.0.991), phone sign-ups off — owner-decided — [details](docs/queue-details.md#q206)
- Q207 [ops] 5–6 Oct rulings: sale corner tag, shop closing time, Main - Sub import, stock-in edit — owner-decided — [details](docs/queue-details.md#q207)
- Q208 [ops] Cheap safe list (both batches) — ready — [details](docs/queue-details.md#q208)
- Q209 [ops] G40–G64 triage groups and the obligation index (re-check, stale) — ready — [details](docs/queue-details.md#q209)
- Q210 [ops] Run the 6.0.995 returns.created_at census via ops — ready — [details](docs/queue-details.md#q210)
- Q211 [ops] Multi-client template renders the 6.0.984 crons — ready — [details](docs/queue-details.md#q211)
- Q212 [ops] test-branch-review-state-pure hangs at check 9 (pre-existing) — ready — [details](docs/queue-details.md#q212)
