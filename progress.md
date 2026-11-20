# progress.md — Business OS live ledger

*Read it every session. State only: narrative goes to the [session log](docs/history/session-log.md). Never put customer names, phone numbers or other personal data in this file or any tracked file.*

**Contents:** [Status](#status-snapshot--21-nov-2026-0226-cambodia-utc7) · [Lanes](#current-status) · [Owner questions](#open-owner-questions) · [Release process](#release-process) · [Golden Rules](#golden-rules) · [Queue](#queue) — elsewhere: [owner decisions](docs/owner-decisions.md) · [queue details](docs/queue-details.md) · [releases, holds, history](docs/history/releases.md) · [session log](docs/history/session-log.md)

Ending a session: update the Status snapshot, Current status and Queue here, reserve versions in the private version register, and write narrative to `docs/history/session-log.md`. Superseded snapshots move to the session log.

## Status snapshot — 21 Nov 2026, 02:26 (Cambodia, UTC+7)

- **Production:** `90ad75aa09055adbc2c125876081976a996c8426` (6.0.2688) since deploy 9, 20 Nov 20:29. Deploy run 44744182601 on exact-SHA gate 44737956175 (green: 8 shards, 3 browser suites, verdict). Worker version `8a40bab6-3697-4c24-a548-72af72d53f6e`; `/api/runtime/version` revision `90ad75aa0905`, tier paid. `main` equals production on the public and the private repository. Migrations: 242 applied, last 0319.
- **Deploy 9 delivered** the count-task cost and polish round on top of count tasks (live since deploy 7, 19 Nov) and the reopen rule (deploy 8, 20 Nov): the task board cold read 73,737 → 31,669 rows (30 tasks × 300 products); a task closed by hand keeps its close-time figures, flagged `at_close` by the Worker and labelled "counted at close"; the Free cap of 10 open tasks per branch × 100 products (Paid unchanged, a reopen is never capped); issue-by-filter 6.4 ms at 6K products; refusals carry the task figures; the Khmer at-close cell fits at 1280 px. Postflight clean: 8 read-only d1-export runs (44745217942 to 44748953228), 0 drift in stock ledgers, sale money, returns, shift cash and prepared figures.
- **Deploy 10, planned 21 Nov about 20:00 (slot 1 of 21 Nov, one spare):** lane handover cutoff 13:00 (tip + green gate + GO review each); an Opus composer on `90ad75aa0` 13:00–15:00; gate and one Opus review of the compose 15:00–18:00; the lead's go/no-go. The compose has started early on `lane/compose-deploy-10` (not yet pushed). Candidates are marked in Current status.
- **Reads, measured** (metrics run 44723661766, 14–19 Nov trading hours): about **16.2M D1 rows a day against Free's 5M**. `GET /api/products/search` 8.1M (600 requests × 13.5K rows), products/filters 1.6M, sales/stats 1.45M, products/possible-duplicates 1.18M, inventory-checks/products 0.77M, notifications/summary 0.65M, sales list 0.54M, dashboard/startup 0.49M. Background jobs about 4.7K read and 1.6K written a day. Root cause of the biggest: every sale advances the products cache namespace that the till's search index also uses, so the till falls back to server text search.
- **Plan to cut reads:** deploy 10 carries the quick wins: the till's search index survives sales (QW1), duplicates without the stock join (QW2, measured −28%, about 0.33M a day), one filters entry for every branch (QW3), and bell sections on the plan-lifetime cache (a repeat summary 31,051 → 24 rows). Next: catalogue option C (a small token table, slices C3–C7), money option C (a sales search index; stored daily totals, which are seeded but not wired in production: the kernel returns null and both cron steps skip; the 0155 trigger plan), count-list rows R1–R4 (latest-count table, migration 0320). The stats-search semi-joins (Q1) are parked: measured saving only about 9%. A read and write roadmap (Opus, read-only) is in progress.
- **Plan tier:** Workers Paid kept to the end of December as the safety net (owner 20 Nov). The goal stays Cloudflare Free permanently. A Turso (libSQL, Singapore) track runs in parallel and waits on the owner's account and tokens.
- **Standing limits:** at most two deploys per Cambodia date, at any hour; open shifts do not block a deploy (owner 12 Nov). Native and browser tests run one at a time under the shared native-tests lock. One writer per lane, each in its own worktree. Remote D1 only through the ops workflows.
- **Roles (owner 21 Nov):** the lead session decides (order, options, go/no-go, owner questions) and does only the crucial reviews and architecture; Opus agents review, design and compose; Sonnet agents build.

## Current status

States: built · review · gate · ready (gate green and review GO) · live. Lanes already live are in the [release history](docs/history/releases.md).

| lane | branch @ tip | state | what blocks it |
| --- | --- | --- | --- |
| Public website overhaul (website session) | `lane/public-web-overhaul` @ `2ab19b282` | ready for deploy 10: gate 44792345423 green; Opus review GO at `b9c33041e` (the tip adds one test-only commit) | compose: diff the en/km key sets, rerun the performance budget and chunk boundary tests after the build. Accepted: below 400 px the Saved button leaves the header (owner call pending) |
| Admin alerts pinned until resolved (website session) | `lane/admin-notify-pin` @ `20df7fe2b` | review GO; gate 44797946821 running | in deploy 10 only if that gate is green by 13:00; otherwise `603511c46` (GO, gate 44768711886 green). Never compose `c9e0467a9`, `8dac0479c` or `fbfe3fdc1` |
| Refund credit keeps its method (payments P0, live bug) | `lane/pay-p0` @ `3d3074953` (base `b652a501c`) | review GO with conditions at `f50ef4425`; C2 tests, the C3 rename rule, a pre-fix Redo guard and a one-read missing-methods check committed (6.0.2756–2758, 6.0.2761); gate 44792098213 green on `8eee3c7a2`, before them | C1: the census query rewrite is not on the lane yet (no `ops/` change since `f50ef4425`); then a gate on the tip |
| Catalogue quick wins QW1–QW3 | `lane/catalogue-quick-wins` @ `45aaea5ec` | review GO with conditions at `c287a97a5`; gate 44776563878 red there (two stale pins), fixed in 6.0.2750 and 6.0.2754; conditions and the socket-aware index backstop committed (6.0.2751–2753); gate 44800257161 running | the gate. The stored-daily-totals kernel bump 2 → 3 (6.0.2750), forced by the `planTier.ts` edit, was assessed harmless: the kernel is not wired in production |
| Bell cache (money quick win Q4) | `lane/money-quick-wins` @ `3f9278282` | built (6.0.2727, 6.0.2748, 6.0.2759); Opus review running; gate 44800578267 running | review and gate; the compose takes only the Q4 commits (Q1 `c747cff5b` parked) |
| Count-list reads round 0 | `lane/ic-reads-r0` @ `bb76444d0` (base `afd991a39`) | review GO with conditions, C1–C5 done; gate 44793134215 running | measured: the no-branch Last-checked read doubles at today's tiny history (16,668 → 33,263 rows) and the latest-items read costs more until about 24K counted items. A sole-active-branch change is being built; the lead decides whether step 3 ships |
| Retire the old R2 bucket | `lane/ops-r2-retire` @ `21626f9ca` (base `b652a501c`) | ready for deploy 10: gate 44750231535 green; review GO with conditions, C1–C3 done | after it is on main: plan, reference query (must be 0), expire, next day delete the bucket, then the R2 inventory. Owner approved the delete (20 Nov) |
| Weekly copy, health checks on the copy | `lane/ops-weekly-copy` @ `b8eab9043` | stopped mid-build: S5, S1, S2, S6 and the cost pins uncommitted in the lane's worktree | a fresh builder; natives under the lock |
| "Weekly backup missing" bell | `lane/backup-weekly-bell` @ `f252d7a4e` | built; pure tests green | 6 backup natives and 5 screenshots |
| Count-task Worker tests | `lane/count-tasks-tests-cf` @ `2ac77bd34` | built, tests only | S-J harness speed; a later compose |
| Deploy kit | `lane/deploy-speed` @ `b9d71aa3c` | in use: `deploy.yml` and `gate.yml` run from this ref (live-version retry, 6.0.2627) | not on main |
| KHQR online checkout | `lane/khqr` @ `1e686586a` | not started on main: 110 ahead, 1,108 behind, 42 conflicts, 7 migrations to renumber | its own lane from main after deploy 10, shipped switched off; the owner's PayWay keys |
| This ledger | `lane/progress-ledger` | review | the lead composes it into deploy 10 |

Also running: the deploy 10 compose, its security review and dead-code audit; the read and write roadmap; the bell-cache review; a design of the count list as a view of Products (owner 21 Nov).

## Open owner questions

Only questions open today. Every ruling is in [docs/owner-decisions.md](docs/owner-decisions.md); never re-ask a settled one.

1. **Public site, phones under 400 px:** the Saved button leaves the header. Keep it so, or place it elsewhere? (Ships as is in deploy 10.)
2. **Public site, title bars:** confirm the reading: no title-bar row on the account, language and list floats, and List and Saved as one full page. Also confirm that "pinned" alerts mean pinned in the bell, not an on-screen strip.
3. **Public site Khmer:** the owner's native-Khmer check of the new public texts (check sheet with the website session).
4. **KHQR:** the ABA PayWay merchant ID and API key ("I will add that later", 20 Nov).
5. **Turso:** create the account, the databases and the tokens (owner only); allow an emergency upgrade at 95% or not.
6. **Two limited Cloudflare tokens** (owner chose both, 2 Nov): analytics for the governor's outside alarm, backup for off-site backups.
7. **Refund credit rows relabelled before the fix:** after pay-p0 is live, a read-only census lists them; repairing them is a production write that needs the owner's OK.
8. **Payment-method rename (lead decision, 21 Nov):** a rename that keeps the drawer kind renames the refund credit too; one that changes the kind leaves the credit alone. The owner may object before deploy 10.
9. **Older questions, maybe answered in chat (check before re-asking):** approving a rename (6.0.985) and its Undo; the password for other money settings (6.0.986); returns export limits (6.0.989); keeping Conflict marks forever (6.0.988); the customers index (6.0.983); Review-tier multi-select delete; returns:bulk without returns:edit; the About-blocks media box; Paid memo 5 s or 15 s; the IC Review entry; editor Q1–Q3 and Khmer wording; database space, release rules on Free, which expiry date counts, sign-in after a rewind; the loyalty redeem step (loyalty is off).
10. **Real devices:** iOS, Android and installed-PWA acceptance (photos, keyboards, camera prompt, Google Translate on the public site).

## Release process

Checked against deploy 9 (20 Nov).

- **Candidate:** an Opus composer merges the ready lanes onto the production commit in a fresh worktree; the exact SHA passes the full `gate.yml` on GitHub (shards, browser suites, verdict); one independent Opus review of the composed delta says GO; a secrets scan of the delta and its commit messages is clean; the lead gives the final go/no-go. Follow the [deploy-provenance skill](.claude/skills/deploy-provenance/SKILL.md); never infer that main is deployed.
- **Deploy:** `deploy.yml` from `lane/deploy-speed` with `ref=<sha> plan=paid run_migrations=true gate_run_id=<the green gate> confirm=DEPLOY`. It reuses the gate result and waits for the live Worker version.
- **After:** check the Worker version and `/api/runtime/version`; run the light postflight (read-only d1-export queries: migrations applied, IC approvals, population token, stock ledgers, sale money, returns, shift cash, prepared figures); fast-forward `main` on the public and private repositories. Heavy health checks move to the weekly copy once `lane/ops-weekly-copy` lands.
- **Limits:** at most two deploys per Cambodia date, any hour; open shifts do not block (owner 12 Nov); keep one slot spare when possible.
- **Database:** remote D1 only through the ops workflows, never `wrangler --remote` from an agent. Migrations are append-only, LF-only, with pre/post assertions. 0320 is reserved for the latest-count table; the next free number is 0321, checked against `d1_migrations` and every ref.
- **Repositories:** `business-os-private` mirrors the public repository with the same SHAs and its Actions off; the gate runs on the public repository. No data in git.
- **Commits:** versions reserved in the private version register; titles `6.0.N — concise description`; never rewrite pushed history. Holds and production-only actions: [docs/history/releases.md](docs/history/releases.md#holds-and-production-only-actions).

## Golden Rules

*Permanent. Read every session. Never traded against each other.*

### The Core Rule

*Set by the owner on 14 Nov 2026. It never changes and is never relaxed. It binds every person, session and agent, for every change: code, data, tests, workflows and docs. No deadline, convenience or smaller diff outweighs it. Every other rule in this file applies it.*

Every change meets the highest standard on all six points at once:

1. **Quality.** It is correct in every edge case and fixes the root cause, not the symptom. A write either fully succeeds or is reported as failed or partial. The code is readable and maintainable (the Golden Rules priority order in progress.md).
2. **Quality control.**
   - The writer never certifies their own work; an independent reviewer does.
   - A test only counts if it would fail on the wrong implementation.
   - Every claim is verified on the committed commit, in both packages, and the evidence is recorded.
   - A deploy needs a green full gate on the exact commit.
   - "Should work" is never evidence.
3. **Standards and concepts.** It follows the project's conventions and the owner's recorded decisions (`docs/owner-decisions.md`, the decision hubs). It keeps the established concepts the same on every sibling surface:
   - the one revenue definition;
   - product identity by barcode;
   - batch + branch stock;
   - the Cambodia business day;
   - both language packs.
4. **Requirements.** It delivers exactly what the owner asked, fully, with no dead ends or trapping flows. Anything inferred is flagged, not shipped.
5. **Efficiency, targeted and scalable.** It is the smallest correct change at the right layer, using the fewest D1 reads, writes, calls and CPU that are still correct:
   - indexed seeks, not scans;
   - batched writes;
   - load on demand, summary first;
   - a cost that stays flat as data grows;
   - within Cloudflare Free limits, every number taken from `getPlanLimits(env)`.

   Efficiency never ships wrong data.
6. **Process efficiency.**
   - Work never idles: while one task waits (a deploy, a gate), the next proceeds.
   - Nothing proven is re-done.
   - Use the fewest round trips.
   - Finish what is running before starting more.

When two points seem to conflict, correctness wins, then the order above. A change that misses any point is not done.

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

### Next, in order

1. **Deploy 10 (21 Nov):** compose the ready lanes in Current status; gate; one Opus review; deploy about 20:00.
2. **After deploy 10, production steps:** the old-bucket retire sequence; the refund-credit census (read-only), then a repair only with the owner's OK; switch `dash_overview_5m` ON (the owner allowed a 5-minute-old overview, 27 Oct) and keep the report_atomic shadow.
3. **Deploy 9 review follow-ups:** legacy closed tasks read "All counted" (open-task wording); the contract clause on the first-page refusal; a native for reopen plus a second close with other figures; the differential must confirm the ids-only path; a warm-up open in the layout test.
4. **Deploy 11:** the Worker's cart and wishlist mirror keeps the shop line (`cloudflare/src/routes/portal.ts`, website session); bell sections that hit LIMIT 50/20 report "truncated" if not already in the bell-cache lane.
5. **Payments P1–P10** (design of 20 Nov, owner answers of 20 Nov): payment events and return refund corrections, then the Telegram "received" figure counts money received that day, sale-line paid/unpaid tags, return edits. Replaces Q001, Q021 and Q022 below.
6. **Read cuts:** catalogue option C (C3–C7, token table allowed by the owner); money option C (sales search index; stored daily totals phase B S0–S6, which wires the kernel: today the totals are seeded, not wired); count-list rows R1 (migration 0320) to R4, adding at most one write per counted line; the 0155 plan: keep the delete and update guards, refuse REPLACE on `product_batches` in the Worker, a gate test, a daily invariant check, drop only the insert-orphan scan (migration 0321 or later); the owner switches `stock_bump_narrow` and `products_typed_order_js`.
7. **Weekly copy and backup:** finish `lane/ops-weekly-copy` (S5, S1, S2, S6, cost pins), then the restore drill and the switch-on, which need the owner's keys; the weekly-bell natives.
8. **Turso (Singapore):** T1 database layer, T2 fewer round trips, T3 Turso client; cutover night with writes frozen planned 19–20 Dec. Waits on the owner's account and tokens.
9. **Count list as a view of Products** (owner 21 Nov): the design running now may replace parts of R1–R4; decide before building R1.
10. **Customer search:** the phone index also holds the 0-prefixed local form (migration after 0320), the guard fold, and the till list scrolls past 6 results.
11. **Security:** action history has no organisation fence (latent while each deployment has one organisation).
12. **Count-list safety:** the 503 "saved, refresh" branch in the IC middleware is unreachable (a strict bump with fault-injection tests, or delete it and its test claims).
13. **KHQR:** a new lane from main after deploy 10, shipped switched off until the owner adds the keys.
14. **Official product name:** a separate official-name field (column, form, import, search, Khmer); backend lane not started.
15. **R2 storage:** clear folder names; confirm the 14 Nov old-format backup set was evicted by retention.
16. **Ledger housekeeping:** record the owner's 27 Oct return answers ("option 1 ... No ... No ... Yes, count today") and the 20 Oct status rule ("not paid and completed only this two statuses, the rest are tags") in `docs/owner-decisions.md`; give each `docs/queue-details.md` heading its title so the backlog list below can move there.

### Backlog carried from 27 Oct

Not re-verified since 27 Oct. One line per item: `Q### [area] title — state — details`. **owner-decided** = the owner has ruled on what to build; **needs owner** = at least one part waits on an owner answer, action, data approval or device check; **ready** = workable without owner input (not a claim that it is done). Full text is in [docs/queue-details.md](docs/queue-details.md); done or superseded items move to the session log.

#### Sales & money
- Q001 [sales] Paid basket growth (CONSOL-F): added items on a paid sale; S4 is 6.0.982 — owner-decided (superseded by payments P1–P10, Next item 5) — [details](docs/queue-details.md#q001)
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
- Q021 [sales] Sale payments S5–S8 and the five flagged old short sales — owner-decided (superseded by payments P1–P10, Next item 5) — [details](docs/queue-details.md#q021)
- Q022 [sales] 6.0.982 P3 follow-ups: credit-only sale in linked rename; count tests — ready (superseded by payments P1–P10, Next item 5) — [details](docs/queue-details.md#q022)
- Q023 [sales] Normalise past sale statuses to Completed / Not Paid plus tags — owner-decided — [details](docs/queue-details.md#q023)
- Q024 [sales] Exchange replacement loyalty follows the switch; SELECT-only postflight audits — ready — [details](docs/queue-details.md#q024)
#### Stock & products
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
#### Returns
- Q067 [returns] Findings C/D/E: imported qty capacity, Not Paid partial return, replacement as Cash — owner-decided — [details](docs/queue-details.md#q067)
- Q068 [returns] Findings F/G/M: paid sale growth, restore after reprice (6.0.989), id collision — owner-decided — [details](docs/queue-details.md#q068)
- Q069 [returns] Not Paid returns, atomic create/edit, replacement chooser, cancel policy — needs owner — [details](docs/queue-details.md#q069)
- Q070 [returns] Sale/return id equality, v0 N+1 reads, mixed CREATE budget, edit asymmetries — ready — [details](docs/queue-details.md#q070)
- Q071 [returns] Returns endpoint integration, row caps, Precision v1 rulings — needs owner — [details](docs/queue-details.md#q071)
- Q072 [returns] F-register F69–F73 and U16–U20 — ready — [details](docs/queue-details.md#q072)
- Q073 [returns] Exchange budget headroom: number-probe retries (6.0.994 E1) — ready — [details](docs/queue-details.md#q073)
#### Contacts
- Q074 [contacts] Blank gender, General customer membership, cleanup, duplicate-phone pairs — needs owner — [details](docs/queue-details.md#q074)
- Q075 [contacts] Membership prefix, compare/bulk review, identity index, Khmer for duplicates — needs owner — [details](docs/queue-details.md#q075)
- Q076 [contacts] Unknown phone (BC-Q14), supplier invoice residual, lot backfills (data) — needs owner — [details](docs/queue-details.md#q076)
#### Shift, receipts, Telegram
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
#### Permissions
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
#### Public site
- Q119 [public] Returns policy page (7 days, unopened, receipt) — owner-decided — [details](docs/queue-details.md#q119)
- Q120 [public] Storefront minimum age 16 — owner-decided — [details](docs/queue-details.md#q120)
- Q121 [public] Public zoom only, retailer line, EN/KM overhaul, admin landing design — owner-decided — [details](docs/queue-details.md#q121)
- Q122 [public] Stale policy text, assistant first, front-page ranks (BC-Q23b), forgot password — needs owner — [details](docs/queue-details.md#q122)
- Q123 [public] Public rows per page, editor preview promotions/page size, portal shop name — needs owner — [details](docs/queue-details.md#q123)
- Q124 [public] Portal details, preferences scope (BC-Q23a), sticky page size, guest accounts — needs owner — [details](docs/queue-details.md#q124)
- Q125 [public] Shopper scanner, old-domain DNS, stories and promotions editor (deferred) — needs owner — [details](docs/queue-details.md#q125)
- Q126 [public] Website Editor sign-up toggle — owner-decided — [details](docs/queue-details.md#q126)
#### Platform & ops
- Q127 [ops] Full task ledger reconciliation (CONSOL-RECONCILE; register re-verified 26 Oct) — ready — [details](docs/queue-details.md#q127)
- Q128 [ops] Executor authority and import recovery (CONSOL-J) — ready — [details](docs/queue-details.md#q128)
- Q129 [ops] SheetJS 0.20.3: rework the reader, re-run parity — owner-decided — [details](docs/queue-details.md#q129)
- Q130 [ops] LICENSE file: All rights reserved — Leang Cosmetics — owner-decided — [details](docs/queue-details.md#q130)
- Q131 [ops] Offline queue removal slices S0, S5, S6 — owner-decided — [details](docs/queue-details.md#q131)
- Q132 [ops] Free-plan paths over 50 statements; E-* efficiency lanes — ready — [details](docs/queue-details.md#q132)
- Q133 [ops] Comments sweep and small shared helpers — ready — [details](docs/queue-details.md#q133)
- Q134 [ops] fees-k leftovers and storefront leftovers — ready — [details](docs/queue-details.md#q134)
- Q135 [ops] K8b migration number — ready — [details](docs/queue-details.md#q135)
- Q136 [ops] Privacy purge of history; repository private later — owner-decided (private copy `business-os-private` created 20 Nov; the history purge is still open) — [details](docs/queue-details.md#q136)
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
- Q164 [ops] C3v2 read models, offline snapshot loop, polling, backups bucket decision — needs owner (backups bucket: see Q184) — [details](docs/queue-details.md#q164)
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
- Q180 [ops] Public-repo customer data: scrub the session log, purge history later, private copy — owner-decided (private copy created 20 Nov; scrub and purge still open) — [details](docs/queue-details.md#q180)
- Q181 [ops] 5xx message redaction, admin Vary header, image validation parity — ready — [details](docs/queue-details.md#q181)
- Q182 [ops] Image cap race, abuse bindings (BC-Q25), AI quota, CSP rollout, metrics — needs owner — [details](docs/queue-details.md#q182)
- Q183 [ops] Origin admission; owner security checklist (admin user, 2FA, old zone) — needs owner — [details](docs/queue-details.md#q183)
- Q184 [ops] Cloudinary secret, malformed secret name, build-state evidence, old R2 bucket — needs owner (old R2 bucket: owner approved the delete 20 Nov, `lane/ops-r2-retire`) — [details](docs/queue-details.md#q184)
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
