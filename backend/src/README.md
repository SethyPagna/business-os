# Backend Source Guide

This folder contains the first-party backend runtime for Business OS.

## How The Backend Runs

1. `backend/server.js` bootstraps Express, mounts middleware, API routes, the health endpoint, the SPA fallback, and the WebSocket server.
2. `config/` resolves the runtime folder, `.env`, canonical organization data folder, upload path, and frontend build path.
3. `database.js` opens SQLite, applies schema/migrations, and seeds required defaults.
4. `requestContext.js`, `middleware.js`, `security.js`, and `helpers.js` provide the cross-cutting request, auth, audit, and broadcast behavior used by route files.
5. `routes/` owns HTTP behavior by domain.
6. `services/` owns provider-specific integrations so route files stay focused on business workflows.

## File Ownership

- `config/` - runtime path, environment resolution, and organization-aware storage bootstrap
- `database.js` - SQLite schema, pragmas, migrations, seed data
- `helpers.js` - shared validation, audit, sync broadcast, and response helpers
- `middleware.js` - auth token, upload, and request guard middleware
- `requestContext.js` - device/user/request metadata capture
- `security.js` - OTP, rate-limit, and verification security helpers
- `serverUtils.js` - server-side cache/security/header/request utility helpers
- `websocket.js` - WebSocket attachment and client fan-out
- `routes/` - domain HTTP handlers mounted by `server.js`
- `services/` - external auth/verification providers

## Documentation Output

Generated references live in `ops/docs/reference/`:

- `BACKEND-FUNCTION-REFERENCE.md`
- `ALL-FILE-INVENTORY.md`
- `PROJECT-CODE-REFERENCE.md`

Regenerate them with:

```bash
node ops/scripts/generate-doc-reference.js
node ops/scripts/generate-full-project-docs.js
```

## Maintenance Rules

1. Keep schema assumptions in sync with `database.js`.
2. Keep auth/audit/sync behavior centralized instead of duplicating it per route.
3. Every sensitive mutation should validate input, enforce authorization, write audit entries, and broadcast affected sync channels.
