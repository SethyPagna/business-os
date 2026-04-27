# Business OS Optimization Roadmap

This roadmap turns the broad optimization ideas into a step-by-step plan for
Business OS specifically. The goal is not "maximum caching" or "maximum
cleverness"; the goal is fast, reliable, secure business software that behaves
well on slower remote links and across long-running sessions.

## Guiding Rules

1. Local-first beats network-first for business data reads.
2. Static assets may be cached aggressively; HTML and API data should not be
   cached by the service worker.
3. Deploy safety matters more than squeezing out one more benchmark point.
4. Conflict handling must be explicit for writes that can happen from multiple
   devices.
5. We prefer boring reliability over brittle "offline magic".

## Already Applied

- Frontend route and vendor chunking for the heavy shell.
- Local Dexie cache for core data tables.
- Safer auth/session rotation handling.
- WebSocket handoff protection during token changes.
- Basic optimistic write-conflict guards for core master data.
- Minimal service worker strategy:
  - caches static same-origin assets only
  - does not cache HTML
  - does not cache API traffic
  - does not cache uploads or user-generated media
- Backend compression is enabled when the optional `compression` package is
  installed.

## Phase 1: Safe Wins

These changes are low-risk and should improve speed without making deploys or
 sync behavior harder to trust.

### 1.1 Reduce request waterfalls after login

- Add one lightweight bootstrap endpoint that returns:
  - current user
  - organization summary
  - permissions
  - session expiry
  - app settings needed immediately
- Use that response to populate the shell before deeper page-specific fetches.

Why:
- fewer round trips on Tailscale Funnel
- less "first click after login" instability
- lower chance of early 401 noise from staggered requests

### 1.2 Break large frontend features by user intent

Highest priority split targets:
- `CatalogPage`
  - public shell
  - portal editor
  - about/media editor
  - membership lookup
  - share/reward review queue
- `Products`
  - list/table
  - editor modal
  - import/export actions
  - analytics/detail panels

Why:
- reduces memory pressure
- reduces navigation latency after long sessions
- keeps heavy editing features out of simple read-only visits

### 1.3 Namespace translation files

Current translation payloads are still large.

Split by namespace instead of per-language monolith:
- `auth`
- `shell`
- `dashboard`
- `products`
- `contacts`
- `settings`
- `portal`

Why:
- smaller first render
- avoids pulling portal/product copy when a user only opens dashboard

### 1.4 Strengthen table and list rendering

Apply virtualization where data can grow significantly:
- products
- customers
- suppliers
- audit log
- files/library

Why:
- improves long-session responsiveness
- lowers CPU and memory cost on weaker devices

## Phase 2: Sync Reliability

These changes should make multi-device behavior more predictable.

### 2.1 Formalize per-table sync metadata

Add sync metadata for syncable tables:
- `updated_at`
- `updated_by`
- `version`
- optional `deleted_at` for soft deletes where appropriate

Use this for:
- stale write detection
- delta sync
- conflict reporting

### 2.2 Move from broad refreshes to delta sync

Instead of refreshing whole datasets after many operations:
- sync by table
- sync by `updated_at` cursor
- fetch only changes since the last known checkpoint

Why:
- less bandwidth
- faster remote devices
- less UI churn after writes

### 2.3 Add explicit conflict outcomes

Current conflict handling is mostly optimistic rejection.

Next step:
- detect conflict type:
  - stale update
  - stale delete
  - deleted-on-server
  - version mismatch
- return structured payload:
  - client copy
  - server copy
  - conflict reason
  - conflict timestamp

Frontend then decides:
- retry automatically
- prompt user
- merge safe fields

### 2.4 Background sync queue discipline

Keep the queue, but tighten policy:
- queue writes only for approved operations
- pause non-critical sync when tab hidden
- resume on focus, reconnect, or after critical user actions
- batch retries to avoid thrash

Why:
- smoother UI
- less background churn on weak links

## Phase 3: Heavy Work Off Main Thread

### 3.1 Move CPU-heavy workflows into workers

Best candidates:
- CSV parsing/import
- report generation
- sync diff calculation
- large Dexie write batches

Why:
- avoids UI freezes
- keeps navigation smooth during imports and sync

### 3.2 Chunk Dexie hydration and writes

Avoid large synchronous DB work on startup:
- hydrate only what the current route needs
- write in batches of a few hundred rows
- avoid clearing and replacing very large tables unless necessary

Why:
- less startup jank
- fewer freezes when data volumes grow

## Phase 4: Data Layout and Organization Isolation

### 4.1 Move the live runtime data root fully under organization-owned paths

Current state:
- org scaffolding exists
- live source-of-truth paths are still not fully rooted under the org runtime

Target:
- each organization owns its own:
  - DB
  - uploads
  - imports
  - exports
  - backups
  - logs

Why:
- cleaner tenant separation
- easier backup/restore per organization
- less accidental data bleed between future businesses

### 4.2 Add startup migration/version coordination

When code changes or schema changes:
- store an app/build version marker
- store a schema version marker
- run explicit migrations at startup
- surface migration status in admin diagnostics

Why:
- safer updates
- clearer handling when one device upgrades before another

## Phase 5: Observability and Failure Visibility

### 5.1 Add real client-side diagnostics

Track and expose:
- slow route loads
- repeated local fallback usage
- sync queue backlog
- websocket reconnect counts
- auth refresh failures

### 5.2 Add server-side performance counters

Track:
- slow queries
- slow API routes
- sync conflict frequency
- upload processing duration

Why:
- lets us fix real bottlenecks instead of guessing from anecdotal lag

## Ideas We Should Avoid or Delay

These ideas are either risky for this architecture or not worth the complexity
right now.

### Avoid in the service worker

- API response caching
- HTML caching
- offline write replay in the service worker
- caching uploads/media that users may replace frequently

Why:
- stale business data
- hard-to-debug deploy mismatches
- greater risk of "works on one device, not another"

### Delay until architecture changes

- edge/serverless-first backend deployment for the full app
- micro-frontends
- GraphQL migration
- CDN-only assumptions for private/auth-heavy traffic

Why:
- the current app is still a stateful business system with local data, sync,
  uploads, and long-lived sessions

## Practical Order of Work

If we keep moving on this roadmap, the best order is:

1. Bootstrap endpoint to reduce post-login waterfall requests.
2. Split `CatalogPage` by workflow.
3. Split translations by namespace.
4. Virtualize large tables and lists.
5. Introduce table-level sync versions and delta sync.
6. Move CSV/report/sync-heavy work into web workers.
7. Finish the org-owned runtime data root migration.
8. Add diagnostics for slow loads, conflicts, and reconnect churn.

## Deployment Notes

- Keep backend compression on.
- If a CDN/proxy is added in front later, use it for static assets first.
- Keep Funnel/private app traffic conservative and predictable.
- Prefer asset caching plus local Dexie reads over aggressive network-layer
  caching of business data.
