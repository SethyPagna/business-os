// The RECORDS float. ONE float and ONE change table for every record type.
//
// The owner, Sep 6 2026 (sales) and Sep 22 2026 (everything else): "one line
// called Records with total records when press it pops up a float with who
// made changes in this ... record ... and click on specific information/record
// row can see more details before and after" / "having records in sales,
// returns, stock changes, products, invoices, etc... Compact rows, press to
// open etc..."
//
// This is SaleRecordsFloat generalised, not a second float beside it. Four
// surfaces now answer the same question (a sale, a return, a product, a
// contact), and four copies of this component would be four sets of
// escape/backdrop/safe-area bugs and four chances for "Before" and "After" to
// stop meaning the same thing. What each surface still owns is only its
// vocabulary and its value formatting -- the RecordsAdapter it passes in.
//
// Decisions kept verbatim from the sale float, because they were the ask:
//
//   "a float"                 the shared Modal -- portalled above the content,
//                             ONE close affordance (its header X), declared
//                             read-only so nothing here can be lost. No
//                             minimize: there is no draft to park.
//   "who made changes"        the acting account's USERNAME leads every row,
//                             with the branch/username/dd-mm-yyyy HH:mm
//                             convention every other history surface uses.
//   "or +"                    the default list is UNFILTERED; the filter
//                             offers only the kinds this record actually has,
//                             through the shared FilterMenu, so the chosen
//                             filters live inside the menu and never spill
//                             into the header.
//   "click ... before/after"  selecting a row expands its before -> after
//                             INSIDE the float, ONE row at a time: this is a
//                             comparison, and two open side by side is how a
//                             reader ends up reading the wrong record's
//                             numbers.
import { useEffect, useMemo, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Modal from './Modal.tsx'
import FilterMenu from './FilterMenu.tsx'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import {
  filterRecords,
  normalizeRecordsResponse,
  recordKindCounts,
  type RecordItem,
  type RecordRenderContext,
  type RecordsAdapter,
} from '../../utils/entityRecords.ts'

type TranslateFn = (key: string) => string

export interface RecordsFloatProps {
  /** The float's title, already composed by the caller (it knows the record). */
  title: string
  /**
   * Which record is open -- 'sale:41', 'product:12'. The read is keyed on THIS,
   * not on the loader's identity: an inline arrow is a new function every
   * render, and an effect that depends on one re-reads forever.
   */
  recordKey: string | number
  /** Reads the records. One call, on open; a failed read says so. */
  load: () => Promise<unknown>
  adapter: RecordsAdapter
  onClose: () => void
  t: TranslateFn
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

export interface RecordChangeTableProps {
  record: RecordItem
  adapter: RecordsAdapter
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

/** The expanded Field | Before | After table, exported so it is testable. */
export function RecordChangeTable({ record, adapter, t, fmtUSD, fmtKHR }: RecordChangeTableProps) {
  const label = makeLabel(t)
  const ctx: RecordRenderContext = { label, t, fmtUSD, fmtKHR }
  const rows = adapter.fieldRows(record, ctx)
  if (rows.length === 0) return <p className="text-xs text-gray-400">{label('historical_details_unavailable', 'Historical details unavailable')}</p>
  return (
    <table className="w-full text-[11px]">
      <thead className="text-gray-400"><tr>
        <th className="py-1 text-left font-medium">{label('field', 'Field')}</th>
        <th className="py-1 text-right font-medium">{label('before', 'Before')}</th>
        <th className="py-1 text-right font-medium">{label('after', 'After')}</th>
      </tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.key}>
          {/* Khmer glyphs need vertical room: leading-relaxed, not a line box
              sized to Latin text, or the subscript strokes clip. */}
          <td className="py-0.5 pr-2 leading-relaxed">{row.label}</td>
          <td className="py-0.5 text-right leading-relaxed tabular-nums">{row.before}</td>
          <td className="py-0.5 text-right leading-relaxed tabular-nums font-semibold text-gray-800 dark:text-gray-100">{row.after}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

export interface RecordRowProps extends RecordChangeTableProps {
  open: boolean
  onToggle: () => void
}

/**
 * ONE compact row: what changed, on what, by whom, where and when -- and the
 * before/after table underneath once it is pressed. Exported so the row
 * contract (the username, the branch only where there is one, press-to-open)
 * is pinned by a rendered test rather than by reading the JSX.
 */
export function RecordRow({ record, adapter, open, onToggle, t, fmtUSD, fmtKHR }: RecordRowProps) {
  const label = makeLabel(t)
  const ctx: RecordRenderContext = { label, t, fmtUSD, fmtKHR }
  // The via badge. Only the two replay directions are named: nearly every
  // record was made by an ordinary apply and a badge on nearly every row is
  // noise, and an unknown value from a newer Worker prints nothing rather than
  // an English identifier.
  const via = record.via === 'undo' ? label('undo', 'Undo')
    : record.via === 'redo' ? label('redo', 'Redo')
      : null
  return (
    <li>
      <button
        type="button"
        data-records-row=""
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-1 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* Khmer glyphs need vertical room: leading-relaxed, not a line box
                sized to Latin text, or the subscript strokes clip. */}
            <span className="text-[13px] font-medium leading-relaxed text-gray-800 dark:text-gray-100">{adapter.kindLabel(adapter.normalizeKind(record.kind), ctx)}</span>
            {/* Names are never cut to an ellipsis: the scroller is how a long
                product or receipt name stays readable. */}
            {record.subject ? <span className="detail-scroll-text min-w-0 text-xs text-gray-500">{record.subject}</span> : null}
          </span>
          {/* The history convention: BRANCH (only where the row carries one --
              audit_logs has no branch column, so most records honestly have
              none and the span is simply absent), the acting USERNAME, then
              the dd/mm/yyyy HH:mm stamp. */}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-relaxed text-gray-400">
            {record.branch_name ? <span data-records-branch="">{record.branch_name}</span> : null}
            <span data-records-actor="">{record.provenance_unknown || !record.actor_username
              ? label('unknown', 'Unknown')
              : record.actor_username}</span>
            <span>{fmtDateTime24(record.at)}</span>
            {via ? <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{via}</span> : null}
          </span>
        </span>
      </button>
      {open ? (
        <div className="px-1 pb-3 pl-6">
          <RecordChangeTable record={record} adapter={adapter} t={t} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
        </div>
      ) : null}
    </li>
  )
}

export default function RecordsFloat({ title, recordKey, load, adapter, onClose, t, fmtUSD, fmtKHR }: RecordsFloatProps) {
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Set<string>>(new Set())

  const label = makeLabel(t)
  const ctx: RecordRenderContext = { label, t, fmtUSD, fmtKHR }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    load()
      .then((payload) => {
        if (cancelled) return
        setRecords(normalizeRecordsResponse(payload))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // An empty list would read as "nobody ever touched this record", which
        // is a different and wrong answer. A failed read says it failed.
        setError((cause as Error)?.message || label('records_load_failed_record', 'Could not load these records.'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey])

  const visible = useMemo(() => filterRecords(records, kinds, adapter), [records, kinds, adapter])
  const counts = useMemo(() => recordKindCounts(records, adapter), [records, adapter])

  const toggleKind = (kind: string): void => {
    setKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  return (
    <Modal title={title} onClose={onClose} size="lg" unsavedChanges="read-only">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {visible.length === records.length
              ? `${records.length} ${label('records', 'records')}`
              : `${visible.length} / ${records.length}`}
          </span>
          {/* Chosen filters live INSIDE the menu -- never as chips beside it. */}
          <FilterMenu
            compact
            label={t('filter') || 'Filter'}
            activeCount={kinds.size}
            onClear={kinds.size ? () => setKinds(new Set()) : null}
            sections={[{
              id: 'record_kind',
              label: label('record_kind', 'Change type'),
              options: counts.map(({ kind, count }) => ({
                id: kind,
                label: `${adapter.kindLabel(kind, ctx)} (${count})`,
                active: kinds.has(kind),
                onClick: () => toggleKind(kind),
              })),
            }]}
          />
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-gray-400">{t('loading') || 'Loading…'}</div>
        ) : error ? (
          <div role="alert" className="rounded border border-red-200 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:text-red-400">{error}</div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">{t('no_data')}</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {visible.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                adapter={adapter}
                open={openId === record.id}
                onToggle={() => setOpenId(openId === record.id ? null : record.id)}
                t={t}
                fmtUSD={fmtUSD}
                fmtKHR={fmtKHR}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
