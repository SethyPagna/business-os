import type { AuditFieldDiffRow } from '../../utils/auditLogFieldDiff.ts'

// One line of the Field | Before | After table, shared by the changed-field
// block and the recorded-context block so the two can never drift apart.
//
// A context row has no old side to compare against, so it reads "Field: value"
// -- no strike-through, no arrow, no green "added" wall (the owner's E4
// report: a legacy rename row printed From/Rows/To as three additions that
// never happened). A long value (a receipt template is kilobytes) gets its own
// scrolling block; leading-relaxed because Khmer subscripts clip in a line box
// sized to Latin text.
export default function AuditFieldDiffLine({ row }: { row: AuditFieldDiffRow }) {
  const indent = row.depth > 0 ? { paddingLeft: `${Math.min(row.depth, 2) * 12}px` } : undefined
  const body = row.changeType === 'context' ? (
    <span className="min-w-0 break-words text-gray-700 dark:text-gray-200">{row.after ?? row.before}</span>
  ) : row.changeType === 'added' ? (
    <span className="min-w-0 break-words text-green-600 dark:text-green-400">{row.after}</span>
  ) : row.changeType === 'removed' ? (
    <span className="min-w-0 break-words text-red-500 line-through dark:text-red-400">{row.before}</span>
  ) : (
    <span className="flex min-w-0 flex-wrap items-center gap-1 break-words">
      <span className="text-red-500 line-through dark:text-red-400">{row.before}</span>
      <span className="text-gray-400">&rarr;</span>
      <span className="text-green-600 dark:text-green-400">{row.after}</span>
    </span>
  )
  if (row.long) {
    return (
      <div data-audit-diff-row={row.changeType} style={indent} className="text-xs leading-relaxed">
        <div className="mb-0.5 font-medium text-gray-500 dark:text-gray-400">{row.label}</div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 font-mono text-[11px] text-gray-700 dark:bg-gray-900/60 dark:text-gray-200">
          {row.changeType === 'removed' ? row.before : row.after ?? row.before}
        </pre>
      </div>
    )
  }
  return (
    <div data-audit-diff-row={row.changeType} style={indent} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-relaxed">
      <span className="w-28 flex-shrink-0 font-medium text-gray-500 dark:text-gray-400 sm:w-32">{row.label}</span>
      {body}
    </div>
  )
}
