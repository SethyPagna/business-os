# Organization Variants

This repo carries one shared codebase with deployment profiles for current single-organization servers and future centralized organization paths.

## Current Foundation

The live codebase is organization-aware, while the current server instance is still effectively:

- one active organization per server instance
- one default group per organization
- admin-created users only
- organization remembered on the device for long-lived sign-in

The default seeded organization is:

- Name: `LeangCosmetics`
- Slug: `leangcosmetics`
- Public path: `/<organization>/public`

## Variant Folders

### `business-os-v1-centralized-org-path`

Use when one central server hosts organization paths:

- Admin app: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public portal: `https://atlas.tail47edcd.ts.net/<organization>/public`

### `business-os-v2-dedicated-server`

Use when each business gets its own full server/runtime:

- Admin app: `https://atlas.tail47edcd.ts.net/`
- Public portal: `https://atlas.tail47edcd.ts.net/public`

### `business-os-v3-centralized-server-template`

Use when moving to real multi-business central hosting:

- Admin app: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public portal: `https://atlas.tail47edcd.ts.net/<organization>/public`

Extra future work for true v3:

- org-scoped uniqueness on products/customers/suppliers/users in one shared DB
- org-scoped settings table instead of a single global settings table
- org-scoped backups and billing

## Owned Auth Setup

Business OS uses its own Postgres users, roles, permissions, OTP/email flows, and owned Google OAuth callback. Add the active admin/public origins and `/api/auth/oauth/callback` URLs to the Google login OAuth client for the deployment you use.

Old Supabase-linked users must sign in with password/OTP first, then relink Google from Business OS.
