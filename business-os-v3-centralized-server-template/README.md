# Atlas V3: Centralized Multi-Organization Template

This profile is the future-facing scale-up shape.

Use when:
- many businesses share one central Atlas server
- each business is isolated by organization
- setup/create organization can later be enabled

Expected URL pattern:
- Admin: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public: `https://atlas.tail47edcd.ts.net/<organization>/public`

Important:
- the current codebase now includes the organization/group foundation
- true shared-DB multi-tenant isolation for all business tables is still a later migration step
