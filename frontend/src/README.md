# Frontend Source Guide

This folder contains the React SPA used by Business OS.

## How The Frontend Runs

1. `index.tsx` boots React.
2. `AppContext.jsx` restores session/settings and exposes global helpers.
3. `App.tsx` mounts the shell, lazy-loads pages, and renders shared notification/sync UI.
4. `web-api.ts` wires `window.api` to the shared API facade directly.
5. `api/` owns HTTP, WebSocket, local IndexedDB fallbacks, and domain wrappers.
6. `components/` owns page-level workflows and UI composition.
7. `lang/` provides translation dictionaries.
8. `utils/` contains cross-feature helpers such as printing, formatting, and CSV generation.

## Key Rules

1. Business correctness belongs to the backend; the frontend should guide workflows and validate UX inputs.
2. Components should call `api/methods.js` rather than custom fetch calls; `methods.js` remains the large domain registry while transport, websocket, local cache, and browser bootstrap code migrate to TypeScript.
3. User-facing strings should use translation keys in both `en.json` and `km.json`.
4. New pages should include permission-aware UI, loading/error states, and responsive layouts.

## Documentation Output

Generated references live in `ops/docs/reference/`:

- `FRONTEND-FUNCTION-REFERENCE.md`
- `ALL-FUNCTION-REFERENCE.md`
- `PERFORMANCE-SCAN.md`

Regenerate them with:

```bash
node ops/scripts/docs/generate-doc-reference.ts
npm --prefix ops run phase29:audit:repeat
```
