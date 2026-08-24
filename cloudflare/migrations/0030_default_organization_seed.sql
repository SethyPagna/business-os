-- routes/organizations.ts's GET /bootstrap always returns
-- `organizationCreationEnabled: false` (this app is one Worker + one D1
-- database per business, single-tenant -- see that file's own header
-- comment) plus whatever row `getDefaultOrganization()` finds first in
-- `organizations`. Login.tsx already auto-fills and *hides* its
-- organization picker once bootstrap resolves a locked org (Part 225) --
-- but nothing ever seeded a first row, so a fresh install has zero rows,
-- `organization` comes back null, the frontend's lock-and-hide condition
-- (`serverOrg && !organizationCreationEnabled`) never fires, and the
-- picker stays visible, forcing the box to be searched/typed on every
-- login for a value the backend doesn't even read back (`POST /login`'s
-- body type has no `organization` field at all -- confirmed by
-- inspection, it's a frontend-only submit gate today). Seeding one
-- default row fixes this the same way any other "must always have at
-- least one default X out of the box" case in this app already works
-- (default branch, default roles) -- conditioned on the table actually
-- being empty, so an already-customized name on an existing install is
-- never overwritten.
INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled)
SELECT 'Leang Cosmetics', 'leang-cosmetics', 'leang-cosmetics', 1, 0
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Same conditional-seed reasoning for the default group `getDefaultGroup()`
-- looks up under that org -- not load-bearing for login itself, but keeps
-- both organization-scoped lookups consistent with "never absent by
-- default" rather than leaving one seeded and the other not.
INSERT INTO organization_groups (organization_id, name, slug, is_default, is_active)
SELECT o.id, 'Main', 'main', 1, 1
FROM organizations o
WHERE o.slug = 'leang-cosmetics'
  AND NOT EXISTS (SELECT 1 FROM organization_groups);
