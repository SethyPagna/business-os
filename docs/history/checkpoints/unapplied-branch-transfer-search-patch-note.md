# Unapplied patch note — "Branch/Transfer search fix"

**Status: unverified / not known to have been applied as a distinct patch.**
This is the original content of the repo-root `README.md`, moved here
2026-09-02 during the Section-9 hygiene pass because it was never a project
README — it was an instruction note for a zip patch, most likely dropped at
the repo root by mistake or left behind after being extracted.

**Source-check done 2026-09-02 (read-only):** the specific fix this note
describes — folding `barcode` into `TransferModal.tsx`'s client-side fuzzy
match for the "Multiple products" transfer mode — **is present in current
source** (`frontend/src/components/branches/TransferModal.tsx`, the
`fuzzyTextMatches` call joins `product.name, product.sku, product.barcode`,
with a comment citing the same reasoning this note gives: "leaving barcode
out of this client-side path was the last place..."). The four backend files
this note names (`branches.ts`, `products.ts`, `compat.ts`,
`stockLedgerQuery.ts`) all reference `PRODUCT_SEARCH_COLUMNS` /
`barcode`-inclusive search helpers. This is consistent with the fix having
landed — either via this exact patch at some point, or independently — but
was **not traced to a specific commit or session-log Part**, so treat it as
"apparently already applied," not confirmed applied-via-this-patch. Do not
reapply this patch without first diffing it against current source; it may
now be a no-op or, worse, a regression against later changes to the same
files.

---

## Original note (verbatim)

# Branch/Transfer search fix

Extract this zip's contents directly into the root of your project repo
(same folder that contains `cloudflare/` and `frontend/`) and let it
overwrite these 5 files:

- cloudflare/src/routes/branches.ts
- cloudflare/src/routes/products.ts
- cloudflare/src/routes/compat.ts
- cloudflare/src/lib/stockLedgerQuery.ts
- frontend/src/components/branches/TransferModal.tsx

Verified against the uploaded repo:
- `cd cloudflare && npx tsc --noEmit`  -> clean
- `cd frontend && npx tsc --noEmit -p tsconfig.json` -> clean

See chat for the root-cause writeup of each bug and what changed beyond
the update_code.zip originally provided (added `barcode` into the
"Multiple products" transfer mode's client-side fuzzy match, which had
been dropped even in that update).
