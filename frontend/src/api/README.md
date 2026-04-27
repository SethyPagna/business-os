# Frontend API Guide

This folder is the browser-side transport layer for Business OS.

## Files

- `http.js`
  - low-level HTTP request wrapper
  - auth token attachment, retry handling, offline/server-unreachable detection

- `methods.js`
  - named Business OS API calls used by page components
  - keeps request/response shapes centralized so UI pages do not hand-roll endpoints

- `localDb.js`
  - Dexie-based browser storage for offline queues and local cache helpers

- `websocket.js`
  - realtime sync channel client used by the shared app shell

## Rules

1. Add new API calls here before wiring them into pages.
2. Keep auth/session handling centralized here so page components stay declarative.
3. Prefer stable method names that describe the business action, not just the URL.
