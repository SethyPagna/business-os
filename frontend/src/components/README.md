# Frontend Components Guide

This folder contains the first-party Business OS UI surfaces.

## Layout Rules

- Each page folder owns one major business domain or settings surface.
- Shared shell behavior lives above this folder in `frontend/src/App.jsx` and `frontend/src/AppContext.jsx`.
- Domain folders may include page entry components, tables, modals, cards, and import/export helpers for that domain.

## Domain Ownership

- `auth/` - login, OTP, password recovery, provider sign-in entry points
- `dashboard/` - business overview, KPI cards, charts, quick actions
- `products/` - product catalog CRUD, variants, images, import/export
- `inventory/` - stock summary, movement history, export, branch-aware views
- `sales/` - sales history, analytics summaries, export
- `returns/` - customer/supplier return workflows
- `contacts/` - customers, suppliers, delivery contacts
- `branches/` - branch management and transfer flows
- `pos/` - point-of-sale cart, checkout, receipt initiation
- `catalog/` - customer portal editor and public portal rendering
- `loyalty-points/` - membership and rewards settings
- `receipt-settings/` - receipt template layout, preview, saved templates
- `users/` - local users, roles, permissions, profile surface
- `files/` - internal library/assets/AI-provider surfaces
- `server/` - sync diagnostics and server status
- `utils-settings/` - settings, backup, audit log, app-level admin utilities
- `navigation/` - sidebar and navigation chrome
- `shared/` - shared primitives reused across domains

## Expectations

1. Page entry components should explain the workflow they own with a short file header or docblock when the behavior is non-obvious.
2. Mutations should call the shared frontend API layer instead of inlining fetch logic.
3. UI state that must survive page switches should be pushed up into `AppContext` or a shared utility rather than duplicated.
