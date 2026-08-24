import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import type { Env } from '../index'

// Ported from backend/src/routes/organizations.ts + organizationContext/index.ts.
// The legacy version resolved org context per-user via users.organization_id /
// users.organization_group_id -- neither column exists on this D1 deployment's
// `users` table (see migrations/0001_init.sql). This app is provisioned one
// Cloudflare Worker + one D1 database per business (single-tenant), so there's
// only ever one row in `organizations`. /current therefore resolves the same
// "default org" as /bootstrap rather than joining through the signed-in user --
// behaviorally identical for a single-tenant deployment, just without a join
// that has nothing to join against here.
//
// Also dropped: the legacy filesystem-layout `storage` block
// (ensureOrganizationFilesystemLayout). That resolved local disk paths under
// ORGANIZATIONS_ROOT for the old Docker/Postgres runtime; Cloudflare has no
// local filesystem and the frontend never reads `storage` off these responses
// (only `organization` / `organizationCreationEnabled` -- confirmed against
// Login.tsx), so it's safe to omit rather than fake.

type OrgRow = {
  id: number
  name: string
  slug: string
  public_id: string
  is_active: number
  setup_enabled: number
  created_at: string
}

type GroupRow = {
  id: number
  organization_id: number
  name: string
  slug: string
  is_default: number
}

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

const ORG_COLUMNS = 'id, name, slug, public_id, is_active, setup_enabled, created_at'

// The organization this deployment is pinned to.
//
// This app is provisioned one Worker + one D1 per business (single-tenant),
// so in practice `organizations` holds exactly one row and "first by id"
// already resolved it. That is an accident of the data, though, not a
// stated rule -- if a second row ever appeared (a bad import, a restored
// backup from another business, a manual insert), the login screen would
// silently start offering it and could auto-select the wrong one.
//
// `BUSINESS_OS_ORGANIZATION_SLUG` (wrangler.toml [vars]) makes the pin
// explicit: this deployment is Leang Cosmetics and nothing else. It is
// deliberately a PREFERENCE, not a hard requirement -- if the configured
// slug matches no row (a rename, a fresh database, a local dev copy seeded
// under a different name), this falls back to the old first-by-id
// behaviour rather than returning null and making login impossible. A
// wrong/stale config value can therefore never lock anyone out; it can
// only fail to narrow a choice that is already a single row.
//
// Creating other organizations stays impossible regardless: this router
// exposes no POST/PUT/DELETE at all, and /bootstrap reports
// `organizationCreationEnabled: false`, which is what puts the login
// screen into its locked state (Login.tsx's setOrganizationLocked). The
// "Switch organization" button there remains the deliberate unlock.
async function getDefaultOrganization(env: Env): Promise<OrgRow | null> {
  const db = getDb(env)
  const pinnedSlug = String(env.BUSINESS_OS_ORGANIZATION_SLUG || '').trim().toLowerCase()
  if (pinnedSlug) {
    const pinned = await db
      .prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE lower(trim(slug)) = @slug OR lower(trim(public_id)) = @slug LIMIT 1`)
      .get<OrgRow>({ slug: pinnedSlug })
    if (pinned) return pinned
  }
  return (await db
    .prepare(`SELECT ${ORG_COLUMNS} FROM organizations ORDER BY id ASC LIMIT 1`)
    .get<OrgRow>()) || null
}

async function getDefaultGroup(env: Env, organizationId: number): Promise<GroupRow | null> {
  const db = getDb(env)
  return (await db
    .prepare(`SELECT id, organization_id, name, slug, is_default FROM organization_groups WHERE organization_id = @organizationId ORDER BY is_default DESC, id ASC LIMIT 1`)
    .get<GroupRow>({ organizationId })) || null
}

app.get('/bootstrap', async (c) => {
  const organization = await getDefaultOrganization(c.env)
  const group = organization ? await getDefaultGroup(c.env, organization.id) : null
  return c.json({
    organizationCreationEnabled: false,
    organization,
    defaultGroup: group,
  })
})

app.get('/search', async (c) => {
  const q = String(c.req.query('q') || '').trim().toLowerCase()
  const db = getDb(c.env)
  const items = q
    ? await db
        .prepare(
          `SELECT id, name, slug, public_id, is_active, setup_enabled
           FROM organizations
           WHERE is_active = 1
             AND (lower(trim(name)) LIKE @like OR lower(trim(slug)) LIKE @like OR lower(trim(public_id)) LIKE @like)
           ORDER BY
             CASE
               WHEN lower(trim(name)) = @exact THEN 0
               WHEN lower(trim(slug)) = @exact THEN 1
               WHEN lower(trim(public_id)) = @exact THEN 2
               ELSE 3
             END,
             name COLLATE NOCASE ASC
           LIMIT 8`
        )
        .all({ like: `%${q}%`, exact: q })
    : await db
        .prepare(
          `SELECT id, name, slug, public_id, is_active, setup_enabled
           FROM organizations WHERE is_active = 1 ORDER BY name COLLATE NOCASE ASC LIMIT 8`
        )
        .all()
  return c.json({ items: items || [] })
})

app.get('/current', requireAuth, async (c) => {
  const organization = await getDefaultOrganization(c.env)
  if (!organization) {
    return c.json({ success: false, error: 'Organization context not found.' }, 404)
  }
  const group = await getDefaultGroup(c.env, organization.id)
  return c.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      public_id: organization.public_id,
    },
    group: group ? { id: group.id, name: group.name, slug: group.slug } : null,
  })
})

export default app
