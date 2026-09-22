// Audit Log currently shows old_value/new_value as raw pretty-printed JSON
// blobs (see AuditLog.tsx's "Before (old data)"/"After (new data)" <pre>
// blocks) -- readable for a developer, not for the "audit log: raw/non-
// user-friendly data display, needs a readable formatted view" request
// carried in progress.md since the Aug 18 2026 batch. This module builds a
// field-by-field diff instead: only the fields that actually changed,
// labeled in plain words, old -> new. The raw JSON view stays available
// (moved behind a toggle in AuditLog.tsx) for anyone who wants the exact
// payload -- this doesn't replace it, it makes the default view readable.
//
// Sep 23 2026 (records lane, verifier findings E4/E6). Three things this
// renderer got wrong on real rows:
//
//   1. A row with NO old side at all -- a legacy row whose payload is the
//      recorded details, a create -- was rendered as a wall of "added"
//      fields: `From | null | Coke 330 ml [added]`. Nothing was added; that
//      is simply what the record says. Those rows are CONTEXT now, and the
//      added/removed/changed vocabulary is reserved for rows that carry both
//      sides, where it means something.
//   2. A nested object (an address, a configured payment-method list) was
//      flattened into one unreadable line. Nested objects now expand into
//      their own rows, `Parent - Child`, up to MAX_NESTED_DEPTH.
//   3. A long value (a receipt template runs to kilobytes) was rendered
//      inline, pushing the row off the screen. Those rows are flagged `long`
//      so the renderer can give them their own scrolling block.

export interface AuditFieldDiffRow {
  key: string
  label: string
  before: string | null
  after: string | null
  /**
   * 'context' means the record carries only one side, so there is nothing to
   * compare: the value is what was recorded, not something that "changed".
   */
  changeType: 'changed' | 'added' | 'removed' | 'context'
  /** 0 for a top-level field, 1+ for a key inside a nested object. */
  depth: number
  /** The value is too long for an inline row and needs its own block. */
  long: boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// snake_case or camelCase -> "Title Case Words", same convention
// formatEntityName (AuditLog.tsx) already uses for table_name/entity.
export function formatAuditFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

// Recursive so a nested object/array field (e.g. a sale's `items`) still
// reads as one flat line instead of falling back to raw JSON -- same
// technique AuditLog.tsx's own flattenSummaryValue already uses for the
// list-row summary, reused here so the detail view and the list-row
// summary describe changes the same way. Objects nested no deeper than
// MAX_NESTED_DEPTH are expanded into rows before this is reached; this is
// what the rest (arrays, deeper objects) still collapses to.
function formatAuditFieldValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) {
    const parts = value.map((entry) => formatAuditFieldValue(entry)).filter((part): part is string => Boolean(part))
    return parts.length ? parts.join(', ') : null
  }
  if (isPlainRecord(value)) {
    const parts = Object.entries(value)
      .map(([key, entryValue]) => {
        const formatted = formatAuditFieldValue(entryValue)
        return formatted ? `${formatAuditFieldLabel(key)}: ${formatted}` : null
      })
      .filter((part): part is string => Boolean(part))
    return parts.length ? parts.join(', ') : null
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

// Bookkeeping fields every table carries that never belong in a human-
// facing diff -- an audit row about *what changed* shouldn't itself list
// "Updated At changed" as one of the changes.
const IGNORED_DIFF_KEYS = new Set(['id', 'created_at', 'updated_at', 'client_request_id'])

/**
 * How deep a nested object is expanded into its own rows. Two levels covers
 * every payload this app writes (a settings object of objects is the worst
 * case); past that the flattened one-line form is still better than an
 * unbounded row explosion.
 */
const MAX_NESTED_DEPTH = 2

/**
 * Longer than this and a value gets its own scrolling block instead of an
 * inline row. Sized from the real offenders: an address object flattens to
 * ~200 characters, a receipt template to thousands.
 */
const LONG_VALUE_CHARS = 180

function safeParseRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function collectRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  context: boolean,
  depth: number,
  keyPrefix: string,
  labelPrefix: string,
  rows: AuditFieldDiffRow[],
): void {
  const keys = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const key of keys) {
    if (IGNORED_DIFF_KEYS.has(key)) continue
    const beforeValue = before ? before[key] : undefined
    const afterValue = after ? after[key] : undefined
    const fullKey = keyPrefix ? `${keyPrefix}.${key}` : key
    const label = labelPrefix ? `${labelPrefix} - ${formatAuditFieldLabel(key)}` : formatAuditFieldLabel(key)

    // A nested object is its own set of fields, not one line of text.
    if (depth < MAX_NESTED_DEPTH && (isPlainRecord(beforeValue) || isPlainRecord(afterValue))) {
      collectRows(
        isPlainRecord(beforeValue) ? beforeValue : null,
        isPlainRecord(afterValue) ? afterValue : null,
        context,
        depth + 1,
        fullKey,
        label,
        rows,
      )
      continue
    }

    const beforeFormatted = formatAuditFieldValue(beforeValue)
    const afterFormatted = formatAuditFieldValue(afterValue)
    if (beforeFormatted === afterFormatted) continue

    let changeType: AuditFieldDiffRow['changeType'] = 'changed'
    if (context) changeType = 'context'
    else if (beforeFormatted === null && afterFormatted !== null) changeType = 'added'
    else if (beforeFormatted !== null && afterFormatted === null) changeType = 'removed'

    rows.push({
      key: fullKey,
      label,
      before: beforeFormatted,
      after: afterFormatted,
      changeType,
      depth,
      long: (beforeFormatted?.length || 0) > LONG_VALUE_CHARS || (afterFormatted?.length || 0) > LONG_VALUE_CHARS,
    })
  }
}

/**
 * Builds only the rows worth showing, sorted by label (which keeps a nested
 * object's rows together, since they share their parent's label prefix).
 * Returns [] when neither side is parseable JSON -- the caller falls back to
 * the raw view then -- or when there is genuinely nothing to show.
 *
 * Passing only a new side (a create, a legacy details payload, the `details`
 * column of any row) is a legitimate call: it yields context rows.
 */
export function buildAuditFieldDiff(oldValue: string | null | undefined, newValue: string | null | undefined): AuditFieldDiffRow[] {
  const before = safeParseRecord(oldValue)
  const after = safeParseRecord(newValue)
  if (!before && !after) return []

  const rows: AuditFieldDiffRow[] = []
  // No old side at all: there is nothing these values changed FROM.
  collectRows(before, after, !before, 0, '', '', rows)
  return rows.sort((a, b) => a.label.localeCompare(b.label))
}
