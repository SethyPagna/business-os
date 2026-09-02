# Product web-verification workflow

A cautious, repeatable way to check a catalog product's name against the
open web, using the product's current NAME as primary evidence and its
BARCODE(s) as corroborating evidence only -- per the coordinated plan's
Section 7 brief and the standing rule "search by both barcode and name, not
name alone."

**This tool never writes to the product catalogue.** It reads a product
export and produces a CSV/XLSX review sheet. A human has to read that
sheet, decide row by row, and apply the ones they approve through a
separate, explicit step -- see "What this does not do" below.

## Why this lives at `ops/product-verification/`, not inside
`ops/scripts/migration/`

`ops/scripts/migration/official-name-recertification.mjs` and its sibling
`build-official-name-recertification.mjs` are narrow, one-batch tools: they
are hard-coded to the id range 6032-6104 (`validateReviewRows`'s
`firstId`/`lastId` defaults and its exact-73-row assertion) and to a single
migration's guarded-SQL apply step. This workflow is meant to be run again
and again, against any product export, indefinitely -- it has no batch ID
range, no row-count assertion, and no apply step at all (see below). Folding
a general, repeatable, provider-pluggable search+reconcile engine into a
directory whose own tests assert "exactly 73 rows, ids 6032-6104" would
either break that assertion or force it to special-case an unbounded input,
neither of which belongs in a one-batch migration script.

What it does **not** do is invent a parallel review vocabulary. Its output
sheet uses the *exact same 20 `REVIEW_HEADERS` columns*
`official-name-recertification.mjs` already defines and knows how to read
(imported directly from that file, not redefined -- see
`verify-products.mjs`'s `REVIEW_HEADERS` export) plus 4 extension columns
appended after them. A human, or that script's own `--validate-only` /
`buildGuardedSql` path, can point at this tool's output and find the columns
it expects in the positions it expects them.

## Quick start

```sh
# from the repo root
node ops/product-verification/verify-products.mjs \
  --input ops/product-verification/fixtures/sample-input.json \
  --out   ops/product-verification/fixtures/sample-output/review.csv \
  --provider mock \
  --fixtures ops/product-verification/fixtures/sample-evidence \
  --xlsx
```

This replays the checked-in sample fixtures (offline, deterministic, no
network) and writes `review.csv` + `review.xlsx`. See "Sample run" below
for what it produces.

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--input <csv\|json>` | *(required)* | Product export to verify. |
| `--out <csv>` | *(required)* | Where to write the review sheet. |
| `--provider mock\|http` | `mock` | Evidence source -- see "Providers" below. |
| `--fixtures <dir>` | `fixtures/sample-evidence` | Mock provider's fixture directory. |
| `--cache-dir <dir>` | `.cache` | Disk cache directory (gitignored). |
| `--delay-ms <n>` | `250` | Delay between provider calls (rate limiting). |
| `--xlsx` | off | Also write a `.xlsx` next to `--out`. |
| `--limit <n>` | all | Only process the first `n` input rows (smoke-testing). |

### Input format

CSV or JSON, one row per product. Column names accept either this tool's
own names or the REVIEW_HEADERS names, so a REVIEW_HEADERS-shaped export
(e.g. `official-name-recertification.mjs`'s own review CSV) can be fed back
in directly:

| Column (either name works) | Meaning |
| --- | --- |
| `id` | Product id. |
| `name` / `current_name` / `expected_shop_name` | Current catalog display name. |
| `brand` / `expected_brand` | Current brand. |
| `category` / `expected_category` | Current category. |
| `description` / `current_description` | Full `products.description` text (see "No `official_name` column" below). |
| `official_name` / `current_official_name` | Use directly if you already have it extracted; otherwise leave blank and it is derived from `description`. |
| `barcodes` / `expected_barcode` | `\|` or `;` separated list (comma is not a separator -- a barcode may be a bare number). |
| `prior_barcodes` | Barcode(s) on record at the last verification pass, for `barcode_changed` detection. |
| `prior_confidence` / `prior_evidence` | Passed straight through to the output sheet's `prior_confidence` / `prior_evidence` columns. |

### No `official_name` column

There is no `official_name` column in the live `products` table (checked
against `cloudflare/migrations/0001_init.sql`) -- the value lives as one
labelled section inside the free-text `description` column, alongside up to
four others (introduction, features & benefits, who is it for, ingredients
-- see `cloudflare/src/lib/productDescriptionSections.ts`'s
`SECTION_ORDER`), written as `Official Product Name:\n<value>` and joined
with the other present sections by a blank line
(`cloudflare/src/lib/importEngine.ts`'s `buildDescriptionFromColumns`,
`frontend/src/components/catalog/productDetailSections.ts`'s
`parseProductDescription`). `lib/description.mjs`'s
`extractOfficialNameFromDescription` is a minimal, **read-only** port of
that label-matching rule -- this workflow never writes a description (see
below), so there is no write-side port to keep in sync.

## Providers

`providers/provider.mjs` documents the two-method interface
(`searchByName`, `searchByBarcode`). Two are included:

- **`mock`** (default) -- replays pre-recorded evidence from
  `--fixtures/<productId>.json`. Deterministic and offline; used for tests
  and the sample run. A product with no fixture file gets no evidence (a
  legitimate low-confidence outcome, not an error).
- **`http`** -- a real web search via `providers/httpProvider.mjs`, using
  Node's built-in `fetch`. Requires an environment variable
  `PRODUCT_VERIFY_SEARCH_KEY` (and `PRODUCT_VERIFY_SEARCH_CSE_ID` for the
  `google-cse` type). **No key is stored in this repo.** Set
  `PRODUCT_VERIFY_SEARCH_TYPE` to `serper` (default), `google-cse`, or
  `bing`. Every raw result is passed through `lib/matchAssessment.mjs`'s
  `assessHit()` -- a token-overlap heuristic, conservative by design (it
  returns `false` when uncertain rather than guessing a match) -- before
  reaching `reconcile.mjs`.

A third option the codebase already has a convention for --
`groq/compound`'s built-in web research (`cloudflare/src/lib/aiGateway.ts`'s
`providerCanUseWebResearch` / `enabled_tools: ['web_search','visit_website']`)
-- was left out of this pass: it needs an encrypted D1 secret
(`decryptSecret`) that this standalone Node script has no access to, and
the coordinator's note treating it as "an optional provider, not a
requirement" meant it did not block this section. `providers/provider.mjs`'s
interface is the seam a `groqProvider.mjs` would implement if someone wants
to add it later (call Groq's public chat-completions endpoint directly with
`compound_custom.tools.enabled_tools`, using an env var such as
`PRODUCT_VERIFY_GROQ_API_KEY` -- never a value baked into this repo -- and
pipe its response through the same `assessHit`-shaped contract the other
two providers use).

## Reconciliation rules (`reconcile.mjs`)

Pure, dependency-free, unit-tested (`reconcile.test.mjs`, 18 cases, run with
`node --test`). Given a product row plus the name-search hits and
per-barcode-search hits collected for it:

- **Confidence**
  - **high** -- the name is confirmed by hits from >=2 independent source
    *domains* that agree on brand + product line, AND at least one real
    (non-junk) barcode has a hit that also agrees.
  - **medium** -- the name is confirmed (>=2 domains) but no real barcode
    corroborates it (junk/shared/absent barcode, or a real barcode with no
    matching web evidence) -- OR the name is confirmed but a real barcode's
    evidence points to a different variant/size (lowered from high, never
    silently overridden: the name evidence is still real evidence).
  - **low** -- the name is not independently confirmed: zero or one
    source, or a barcode-only match with no independent name agreement. A
    barcode match alone never reaches high, and never rescues confidence
    by itself, however strong.
  - "Independent" means distinct source domains, not distinct URLs on the
    same retailer.
- **Flags** -- `multi_barcode` (more than one distinct barcode on record,
  after collapsing leading-zero-padding duplicates), `junk_barcode` (no
  barcode on record, or at least one recorded barcode is blank/zero/too
  short/non-numeric/a bad GTIN check digit), `barcode_changed` (current
  barcodes differ from `prior_barcodes`, ignoring leading-zero padding),
  `name_barcode_conflict` (a real barcode's evidence agrees on brand +
  product but not on variant/size -- a different pack/bundle/shade),
  `shared_barcode` (a real barcode has web results, but none describe this
  product at all -- the code is registered to something else), and
  `variant_ambiguous` (name sources agree on the product line but split
  across multiple distinct variant names, with none reaching its own
  2-domain confirmation).
- **Barcode canonicalization** -- `lib/barcode.mjs` validates GTIN-8/12/13/14
  check digits and strips a single leading zero before comparing two
  barcodes, so "the same code with/without a leading zero" (a real,
  recurring pattern in this catalog's spreadsheet-sourced data -- numeric
  cells silently drop a leading zero) is never mistaken for a genuinely
  different code or a `barcode_changed` event.

## Reading the sheet

Each row is one product. The 20 shared `REVIEW_HEADERS` columns (imported
from `official-name-recertification.mjs`) plus 4 extension columns:

| Column | Source |
| --- | --- |
| `id`, `expected_shop_name`, `expected_barcode` (first barcode only), `expected_brand`, `expected_category`, `expected_old_description` | The input row, as given. |
| `proposed_official_name` | `reconcile.mjs`'s majority-vote name across agreeing sources, or the current name when the name isn't confirmed. |
| `barcode_aliases` | Any *additional* barcodes on record beyond the first (`\|`-joined). |
| `official_source_url`, `independent_source_url`, `barcode_source_url` | The first name-search hit, a second name-search hit from a different domain (when one exists), and the first barcode-search hit, picked out of `reconcile.mjs`'s full evidence trail. |
| `confidence`, `unresolved_notes` | `reconcile.mjs`'s confidence tier and its plain-language rationale. |
| `review_status` | Derived from confidence: high -> `verified`, medium -> `probable`, low -> `hold`. This tool never sets `approved` itself. |
| `evidence_notes` | The full evidence trail (every hit, its URL, title, and which query found it). |
| `prior_confidence`, `prior_evidence` | Passed through from the input row, unchanged, when present. |
| `approved_for_apply`, `reviewed_by`, `reviewed_at_utc` | Always `false` / blank / blank -- these are for a human reviewer to fill in, never this tool. |
| `current_official_name` *(extension)* | Extracted from the input's `description` via `lib/description.mjs`, or the input's explicit official-name column. |
| `barcodes` *(extension)* | Every barcode on record for this product, `;`-joined. |
| `flags` *(extension)* | Every flag raised, `;`-joined -- see "Reconciliation rules" above. |
| `evidence` *(extension)* | Identical to `evidence_notes` -- kept as its own column since some spreadsheet tooling truncates a long value differently depending on column width; having it twice costs one column and nothing else. |

## What this does not do

- **It never writes to the `products` table, or anywhere else in the live
  catalogue.** `approved_for_apply` is always written `false`; `reviewed_by`
  and `reviewed_at_utc` are always blank. A human has to review the sheet,
  change those three columns by hand (or through whatever review UI reads
  this sheet), and only then does a *separate* apply step -- such as
  `official-name-recertification.mjs`'s own `buildGuardedSql`, or a
  future equivalent -- get to act on a row.
- **It is not safe to point `official-name-recertification.mjs`'s
  `buildGuardedSql` at this tool's output unmodified**, beyond the
  id-range/row-count mismatch already noted above. `buildGuardedSql`
  replaces a product's *entire* `description` column with a single
  `Official Product Name:\n<value>` string
  (`ops/scripts/migration/official-name-recertification.mjs`) -- correct
  for the one migration batch it was built for (ids 6032-6104, which only
  ever carried that one section), but destructive for any product whose
  description also carries introduction / features & benefits / who is it
  for / ingredients sections: applying that guarded SQL to a general
  product would silently delete those other sections. A general apply step
  for this tool's output would need to update just the `official_name`
  section in place (mirroring `sanitizeImportedDescription`'s join logic in
  `cloudflare/src/lib/productDescriptionSections.ts`) rather than
  overwrite the whole column. No such apply step exists yet -- writing one
  was out of scope for this section's brief, which stops at "review sheet,
  never an automatic catalogue write."
- **It never fails the whole run on one bad product.** A lookup error for a
  single row is recorded as a low-confidence, `lookup_error`-flagged row,
  and the run continues (`verify-products.mjs`'s `runVerification`).

## Sample run

`fixtures/build-sample.mjs` builds a 30-product sample
(`fixtures/sample-input.json` + one fixture per product under
`fixtures/sample-evidence/`) from real prior-verification data -- see
`fixtures/sample-evidence/README.md` for exactly which real artifact backs
each product, and the one gap in the real data (no product currently has a
genuine second real barcode on record) that a handful of clearly-labelled
constructed rows cover instead. Regenerate it with:

```sh
node ops/product-verification/fixtures/build-sample.mjs
```

Run it (mock provider, fully offline):

```sh
node ops/product-verification/verify-products.mjs \
  --input ops/product-verification/fixtures/sample-input.json \
  --out   ops/product-verification/fixtures/sample-output/review.csv \
  --provider mock --fixtures ops/product-verification/fixtures/sample-evidence --xlsx
```

30 products, 0 lookup errors. Summary: 6 high, 10 medium, 14 low; flags --
5 `multi_barcode`, 3 `barcode_changed`, 8 `junk_barcode`, 2
`name_barcode_conflict`, 1 `shared_barcode`, 1 `variant_ambiguous`. See the
Section 7 report for the full 30-row designed-tier-vs-actual-confidence
table and a discussion of the 4 rows where this tool's stricter
"barcode must also corroborate for high" rule disagrees with an earlier
pass's own (looser) rubric.
