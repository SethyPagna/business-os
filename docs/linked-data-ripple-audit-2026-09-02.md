# Linked-data ripple audit — Stage 1

Scope: UXA-04 only. This audit verifies rename/merge effects across current
lists, nested details, filters, reports, exports, receipts, search/read caches
and live refresh. It does not authorize deployment, migration application, or
production writes.

## Data contract

| Reference | Authority | Mutable linked display data | Preserved point-in-time data |
| --- | --- | --- | --- |
| Customer | `customers.id` | Sales customer fields, returns, share submissions, AR links/names, loyalty and portal-account links | Audit/action payloads |
| Supplier | `suppliers.id` where schema supports it | Return supplier, batch supplier, AP links/names; legacy `products.supplier` and name-only lots use exact normalized equality | Audit/action payloads; receipt cost and catalog cost |
| Delivery contact | `delivery_contacts.id` | Sales courier id/name | Audit/action payloads |
| User/cashier | `users.id` | Operational cashier/creator snapshots in sales, returns, stock, transfers, files, imports and live action history | `audit_logs.user_name` |
| Product | `products.id` | Current catalog/search/filter/detail rows | Sale-item and inventory-movement product-name/cost snapshots |
| Category/unit | Lookup-row id; product membership is legacy text | Product primary and exact `||` membership text, rewritten atomically with the lookup row | Sales/movement/audit snapshots |
| Brand | Saved settings library plus current product text | Product primary/membership and brand library/color map in one batch | Sales/movement/audit snapshots |
| Payment method | Exact normalized configured text | Settings only, or sales summary/detail JSON when the user explicitly chooses linked scope | Audit/action payloads |
| Inventory/return reason | Exact normalized configured text | Preset only, or linked operational rows when explicitly selected | Audit/action payloads; return reason replacement preserves inventory movements |
| Expense label/type | Exact normalized fee text | Fee rows and reports | Audit/action payloads |

No reference rename/merge statement writes product cost, receipt cost, batch
cost, barcode or selling price. Product identity and cost rules remain outside
the generic reference cascade.

## Stage-1 findings and fixes

- Category/unit carry and delete changed product rows without advancing the
  `products` cache version. They now advance it before signalling the live
  product refresh.
- Contact merge repointed stable IDs but retained the merged-away customer,
  supplier or courier name in operational rows. Customer sale/return/share
  fields, supplier-return names and delivery names now follow the survivor ID.
- Supplier free-text carry used case-sensitive equality in one merge path. It
  now uses trimmed, case-normalized exact equality; there is still no fuzzy or
  wildcard rewrite.
- Customer, supplier, delivery and cashier changes did not invalidate every
  dependent cache namespace or refresh already-open consumers. Dependency
  versions and Sales/Returns/Inventory/Branches/Files/Review subscriptions are
  now wired.
- A cache-version write and its WebSocket broadcast could race. The affected
  reference routes now await the version advancement before emitting the live
  refresh signal.
- Open Sales receipt/detail and Return detail/editor surfaces retained the row
  object captured on click. They now rebind to refreshed list rows by stable
  sale/return ID.
- The cashier filter and shared supplier-name suggestion cache could retain a
  renamed value. User broadcasts invalidate cashier options; supplier
  broadcasts invalidate the module cache and reload an open Product form.

## Reproducible evidence

- `cloudflare/scripts/test-contact-merge-repoints-pure.cjs` executes the real
  migration chain in SQLite and proves stable-ID repoints plus current display
  snapshot carry for customer, supplier and delivery merges.
- `cloudflare/scripts/test-reference-atomicity-pure.cjs` proves lookup/product
  rewrites roll back together and costs remain unchanged.
- `cloudflare/scripts/test-rename-cascade-pure.cjs` proves exact category,
  brand, unit, supplier and product-name carry behavior.
- `cloudflare/scripts/test-user-rename-cascade-pure.cjs` proves all id-scoped
  user snapshots update together while `audit_logs` is excluded.
- `cloudflare/scripts/test-linked-reference-ripple-pure.cjs` pins cache-version
  dependencies, version-before-broadcast ordering, live subscriptions, nested
  detail refresh, filter invalidation and no-cost/no-audit guards.

## Stage-2 live gates

After deployment authorization, use two authenticated clients and verify each
reference mutation while the affected list, detail, filter, report and export
surface is already open. Confirm the second client receives one live signal,
the following request uses the new cache version, printed/80-mm receipt views
show the intended mutable identity fields, immutable product/cost evidence is
unchanged, and reconnecting an offline client clears stale read-cache entries.
Repeat once with cache-version storage in its D1 fallback mode. Collision,
permission-denied, optimistic-conflict and cancelled-preview paths must produce
no partial rewrite and no false refresh success.

Stage 1 performed no deploy, migration apply, production write or cost change.
