# Schema Relationships and Logic

This document summarizes core SQLite entities and how they connect in application logic.

## Core Identity and Access

- `users`
  - PK: `id`
  - Role link: `role_id -> roles.id` (logical relation)
  - Auth metadata: `otp_*`, `email_verified`, `phone_verified`, `firebase_user_id`
- `roles`
  - PK: `id`
  - Stores permission templates (`permissions` JSON).
  - System role supported via `code` + `is_system` (Admin role lock).

## Catalog and Inventory

- `products`
  - PK: `id`
  - Optional hierarchy: `parent_id` for variants.
  - Pricing: selling/purchase/cost in USD/KHR.
  - Aggregated stock field: `stock_quantity` (derived from branch stock/movements).
- `product_images`
  - FK-like: `product_id -> products.id` (declared with cascade).
- `branch_stock`
  - Unique pair: `(product_id, branch_id)`.
  - Represents stock position per branch.
- `inventory_movements`
  - Ledger-like table for stock events.
  - Used to verify/repair stock consistency.
- `stock_transfers`
  - Captures inter-branch stock transfer records.

## Contacts

- `customers`
  - Membership link via unique `membership_number` index.
- `suppliers`
- `delivery_contacts`

These are referenced by sales/returns UI and reporting joins.

## Sales and Returns

- `sales`
  - PK: `id`, optional `receipt_number` unique.
  - Holds transaction totals, discount/tax/delivery fields, status fields.
- `sale_items`
  - FK-like: `sale_id -> sales.id` (declared cascade).
  - Contains snapshot pricing/cost per sold line.
- `returns`
  - PK: `id`, optional `return_number` unique.
  - Supports customer returns and supplier-return workflow fields.
- `return_items`
  - FK-like: `return_id -> returns.id` (declared cascade).
  - Maps returned quantities and financial values.

## Settings and Dynamic Structures

- `settings`
  - Key-value table for app/runtime behavior.
  - Customer portal config is expressed as `customer_portal_*` keys.
- `custom_fields`
  - Dynamic schema fields by entity type.
- `custom_tables`
  - Metadata for user-defined tables (`ct_*`), with runtime-created physical tables.

## Audit and Verification

- `audit_logs`
  - Append-only operational trace with user/action/entity details and device metadata.
- `verification_codes`
  - One-time code lifecycle (issue, expire, consume) for login/reset/contact verification.

## Relationship Summary

Logical relationship graph:

- `roles` 1 -> N `users`
- `users` 1 -> N `sales` (cashier reference by id/name snapshot)
- `users` 1 -> N `returns` (cashier reference by id/name snapshot)
- `products` 1 -> N `product_images`
- `products` N <-> N `branches` through `branch_stock`
- `sales` 1 -> N `sale_items`
- `returns` 1 -> N `return_items`
- `customers` 1 -> N `sales` / `returns` (snapshot-style linkage)
- `suppliers` 1 -> N supplier-return records in `returns`

## Derived and Reconciled Data

These values are not purely raw input and may be recomputed/repaired:

- `products.stock_quantity`
  - Derived from branch stock or movement reconciliation.
- Dashboard and inventory stats
  - Derived from sales/sale_items/returns/return_items and related status filters.
- Membership/points balances
  - Derived from loyalty rules + sale/return events + manual adjustments.

## Import/Backup Considerations

- Backup import clears/replaces known tables in FK-safe order.
- Unknown columns are ignored; missing columns default to NULL.
- Post-import repairs:
  - relational consistency cleanup,
  - branch default checks,
  - product stock recomputation,
  - primary admin + Admin role reassertion.

