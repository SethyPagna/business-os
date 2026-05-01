# Architecture Overview

## Runtime Model

Business OS is a Node.js backend with an SPA frontend and required local scale services:

- Backend: Express + SQLite (`better-sqlite3`) + WebSocket (`ws`).
- Frontend: React + Vite build artifacts served by backend.
- Storage: local SQLite file and local uploads folder under `business-os-data` remain authoritative by default.
- Scale services: Docker Compose starts Redis, Postgres, and MinIO for import queues and verified future migration targets.
- Sync/UI refresh: backend broadcasts channel updates via WebSocket `sync:update`.

The backend is the source of truth for all business data. Frontend state is view/cache only. Postgres/MinIO are not used as the live data store until an admin explicitly completes the in-app migration wizard. The migration panel can automate the safety phase today: local backup first, Google Drive sync when connected, and no live storage switch until verified migration support is unlocked.

## Major Layers

### 1) Entry and Runtime

- `backend/server.js`
  - Creates Express app and HTTP server.
  - Mounts route modules.
  - Attaches WebSocket server.
  - Serves uploads and frontend dist.
  - Handles global error mapping and graceful shutdown.

### 2) Configuration and Paths

- `backend/src/config/index.js`
  - Resolves runtime directory (source vs packaged EXE).
  - Loads `.env`.
  - Resolves storage root via `data-location.json` or defaults.
  - Resolves organization data under `business-os-data/organizations/<public_id> (<sanitized-name>)/`.
  - Exposes derived paths (`DB_PATH`, `UPLOADS_PATH`, `IMPORTS_PATH`, `FRONTEND_DIST`) and scale service config.

### 3) Database and Schema

- `backend/src/database.js`
  - Creates/updates schema.
  - Runs safe migrations.
  - Seeds defaults (including primary admin and Admin role).
  - Enforces baseline indexes and default settings.

### 4) Shared Utilities

- `backend/src/helpers.js`
  - Response helpers (`ok`, `err`), audit logging, websocket broadcast, CSV import helpers.
- `backend/src/security.js`
  - Rate limiting, abuse lockout, encryption helpers, secure comparisons.
- `backend/src/middleware.js`
  - API token auth, upload middleware, image constraints/compression.
- `backend/src/requestContext.js`
  - Captures device/client headers for audit metadata.

### 5) Domain Routes

- `backend/src/routes/*`
  - Each file owns one business domain (auth, users, products, sales, returns, portal, etc.).
  - Routes coordinate validation + db writes + audit + broadcast.

### 6) Services

- `backend/src/services/verification.js`
  - Email/SMS verification capability abstraction and code lifecycle.
- `backend/src/services/importJobs.js`
  - Queue-backed large import jobs, BullMQ/Redis queue driver, and SQLite fallback for compatibility modes.
- `backend/src/services/googleDriveSync.js`
  - Google Drive OAuth and data sync integration.

### 7) Frontend

- `frontend/src/App.jsx`
  - Shell, navigation routing, page composition.
- `frontend/src/api/*`
  - HTTP + websocket client wrappers, local IndexedDB cache helpers.
- `frontend/src/components/*`
  - Domain UI pages and subcomponents.
- `frontend/src/lang/*`
  - i18n dictionaries (English, Khmer).

## Security Model

### Auth and Session

- Supports username/email + password, OTP 2FA, and verification-code flows.
- `authToken` middleware enforces API token when `SYNC_TOKEN` is configured.
- Login and verification routes enforce rate limits and abuse lockouts.

### Authorization

- Authorization is backend-enforced on every write path.
- User-management policy:
  - Admin-control users can manage non-admin users.
  - Users can self-manage only their own profile/security.
  - Admin-to-admin cross-edit is blocked.
  - Primary `admin` account is protected from deactivation/deletion.

### Audit Trail

- Sensitive actions are logged to `audit_logs` with device/client metadata.
- Audit failures are non-fatal by design (no business-write rollback from log failure).

## Data Flow Interconnections

### Sales

Sales write path updates:

1. `sales`
2. `sale_items`
3. inventory movement rows
4. product/branch stock quantities
5. loyalty points adjustments
6. dashboard/stat queries via derived sums

### Returns

Returns write path updates:

1. `returns`
2. `return_items`
3. stock restoration or supplier-return movement logic
4. refund/tax/profit-related aggregated stats

### Customer Portal

- Public portal endpoints read product/member settings from core tables/settings.
- Portal behavior is controlled by `settings` keys under `customer_portal_*`.
- Submission review writes feed into loyalty points and audit channels.

## Release and Portability

- `run\build-release.bat` assembles a portable folder and installer.
- Release output includes the shared runtime bootstrapper and Docker Compose config.
- `run\start-server.bat` is the one-button runtime path: it verifies scale service health before launching the app.
- Existing `business-os-data` and `.env` in release folder are preserved on rebuild.
- Data path can be relocated and persisted via `data-location.json`.
