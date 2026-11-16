import { Hono } from 'hono'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'
import { audit } from '../lib/audit'
import { requireAuth } from '../lib/auth'
import { getDb } from '../lib/db'
import { denyUnlessCurrentPassword } from '../lib/destructiveStepUp'
import { isAdminControlUser } from '../lib/permissions'
import { getPlanLimits } from '../lib/planTier'
import { SALES_DAILY_FLAGS_SQL, SALES_DAILY_QUARANTINE_KEY, isSalesDailyDate, rebuildRangeStatements, salesDailyFlagsFromRows, salesDailyRangeDays, verifyStartStatement } from '../lib/salesDailyTotals'

// POST /api/system/sales-daily/rebuild { from, to, currentPassword, clearQuarantine? }  (stored daily sales totals, migration 0308).
//
// Its own route file, mounted ahead of the system router in src/index.ts, so it never touches routes/system.ts (another lane's file). Same gate as the
// other destructive system routes: an administrator, then the caller's current password through the shared rate-limited step-up.
//
// What it does is only MARK: it re-seeds the days of the range that have sales and no row, and sets every day of the range dirty. The sales-daily-recompute
// cron step does the work, newest days first, so a rebuild writes about one row per day and computes nothing here. It answers how many days are waiting.
// clearQuarantine: true is accepted ONLY when the range covers EVERY day that caused the quarantine (the quarantine row names them all; one it cannot read makes the
// whole range the days to verify). It removes the quarantine row and, in the SAME batch, puts those days into a VERIFY state (system_flags sales_daily_verify): stored
// reads stay stopped until the recompute has redone them and a reconcile has found each one in agreement. It is never done by anything else, and never silently.
const app = new Hono<{ Bindings: Env; Variables: { user: any } }>()
app.use('*', requireAuth)

const FIELDS = ['from', 'to', 'currentPassword', 'clearQuarantine']

app.post('/rebuild', async (c) => {
  const user = c.get('user')
  if (!isAdminControlUser(user)) return c.json({ success: false, error: 'No permission', code: 'forbidden' }, 403)
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ success: false, error: 'A rebuild needs a JSON object.', code: 'sales_daily_body' }, 400)
  if (Object.keys(body).some((field) => !FIELDS.includes(field))) return c.json({ success: false, error: 'Only from, to, currentPassword and clearQuarantine are accepted.', code: 'sales_daily_body' }, 400)
  const { from, to } = body
  if (!isSalesDailyDate(from) || !isSalesDailyDate(to)) return c.json({ success: false, error: 'from and to must be dates (YYYY-MM-DD).', code: 'sales_daily_range' }, 400)
  const days = salesDailyRangeDays(from, to)
  if (days < 1) return c.json({ success: false, error: 'from must not be after to.', code: 'sales_daily_range' }, 400)
  const maxDays = getPlanLimits(c.env).salesDailyRebuildMaxDays
  if (days > maxDays) return c.json({ success: false, error: `A rebuild covers at most ${maxDays} days at a time.`, code: 'sales_daily_range_too_long', maxDays }, 400)
  if (body.clearQuarantine !== undefined && typeof body.clearQuarantine !== 'boolean') return c.json({ success: false, error: 'clearQuarantine must be true or false.', code: 'sales_daily_body' }, 400)
  const clearQuarantine = body.clearQuarantine === true

  const db = getDb(c.env)
  // Checked BEFORE the password step: a clear that cannot be accepted is refused with its reason and changes nothing.
  let verifyDays: string[] = []
  if (clearQuarantine) {
    const flags = salesDailyFlagsFromRows(await db.prepare(SALES_DAILY_FLAGS_SQL).all<{ key: string; value: string }>())
    if (flags.quarantined) {
      const caused = flags.quarantineDays
      if (caused && caused.some((day) => day < from || day > to)) return c.json({ success: false, error: 'The range must cover every day that caused the quarantine.', code: 'sales_daily_clear_range', days: caused }, 400)
      const named = caused ?? Array.from({ length: days }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
      // a verification still under way (a verified day differed again and re-quarantined) keeps the days not yet verified: the record is a union, never a replacement
      verifyDays = [...new Set([...(flags.verify ?? []), ...named])].sort()
    }
  }
  const passwordDenied = await denyUnlessCurrentPassword(c, body, 403)
  if (passwordDenied) return passwordDenied

  const statements = rebuildRangeStatements(from, to).map((statement) => ({ sql: statement.sql, params: statement.params }))
  // the verify record first, then the quarantine row goes: at no instant are stored reads allowed
  if (clearQuarantine && verifyDays.length) { const verify = verifyStartStatement(verifyDays, new Date().toISOString()); statements.push({ sql: verify.sql, params: verify.params }) }
  if (clearQuarantine) statements.push({ sql: `DELETE FROM system_flags WHERE key = '${SALES_DAILY_QUARANTINE_KEY}'`, params: {} })
  const results = await db.batch(statements)
  const changes = (index: number) => Number((results[index] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0)
  const seeded = changes(0)
  const marked = changes(1)
  const quarantineCleared = clearQuarantine ? changes(statements.length - 1) > 0 : false
  const backlog = (await db.prepare('SELECT COUNT(*) AS n FROM sales_daily_totals WHERE state <> 0').get<{ n: number }>())?.n ?? 0
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'sales_daily_rebuild', 'system', null, { from, to, days, seeded, marked, quarantineCleared, verifying: verifyDays.length })
  return c.json({ success: true, from, to, days, seeded, marked, quarantineCleared, verifying: verifyDays.length, backlog })
})

export default app
