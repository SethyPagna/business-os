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
