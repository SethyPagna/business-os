import { UTF8_BOM, escapeCsvValue } from './csv.ts'

// exampleRow is optional and keyed by header name -- a header with no entry
// in the map is left blank in the example line, same as a real import file
// would leave an unused optional column blank. Was previously always
// header-only (no data row at all), which is exactly the "template did not
// give example and explain" gap reported against the products import: a
// person opening the file for the first time had nothing showing what a
// real value should look like for a column like `batch` or `date`, only the
// bare column name.
export function buildCSVTemplate(headers: string[], filename: string, exampleRow?: Record<string, unknown>): void {
  const lines = [headers.join(',')]
  if (exampleRow && typeof exampleRow === 'object') {
    lines.push(headers.map((header) => escapeCsvValue(exampleRow[header])).join(','))
  }
  const blob = new Blob([UTF8_BOM, lines.join('\n'), '\n'], { type: 'text/csv;charset=utf-8' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}
