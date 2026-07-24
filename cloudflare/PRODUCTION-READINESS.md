# Is the Cloudflare path production-ready?

**No.** Direct answer, not a hedge: if you pointed real customer traffic at
`cloudflare/` today, checkout would mostly work, but almost everything else
in the admin app would 404, and nothing would be protected by a login
outside the two routes that already enforce it. This document says exactly
why, with numbers, and exactly what closing the gap looks like — not a vague
"more work needed."

## The number that matters

**20 of 215 backend API endpoints exist in `cloudflare/`.** Counted directly
from both codebases (`router.get/post/put/delete` in `backend/src/routes/`
vs `app.get/post/put/delete` in `cloudflare/src/`), not estimated. By code
volume: **1,534 lines in `cloudflare/src/routes` + `lib`, versus 27,681 lines
across `backend/server.ts` + `backend/src/routes/`** — about 5.5%.

This isn't a criticism of the work done — every one of those 20 endpoints
was built against a real local D1/KV/R2 instance and tested with actual HTTP
requests, not written blind (see `MIGRATION.md` for the specific test
transcripts: the POS checkout's atomicity was verified by literally trying
to oversell stock and confirming zero partial writes; file uploads were
tested with a real magic-byte validation bypass attempt; the branches route's
optimistic-concurrency conflict detection was tested with a deliberately
stale `updated_at`, not just a happy-path save). The quality bar per
endpoint has been high. The coverage is just genuinely small relative to
what a 25-route, 215-endpoint application needs.

## What's solid, and why you can trust it

- **The D1 schema** (`migrations/0001_init.sql`) — all 45 tables, converted
  and validated statement-by-statement against real D1. Not a bottleneck to
  finishing the rest.
- **Auth** (`src/lib/auth.ts`, `src/routes/auth.ts`) — bcrypt + signed
  session cookies + D1-backed sessions, tested through a full six-step
  lifecycle (login, wrong password, correct password, `/me`, a protected
  route, logout, re-block). The *mechanism* is ready to protect the other
  205 endpoints once they exist — protecting them is then a one-line
  `app.use('*', requireAuth)` per route file, not new engineering.
- **POS checkout** (`src/routes/sales.ts`) — real atomic writes via D1's
  `batch()`, tested including the failure path (rejected oversell, verified
  zero partial rows across three tables).
- **Product search + portal catalog** — tested, including the KV → Cache
  API fix that avoids a real free-tier trap (KV's 1,000 writes/day cap,
  which per-search-query caching would have exhausted in hours).
- **File uploads** (`src/routes/files.ts`) — upload (with magic-byte content
  validation, matching what the Docker path does), list, public serving via
  R2, and delete. Tested including the security-relevant path: uploading
  plain text disguised with a `.png` extension is correctly rejected before
  it ever reaches storage. Public serving verified byte-identical to what
  was uploaded. **One real, disclosed gap**: the Docker path uses `sharp`
  (a native image library, cannot run in a Workers isolate) to compress
  oversized images down to a 40KB budget; this path can't compress, so it
  hard-rejects any image over 40KB instead. Same category of limitation as
  ffmpeg below — needs Cloudflare Images or a Container to close for real.
- **Branches** (`src/routes/branches.ts`) — list, create, update, delete,
  including business rules that were actually tested rather than assumed to
  carry over: only one branch can be the default at a time (tested by
  creating two branches both marked default, confirmed only the second
  ended up with `is_default = 1`), the default branch can't be deleted, a
  branch with stock in it can't be deleted, and an optimistic-concurrency
  write-conflict check (a delete sent with a deliberately stale
  `updated_at` was correctly rejected with a 409, matching the Docker
  path's exact response shape). **Scoped deliberately**: stock-integrity
  repair, branch-to-branch transfers, and the summary/metrics endpoint
  (which depends on a large separate `businessMetrics.ts` module) are not
  ported this pass.
- **Catalog** (`src/routes/catalog.ts`) — `/meta` (categories + branches)
  and `/products` (product list with per-branch stock and image gallery).
  The original's `/products` query uses a Postgres-only
  `json_agg(json_build_object(...)) FILTER (WHERE ...)` aggregate with no
  SQLite equivalent (`json_build_object` doesn't exist in SQLite at all) —
  confirmed the closest native SQLite approximation does work in real D1,
  but rewrote it as two plain queries + an app-side group instead, for
  consistency with the join style already used throughout this migration.
  Tested with real multi-branch stock data and a multi-image gallery,
  verified correct per-branch quantities and gallery ordering in the
  response, not just that it returned *something*.

## What's missing, and how much it matters

**Blocking — nothing works at all without these:**
- **195 of 215 endpoints.** Inventory (the rest of it — stock adjustments,
  movements, low-stock views), returns, customers, contacts, custom tables,
  users/roles, organizations, notifications, action history, sync,
  analytics, dashboard, AI features, backups, branch transfers/stock-
  integrity — all of `backend/src/routes/` except the 8 files already
  ported.
- **The frontend doesn't point here at all.** `frontend/` calls the Express
  backend exclusively (confirmed by the same diff check used all session:
  zero changes to `frontend/` outside the promotions feature). Nothing in
  the deployed Worker is reachable from the actual app UI yet.

**Architecturally unresolved — not "not done yet," but "needs a different
design than a direct port":**
- **Live cross-device sync.** `backend/src/helpers.ts`'s `broadcast()` pushes
  over a plain Node `ws` WebSocket server to every connected terminal (this
  is how, e.g., a sale on one register updates stock live on another).
  Workers don't hold long-lived state the way a Node process does — the
  Cloudflare-native equivalent is **Durable Objects** (one Durable Object
  per store/organization, holding the WebSocket connections and
  broadcasting to them), which is a genuinely different architecture, not a
  mechanical port. Not started.
- **Import jobs at scale.** Already flagged in `MIGRATION.md`: this app
  allows CSV/ZIP imports up to 2048MB. A Worker has a per-invocation CPU-time
  budget a single long-running Docker process doesn't. The queue plumbing
  exists (`src/queue.ts`); the chunked processing logic doesn't.
  - **ffmpeg / video optimization.** Cannot run in a Worker at all (no
  native binaries in a V8 isolate). Needs a Cloudflare Container (a real
  Docker image running on Cloudflare's infra, GA since April 2026) — sketched
  in `src/queue.ts`, not built. Lower priority: this app already degrades
  gracefully to "ffmpeg unavailable" today when the binary is missing.

**Hardening — the ported routes work, but aren't hardened the way the
Express backend is:**
- No rate limiting or login lockout after failed attempts (flagged
  explicitly in `MIGRATION.md` when auth was built — needs a D1/KV-backed
  counter to work correctly across Workers' distributed model; an in-memory
  counter, which is what the lockout in `backend/src/routes/auth.ts`
  effectively is, would not port correctly here).
- No OTP/2FA, no audit logging on the ported routes (the Express backend's
  `audit()` calls, used throughout `promotions.ts` this session, have no
  equivalent yet in the Workers routes).
- No CORS configuration (only matters once the Worker and frontend are on
  different origins — noted in `MIGRATION.md`, still true).

## If you deployed this today, concretely

`wrangler deploy` would succeed and the Worker would come up healthy.
`/health`, `/api/settings`, `/api/products/search`,
`/api/portal/catalog/products/search`, `/api/auth/login`, `/api/sales`,
`/api/files/*` (upload, list, delete, and public `/uploads/*` serving),
`/api/branches/*` (list, create, update, delete), and `/api/catalog/*`
(meta, products with stock/gallery) would all work correctly. Every other
URL the actual frontend calls — `/api/inventory/*`, `/api/users/*`,
`/api/returns/*`, and 190 more — would return a 404 from Hono's default
not-found handler, because nothing is mounted at those paths. No
cross-device sync would happen. This is not a subtle gap you'd discover
slowly; it would be immediately, completely obvious the moment anyone
clicked past the product catalog and branch settings.

## The path to actually getting there, if you want it

Roughly in priority order, each phase independently useful and shippable:

1. **The rest of inventory + the next-highest-traffic remaining routes**:
   `inventory.ts`'s stock adjustment/movement endpoints, `users.ts`,
   `returns.ts` — same proven technique as the 8 done routes (port the SQL
   as-is where it's already SQLite-flavored, fix Postgres-only syntax like
   the `GREATEST()` bug found in `sales.ts` or the `json_agg`/
   `json_build_object` issue found in `catalog.ts`, test against real D1
   before calling it done).
2. **Auth hardening**: apply `requireAuth` to every newly-ported route,
   port rate limiting onto a D1/KV counter.
3. **Live sync redesign**: a Durable Object per organization — genuinely new
   design work, not a port; worth scoping separately once the REST surface
   is otherwise complete.
4. **Import jobs + ffmpeg/image-compression Containers**: last, since both
   are already flagged as lower-urgency in `MIGRATION.md` and the app
   degrades gracefully without either (files.ts hard-rejects oversized
   images today rather than failing silently).

Each of the 8 already-ported routes took real, careful, tested work — there's
no shortcut through steps 1–2 that skips actually doing and testing each
route. That said, the pattern is now proven and repeatable seven times over
(settings, products, portal, sales, files, branches, catalog), which is most
of the hard part: the D1 adapter, the auth mechanism, the cache strategy,
the atomic-write pattern, the R2/upload-validation pattern, and now the
optimistic-concurrency (write-conflict) pattern all already exist and
don't need to be re-invented per route.
