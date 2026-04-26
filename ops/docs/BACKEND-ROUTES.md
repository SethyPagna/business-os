# Backend Route Reference

Mounted in `backend/server.js`.

## Auth

Base: `/api/auth`  
File: `backend/src/routes/auth.js`

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
File: `backend/src/routes/settings.js`

- `GET /`
- `POST /`

## Categories

Base: `/api/categories`  
File: `backend/src/routes/categories.js`

- `GET /`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

## Units + Custom Fields

Bases: `/api/units`, `/api/custom-fields`  
File: `backend/src/routes/units.js`

## Branches and Transfers

Base: `/api/branches`  
File: `backend/src/routes/branches.js`

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

## Catalog (internal lightweight read API)

Base: `/api/catalog`  
File: `backend/src/routes/catalog.js`

- `GET /meta`
- `GET /products`

## Customer Portal (public + admin review endpoints)

Base: `/api/portal`  
File: `backend/src/routes/portal.js`

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
- `GET /movements`

## Sales + Dashboard + Analytics

Base: `/api`  
File: `backend/src/routes/sales.js`

- `POST /sales`
- `PATCH /sales/:id/status`
- `PATCH /sales/:id/customer`
- `GET /sales`
- `GET /sales/export`
- `GET /dashboard`
- `GET /analytics`

## Contacts

Base: `/api`  
File: `backend/src/routes/contacts.js`

- Customers (`/customers`, `/customers/:id`, bulk import)
- Suppliers (`/suppliers`, `/suppliers/:id`, bulk import)
- Delivery contacts (`/delivery-contacts`, `/delivery-contacts/:id`, bulk import)

## Users and Roles

Base: `/api`  
File: `backend/src/routes/users.js`

- Users CRUD + profile + password + contact verification
- Role CRUD
- Avatar upload

## Returns

Base: `/api`  
File: `backend/src/routes/returns.js`

- `GET /returns`
- `GET /returns/:id`
- `POST /returns`
- `POST /returns/supplier`
- `PATCH /returns/:id`

## Custom Tables

Base: `/api/custom-tables`  
File: `backend/src/routes/customTables.js`

- table metadata CRUD and row CRUD for runtime `ct_*` tables.

## System / Backup / Reset / Data Path

Base: `/api/system`  
File: `backend/src/routes/system.js`

- audit/debug
- backup export/import
- sales/full reset and factory reset
- integrity verify/repair
- data path read/update/delete
- folder browsing/open/picker endpoints

