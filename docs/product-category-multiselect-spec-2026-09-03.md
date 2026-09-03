# Design spec — searchable, browsable, multi-select Categories in the product edit detail

Written Sep 3 2026 by session business-os-v1-14 (docs only, no code). Every fact below was read
from **committed HEAD `a43a3cdf`** via `git show HEAD:<path>` — never the working copy, because the
main tree carries ~63 dirty files that are the ChatGPT/Codex surface's in-flight batch. It is
**reference to re-verify** before a lane starts. Routed to the multi-session coordinate plan
(`bos-rc/docs/plans/coordinated-plan-2026-09-02.md` on `rc/coordinated-2026-09-02`, live board
`bos-rc-workers/task-board-2026-09-03.md`, coordinator `business-os-v1-d9`) as item **B12**.
Nothing here is implemented.

**Revision 2** (same day) folds in the user's answers to all four of the questions this spec
originally left open — Brand ships with Category, Unit stays single-value, categories are capped at
5, and the storefront gets a primary-plus-ellipsis reveal. Those are decisions now, recorded in
§10 with the verbatim wording, and they have already been pushed back through §3, §3.2, §4 and
§4.1. **Revisions 3 and 4** close the last ambiguity: the storefront's filter clause was put back
to the user directly rather than inferred — they chose the *matched* category, then refined the
affordance to "matched and +n number of categories", so the card carries one label plus a `+N`
counter rather than an ellipsis (§4.1). No question in this spec is left to the lane's judgement.

Standing rules this spec is written against: root cause over symptom, sibling-surface parity in the
same commit, both language packs, per-action permission keys, floats over inline expansion,
truncated text revealable, a failed save keeps the form intact, verified for real in both packages
and in the browser.

---

## 0. The ask

> "the edit detail, the categories doesn't have search and show option available and can do
> multiple categories."

Three separate defects in one field:

| # | Defect | Today |
|---|---|---|
| A | **No search** | The only way to narrow the list is to overwrite the field's own value |
| B | **No "show options"** | Nothing reveals the full list; on an edit the list is already collapsed to the current value |
| C | **Single value only** | Picking an option replaces the previous one |

---

## 1. What is actually there today (HEAD `a43a3cdf`)

The Category control in the product edit detail is `SuggestionTextInput`, a component defined
inside the form file itself — `frontend/src/components/products/forms/ProductForm.tsx:206` (props)
and `:220` (body), rendered for Category at `:1389-1397`.

Its entire behaviour:

- One `<input>` holding the value; the popover opens on **focus** and on every keystroke.
- The match list is computed from the **field's own value**:
  `if (!normalized || key.includes(normalized)) unique.push(option)` — the "search term" *is* the
  stored value. On a **new** product the field is empty and the full list appears; on an **edit**
  the field is prefilled, so the list collapses to options containing the current category. That is
  defect **B**, and it is precisely why the user hit this in the *edit* detail.
- No chevron, caret or other affordance opens the list without typing, so the only route back to
  the full list is to clear a value the user did not want to lose (defect **A**).
- Clicking an option calls `onChange(option)` — a **replacement**, not an addition (defect **C**).
- No keyboard support: no arrow-key navigation, no Enter-to-select, no Escape-to-close, no
  `role="combobox"` / `aria-expanded` / `role="listbox"` — only an `aria-label`. The popover closes
  on a 120 ms blur timer.
- Options come from `categorySuggestionOptions` (`:569`) = the lookup library's names only. The
  `categories` lookup table also carries a **color** (`routes/products.ts:3331`,
  `SELECT id, name, color FROM categories`) that the picker never shows.

**The same component also serves Brand (`:1401`) and Unit (`:1413`)**, so all three fields carry
all three defects. Fixing the component fixes them together — that is the root cause; patching the
Category field alone would be the symptom fix.

Payload shape: the form initialises and sends `category` only (`:436`, `:1394`). It never sends
`categories`.

---

## 2. The backend already supports multiple categories — the gap is UI-only

This is a *prepared-not-live* capability, not new backend work. Verified along the full write path,
not just the readers (a coalescing reader is not proof that the writer round-trips):

| Layer | Evidence (HEAD `a43a3cdf`) |
|---|---|
| Schema | `cloudflare/migrations/0033_product_multi_category_brand.sql` — `ALTER TABLE products ADD COLUMN categories TEXT` + `brands TEXT`; nullable, `\|\|`-delimited, primary value included, no backfill required |
| Normalizer | `cloudflare/src/lib/productWrites.ts:140-159` `normalizeMultiValue(primary, rawMulti)` — accepts a **JS array** or an already-`\|\|`-joined string, unshifts the primary, dedupes case-insensitively, re-joins |
| Create | `routes/products.ts:1646` calls it, then `insertRow` |
| Update | `routes/products.ts:1894-1896`, guarded by `'category' in body \|\| 'categories' in body` so an unrelated edit cannot wipe the list |
| **Persistence** | `productWrites.ts:90-117` — `insertRow`/`updateRow` build their column list from `tableColumns(env, table)` (the live PRAGMA), so `categories` **is** written the moment it is in the body. There is no hand-maintained allowlist to extend |
| Search | `routes/products.ts:885-896` — `MULTI_VALUE_COLUMNS = { brand: 'brands', category: 'categories' }`, reading `COALESCE(categories, category)` |
| Inventory filter | `routes/inventory.ts:260` `categoryMatchOne` matches `p.categories` with `\|\|` delimiters |
| Import | `lib/importEngine.ts:1106`, `:1206` already carry `categories` / `brands` |

**Consequence:** sending `categories: ["Skincare", "Serums"]` from the edit form is accepted end to
end today. Expect this lane to be almost entirely frontend. Re-verify against `c2bb7e6c` before
building, and still prove the round-trip at layer 4 (§8) rather than trusting this table.

### 2.1 One real backend gap found while verifying — "remove every category" cannot clear the list

`normalizeMultiValue('', [])` returns `undefined`, and `undefined` means *leave the column alone*
(that is deliberate — it stops a single-value caller from flattening an existing list). Combined
with the `'category' in body` guard on the update path, the result is:

> A user who removes **every** category from a product clears `products.category` but leaves
> `products.categories` holding the old list — and search/filter read
> `COALESCE(categories, category)`, so the product keeps appearing under categories it no longer
> has.

Nothing can hit this today because no UI can send an empty list. The multi-select is exactly the UI
that will. **The lane must fix this in the same commit**: distinguish "field absent" (leave alone)
from "field present and empty" (write `NULL`), and cover it with a pure test in
`cloudflare/scripts/`.

---

## 3. The control to build

Replace `SuggestionTextInput` with **one shared component** (suggested home:
`frontend/src/components/shared/LookupMultiSelect.tsx`) used by Category and Brand in multi mode
and Unit in single mode, so the three fields cannot drift apart again.

Requirements, each traceable to a defect or a standing rule:

1. **Search (defect A).** A dedicated search input *inside* the popover, separate from the chosen
   values. Typing filters; it never mutates what is already selected.
2. **Show options (defect B).** An always-present chevron button opens the full, unfiltered list
   with zero typing — including when values are already chosen. Focus still opens it too.
3. **Multiple (defect C).** Selected categories render as removable chips in the field; list rows
   are checkboxes (toggle, not replace); a live "N of 5 selected" count. **Capped at 5 categories
   per product** (user decision, §10). At the cap the unselected rows go disabled with a short
   reason rather than silently ignoring the click, and removing a chip re-enables them.
4. **Free text stays possible.** Today an operator may type a category that does not exist yet
   (`ProductForm.tsx:217` says so explicitly). Keep it as an explicit **"Create 'X'"** row so the
   capability is not lost in the rewrite.
5. **Float, don't push.** The popover floats above content and never displaces the form below it.
6. **Keyboard + a11y.** `role="combobox"` + `aria-expanded` on the trigger; `role="listbox"` /
   `option` + `aria-selected` on rows; arrow keys to move, Enter to toggle, Escape to close,
   Backspace on an empty search removes the last chip. Rows stay `min-h-11` (44 px).
7. **Hierarchical "Main - Sub" grouping.** Reuse `utils/categoryGrouping.ts` and the group
   semantics already shared by `components/shared/CategoryFilterOptions.tsx`, so picking "Haircare"
   in the *editor* behaves the way picking it in the *filters* does.
8. **Long names revealable.** Chips and rows use the shared truncated-text reveal, never a dead "…".
9. **A failed save keeps everything.** If the PUT fails the dialog stays open, every chip intact,
   the reason shown.
10. **Both language packs**, keys in §7.

### 3.1 Primary vs the list — the one rule

`products.category` stays the **single primary** column: every sort, group-by, facet and legacy
report reads it, and `0033`'s own comment commits to that. `products.categories` is the **full list
including the primary as its first element** — exactly what `normalizeMultiValue` produces.

So the UI contract is: **the first chip is the primary**, with an explicit "make primary" action on
the other chips, and the form always sends `category = categories[0]`. Lock it with a source-shape
test, not a comment — a form that sends a `category` not equal to `categories[0]` would silently
mis-sort the catalog.

### 3.2 The cap is one rule with one implementation

The 5-category cap is a business rule, so it does not live only in the picker. One shared constant,
enforced in the component **and** in `normalizeMultiValue` / the product write routes (reject or
truncate deterministically, with a clear error), and therefore also on the paths that never touch
the picker: **CSV import**, bulk edit, and the undo/redo replay. A cap enforced only in the UI is
the exact shape of bug this project keeps finding — the importer would happily write eight
categories that no editor can then represent. Cover it with a pure test in `cloudflare/scripts/`
alongside the §2.1 empty-list test.

---

## 4. Sibling surfaces — same unit of work

A capability lands on every sibling surface in the same commit. Verdicts are from HEAD and are the
lane's checklist, not a suggestion.

| Surface | File (HEAD) | Today | Required |
|---|---|---|---|
| Product edit/create — Category | `products/forms/ProductForm.tsx:1389` | single, no search, no show-all | the new control, multi |
| Product edit/create — Brand | `ProductForm.tsx:1401` | same defects; `products.brands` exists | the new control, multi — **in the same commit as Category** (user decision, §10) |
| Product edit/create — Unit | `ProductForm.tsx:1413` | same defects | the new control in **single** mode — a product keeps exactly one unit (user decision, §10) — but it still gains search + show-all |
| Variant form | `products/forms/VariantFormModal.tsx:149` (`category: parent.category`) | inherits the single primary | must inherit the whole list |
| Bulk import | `products/import/BulkImportModal.tsx:477`, `:2187`, `:2820` | maps a single `category` column | accept a delimited `categories` column, map it, let the review grid edit it |
| Bulk edit / mass assign | Products page bulk actions | single | multi, same control |
| Product detail read views | `products/surfaces/ProductDetailModal.tsx:257`, `ProductRowParts.tsx`, `inventory/ProductDetailModal.tsx:127` | render `p.category` only | render every category; in a **row** use the same one-label-plus-`+N` pattern as §4.1 so admin and storefront read alike, expanded to chips in the detail sheet |
| Export | `products/ExportFieldsModal.tsx:35` | basic group names `category` | export the full list |
| Filters — Products / Inventory / POS / portal | `shared/CategoryFilterOptions.tsx`, `utils/multiSelect.ts`, `pos/FilterPanel.tsx`, `catalog/PortalFilterCombobox.tsx` | **already multi-select**, and the backend already matches `p.categories` | no build — but **verify** a two-category product appears under *both* |
| Manage categories | `products/lookups/ManageCategoriesModal.tsx` | usage counts + rename/merge | counts must include multi-membership; rename/merge must rewrite **every element** of the `\|\|` list (`routes/lookups.ts:222` claims it rewrites `products.category/categories` — verify element-wise) |
| Storefront / public portal | `catalog/*` | — | one label + `+N` counter, matched label under a filter, see §4.1; only public categories, never internal facets |

Two rules that bite here specifically:

- **Rename cascade.** A category rename must move *every* linked record, including products where
  the renamed category is a **non-primary** element. A substring replace on a `\|\|`-joined string
  is the obvious wrong implementation — "Hair" would corrupt "Haircare".
- **Undo/redo.** The product-edit undo appliers must restore `category` and `categories` together,
  or an undo silently drops the extra categories.

### 4.1 Storefront display contract (user decision, §10)

The user's words: *"so for the default we show primary with elipses...when user click on it it
shows all in details... when filter search it shows..."*

Which reads as three rules:

1. **Default** — a product shows **one** category label followed by a **`+N` counter** when it
   carries more, where N is the number of categories not shown (a product with 3 categories reads
   `Skincare +2`). The counter is a real control, not a truncated string, and not a bare "…" — the
   user asked for the count explicitly ("matched and +n number of categories") so the shopper can
   see *how much* more there is before deciding to open it. A product with exactly one category
   shows no counter.
2. **On click/tap** — the `+N` reveals the **full** category list in the detail view. It must be
   genuinely revealable rather than a dead end (shared truncated-text reveal), and the reveal
   **floats over** content rather than pushing the page down.
3. **Under a filter or search** — the product surfaces under **every** category it carries, not
   only the primary, **and the label swaps from the primary to whichever category matched the
   filter**, so the shopper can see why the product is in these results. The `+N` counter stays,
   now counting the product's other categories (`Serums +2`). The backend already supports the
   query half (`COALESCE(categories, category)`), so this is display work.

Rule 3 was the least explicit clause in the user's message; it was put back to them directly rather
than guessed, and **they chose "show the matched category"** over always showing the primary and
over expanding the card to list every match — then refined the affordance to *"matched and +n
number of categories"*, which is why rules 1 and 3 both carry a counter rather than an ellipsis.

Edge case the lane must settle without asking again: when a filter matches **more than one** of a
product's categories, show the first match in the product's own category order (the primary-first
order stored in `categories`) and count the rest into `+N`. That keeps the card to one label plus
one counter, which is the shape all three rules assume.

`+N` is a composed string, so it needs a real i18n entry with the number interpolated — not an
English "+" concatenated onto a translated word — and Khmer numerals/format verified rather than
assumed. Same treatment on every surface that adopts the pattern.

---

## 5. Permissions

Editing a product's categories belongs to the product-edit grant; managing the category library is
the lookups grant. Model both as per-action keys and make them visible in the permission editor — a
read-only tier sees the chips and cannot open the picker (no dead controls). Any new key lands in
the permission editor and both packs in the same commit.

---

## 6. Data / migration

**No migration is needed** — `0033` already added the columns and every reader uses
`COALESCE(categories, category)`, so existing rows with `categories IS NULL` are already correct.
**Do not write a backfill.** For whoever needs a number later: `0106` is taken by the ChatGPT
batch, `0107` is claimed by d9.

---

## 7. i18n

Already in `frontend/src/lang/en.json`: `categories` (:934), `category` (:935), `no_category`
(:2609), `noCategory` (:2584). The `type_or_select_category` / `_brand` strings are inline `tr()`
fallbacks in ProductForm.

New keys, in **both** packs, with Khmer verified from authoritative sources rather than guessed:
search categories, show all categories, create category "X", primary category, make primary, remove
category, "N of 5 selected", cap-reached reason, no matching categories, and the **`+N` counter**
from §4.1 as an interpolated entry (never an English "+" concatenated onto a translated word).
`npm run verify:i18n` must exit 0.

---

## 8. Verification the lane owes

- **Layer 1** — `cd frontend && npm run test:utils && npm run verify:i18n && npm run build`;
  `cd cloudflare && npx tsc --noEmit` plus every `scripts/test-*.cjs` run individually.
- **Layer 3, matrix** — every writer × {one category, two categories, **all categories removed**
  (§2.1), duplicate/case-variant input, a name containing `\|\|`, a name containing `-` that looks
  hierarchical}: create, edit, variant, bulk edit, CSV import, undo, redo.
- **Layer 4, live API** — `PUT /products/:id` with `categories: ["A","B"]`, then assert with
  `better-sqlite3` that `products.categories = 'A||B'` **and** `products.category = 'A'`; then
  `GET /products/search` filtered by `B` returns the row; then PUT an empty list and assert
  `categories IS NULL`.
- **Layer 5, browser** — at 5173, desktop **and** 375 px: open the edit detail of a product that
  already has a category, click the chevron and confirm the **full** list appears (the reported
  defect), type to filter, select a second category, save, reopen, confirm both chips survive, then
  confirm the product appears under both categories in the Products filter. Expected vs actual per
  row.

**Trap to avoid:** `GET /api/products/search` reads its search term from `query` / `q` **only** —
not `search`, not `ids`. Two live bugs today come from exactly that mistake. Any picker that
searches through that endpoint must send `query:`.

---

## 9. Sequencing

Do **not** start this in the main checkout: its ~63 dirty tracked files are the ChatGPT/Codex
in-flight batch, already live in production (Worker `546e1c30`), and must not be edited, staged,
checked out or reverted. Base the lane on d9's hotfix base `c2bb7e6c` in an isolated worktree under
`bos-rc-workers`. The item is parked behind the production hotfix as **B12** and is scheduled when
the user re-opens the RC lanes.

**Expect the base to move.** d9 has opened `hf/review-fixes` on `hotfix/prod-2026-09-03` to fix
forward a dashboard regression in the same ChatGPT batch (`compat.ts` `productInRangeClause`
scoping the stock and alert cards to the selected date range). Re-confirm the base commit with d9
at the moment the lane starts rather than reusing `c2bb7e6c` from this document — this spec is
reference to re-verify, and that is exactly the field most likely to have gone stale.

---

## 10. Decisions (user, Sep 3 — all four answered)

These were open questions in the first version of this spec (`538e9783`); the user answered all
four the same day, relayed through the coordinate-plan verification session. They are decisions
now, not proposals.

| # | Question | Decision |
|---|---|---|
| 1 | Brand multi-select too? | **Yes** — "brands too". Category and Brand ship multi-select **in one commit**; they share the broken component |
| 2 | Unit multi-value? | **No** — "Unit stays single-value". A product keeps exactly one unit; Unit still gets the search + show-all fix from the shared component |
| 3 | A cap per product? | **Yes — 5 categories.** Enforced as one rule in the picker *and* the backend, so import/bulk-edit/undo cannot exceed it (§3.2) |
| 4 | Storefront display | **A third shape, not either option offered** — one category label plus a **`+N` counter** ("matched and +n number of categories"), the full list on click, and under a filter the label shown is the **matched** category rather than the primary. Verbatim wording and the three rules are in §4.1 |

**Nothing in this spec is left to a guess.** The one clause that was ambiguous — "when filter
search it shows..." — was put back to the user rather than inferred, and they chose *show the
matched category* over always showing the primary and over expanding the card to list every match.
§4.1 also settles the follow-on edge case (a filter matching several of a product's categories)
so the lane does not have to re-open the question mid-build.
