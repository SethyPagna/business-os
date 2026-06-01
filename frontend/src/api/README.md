# Frontend API Guide

This folder is the browser-side transport layer for Business OS.

## Files

- `http.ts`
  - low-level HTTP request wrapper
  - auth token attachment, retry handling, offline/server-unreachable detection
  - runtime version mismatch, Cloudflare Access redirect, transient gateway, write-dedupe, and read-fallback classification

- `methods.ts`
  - named Business OS API calls used by page components
  - keeps request/response shapes centralized so UI pages do not hand-roll endpoints
  - next high-risk TypeScript target because it is still the large domain registry

- `query.ts`
  - typed query-string and positive-id normalization helpers shared by `methods.ts`
  - keeps pure request-shaping logic outside the remaining `ts-nocheck` domain registry

- `queryCache.ts`
  - bounded read-query cache helpers stored in Dexie settings rows
  - keeps cache key construction, TTL reads, writes, and sync-update invalidation scans outside the large domain registry

- `localMirrors.ts`
  - local Dexie mirror write/purge helpers for server read fallbacks
  - keeps live-server mirror policy, sensitive table purge state, and mirror write fan-out outside the large domain registry

- `syncRuntime.ts`
  - sync event, service-worker outbox registration, and stored-session helpers
  - keeps offline queue signalling shared between `methods.ts` and `web-api.ts`

- `browserDialogs.ts`
  - browser CSV picker and image/data-url compatibility fallbacks
  - keeps DOM file-input behavior and CSV decoding outside the large domain registry

- `systemJobs.ts`
  - system job polling, cancellation, and backup folder queue transport helpers
  - keeps long-running backup job API mechanics outside the large domain registry

- `systemRuntime.ts`
  - system config/debug reads, integration doctor, reset/factory reset, sync server URL test, folder/path helpers, and scale migration transport
  - keeps filesystem-facing system calls and long-timeout system transport outside the large domain registry

- `authTransport.ts`
  - login/logout, password reset, OTP/2FA, session-duration, owned Google OAuth, and organization lookup transport
  - keeps direct auth and organization HTTP calls outside the large domain registry

- `aiTransport.ts`
  - AI provider CRUD/test transport and AI response reads with actor attribution
  - keeps AI provider route keys and direct `/api/ai/*` calls outside the large domain registry

- `actionHistoryTransport.ts`
  - action history read/create/update/undo/redo transport with device attribution
  - keeps history route keys and mutation payload shaping outside the large domain registry

- `inventoryTransport.ts`
  - inventory stock actions, summary/stats, product search, movement history, and reason transport
  - keeps inventory query caching, page bounds, and device-attributed stock writes outside the large domain registry

- `rfidTransport.ts`
  - RFID gateway status, tag search/create, session event/review/apply transport
  - keeps RFID route keys, id encoding, and device-attributed RFID writes outside the large domain registry

- `portalTransport.ts`
  - customer portal catalog/config/submission/AI transport plus review actions
  - keeps portal timeout headers and API-version mismatch handling outside the large domain registry

- `driveSync.ts`
  - Google Drive sync status, cooldown-aware fallback, preferences, OAuth, and job queue transport
  - keeps Drive sync polling/action mechanics outside the large domain registry

- `notificationSummary.ts`
  - notification summary polling, cooldown-aware fallback, and request sharing
  - keeps transient notification availability mechanics outside the large domain registry

- `expectedUpdatedAt.ts`
  - optimistic-update payload helpers for row and settings writes
  - keeps updated-at conflict metadata lookup outside the large domain registry

- `requestIds.ts`
  - idempotency key helpers for write payloads
  - keeps client request-id creation and trimming consistent across products, POS, contacts, inventory, and returns

- `conflicts.ts`
  - compact conflict-attempt payload builders for settings and return items
  - strips server metadata before rendering retry/merge context

- `syncPreview.ts`
  - bounded pending-sync queue preview serializer
  - keeps queue popovers light while preserving enough metadata for status and retry review

- `actorQuery.ts`
  - current-user context reader and actor query-string helper
  - keeps user attribution parameters consistent for AI, user, role, upload, and delete calls

- `portalHttp.ts`
  - portal base URL resolver and abortable public-portal fetch helper
  - keeps public catalog, membership, submission, and portal AI reads on one timeout path

- `importTransport.ts`
  - import-job multipart headers, live-server form POSTs, and import payload device metadata
  - keeps CSV, ZIP, image, and error-download transport details out of the large domain registry

- `cooldownFallbacks.ts`
  - notification summary and Drive sync status fallback/cooldown helpers
  - keeps transient-gateway backoff state and typed fallback payloads outside the large domain registry

- `localDb.ts`
  - Dexie-based browser storage for offline queues and local cache helpers

- `websocket.ts`
  - realtime sync channel client used by the shared app shell

- `../web-api.ts`
  - installs `window.api`, owns offline vault sync, background sync registration, service-worker event forwarding, and lazy domain-method loading

## Rules

1. Add new API calls here before wiring them into pages.
2. Keep auth/session handling centralized here so page components stay declarative.
3. Prefer stable method names that describe the business action, not just the URL.
4. TypeScript conversions should add real boundaries: typed payloads, typed timers, and typed event details; add compatibility wrappers only when existing JSX imports cannot safely move yet.
