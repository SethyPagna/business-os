# Module Naming Guide

This guide standardizes module naming without breaking existing imports immediately.

## Goals

- Keep current runtime behavior stable.
- Make ownership clearer for future refactors.
- Reduce ambiguity between similarly named files across domains.

## Backend Naming Pattern

- Route files: `<domain>Routes.js`
  - Example: current `backend/src/routes/returns.js` -> target alias name `returnsRoutes.js`
- Service files: `<domain>Service.js`
  - Example: `verification.js` -> target alias `verificationService.js`
- Utility files: `<domain>Utils.js` or `<domain>Helpers.js`

## Frontend Naming Pattern

- Page-level components: `<Domain>Page.jsx`
- Domain subcomponents: `<Domain><Responsibility>.jsx`
- Shared primitives: `<PrimitiveName>.jsx` in `components/shared/`
- Hook files: `use<Domain><Feature>.js`

## Translation Key Grouping Pattern

- Prefix keys with domain to improve discoverability:
  - `dashboard_*`
  - `inventory_*`
  - `products_*`
  - `portal_*`
  - `users_*`
  - `auth_*`
  - `backup_*`
  - `settings_*`

## Migration Recommendation

1. Introduce alias exports or index barrels first.
2. Migrate imports incrementally by domain.
3. Rename physical files only when import graph is fully updated and tested.
