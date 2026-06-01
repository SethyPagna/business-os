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

- `requestIds.ts`
  - idempotency key helpers for write payloads
  - keeps client request-id creation and trimming consistent across products, POS, contacts, inventory, and returns

- `conflicts.ts`
  - compact conflict-attempt payload builders for settings and return items
  - strips server metadata before rendering retry/merge context

- `syncPreview.ts`
  - bounded pending-sync queue preview serializer
  - keeps queue popovers light while preserving enough metadata for status and retry review

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
