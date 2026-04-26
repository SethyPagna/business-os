# Documentation Index

This folder documents Business OS architecture, data relationships, runtime flows, and module responsibilities.

## Documents

- `ARCHITECTURE.md`
  - End-to-end system architecture (backend, frontend, storage, websocket, auth, release model).
- `SCHEMA-RELATIONSHIPS.md`
  - SQLite table map, foreign-key-style relationships, and derived/calculated data paths.
- `BACKEND-ROUTES.md`
  - Route inventory by domain, mounted paths, and route-file ownership.
- `FILE-MAP.md`
  - Folder/file responsibility map for backend and frontend source trees.
- `DOCUMENTATION-STRUCTURE.md`
  - Documentation organization model and regeneration workflow.
- `reference/BACKEND-FUNCTION-REFERENCE.md`
  - Auto-generated backend function/class and route inventory with line references.
- `reference/FRONTEND-FUNCTION-REFERENCE.md`
  - Auto-generated frontend function/component inventory with line references.
- `reference/TRANSLATION-REFERENCE.md`
  - Auto-generated i18n key coverage, grouping, and key-diff report.
- `reference/RUN-RELEASE-REFERENCE.md`
  - Auto-generated setup/start/stop/build script reference.
- `reference/MODULE-NAMING-GUIDE.md`
  - Non-breaking modular naming standard for future refactor waves.
- `reference/PROJECT-COVERAGE-SUMMARY.md`
  - High-level coverage summary for all first-party frontend/backend files and folders.
- `reference/ALL-FILE-INVENTORY.md`
  - File-by-file commentary inventory for all first-party frontend/backend files.
- `reference/FOLDER-COVERAGE.md`
  - Folder-level commentary and contained-file listings.
- `reference/IMPORT-EXPORT-REFERENCE.md`
  - Import/export and dependency-reference map for code files.
- `reference/TRANSLATION-SECTION-REFERENCE.md`
  - Translation keys grouped into page/section domains.
- `reference/PERFORMANCE-SCAN.md`
  - Source/chunk performance scan and hotspot inventory.

## How to use this docs set

1. Start with `ARCHITECTURE.md` to understand high-level boundaries.
2. Use `SCHEMA-RELATIONSHIPS.md` when changing any inventory/sales/returns/portal logic.
3. Use `BACKEND-ROUTES.md` before adding/changing endpoints.
4. Use `FILE-MAP.md` to find the right module before editing.
5. Use `docs/reference/*` for per-file function/script/i18n details.
6. Use `PROJECT-COVERAGE-SUMMARY.md` as the entrypoint for full-coverage docs.

## Regenerating references

Run:

```bash
node scripts/generate-doc-reference.js
node scripts/generate-full-project-docs.js
node scripts/performance-scan.js
```

This refreshes all files under `docs/reference/`.
