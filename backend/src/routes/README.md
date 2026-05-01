# Routes Folder Guide

Each file in this folder owns one API domain and is mounted by `backend/server.js`.

## Runtime Contract

Route files sit behind the shared middleware stack from `server.js`, so by the time a handler runs it already has:

- parsed JSON/form bodies
- request context metadata
- security headers
- cache policy on API responses
- auth middleware where the route requires it

## Domain Ownership

- `auth.js` - login, OTP, password reset, verification capabilities
- `users.js` - users, roles, profile, contact verification
- `products.js` - product CRUD, variants, images, bulk import
- `importJobs.js` - asynchronous CSV/TSV and media import jobs
- `inventory.js` - adjustments, movement history, inventory summaries
- `sales.js` - sale creation, status changes, dashboard analytics
- `returns.js` - customer and supplier return workflows
- `contacts.js` - customers, suppliers, delivery contacts
- `portal.js` - public customer portal config, membership lookup, review submissions
- `settings.js` - settings read/write APIs
- `system.js` - backup, import/export, reset, integrity, data-path tools
- `branches.js`, `categories.js`, `units.js`, `customTables.js`, `catalog.js` - supporting domain endpoints

## Route Handler Checklist

1. Validate payloads and enforce domain constraints.
2. Enforce authorization server-side; never trust frontend role state.
3. Write audit entries for sensitive mutations.
4. Broadcast the affected sync channels.
5. Keep response shapes consistent with shared helpers.
