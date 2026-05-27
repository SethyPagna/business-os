# Frontend API Guide

This folder is the browser-side transport layer for Business OS.

## Files

- `http.ts` with `http.js` as a compatibility wrapper
  - low-level HTTP request wrapper
  - auth token attachment, retry handling, offline/server-unreachable detection
  - runtime version mismatch, Cloudflare Access redirect, transient gateway, write-dedupe, and read-fallback classification

- `methods.js`
  - named Business OS API calls used by page components
  - keeps request/response shapes centralized so UI pages do not hand-roll endpoints
  - next high-risk TypeScript target because it is still the large domain registry

- `localDb.ts` with `localDb.js` as a compatibility wrapper
  - Dexie-based browser storage for offline queues and local cache helpers

- `websocket.ts` with `websocket.js` as a compatibility wrapper
  - realtime sync channel client used by the shared app shell

- `../web-api.ts` with `../web-api.js` as a compatibility wrapper
  - installs `window.api`, owns offline vault sync, background sync registration, service-worker event forwarding, and lazy domain-method loading

## Rules

1. Add new API calls here before wiring them into pages.
2. Keep auth/session handling centralized here so page components stay declarative.
3. Prefer stable method names that describe the business action, not just the URL.
4. TypeScript conversions should add real boundaries: typed payloads, typed timers, typed event details, and one explicit compatibility wrapper when existing JSX imports still use `.js`.
