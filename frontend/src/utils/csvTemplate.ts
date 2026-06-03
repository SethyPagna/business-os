import { UTF8_BOM } from './csv.ts'

export function buildCSVTemplate(headers: string[], filename: string): void {
  const blob = new Blob([UTF8_BOM, headers.join(','), '\n'], { type: 'text/csv;charset=utf-8' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}
