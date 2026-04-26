# Atlas Organization Variants

This repo now carries one shared codebase with three deployment profiles.

Why shared instead of three full code duplicates:
- the business logic is still mostly the same
- the organization/group layer is the main difference
- shared source avoids three versions drifting apart and breaking differently

## Current foundation

The live codebase is now organization-aware, but the current server instance is still effectively:

- one active organization per server instance
- one default group per organization
- admin-created users only
- organization remembered on the device for long-lived sign-in

The default seeded organization is:

- Name: `LeangCosmetics`
- Slug: `leangcosmetics`
- Public path: `/<organization>/public`

## Variant folders

### `business-os-v1-centralized-org-path`

Use when:
- you keep one central server
- each business is reached by `atlas.tail47edcd.ts.net/<organization>/...`
- organization self-create stays disabled for now

URL model:
- Admin app: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public portal: `https://atlas.tail47edcd.ts.net/<organization>/public`

Supabase redirect examples:
- `https://atlas.tail47edcd.ts.net`
- `https://atlas.tail47edcd.ts.net/leangcosmetics`

### `business-os-v2-dedicated-server`

Use when:
- each business gets its own full server/runtime
- the whole server is migrated for one business
- URL can stay root-based without organization in the path

URL model:
- Admin app: `https://atlas.tail47edcd.ts.net/`
- Public portal: `https://atlas.tail47edcd.ts.net/public` or business-specific custom path

Supabase redirect examples:
- `https://atlas.tail47edcd.ts.net`
- `http://localhost:4000`

### `business-os-v3-centralized-server-template`

Use when:
- you are ready for real multi-business central hosting
- businesses share one server but must stay isolated by organization
- org creation can eventually be enabled

URL model:
- Admin app: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public portal: `https://atlas.tail47edcd.ts.net/<organization>/public`

Extra future work for true v3:
- org-scoped uniqueness on products/customers/suppliers/users in one shared DB
- org-scoped settings table instead of a single global settings table
- org-scoped backups, billing, and per-org Supabase config strategy

## Supabase setup by variant

### Shared rules for all variants

Supabase is still auth-only:
- email/password
- Google
- Facebook
- optional magic link / invite / MFA features

Business data remains local to Business OS.

### Variant-specific redirect guidance

#### v1 centralized org path

Add these to Supabase Auth URL Configuration:
- Site URL: `https://atlas.tail47edcd.ts.net`
- Redirect URLs:
  - `https://atlas.tail47edcd.ts.net`
  - `https://atlas.tail47edcd.ts.net/leangcosmetics`
  - `http://localhost:4000`

#### v2 dedicated server

Add these:
- Site URL: business-specific root URL
- Redirect URLs:
  - that root URL
  - `http://localhost:4000`

#### v3 centralized

Add:
- Site URL: `https://atlas.tail47edcd.ts.net`
- Redirect URLs:
  - `https://atlas.tail47edcd.ts.net`
  - each org admin path you actively use
  - localhost for development

## Policies

For the current foundation pass:
- no new Supabase RLS policy is required just because organization-aware login now exists
- the existing `001-auth-only-setup.sql` still covers the auth mirror surface

When you move to a true centralized shared DB later, Business OS local tables will need their own org-scoping rules in application logic or a future DB migration. That is separate from current Supabase auth policies.
