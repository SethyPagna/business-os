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

async function getDefaultOrganization(env: Env): Promise<OrgRow | null> {
  const db = getDb(env)
  return (await db
    .prepare(`SELECT id, name, slug, public_id, is_active, setup_enabled, created_at FROM organizations ORDER BY id ASC LIMIT 1`)
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
