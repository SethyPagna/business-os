# Frontend Source Guide

This folder contains the React SPA used by Business OS.

## How The Frontend Runs

1. `index.jsx` boots React.
2. `AppContext.jsx` restores session/settings and exposes global helpers.
3. `App.jsx` mounts the shell, lazy-loads pages, and renders shared notification/sync UI.
4. `web-api.js` wires `window.api` to the shared API facade.
5. `api/` owns HTTP, WebSocket, local IndexedDB fallbacks, and domain wrappers.
6. `components/` owns page-level workflows and UI composition.
7. `lang/` provides translation dictionaries.
8. `utils/` contains cross-feature helpers such as printing, formatting, and CSV generation.

## Key Rules

1. Business correctness belongs to the backend; the frontend should guide workflows and validate UX inputs.
2. Components should call `api/methods.js` rather than custom fetch calls.
3. User-facing strings should use translation keys in both `en.json` and `km.json`.
4. New pages should include permission-aware UI, loading/error states, and responsive layouts.

## Documentation Output

Generated references live in `ops/docs/reference/`:

- `FRONTEND-FUNCTION-REFERENCE.md`
- `ALL-FUNCTION-REFERENCE.md`
- `PERFORMANCE-SCAN.md`

Regenerate them with:

```bash
node ops/scripts/generate-doc-reference.js
node ops/scripts/generate-full-project-docs.js
node ops/scripts/performance-scan.js
```
