// The "more details" float of ONE record in a Records list. VIEW ONLY.
//
// The owner, 5 Oct 2026: "Keep the click-a-record-to-view-details hint. A
// record shows before and after. A more-details option opens another float
// that is view only: no edits, no actions, just viewing."
//
// The record is already loaded when this opens, so it renders its real
// content from the first paint -- nothing waits on a read and nothing
// expands later. What it adds over the inline Field | Before | After table is
// the whole record at once: what kind of change, on what, by whom, where and
// when, and every CHANGED field as old -> new with room for a long value.
//
// View only is a property of this file, not a convention: it imports no
// writer, renders no input and no button of its own (the shared Modal's
// header X is the one control), and declares itself 'read-only' so closing it
// can never ask about unsaved work. tests/recordDetailFloat.test.ts pins that
// against the rendered markup.
//
// The values come from the SAME adapter the inline table uses, so the two can
// never describe one edit two ways: money goes through the app's formatters
// (house rounding), the time through the business-zone formatter, field names
// from the reader's language pack. Cost lines are removed for a viewer
// without cost permission before anything is rendered (recordForViewer).
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import Modal from './Modal.tsx'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import {
  recordForViewer,
  type RecordItem,
  type RecordRenderContext,
  type RecordsAdapter,
} from '../../utils/entityRecords.ts'

type TranslateFn = (key: string) => string

export interface RecordDetailFloatProps {
  record: RecordItem
  adapter: RecordsAdapter
  /** Fail closed: a viewer is assumed NOT to hold product_cost_view. */
  canViewCosts?: boolean
  onClose: () => void
  t: TranslateFn
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

function makeLabel(t: TranslateFn) {
  return (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
}

export default function RecordDetailFloat({ record: source, adapter, canViewCosts = false, onClose, t, fmtUSD, fmtKHR }: RecordDetailFloatProps) {
  const label = makeLabel(t)
  const ctx: RecordRenderContext = { label, t, fmtUSD, fmtKHR }
  const record = recordForViewer(source, canViewCosts)
  const kind = adapter.kindLabel(adapter.normalizeKind(record.kind), ctx)
  const rows = adapter.fieldRows(record, ctx)
  // A field whose old side was never recorded (the typed reason, a legacy
  // row) has nothing to compare: it shows the value alone, not an arrow from
  // "details unavailable". The inline table keeps its explicit three columns.
  const noOldSide = new Set((Array.isArray(record.changes) ? record.changes : []).filter((change) => change.before.state === 'unknown').map((change) => change.field))
  const via = record.via === 'undo' ? label('undo', 'Undo')
    : record.via === 'redo' ? label('redo', 'Redo')
      : null
  const actor = record.provenance_unknown || !record.actor_username ? label('unknown', 'Unknown') : record.actor_username
  const facts: Array<{ key: string; label: string; value: string }> = [
    { key: 'user', label: label('user', 'User'), value: actor },
    { key: 'when', label: label('recorded_at', 'Recorded at'), value: fmtDateTime24(record.at) },
    ...(record.branch_name ? [{ key: 'branch', label: label('branch', 'Branch'), value: record.branch_name }] : []),
    ...(record.entry != null && record.entry !== '' ? [{ key: 'entry', label: label('entry', 'Entry'), value: `#${record.entry}` }] : []),
    ...(via ? [{ key: 'via', label: label('type', 'Type'), value: via }] : []),
  ]
  // A creation with no recorded fields (a product whose own created date is
  // all that is known) has nothing to compare; every other record without
  // rows says so rather than going quiet.
  const showUnavailable = rows.length === 0 && adapter.normalizeKind(record.kind) !== 'create'
  return (
    <Modal title={kind} onClose={onClose} size="md" layer="nested" unsavedChanges="read-only">
      <div data-record-detail="" className="space-y-3 text-xs">
        {record.subject ? <p className="detail-scroll-text text-sm font-medium leading-relaxed text-gray-800 dark:text-gray-100">{record.subject}</p> : null}
        {/* Khmer glyphs need vertical room: leading-relaxed, not a line box
            sized to Latin text, or the subscript strokes clip. */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
          {facts.map((fact) => (
            <div key={fact.key} className="min-w-0">
              <dt className="leading-relaxed text-gray-400">{fact.label}</dt>
              <dd data-record-fact={fact.key} className="break-words font-medium leading-relaxed text-gray-700 dark:text-gray-200">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {rows.length > 0 ? (
          <div>
            <div className="mb-1 font-semibold leading-relaxed text-gray-500 dark:text-gray-400">{label('changed_fields', 'Changed fields')}</div>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {rows.map((row) => (
                <li key={row.key} data-record-change="" className="px-3 py-2">
                  <div className="leading-relaxed text-gray-400">{row.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-relaxed">
                    {noOldSide.has(row.key) ? null : <>
                      <span data-record-before="" className="min-w-0 break-words text-gray-500 dark:text-gray-400">{row.before}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                    </>}
                    <span data-record-after="" className="min-w-0 break-words font-semibold text-gray-900 dark:text-gray-50">{row.after}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : showUnavailable ? (
          <p className="leading-relaxed text-gray-400">{label('historical_details_unavailable', 'Historical details unavailable')}</p>
        ) : null}
      </div>
    </Modal>
  )
}
