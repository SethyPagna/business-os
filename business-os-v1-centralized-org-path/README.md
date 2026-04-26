# Atlas V1: Centralized Server With Organization Path

This profile is for:
- one shared Atlas server
- one organization path per business
- organization creation disabled
- current default organization seeded as `LeangCosmetics`

Use URL pattern:
- Admin: `https://atlas.tail47edcd.ts.net/<organization>/`
- Public: `https://atlas.tail47edcd.ts.net/<organization>/public`

Build flow:
1. Use the shared repo root source.
2. Run the root release flow.
3. Publish behind the central Tailscale/Funnel endpoint.

This folder is intentionally a deployment profile, not a forked code copy.
That keeps the shared app logic maintainable while preserving variant-specific setup notes.
