import { buildCSV } from './csv.js'

export function buildReportManifestRows(rows = []) {
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
}) {
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
