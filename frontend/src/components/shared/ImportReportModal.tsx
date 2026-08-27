import { useEffect, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Modal from './Modal'
import { getImportJobReport } from '../../api/importJobsTransport.ts'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'

// Narrow local type, same pattern BackgroundImportTracker.tsx already uses --
// this modal only ever needs the translation function out of the full app
// context.
type AppContextValue = { t: (key: string) => string }
const useApp = useAppHook as () => AppContextValue

// This modal was globally wired into BackgroundImportTracker (so it's
// reachable from Products/Inventory/Sales/Contacts, not just Dashboard --
// see the "Import warning detail on non-Dashboard pages" progress.md item)
// but every string in it was still hardcoded English, including the
// backend-sourced warning-kind labels (IMPORT_WARNING_LABELS,
// cloudflare/src/lib/importEngine.ts) -- meaning a Khmer-language user saw
// this whole report in English regardless of language setting. Maps each
// known kind onto its own translation key, same "translate a backend-
// supplied machine value via a small local lookup, degrade to the
// server's own label for anything unrecognized" shape
// `translateMovementType` (components/inventory/movementGroups.ts) already
// uses -- kept local rather than shared since this is the only consumer.
const IMPORT_WARNING_KIND_KEYS: Record<string, string> = {
  negative_stock: 'import_warning_kind_negative_stock',
  barcode_collision: 'import_warning_kind_barcode_collision',
  sku_collision: 'import_warning_kind_sku_collision',
  name_match: 'import_warning_kind_name_match',
  membership_mismatch: 'import_warning_kind_membership_mismatch',
  membership_phone_conflict: 'import_warning_kind_membership_phone_conflict',
  duplicate_row_match: 'import_warning_kind_duplicate_row_match',
  stock_action_conflict: 'import_warning_kind_stock_action_conflict',
  other: 'import_warning_kind_other',
}

function translateImportWarningKind(kind: string, fallbackLabel: string, t: (key: string) => string): string {
  const translationKey = IMPORT_WARNING_KIND_KEYS[kind]
  if (!translationKey) return fallbackLabel
  const translated = t(translationKey)
  // t() returns the raw key string itself when a key is missing from both
  // the active language and the English fallback pack -- treat that the
  // same as "not translated" and fall back to the server's own English
  // label rather than ever rendering a bare translation key to the user.
  return translated === translationKey ? fallbackLabel : translated
}

type WarningGroup = {
  kind: string
  label: string
  count: number
  rows: number[]
}

type ImportErrorRow = {
  id?: number | string
  row_number?: number | null
  file_name?: string | null
  code?: string | null
  message?: string | null
}

type ImportJobFileRow = {
  id?: number | string
  kind?: string | null
  original_name?: string | null
  byte_size?: number | null
  status?: string | null
}

type ImportReport = {
  job?: { id?: string; type?: string; status?: string; created_at?: string; created_by_name?: string | null }
  files?: ImportJobFileRow[]
  counts?: { create?: number; update?: number; skip?: number; error?: number }
  totalRows?: number
  warned?: number
  seriousWarningCount?: number
  warningSummary?: WarningGroup[]
  errorCount?: number
  errors?: ImportErrorRow[]
}

type ImportReportModalProps = {
  jobId: string | number
  onClose: () => void
  // Optional label shown in the title (e.g. the source file's name) --
  // callers that already know it (Audit Log's file list, Dashboard's job
  // list) don't need to wait on the report fetch just to show a heading.
  title?: string
}

// Collapses a sorted row-number list into compact ranges for display, e.g.
// [5, 6, 7, 12, 89] -> "5-7, 12, 89" -- the same "rows: r,r,r" notation
// requested, just additionally range-folding contiguous runs since real
// collisions cluster (a shared promotional barcode is usually a contiguous
// block of SKUs in the source file).
function formatRowNumbers(rows: number[]): string {
  if (!rows.length) return ''
  const parts: string[] = []
  let start = rows[0]
  let prev = rows[0]
  for (let i = 1; i <= rows.length; i++) {
    const current = rows[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (current !== undefined) { start = current; prev = current }
  }
  return parts.join(', ')
}

// Kept in sync by hand with cloudflare/src/lib/importEngine.ts's
// SERIOUS_IMPORT_WARNING_KINDS -- this modal can't import that Worker-side
// module directly, so the set is reproduced here. Previously only had 3 of
// the 6 real kinds (missing name_match/membership_mismatch/
// duplicate_row_match, all contact-import kinds), which meant a contact
// import with e.g. a membership-number mismatch showed it under the calmer
// "Other warnings" section instead of "Needs attention" even though the
// backend already correctly classified it as serious.
const SERIOUS_KINDS = new Set(['negative_stock', 'barcode_collision', 'sku_collision', 'name_match', 'membership_mismatch', 'membership_phone_conflict', 'duplicate_row_match', 'stock_action_conflict'])

export default function ImportReportModal({ jobId, onClose, title }: ImportReportModalProps) {
  const { t } = useApp()
  const [report, setReport] = useState<ImportReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getImportJobReport(jobId)
      .then((result) => {
        if (cancelled) return
        setReport((result as { report?: ImportReport } & ImportReport) || null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('import_report_load_failed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per
    // language (useCallback in AppContext), not per-render; adding it here
    // would only re-fire this fetch on a language change mid-view, which
    // isn't worth the extra request for a fallback string used only on error.
  }, [jobId])

  const counts = report?.counts || {}
  const warningSummary = report?.warningSummary || []
  const seriousGroups = warningSummary.filter((g) => SERIOUS_KINDS.has(g.kind))
  const otherGroups = warningSummary.filter((g) => !SERIOUS_KINDS.has(g.kind))
  // A single row can carry more than one warning kind (e.g. both a
  // negative-stock clamp AND a barcode collision) -- summing each group's
  // own count double-counts that row once per kind it triggered, which is
  // exactly what produced the reported "705 warnings" (the headline
  // warned-ROWS stat above) vs. a much larger "1000+ other warnings" (the
  // old sum-of-groups number) on the same job: two different questions
  // (rows affected vs. warning instances raised) both labeled as if they
  // meant the same thing. Use the backend's own distinct-row count
  // (report.seriousWarningCount, see routes/importJobs.ts) instead of
  // summing seriousGroups locally; fall back to the sum only if an older
  // cached report shape doesn't have the field yet.
  const seriousRowCount = report?.seriousWarningCount ?? seriousGroups.reduce((s, g) => s + g.count, 0)
  const errors = report?.errors || []
  const csvFile = (report?.files || []).find((f) => f.kind === 'csv')

  return (
    <Modal title={title || csvFile?.original_name || t('import_report_default_title')} onClose={onClose} size="lg">
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          {t('import_report_loading')}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-red-600 dark:text-red-400 text-sm">{error}</div>
      ) : !report ? (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400 text-sm">{t('import_report_unavailable')}</div>
      ) : (
        <div className="space-y-5">
          {/* Headline counts */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatTile label={t('import_report_stat_created')} value={counts.create ?? 0} />
            <StatTile label={t('import_report_stat_updated')} value={counts.update ?? 0} />
            <StatTile label={t('import_report_stat_skipped')} value={counts.skip ?? 0} />
            <StatTile label={t('import_report_stat_warning_rows')} value={report?.warned ?? 0} tone={(report?.warned ?? 0) > 0 ? 'amber' : undefined} />
            <StatTile label={t('import_report_stat_errors')} value={counts.error ?? 0} tone={counts.error ? 'red' : undefined} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('import_report_warning_rows_hint')}</p>

          {/* Serious warnings, grouped as "kind: rows r, r, r" */}
          {seriousGroups.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 p-4">
              <div className="flex items-center gap-2 mb-2 text-amber-800 dark:text-amber-300 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4" />
                {t('import_report_needs_attention').replace('{n}', String(seriousRowCount))}
              </div>
              <ul className="space-y-1.5 text-sm text-amber-900 dark:text-amber-200">
                {seriousGroups.map((group) => (
                  <li key={group.kind}>
                    <span className="font-medium">{translateImportWarningKind(group.kind, group.label, t)}</span>
                    <span className="text-amber-700/80 dark:text-amber-300/70"> ({group.count}): </span>
                    <span className="font-mono text-xs">{t('import_report_rows_label')} {formatRowNumbers(group.rows)}</span>
                  </li>
                ))}
              </ul>
              {seriousGroups.length > 1 && (
                <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">{t('import_report_groups_overlap_hint')}</p>
              )}
            </div>
          )}

          {otherGroups.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2 text-gray-700 dark:text-gray-300 font-semibold text-sm">
                <FileWarning className="w-4 h-4" />
                {t('import_report_other_warnings')}
              </div>
              <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                {otherGroups.map((group) => (
                  <li key={group.kind}>
                    <span className="font-medium">{translateImportWarningKind(group.kind, group.label, t)}</span>
                    <span> ({group.count}): </span>
                    <span className="font-mono text-xs">{t('import_report_rows_label')} {formatRowNumbers(group.rows)}</span>
                  </li>
                ))}
              </ul>
              {otherGroups.length > 1 && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('import_report_groups_overlap_hint')}</p>
              )}
            </div>
          )}

          {!seriousGroups.length && !otherGroups.length && (
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/10 p-4">
              <CheckCircle2 className="w-4 h-4" />
              {t('import_report_no_warnings')}
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 p-4">
              <div className="text-red-800 dark:text-red-300 font-semibold text-sm mb-2">
                {t('import_report_errors_heading').replace('{n}', String(report?.errorCount ?? errors.length))}
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {errors.map((row, idx) => (
                  <div key={row.id ?? idx} className="text-xs text-red-900 dark:text-red-200 font-mono">
                    {row.row_number != null ? `Row ${row.row_number}: ` : ''}{row.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
      <div className={`text-xl font-bold ${tone === 'red' && value ? 'text-red-600 dark:text-red-400' : tone === 'amber' && value ? 'text-amber-600 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}
