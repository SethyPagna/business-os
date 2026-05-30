# Backend Route Reference

Mounted in `backend/server.js`.

## Auth

Base: `/api/auth`  
File: `backend/src/routes/auth.ts`

- `GET /verification-capabilities`
- `POST /login`
- `POST /login/request-code`
- `POST /login/verify-code`
- `POST /otp/verify`
- `POST /otp/setup`
- `POST /otp/confirm`
- `POST /otp/disable`
- `GET /otp/status/:userId`
- `POST /password-reset/request`
- `POST /password-reset/complete`

## Settings

Base: `/api/settings`  
File: `backend/src/routes/settings.ts`

- `GET /`
- `POST /`

## Categories

Base: `/api/categories`  
File: `backend/src/routes/categories.ts`

- `GET /`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

## Units + Custom Fields

Bases: `/api/units`, `/api/custom-fields`  
File: `backend/src/routes/units.ts`

## Branches and Transfers

Base: `/api/branches`  
File: `backend/src/routes/branches.ts`

- `GET /`
- `POST /`
- `PUT /:id`
- `DELETE /:id`
- `GET /:id/stock`
- `GET /transfers/list`
- `POST /transfer`

Compatibility alias:

- `GET /api/transfers` (in `server.js`)

## Products

Base: `/api/products`  
File: `backend/src/routes/products.js`

- `GET /`
- `POST /variant`
- `POST /`
- `PUT /:id`
- `DELETE /:id`
- `POST /upload-image`
- `POST /bulk-import`

## Import Jobs

Base: `/api/import-jobs`
File: `backend/src/routes/importJobs.ts`

- `GET /`
- `POST /`
- `GET /:id`
- `POST /:id/csv`
- `POST /:id/zip`
- `POST /:id/images`
- `POST /:id/start`
- `POST /:id/approve`
- `POST /:id/cancel`
- `POST /:id/retry`
- `GET /:id/errors.csv`
- `GET /:id/failed-rows.csv`
- `DELETE /:id`

Cancelled or cancelling jobs cannot be started. Retry clears stale cancellation state and re-queues analysis. Product import preflight treats spreadsheet scientific-notation barcodes as blocking review issues.

## Catalog (internal lightweight read API)

Base: `/api/catalog`  
File: `backend/src/routes/catalog.ts`

- `GET /meta`
- `GET /products`

## Customer Portal (public + admin review endpoints)

Base: `/api/portal`  
File: `backend/src/routes/portal.ts`

- `GET /config`
- `GET /catalog/meta`
- `GET /catalog/products`
- `GET /membership/:membershipNumber`
- `POST /submissions`
- `GET /submissions/review` (auth)
- `PATCH /submissions/:id/review` (auth)

## Inventory

Base: `/api/inventory`  
File: `backend/src/routes/inventory.js`

- `POST /adjust`
- `GET /summary`
- `GET /movements` (`userId` filter is admin-only)

## Sales + Dashboard + Analytics

Base: `/api`  
File: `backend/src/routes/sales.js`

- `POST /sales`
- `PATCH /sales/:id/status`
- `PATCH /sales/:id/customer`
- `GET /sales` (`userId` filter is admin-only)
- `GET /sales/export`
- `GET /dashboard`
- `GET /analytics`

## Contacts

Base: `/api`  
File: `backend/src/routes/contacts.ts`

- Customers (`/customers`, `/customers/:id`, bulk import)
- Suppliers (`/suppliers`, `/suppliers/:id`, bulk import)
- Delivery contacts (`/delivery-contacts`, `/delivery-contacts/:id`, bulk import)

## Users and Roles

Base: `/api`  
File: `backend/src/routes/users.ts`

- Users CRUD + profile + password + contact verification
- Role CRUD
- Avatar upload

## Returns

Base: `/api`  
File: `backend/src/routes/returns.ts`

- `GET /returns`
- `GET /returns/:id`
- `POST /returns`
- `POST /returns/supplier`
- `PATCH /returns/:id`

## Custom Tables

Base: `/api/custom-tables`  
File: `backend/src/routes/customTables.ts`

- table metadata CRUD and row CRUD for runtime `ct_*` tables.

## System / Backup / Reset / Data Path

Base: `/api/system`  
File: `backend/src/routes/system/index.js`

- `GET /audit-logs` supports server pagination, search, action/entity/date filters, and admin-only `userId`
- `DELETE /audit-logs/retention?olderThanDays=30&confirm=1` is admin-only
- audit/debug
- backup export/import
- sales/full reset and factory reset
- integrity verify/repair
- data path read/update/delete
- folder browsing/open/picker endpoints
- integration doctor and health diagnostics are read-only

## Action History

Base: `/api/action-history`
File: `backend/src/routes/actionHistory.ts`

- `GET /` supports scoped history and admin-only `userId` filtering for all-history views.
