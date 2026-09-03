# 2026-09-03 — the clean-HEAD deploy that reverted production, and the reconciliation

Session `business-os-v1-5d`, main tree, coordinator. **Reference to re-verify, not ground truth.**
Every claim below names the command or artifact it came from; re-run those rather than trusting this
file.

New sessions: the generalised procedure is the **`deploy-provenance`** skill
(`.claude/skills/deploy-provenance/SKILL.md`). This file is the specific incident it came from.

---

## What happened, in one paragraph

Production was running Worker version `0a531d53-3aa6-4b31-a50e-e04c9bc109ac`, deployed
2026-09-03T07:26:26Z by another session from a tree carrying `hotfix/prod-2026-09-03` — 24 commits
that were **never merged to `main`**. At 08:41:57Z this session deployed
`d701ddc1-22ff-4d87-bbe7-6b25a666b79b` from committed `main` (`a4f10152`), which had been fully
certified green. A deploy replaces production wholesale, so every one of those 24 commits was
deleted from the live site. The user reported it: the Returns button in Sales was gone, and the
branch inventory page had reverted to being identical to the branch overview. All of the
verification passed; none of it was capable of catching this.

## Why the checks did not catch it

Four readings looked like confirmation and were not. They are the substance of the lesson.

**Commit ancestry cannot see a deploy that was not made from a commit.** The pre-deploy audit
verified that production's base commit `57d8f1a2` was an ancestor of HEAD and concluded HEAD was a
strict superset of production. That inference is only valid if production was *built from a commit*.
It was built from a dirty tree with 24 unmerged commits behind it, and no ancestry check can detect
work that has no commit in your history.

**"No migrations to apply" is ambiguous and was read one way.** `wrangler d1 migrations list
--remote` answered `✅ No migrations to apply!` for both remote D1s, and this was recorded as
"production has applied 0105, same as HEAD". The command actually reports that the local chain is
not *ahead* of production. It says exactly the same thing when production is *ahead of you*.
Production was in fact at **0107**. Reading `d1_migrations` directly — which was not done before the
deploy — would have shown `0106_return_replacement_sales.sql` and
`0107_receipt_numbers_business_format.sql` applied, and those two rows alone would have proved the
live build came from a branch `main` did not have.

**The dirty working tree looked like the only copy of the orphaned lanes.** It was not; commit
`7afc8a71` ("import the 2026-09-03 ChatGPT working-tree batch as found in the main checkout") had
already captured that batch onto the hotfix branch, with review fixes on top. The tree was a subset
of a branch nobody had looked at.

**A near-miss: renumbering an already-applied migration.** Following the standing "new migrations
take 0108 or later" rule, `0106_return_replacement_sales.sql` was renamed to `0108_…` in the shared
tree. Production has already applied that migration *under its 0106 filename*. Shipping it as 0108
would have made D1 treat it as new and re-run `ALTER TABLE returns ADD COLUMN replacement_sale_id`,
failing the deploy. Caught by reading `d1_migrations`; reverted before it shipped. **An applied
migration's filename is frozen** — the renumbering rule applies only to migrations that have never
run anywhere.

## The evidence trail that identified the lost build

| Question | Command | Answer |
|---|---|---|
| What was live before? | `npx wrangler deployments list` | `0a531d53…` at 07:26:26Z; mine `d701ddc1…` at 08:41:57Z |
| What does prod's schema prove? | `wrangler d1 execute business-os --remote --command "SELECT id, name FROM d1_migrations ORDER BY id DESC LIMIT 4"` | top id **107**; **106** = `0106_return_replacement_sales.sql` |
| Which branch has those? | `git ls-tree --name-only <branch> cloudflare/migrations/` | `hotfix/prod-2026-09-03` carries both 0106 and 0107 |
| Which lanes landed just before? | `git for-each-ref --sort=-committerdate` | `hf/*` merges at 13:00–14:13 **+07** = 06:00–07:13Z, minutes before the 07:26Z deploy |
| What did the hotfix branch contain? | `git merge-base --is-ancestor <lane> hotfix/prod-2026-09-03` | `hf/receipt-ui`, `hf/receipt`, `hf/dates`, `hf/backup`, `hf/adjust-fail`, `lane-c/app-update-prompt`, `claude/item-corrections-keys-a25bb5` |

Timestamps are the trap: `wrangler` reports UTC, repo commit dates here are +07. Convert before
comparing or the topology reads backwards.

`8e961357 feat(sales): return straight from the sale receipt` is the commit behind the user's
missing Returns button.

**There is no record of the 07:26 deploy in `progress.md`.** That omission is the whole reason
provenance had to be reconstructed from Cloudflare and D1 under time pressure with a live regression
open. Write the record.

## What was rebuilt

Branch **`reconcile/2026-09-03`**, built in an isolated worktree at
`C:/Users/mrkl6/Downloads/bos-rec` so the shared dirty tree and the sessions working in it were never
touched. Merged in order, committing between each:

1. `hotfix/prod-2026-09-03` (24 ahead of main) — the deployed baseline.
2. `hf/search` (+9) — the reviewed by-id stock fix, superseding the hand-applied version.
3. `hf/returns` (+7) — matches the live 0106 schema.
4. `hf/review-fixes` (+6) — dashboard default range is the business day, out-of-stock grouped rows
   become an opt-in, catalog-wide inventory alerts, two stale-closure filter hooks.

Then three commits of this session's own work on top: the malformed-id hardening plus its lock test,
and the test-assertion repair.

**Deliberately excluded**, because they were never merged into the hotfix branch and so were almost
certainly not in the build being restored — including them would be new code shipped under cover of
a restore: `hf/merge` (2), `hf/customers-perf` (1), `lane/6d-delivery-rename-parity` (1),
`rc/coordinated-2026-09-02` (149).

### Conflicts were unions, not choices

Four conflicts, and picking a side would have silently deleted work in every one:

- **`lang/en.json` + `km.json`, three blocks** — each side had *added* distinct keys. Unioned with
  dedupe. Two gotchas: the side that had been the object's last entry loses its trailing comma when
  the other side's keys are appended after it (re-`JSON.parse` to catch it), and this checkout is
  `autocrlf`, so line-ending-sensitive regexes must match `\r?\n`.
- **`frontend/package.json`, twice** — the `test:utils` chain is one very long single line and each
  lane appends its own `node tests/<name>.test.ts`. A side-pick drops a lane's test from the chain
  CI runs, silently and permanently. Unioning recovered `returnsExchangeFlow.test.ts` and
  `hookDepsFilterState.test.ts`.

### One red that was the test's fault, not the code's

`test-products-by-id-lookup-pure.cjs` went red after the `hf/search` merge on
`splitSearchTermGroups(query.query || query.q || query.search || '')`. The behaviour was intact —
that lane reads the term into a named variable so its barcode-equality probe can reuse the raw text.
The assertion was pinning source formatting. Fixed the assertion to match the alias chain and the
parser feed. **A red on a merged branch is a suspect, not a verdict.**

## The stock-integrity bug fixed along the way

Separate from the reconciliation, and live in production the whole time.

`GET /api/products/search` accepted `ids` from every client
(`frontend/src/api/productReadTransport.ts` → `getProductsByIds`) and **never read it**. A silently
dropped filter on a list endpoint is not "an unfiltered list" to a by-id caller — it is the **wrong
record**, because every by-id consumer asks for one id and takes `items[0]`. Verified against a
production snapshot: `?ids=7231&pageSize=1` answered `total 10212` with `items[0] = id 1`. Opening
Adjust Stock on the id-7231 product loaded, and would have written stock against, the catalog's first
row by name. The same silent-drop shape broke the Change-stock picker's search box, which sent
`search=` — an alias the route did not read either, so every keystroke and scan returned the whole
catalog with a `200`.

Fixed server-side (`ids`/`id` honoured, `search` accepted as a third alias, `/filters` strips all
three), client-side (`canonicalizeSearchTerm` at the single transport chokepoint every picker goes
through, by-id payloads filtered to the requested ids, cache key versioned to `v2` so a client cannot
serve a pre-fix cached answer), and at each by-id consumer (`StockAdjustModal`, `Inventory`,
`Products.fetchProductsByIds` resolve by id, never `items[0]`).

**One hardening beyond what `hf/search` shipped:** `Number.parseInt` stops at the first non-digit, so
`ids=1.5.2` parsed to `1` and the lookup answered with product 1. A malformed id resolving to a
*different valid product* is the same wrong-record failure one step further in. Whole-token digits
only now; anything else falls through to the `1 = 0` branch and the caller keeps the row the operator
picked.

`cloudflare/scripts/test-products-by-id-lookup-pure.cjs` locks it: it extracts the real `ids` block
out of the shipped source and **runs** it, so an edit that keeps the words but breaks the fail-closed
branch, the dedupe or the 100-id clamp goes red. It is path-independent (every path resolved from
`__dirname`) — unlike `test-inventory-adjust-set-pure.cjs`, which reads CWD-relative paths and so
only passes when run from `cloudflare/`, reading as a false RED under the sweep command CLAUDE.md
documents. That harness defect is still open.

## Also landed on `main` earlier this session

- `fced3086` — the 30 unresolved i18n keys; `verify:i18n` exits 0 for the first time in days.
- `c570a37e` — KHR on the receipt is a Grand-Total-only line. The four sub-line flags default off,
  and because a saved template overrides defaults (`normalizeReceiptTemplate` merges
  `{...DEFAULT, ...saved}` and ReceiptSettings auto-saves the whole template), a
  `template_revision` field performs a **one-time upgrade** for businesses that already saved one —
  no production data write, and a later deliberate re-enable by the user is preserved. `Driver`
  became `Delivery` on the receipt and, in the reconcile branch, on the sale card too.
- Repaired `cloudflare/node_modules/.bin/tsc`, which was missing entirely while `typescript@5.9.3`
  was installed, so `npx tsc` fell through to the registry. `CHECKPOINT.md` blamed a lost executable
  bit; the real cause was the absent shim. `npm install` in `cloudflare/` recreated it. This repaired
  the command CLAUDE.md documents for every session.

## Open after this

- The three excluded lanes above, if wanted — as a separate, separately-verified step.
- `rc/coordinated-2026-09-02` (149 ahead, 4 conflicts) — needs its `0106_barcode_aliases.sql`
  renumbered (0106 and 0107 are both taken and applied) and a rebase onto main's 0105.
- `test-inventory-adjust-set-pure.cjs`'s CWD-relative paths.
- The returns framing question the user raised — see the session-log Part; the original sale is
  immutable, so it is a return plus a **new linked sale** joined by `returns.replacement_sale_id` /
  `sales.source_return_id`, not a multi-role edit of the sale.
- `hf-adjust-fail` is still split across two directories after the worktree restoration; a Windows
  file lock blocked the last move.
