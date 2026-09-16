import { Hono } from 'hono'
import { requireAuth, type SessionUser } from '../lib/auth'
import { actorSnapshot } from '../lib/actorSnapshot'
import {
  EMPTY_ADDRESS_PRESETS,
  parseStoredAddressPresetDocument,
  POS_ADDRESS_PRESETS_KEY,
  validateAddressPresets,
} from '../lib/addressPresets'
import { bumpVersion } from '../lib/cache'
import { getDb } from '../lib/db'
import { getActionTier, getPermissionTier } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)
app.use('*', async (c, next) => {
  if (getPermissionTier(c.get('user'), 'pos') === 'none') return c.json({ error: 'POS access is required.' }, 403)
  await next()
})

async function readStored(c: { env: Env }) {
  const row = await getDb(c.env).prepare(
    'SELECT value, updated_at FROM settings WHERE key = @key LIMIT 1',
  ).get<{ value: string; updated_at: string | null }>({ key: POS_ADDRESS_PRESETS_KEY })
  if (!row) return { configured: false, revision: null, presets: EMPTY_ADDRESS_PRESETS }
  const document = parseStoredAddressPresetDocument(row.value)
  return { configured: true, revision: document.revision, presets: document.presets, updated_at: row.updated_at || null }
}

app.get('/address-presets', async (c) => c.json({
  ...await readStored(c),
  can_manage: getActionTier(c.get('user'), 'pos', 'manage_address_presets') === 'full',
}))

app.put('/address-presets', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'pos', 'manage_address_presets') !== 'full') return c.json({ error: 'Full POS access is required to manage saved addresses.' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'expected_revision')) {
    return c.json({ error: 'expected_revision is required', code: 'expected_revision_required' }, 400)
  }
  const expectedRevision = body.expected_revision == null ? null : String(body.expected_revision).trim()
  if (body.expected_revision != null && !expectedRevision) {
    return c.json({ error: 'expected_revision is invalid', code: 'invalid_expected_revision' }, 400)
  }
  const validated = validateAddressPresets(body.presets)
  if (validated.error) return c.json({ error: validated.error, code: validated.error }, 400)

  const revision = crypto.randomUUID()
  const value = JSON.stringify({ revision, presets: validated.presets })
  const db = getDb(c.env)
  const stamp = new Date().toISOString()
  const details = JSON.stringify({
    provinceCount: validated.presets.province.length,
    districtCount: validated.presets.district.length,
    subdistrictCount: validated.presets.subdistrict.length,
    revision,
  })
  // D1 batch is atomic: the settings CAS and its audit either both commit or
  // both roll back. The audit SELECT sees the new UUID only when the guarded
  // upsert won, so a stale writer creates neither a setting change nor an
  // audit row.
  const results = await db.batch([
    {
      sql: `INSERT INTO settings (key, value, updated_at)
            SELECT @key, @value, @stamp
            WHERE @expectedRevision IS NULL OR EXISTS (SELECT 1 FROM settings WHERE key = @key)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            WHERE json_extract(settings.value, '$.revision') = @expectedRevision`,
      params: { key: POS_ADDRESS_PRESETS_KEY, value, expectedRevision, stamp },
    },
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value,device_name,device_tz,created_at)
            SELECT @userId,@userName,'update','pos_address_presets',@revision,@details,
              'settings',@key,@details,
              (SELECT device_name FROM user_sessions WHERE user_id=@userId AND revoked_at IS NULL ORDER BY last_seen_at DESC,id DESC LIMIT 1),
              (SELECT device_tz FROM user_sessions WHERE user_id=@userId AND revoked_at IS NULL ORDER BY last_seen_at DESC,id DESC LIMIT 1),
              @stamp
            WHERE EXISTS(SELECT 1 FROM settings WHERE key=@key AND json_extract(value,'$.revision')=@revision)`,
      params: { userId: user?.id ?? null, userName: actorSnapshot(user), revision, details, key: POS_ADDRESS_PRESETS_KEY, stamp },
    },
  ])
  const result = results[0]
  const changes = Number((result as unknown as { meta?: { changes?: number }; changes?: number })?.meta?.changes
    ?? (result as unknown as { changes?: number })?.changes
    ?? 0)
  if (changes !== 1) {
    return c.json({
      error: 'Address presets changed on another device. Reload before saving.',
      code: 'write_conflict',
      current: await readStored(c),
    }, 409)
  }

  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'pos_address_presets_update' }))
  return c.json({ success: true, configured: true, can_manage: true, revision, presets: validated.presets })
})

export default app
