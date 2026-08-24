// Audit Log currently shows old_value/new_value as raw pretty-printed JSON
// blobs (see AuditLog.tsx's "Before (old data)"/"After (new data)" <pre>
// blocks) -- readable for a developer, not for the "audit log: raw/non-
// user-friendly data display, needs a readable formatted view" request
// carried in progress.md since the Aug 18 2026 batch. This module builds a
// field-by-field diff instead: only the fields that actually changed,
// labeled in plain words, old -> new. The raw JSON view stays available
// (moved behind a toggle in AuditLog.tsx) for anyone who wants the exact
// payload -- this doesn't replace it, it makes the default view readable.

export interface AuditFieldDiffRow {
  key: string
  label: string
  before: string | null
  after: string | null
  changeType: 'changed' | 'added' | 'removed'
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
// summary describe changes the same way.
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

function safeParseRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Builds only the rows that actually changed, sorted by label. Returns []
// when either side isn't parseable JSON (caller falls back to the raw
// view in that case) or when there's genuinely nothing to show.
export function buildAuditFieldDiff(oldValue: string | null | undefined, newValue: string | null | undefined): AuditFieldDiffRow[] {
  const before = safeParseRecord(oldValue)
  const after = safeParseRecord(newValue)
  if (!before && !after) return []

  const keys = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})])
  const rows: AuditFieldDiffRow[] = []

  for (const key of keys) {
    if (IGNORED_DIFF_KEYS.has(key)) continue
    const beforeFormatted = before ? formatAuditFieldValue(before[key]) : null
    const afterFormatted = after ? formatAuditFieldValue(after[key]) : null
    if (beforeFormatted === afterFormatted) continue

    let changeType: AuditFieldDiffRow['changeType'] = 'changed'
    if (beforeFormatted === null && afterFormatted !== null) changeType = 'added'
    else if (beforeFormatted !== null && afterFormatted === null) changeType = 'removed'

    rows.push({
      key,
      label: formatAuditFieldLabel(key),
      before: beforeFormatted,
      after: afterFormatted,
      changeType,
    })
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label))
}
