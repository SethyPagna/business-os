import { getDb } from './db'
import type { Env } from '../index'

// Default retention window, in days, for automatic audit-log cleanup. This
// replaced a manual "Clear 30d" button in the Audit Logs UI -- retention is
// now enforced automatically on the cron schedule (see maybeRunScheduledAuditLogRetention
// below) instead of requiring an admin to remember to click something.
// An administrator changes it through PUT /api/settings/audit-log-retention,
// which needs the current password and refuses anything under this 21-day floor.
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 21
const AUDIT_LOG_RETENTION_SETTING_KEY = 'audit_log_retention_days'
const AUDIT_LOG_RETENTION_LAST_RUN_KEY = 'audit_log_retention_last_run'
// Deleting is a full-table scan on created_at, so the scheduled worker
// (which ticks every 6h per wrangler.toml's cron trigger) only actually
// performs a delete pass once per day -- frequent enough that the log table
// never grows much past the configured retention window, infrequent enough
// to not do needless work on every tick.
const AUDIT_LOG_RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

// Owner, 14 Oct 2026: the audit rows of sales, payments (settle and refunds), returns, every stock change,
// permission, role and user changes, and reverts are kept forever. The 13 Oct ruling that old expenses are
// kept still holds. Where the ruling is silent and deletion cannot be undone, the record stays (lead decision,
// 14 Oct): the rows of every system-wide write that changes sales, stock, returns, payments or permissions
// (reset, factory reset, migration finalize, integrity repair, restore, import approval), of anything that
// moves sales ownership or receivables (customer and supplier link, merge, reassign), of every cost and price
// edit, of shift open/close and cash records, and the review decisions that apply stock or money changes.
// Any action ending in _undo or _redo is kept for now (the round-5 commit that follows scopes it). Logins, device
// approvals, settings changes, refused step-ups and every row not named here follow the retention setting.
//
// The classes are the entity and action values the writers use, not a guess:
// scripts/harness/audit_retention_classes.cjs lists every writer and
// test-audit-retention-pure.cjs fails when the source writes an entity/action pair that list does not
// classify, or when the list and the SQL below disagree.
// The ledgers themselves (sales, returns, fees, inventory_movements) are never touched
// by this sweep; it deletes from audit_logs only.
export const AUDIT_RETENTION_KEPT_SALE_PAYMENT_ENTITIES = [
  'sale', 'sale_creation', 'sale_item', 'sales', 'payment_method', 'customer_receivables', 'supplier_invoices',
] as const
export const AUDIT_RETENTION_KEPT_RETURN_ENTITIES = ['return', 'returns', 'return_create', 'return_reason', 'supplier_return'] as const
export const AUDIT_RETENTION_KEPT_STOCK_ENTITIES = [
  'stock', 'stock_transfer', 'stock_transfers', 'stock_session', 'stock_session_operations', 'inventory', 'inventory_movements',
  'inventory_reason', 'product_batch', 'product_batches', 'branch_stock_integrity', 'branch_cutover',
] as const
export const AUDIT_RETENTION_KEPT_PERMISSION_ENTITIES = ['role', 'roles'] as const
export const AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES = ['fee', 'fee_label'] as const
export const AUDIT_RETENTION_KEPT_CASH_ENTITIES = ['shift_session'] as const
// Entities kept only for some actions. An account row is kept when it creates or changes the account (role,
// permissions, active flag); its sign-ins, password resets and device approvals follow the retention setting.
// A product row is kept when it creates the product or edits its price or cost.
const AUDIT_RETENTION_ACCOUNT_ACTIONS = ['create', 'update'] as const
const AUDIT_RETENTION_PRODUCT_ACTIONS = ['create', 'update', 'cost_override', 'catalog_cost_recompute_backfill'] as const
export const AUDIT_RETENTION_KEPT_ENTITY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  user: AUDIT_RETENTION_ACCOUNT_ACTIONS,
  users: AUDIT_RETENTION_ACCOUNT_ACTIONS,
  product: AUDIT_RETENTION_PRODUCT_ACTIONS,
  products: AUDIT_RETENTION_PRODUCT_ACTIONS,
  system: ['reset_data', 'factory_reset', 'finalize_migration'],
  'data-integrity': ['repair'],
  backup: ['restore'],
  import_job: ['import_job_approve', 'import_job_retry'],
  customer: [
    'merge', 'link_sales', 'relink_sales', 'create_and_link_sales', 'customer_same_name_phone_merge',
    'mark_anonymous_customer', 'clear_shared_general_membership',
  ],
  supplier: ['merge', 'supplier_duplicate_cluster_merge'],
  delivery_contact: ['merge'],
}
// Review decisions: every decision on an expense is kept; an approval is kept when the section it applies
// changes stock, prices, returns or contacts. Rejections, resubmissions and branch approvals expire.
export const AUDIT_RETENTION_KEPT_REVIEW_SECTIONS = ['fees'] as const
export const AUDIT_RETENTION_KEPT_APPROVED_REVIEW_SECTIONS = ['products', 'inventory', 'returns', 'contacts'] as const

// Stock changes that are written on the product (or on a legacy row with no entity).
export const AUDIT_RETENTION_KEPT_STOCK_ACTIONS = [
  'stock_add', 'stock_remove', 'stock_set', 'stock_adjust', 'stock_in_line_edit', 'stock_movement_reason_edit',
  'stock_tagged_dispose', 'stock_tagged_restore', 'transfer', 'transfer_intent',
  'merge_duplicate', 'fold', 'product_same_name_merge', 'product_transfer_aware_merge', 'product_leading_zero_twin_merge',
  'received_date_saleability_repair', 'stale_receipt_revert_mirror', 'recompute_stock_cache',
  'branch_cutover_inactive_stock', 'branch_cutover_approved_fold', 'branch_cutover_inactive_fold', 'branch_cutover_lot_fold',
  'branch_cutover_completed', 'undo_closed_branch_cutover',
] as const
export const AUDIT_RETENTION_KEPT_REVERT_ACTIONS = ['stock_revert', 'stock_revert_repair', 'stock_revert_repair_before'] as const
// Rows written before audit rows carried an entity: only their action says what they were.
export const AUDIT_RETENTION_KEPT_LEGACY_ACTIONS = ['sale', 'sale_settlement', 'return'] as const
const sqlList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ')
const AUDIT_ENTITY_KEY_SQL = "LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, '')))"
const AUDIT_ACTION_SQL = "COALESCE(action, '')"
const AUDIT_REVIEW_SECTION_SQL = "COALESCE(CASE WHEN json_valid(details) THEN json_extract(details, '$.section') END, '')"
const AUDIT_RETENTION_KEPT_FOREVER_SQL = `${AUDIT_ENTITY_KEY_SQL} IN (${sqlList([
  ...AUDIT_RETENTION_KEPT_SALE_PAYMENT_ENTITIES,
  ...AUDIT_RETENTION_KEPT_RETURN_ENTITIES,
  ...AUDIT_RETENTION_KEPT_STOCK_ENTITIES,
  ...AUDIT_RETENTION_KEPT_PERMISSION_ENTITIES,
  ...AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES,
  ...AUDIT_RETENTION_KEPT_CASH_ENTITIES,
])})
${Object.entries(AUDIT_RETENTION_KEPT_ENTITY_ACTIONS).map(([entity, actions]) =>
  `        OR (${AUDIT_ENTITY_KEY_SQL} = '${entity}' AND ${AUDIT_ACTION_SQL} IN (${sqlList(actions)}))`).join('\n')}
        OR (${AUDIT_ENTITY_KEY_SQL} = '' AND ${AUDIT_ACTION_SQL} IN (${sqlList(AUDIT_RETENTION_KEPT_LEGACY_ACTIONS)}))
        OR ${AUDIT_ACTION_SQL} IN (${sqlList([...AUDIT_RETENTION_KEPT_STOCK_ACTIONS, ...AUDIT_RETENTION_KEPT_REVERT_ACTIONS])})
        OR ${AUDIT_ACTION_SQL} LIKE '%\\_undo' ESCAPE '\\'
        OR ${AUDIT_ACTION_SQL} LIKE '%\\_redo' ESCAPE '\\'`

export function buildAuditLogRetentionDeleteSql(): string {
  return `DELETE FROM audit_logs WHERE id IN (
    SELECT id FROM audit_logs
    WHERE created_at < @cutoff
      AND NOT (${AUDIT_RETENTION_KEPT_FOREVER_SQL})
      AND NOT (COALESCE(entity, '') = 'pending_action'
        AND (${AUDIT_REVIEW_SECTION_SQL} IN (${sqlList(AUDIT_RETENTION_KEPT_REVIEW_SECTIONS)})
          OR (${AUDIT_ACTION_SQL} = 'approve' AND ${AUDIT_REVIEW_SECTION_SQL} IN (${sqlList(AUDIT_RETENTION_KEPT_APPROVED_REVIEW_SECTIONS)}))))
    LIMIT 5000
  )`
}

// ---------------------------------------------------------------------------
// Before/after field diffs (records/history lane, phase 1)
//
// The Audit Log page already renders a Field | Before | After table for any
// row whose old_value/new_value hold a flat JSON object of fields
// (frontend/src/utils/auditLogFieldDiff.ts -> buildAuditFieldDiff). Almost
// every update route wrote new_value only (a copy of `details`), so that
// table had nothing to show and the page fell back to a raw blob. This is the
// ONE shared "which fields changed" helper for every route that now records a
// before/after -- users, roles, products, contacts, promotions, settings, fees
// and returns all call it, so the written shape can never drift between them.
//
// Rules, chosen to match what the renderer will actually display:
//   - a key whose before and after normalize to the same text is NOT written
//     (the renderer would drop the row anyway, so writing it is noise);
//   - bookkeeping keys the renderer ignores are never written;
//   - secret-shaped keys are never written at all, and a caller can mark
//     further keys as redacted (the key is recorded as having changed, the
//     values are masked).
// Returns null when nothing changed, which is a route's signal to fall back to
// its plain audit() call (or to skip the row entirely).
// ---------------------------------------------------------------------------
export interface AuditFieldChange {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

// Mirrors IGNORED_DIFF_KEYS in frontend/src/utils/auditLogFieldDiff.ts -- the
// renderer drops these, so a writer must not spend a row on them.
const AUDIT_DIFF_IGNORED_KEYS = new Set(['id', 'created_at', 'updated_at', 'client_request_id'])

// Never recorded in an audit row under any circumstances: password hashes,
// session/API tokens, raw credentials and inline binary blobs. This is a hard
// stop, not a redaction -- the key does not appear at all.
// `_key$`/`^key$` is deliberately broader than the keys that exist today: it
// pre-masks a future encryption_key / signing_key / webhook_key column instead
// of waiting for one to leak into a row. The only current columns it catches
// are derived lookup keys (products.name_key), which a diff excludes anyway.
const AUDIT_NEVER_RECORDED = /(password|passcode|passphrase|secret|token|api[_-]?key|private[_-]?key|credential|salt|_key$|^key$|_hash$|^hash$|blob|base64|data_url)/i

// Exposed so a caller with its own secret-key rule (settings' own
// isSensitiveSettingKey) can widen it rather than restate it.
export function isSecretShapedAuditKey(key: string): boolean {
  return AUDIT_NEVER_RECORDED.test(key)
}

export const AUDIT_REDACTED_BEFORE = '(hidden)'
export const AUDIT_REDACTED_AFTER = '(hidden, changed)'

// A single audit row is meant to be read by a person in a table. A receipt
// template, a custom_fields JSON blob or a long description turns one row into
// several kilobytes on each side, which the Audit Log cannot render usefully
// anyway. Past this many characters the value is replaced by its length plus a
// cheap digest -- enough to prove it changed and to tell two same-length values
// apart, without storing the blob twice on every edit.
export const AUDIT_LARGE_VALUE_CHARS = 2048

// FNV-1a 32-bit: synchronous (crypto.subtle is async, and audit() must stay a
// single round trip), allocation-free, and only ever used to say "these two
// large values differ" -- never as a security primitive.
function largeAuditValueDigest(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function summarizeLargeAuditValue(text: string): string {
  return `(${text.length} chars, #${largeAuditValueDigest(text)})`
}

// Stable, order-independent text for comparison: two permission objects that
// differ only in key order are the same permissions, and a boolean true and
// the integer 1 D1 stores for it are the same flag.
function canonicalAuditText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => canonicalAuditText(entry)))
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, canonicalAuditText(entry)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return JSON.stringify(entries)
  }
  return String(value)
}

// What actually lands in old_value/new_value. Booleans become the 0/1 the
// column holds so a diff never reads "No -> 1"; everything else is stored as
// the route supplied it.
function recordedAuditValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0
  return value === undefined ? null : value
}

export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  options: { keys?: readonly string[]; redact?: (key: string) => boolean } = {},
): AuditFieldChange | null {
  const candidates = options.keys && options.keys.length
    ? options.keys
    : [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  const beforeOut: Record<string, unknown> = {}
  const afterOut: Record<string, unknown> = {}
  let changed = 0
  for (const key of candidates) {
    if (AUDIT_DIFF_IGNORED_KEYS.has(key)) continue
    // A redacted key only ever records two fixed strings, so redaction is
    // checked BEFORE the never-recorded stop: "the API key changed" is useful
    // and leaks nothing, while an unredacted secret-shaped key is dropped.
    const redacted = options.redact?.(key) === true
    if (!redacted && AUDIT_NEVER_RECORDED.test(key)) continue
    const beforeValue = before ? before[key] : undefined
    const afterValue = after ? after[key] : undefined
    const beforeText = canonicalAuditText(beforeValue)
    const afterText = after ? canonicalAuditText(afterValue) : null
    if (beforeText === afterText) continue
    changed += 1
    if (redacted) {
      beforeOut[key] = beforeText === null ? null : AUDIT_REDACTED_BEFORE
      afterOut[key] = afterText === null ? null : AUDIT_REDACTED_AFTER
      continue
    }
    beforeOut[key] = beforeText !== null && beforeText.length > AUDIT_LARGE_VALUE_CHARS
      ? summarizeLargeAuditValue(beforeText)
      : recordedAuditValue(beforeValue)
    afterOut[key] = afterText !== null && afterText.length > AUDIT_LARGE_VALUE_CHARS
      ? summarizeLargeAuditValue(afterText)
      : recordedAuditValue(afterValue)
  }
  if (!changed) return null
  // A delete (after === null) records the removed record as the before image
  // and a null after, which is what makes the renderer show every field as
  // removed instead of as an unexplained blank.
  return { before: beforeOut, after: after ? afterOut : null }
}

// Serializers for routes that build their audit row inside their own D1 batch
// (roles, payment-method rename) instead of calling audit().
export function auditChangeColumns(change: AuditFieldChange | null | undefined): { old_value: string | null; new_value: string | null } {
  if (!change) return { old_value: null, new_value: null }
  return {
    old_value: change.before ? JSON.stringify(change.before) : null,
    new_value: change.after ? JSON.stringify(change.after) : null,
  }
}

// K8a: the device of the request being served, set by lib/auth.ts requireAuth
// (see the note on REQUEST_DEVICE_HOOK_KEY there; the key must match). Read
// through a global hook so this module keeps no import of auth.ts. It applies
// only to a row whose actor IS the authenticated user: a row written for
// another account, or outside a request, keeps the freshest-session fallback.
const REQUEST_DEVICE_HOOK_KEY = 'business-os.request-device.v1'
type RequestDevice = { userId: number; deviceName: string | null; deviceTz: string | null }
function currentRequestDevice(): RequestDevice | null {
  try {
    const hook = (globalThis as unknown as Record<symbol, { current?: () => RequestDevice | undefined } | undefined>)[Symbol.for(REQUEST_DEVICE_HOOK_KEY)]
    const device = hook?.current?.()
    return device && Number.isSafeInteger(device.userId) ? device : null
  } catch {
    return null
  }
}

// Ported from backend/src/helpers.ts's audit(). Deliberately swallows its
// own errors (matching the original's comment: "Audit failures must never
// crash the main request") -- an audit log write failing should never be
// the reason a branch/product/sale save fails for the person using the app.
//
// Part 133: audit_logs.device_name/device_tz/client_time have existed on
// the schema since migration 0001, and the Audit Log UI (`auditDeviceLabel`/
// `auditTimezoneLabel` in AuditLog.tsx) already reads and displays them --
// but this was the *only* place anything ever writes an audit_logs row
// (confirmed: `grep -rn "INSERT INTO audit_logs"` across the whole
// `cloudflare/src` tree returns exactly this one call site), and its
// INSERT never included those three columns. Every audit log entry the
// app has ever written has a null device_name/device_tz/client_time,
// silently falling back to the UI's generic "Web login"/"Web session"
// label for every single row, not just an edge case. Fixed by looking up
// the calling user's own most-recently-active live session (device_name/
// device_tz already captured there at login time, see createSession/
// lib/auth.ts) at write time -- deliberately NOT changing this function's
// public signature (userId, userName, action, entity, entityId, details),
// so none of this function's 40+ existing call sites across routes/*.ts
// need to change. client_time isn't available this way (that's a
// per-request client-clock value a small number of callers already thread
// through their own request body separately, e.g. products.ts/compat.ts's
// allowed-fields lists) -- left null here rather than guessed at with the
// server's own clock, since `auditTimezoneLabel`'s fallback already
// produces a reasonable "Server time" label for that case.
// N13: the actor stored on an audit row is the account USERNAME, resolved here
// from users.id rather than taken on trust from the caller.
//
// audit() is called from 130+ places and every one of them passed a *display*
// name -- `user?.name` (the full name) at almost all sites, `user.name ||
// user.username` at a handful -- so the Audit Log read "Za Sethy" while the
// stock, sale and return ledgers built from the same session read "za".
// Resolving from the id fixes every call site at once and makes the value
// unforgeable: the only thing a caller influences is WHICH account id it names,
// and that already comes from the authenticated session.
//
// audit_logs stays OUT of the rename cascade (see userIdentity.ts) because an
// audit row is a point-in-time record; storing the username at write time is
// what makes that exclusion harmless instead of a second naming convention.
//
// P4-4a: this used to be two SELECTs (lookupAuditDeviceInfo, resolveAuditActorName)
// plus the INSERT -- three sequential D1 round trips, awaited at 135 call sites.
// Both lookups are expressed here as LEFT JOINs against the same @user_id bind,
// folded into ONE `INSERT ... SELECT`, so audit() costs exactly one round trip
// regardless of whether userId is set. The fallback semantics are unchanged:
//   - user_name: the account's own username when the users row exists and is
//     non-blank, else the caller-provided name (mirrors resolveActorUsername's
//     `trimmed(row?.username) || trimmed(fallback) || null`); when userId is
//     null the LEFT JOIN matches no row, which is the same "no account" case
//     resolveAuditActorName short-circuited on before.
//   - device_name/device_tz: the most-recently-active live session's device
//     info (mirrors lookupAuditDeviceInfo's ORDER BY last_seen_at DESC, id DESC
//     LIMIT 1), NULL when there is no such session or no userId.
export async function audit(
  env: Env,
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
  // Optional field-level before/after (build it with changedFields above).
  // Three distinct cases, and the difference matters:
  //   - argument ABSENT: old_value stays NULL and new_value stays the details
  //     blob -- byte-for-byte what every pre-existing call site already wrote;
  //   - argument null (a route that opted in, on a save that changed nothing):
  //     BOTH columns are NULL, so the Audit Log shows an empty diff instead of
  //     a details blob it would otherwise render as "every field was added";
  //   - a real change: the two columns hold the changed fields.
  change?: AuditFieldChange | null,
): Promise<void> {
  try {
    await auditOrThrow(env, userId, userName, action, entity, entityId, details, change)
  } catch (_) {
    // Swallow -- see comment above.
  }
}

// The same row as audit(), for an operation that must not report success
// without its record (K10b: a database restore, which cannot ride in one
// batch with the change it records). A failure is the caller's to handle.
export async function auditOrThrow(
  env: Env,
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
  change?: AuditFieldChange | null,
): Promise<void> {
  const statement = buildAuditStatement(userId, userName, action, entity, entityId, details, change)
  await getDb(env).prepare(statement.sql).run(statement.params)
}

// The same INSERT as audit(), as a statement a route can put INSIDE the D1 batch
// that makes the change, so the change and its record commit together or not at
// all (audit() itself stays best-effort for the 130+ routes that call it after
// the fact). entityIdFromLastInsert names the row the batch's preceding INSERT
// created, for a create whose id is not known until it runs.
export function buildAuditStatement(
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
  change?: AuditFieldChange | null,
  options: { entityIdFromLastInsert?: boolean } = {},
): { sql: string; params: Record<string, unknown> } {
  const detailsStr = details != null
    ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
    : null
  const changeColumns = auditChangeColumns(change)
  const idSql = options.entityIdFromLastInsert ? 'last_insert_rowid()' : '@entity_id'
  const requestDevice = currentRequestDevice()
  return {
    sql: `
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz)
      SELECT
        @user_id,
        COALESCE(NULLIF(TRIM(u.username), ''), NULLIF(TRIM(@user_name), '')),
        @action, @entity, ${idSql}, @details, @table_name, ${idSql}, @old_value, @new_value,
        CASE WHEN @request_user_id IS NOT NULL AND @request_user_id = @user_id THEN @request_device_name ELSE s.device_name END,
        CASE WHEN @request_user_id IS NOT NULL AND @request_user_id = @user_id THEN @request_device_tz ELSE s.device_tz END
      FROM (SELECT 1 AS one) AS _dummy
      LEFT JOIN users u ON u.id = @user_id
      LEFT JOIN (
        SELECT device_name, device_tz
        FROM user_sessions
        WHERE user_id = @user_id AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC
        LIMIT 1
      ) AS s ON 1 = 1
    `,
    params: {
      user_id: userId,
      user_name: userName,
      action,
      entity,
      ...(options.entityIdFromLastInsert ? {} : { entity_id: entityId }),
      details: detailsStr,
      table_name: entity,
      old_value: changeColumns.old_value,
      new_value: change === undefined ? detailsStr : changeColumns.new_value,
      request_user_id: requestDevice ? requestDevice.userId : null,
      request_device_name: requestDevice ? requestDevice.deviceName : null,
      request_device_tz: requestDevice ? requestDevice.deviceTz : null,
    },
  }
}

async function getSettingValue(env: Env, key: string): Promise<string | null> {
  const db = getDb(env)
  const row = await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key })
  return row?.value ?? null
}

async function setSettingValue(env: Env, key: string, value: string): Promise<void> {
  const db = getDb(env)
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key, value })
}

export async function getAuditLogRetentionDays(env: Env): Promise<number> {
  const raw = await getSettingValue(env, AUDIT_LOG_RETENTION_SETTING_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) ? Math.max(DEFAULT_AUDIT_LOG_RETENTION_DAYS, parsed) : DEFAULT_AUDIT_LOG_RETENTION_DAYS
}

// Runs on the scheduled worker tick. Deletes audit_logs rows older than the
// configured retention window (default 21 days, see DEFAULT_AUDIT_LOG_RETENTION_DAYS),
// throttled to at most once per day so a 6h cron tick doesn't re-scan the
// table for nothing.
export async function maybeRunScheduledAuditLogRetention(env: Env): Promise<{ skipped: boolean; reason?: string; deleted?: number; retentionDays?: number }> {
  const lastRunRaw = await getSettingValue(env, AUDIT_LOG_RETENTION_LAST_RUN_KEY)
  const lastRun = lastRunRaw ? Date.parse(lastRunRaw) : 0
  if (lastRun && Date.now() - lastRun < AUDIT_LOG_RETENTION_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'ran-recently' }
  }
  const retentionDays = await getAuditLogRetentionDays(env)
  // Compare the RAW created_at column against a full 'YYYY-MM-DD HH:MM:SS'
  // cutoff. The old `date(created_at) < @cutoff` wrapped the column in a
  // function, which defeats any index on created_at and forces a full-table
  // scan, and it deleted in ONE unbounded statement -- on a large backlog that
  // can exceed D1's per-statement CPU/row budget and throw every run, so the
  // table never shrinks. Batch by id (audit_logs has an integer id) so each
  // statement stays bounded; D1 has no `DELETE ... LIMIT`, hence the sub-select.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const db = getDb(env)
  let deleted = 0
  for (;;) {
    const result = await db.prepare(buildAuditLogRetentionDeleteSql()).run({ cutoff })
    const n = result.changes ?? 0
    deleted += n
    if (n < 5000) break
  }
  await setSettingValue(env, AUDIT_LOG_RETENTION_LAST_RUN_KEY, new Date().toISOString())
  if (deleted > 0) {
    await audit(env, null, null, 'audit_log_retention_auto_delete', 'audit_log', null, { retentionDays, cutoffDate: cutoff, deleted })
  }
  return { skipped: false, deleted, retentionDays }
}
