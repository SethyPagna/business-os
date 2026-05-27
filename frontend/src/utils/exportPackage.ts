import { buildCSV } from './csv.js'

export interface ReportManifestInputRow {
  section?: string
  metric?: string
  label?: string
  value?: unknown
}

export interface ReportManifestRow {
  Section: string
  Metric: string
  Value: unknown
}

export interface ReportPackageFile {
  name: string
  content: string
}

export interface BuildReportPackageFilesOptions {
  baseName: string
  exportStamp: string
  manifestRows?: ReportManifestRow[]
  csvFiles?: ReportPackageFile[]
  reportFileName?: string
  reportContent?: string
}

export function buildReportManifestRows(rows: ReportManifestInputRow[] = []): ReportManifestRow[] {
  return (rows || []).map((row, index) => ({
    Section: row.section || 'Report Manifest',
    Metric: row.metric || row.label || `Item ${index + 1}`,
    Value: row.value ?? '',
  }))
}

export function buildReportPackageFiles({
  baseName,
  exportStamp,
  manifestRows = [],
  csvFiles = [],
  reportFileName = '',
  reportContent = '',
}: BuildReportPackageFilesOptions): ReportPackageFile[] {
  const files = [...csvFiles]
  if (manifestRows.length) {
    files.push({
      name: `${baseName}-manifest-${exportStamp}.csv`,
      content: buildCSV(manifestRows),
    })
  }
  if (reportFileName && reportContent) {
    files.push({
      name: reportFileName,
      content: reportContent,
    })
  }
  return files
}
