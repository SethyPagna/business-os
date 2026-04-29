# File and Folder Responsibility Map

## Top-Level

- `backend/`
  - Server runtime, API routes, schema, security, and integration services.
- `frontend/`
  - React application and UI domain components.
- `scripts/`
  - Utility/verification scripts.
- `release/`
  - Packaged distributable artifacts.
- `business-os-data/`
  - Runtime data folder (db, uploads, backups).

## Backend

### `backend/server.js`

Entry point. Mounts route modules, static assets, and websocket attachment.

### `backend/src/config/index.js`

Runtime path and environment resolution.

### `backend/src/database.js`

SQLite schema definition, migrations, seed defaults, and baseline indexes.

### `backend/src/helpers.js`

Cross-cutting helpers:

- response format
- audit writes
- websocket broadcast
- CSV utilities
- integrity utility functions

### `backend/src/middleware.js`

Request auth token check, upload middleware, and image handling.

### `backend/src/security.js`

Rate-limit and abuse control primitives, encryption/secure utility helpers.

### `backend/src/requestContext.js`

Captures request metadata for audit/trace context.

### `backend/src/websocket.js`

WebSocket connection handling and shared client registry.

### `backend/src/services/`

- `firebaseAuth.js`:
  - auth-provider provisioning/sync/token verification.
- `verification.js`:
  - one-time code issuance/verification and delivery provider abstraction.

### `backend/src/routes/`

Domain ownership by file:

- `auth.js`: login, OTP, verification-code auth, password reset.
- `users.js`: users/roles/profile/security management.
- `products.js`: product CRUD, variants, images, bulk import.
- `inventory.js`: stock adjustments, inventory summaries/movements.
- `sales.js`: sale creation and analytics/dashboard outputs.
- `returns.js`: customer and supplier returns.
- `contacts.js`: customer/supplier/delivery-contact management.
- `portal.js`: public customer portal config/catalog/membership/submissions.
- `system.js`: backup/import/reset/integrity/data-path operations.
- `settings.js`, `categories.js`, `branches.js`, `units.js`, `customTables.js`, `catalog.js`: supporting domain APIs.

## Frontend

### App Shell

- `frontend/src/App.jsx`
- `frontend/src/AppContext.jsx`
- `frontend/src/index.jsx`

These define app lifecycle, global context, navigation, and startup.

### API and Data Access

- `frontend/src/api/http.js`
- `frontend/src/api/methods.js`
- `frontend/src/api/websocket.js`
- `frontend/src/api/localDb.js`

These centralize backend calls, websocket sync listening, and local cache helpers.

### Pages / Domains

- `components/dashboard/`, `components/inventory/`, `components/pos/`, `components/products/`, `components/returns/`, `components/sales/`, `components/users/`, `components/utils-settings/`, etc.

Each folder owns UI + interaction logic for a business domain.

### Shared UI and Metadata

- `components/shared/*`
  - modal, page help, navigation configuration.
- `lang/en.json`, `lang/km.json`
  - translation catalogs.

### Utility Functions

- `utils/*`
  - formatting, CSV helpers, printing helpers, Firebase phone helper.

## Interconnection Hotspots

When changing these, review all linked modules:

- Auth/security: `routes/auth.js`, `routes/users.js`, `services/firebaseAuth.js`, `services/verification.js`, `security.js`.
- Inventory correctness: `routes/sales.js`, `routes/returns.js`, `routes/inventory.js`, `database.js`, `helpers.js` integrity helpers.
- Customer portal: `routes/portal.js`, `routes/settings.js`, `frontend/components/CatalogPage.jsx`, `lang/*`.
- Backup/import/reset: `routes/system/index.js`, `database.js`, `frontend/components/utils-settings/Backup.jsx`, `ResetData.jsx`.
