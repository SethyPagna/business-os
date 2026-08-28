// H1 + X5 (Part 401): the shared export machinery behind ExportOptionsDialog.
// Pure helpers here so the projection and the print/PDF document builder are
// unit-testable without JSX.
//
// PDF deliberately has NO library: the dialog opens a clean printable
// document and calls print() -- every platform's print dialog offers
// "Save as PDF", which keeps the bundle small, works offline, and renders
// Khmer with the system fonts instead of whatever glyphs a JS PDF engine
// ships. "Excel" uses the existing xlsxExport bridge; CSV the existing
// csv utils.

export interface ExportColumn {
  key: string
  label: string
  defaultSelected?: boolean
}

// Rows keep the COLUMN ORDER of `columns`, not the selection click order,
// and only the selected keys survive -- the export never leaks a column the
// person unticked (H1's whole point; C2's staff-only fields ride on this).
export function projectExportRows(
  rows: Array<Record<string, unknown>>,
  columns: ExportColumn[],
  selectedKeys: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  const kept = columns.filter((column) => selectedKeys.has(column.key))
  return rows.map((row) => {
    const projected: Record<string, unknown> = {}
    for (const column of kept) projected[column.label] = row[column.key] ?? ''
    return projected
  })
}

// Humanizes a snake_case contract key for the checkbox label / exported
// header: same convention the audit field diff uses.
export function exportColumnLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\busd\b/gi, 'USD')
    .replace(/\bkhr\b/gi, 'KHR')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

// localStorage per-surface column memory ("the chosen set is remembered per
// page"). Both directions are try/catch: storage can be blocked or full, and
// a remembered set naming columns that no longer exist is silently
// intersected away.
export function loadRememberedColumns(rememberKey: string, columns: ExportColumn[]): Set<string> | null {
  try {
    const raw = localStorage.getItem(`bos_export_columns_${rememberKey}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = new Set(columns.map((column) => column.key))
    const kept = parsed.filter((key): key is string => typeof key === 'string' && valid.has(key))
    return kept.length ? new Set(kept) : null
  } catch {
    return null
  }
}

export function saveRememberedColumns(rememberKey: string, selected: ReadonlySet<string>): void {
  try {
    localStorage.setItem(`bos_export_columns_${rememberKey}`, JSON.stringify([...selected]))
  } catch { /* storage blocked/full -- the export itself still works */ }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// The printable document. Kept as a pure string builder so the test can
// assert structure + escaping without a window.
export function buildPrintDocument({ title, subtitle, headers, rows }: {
  title: string
  subtitle?: string
  headers: string[]
  rows: Array<Record<string, unknown>>
}): string {
  const headCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const bodyRows = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans Khmer', 'Khmer OS', sans-serif; margin: 24px; color: #0f172a; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.meta { font-size: 11px; color: #64748b; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 6px; text-align: left; vertical-align: top; word-break: break-word; }
  thead th { background: #f1f5f9; font-weight: 600; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  @page { margin: 12mm; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(subtitle || '')}</p>
<table><thead><tr>${headCells}</tr></thead><tbody>
${bodyRows}
</tbody></table>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`
}

// Opens the printable document; the platform print dialog's "Save as PDF"
// is the PDF path. Returns false when the popup was blocked so the dialog
// can tell the person instead of failing silently.
export function openPrintExport(input: { title: string; subtitle?: string; headers: string[]; rows: Array<Record<string, unknown>> }): boolean {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.open()
  printWindow.document.write(buildPrintDocument(input))
  printWindow.document.close()
  return true
}
