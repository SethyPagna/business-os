import { renderToStaticMarkup } from 'react-dom/server'
import { BarChart, DonutChart, LineChart } from '../components/dashboard/charts'
import { buildCSV } from './csv'
import { fmtTime } from './formatters'

const REPORT_STYLES = `
  :root {
    color-scheme: light;
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface-alt: #f1f5f9;
    --border: #dbe4f0;
    --text: #0f172a;
    --muted: #64748b;
    --accent: #2563eb;
    --accent-soft: rgba(37, 99, 235, 0.08);
    --success: #16a34a;
    --warning: #d97706;
    --danger: #dc2626;
    --shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .report-shell {
    max-width: 1200px;
    margin: 0 auto;
    padding: 28px;
  }
  .report-header {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 24px;
  }
  .report-title {
    font-size: 28px;
    line-height: 1.15;
    font-weight: 800;
    margin: 0 0 6px;
  }
  .report-subtitle,
  .report-meta {
    color: var(--muted);
    margin: 0;
  }
  .report-meta {
    text-align: right;
    min-width: 220px;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }
  .summary-card,
  .chart-card,
  .table-card,
  .meta-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--shadow);
  }
  .summary-card {
    padding: 16px;
  }
  .summary-label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .summary-value {
    margin-top: 8px;
    font-size: 26px;
    line-height: 1.1;
    font-weight: 800;
  }
  .summary-sub {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .meta-grid,
  .chart-grid,
  .table-grid {
    display: grid;
    gap: 16px;
    margin-bottom: 24px;
  }
  .meta-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .chart-grid { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .table-grid { grid-template-columns: 1fr; }
  .meta-card,
  .chart-card,
  .table-card {
    padding: 18px;
  }
  .section-title {
    margin: 0 0 6px;
    font-size: 16px;
    line-height: 1.2;
    font-weight: 800;
  }
  .section-subtitle {
    margin: 0 0 14px;
    color: var(--muted);
    font-size: 12px;
  }
  .meta-list {
    display: grid;
    gap: 10px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px dashed var(--border);
    padding-bottom: 8px;
  }
  .meta-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .meta-label {
    color: var(--muted);
    font-weight: 600;
  }
  .meta-value {
    text-align: right;
    font-weight: 700;
  }
  .chart-frame {
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.9));
    border: 1px solid rgba(148, 163, 184, 0.18);
    padding: 12px;
  }
  .chart-frame svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .chart-frame text {
    font-family: inherit;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
  }
  thead th {
    background: var(--surface-alt);
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 10px 12px;
    text-align: left;
    text-transform: uppercase;
  }
  tbody td {
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  tbody tr:nth-child(even) td {
    background: rgba(241, 245, 249, 0.45);
  }
  .empty-state {
    padding: 18px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--muted);
    text-align: center;
    font-weight: 600;
  }
  .footnote-list {
    margin: 0;
    padding-left: 18px;
    color: var(--muted);
  }
  @media (max-width: 720px) {
    .report-shell { padding: 18px; }
    .report-title { font-size: 24px; }
    .report-meta { text-align: left; }
    .chart-grid { grid-template-columns: 1fr; }
  }
`

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCellValue(value) {
  if (value === undefined || value === null || value === '') return '&mdash;'
  return escapeHtml(value)
}

function renderChartMarkup(chart) {
  if (!chart?.type) return ''
  const props = chart.props || {}
  if (!Array.isArray(props.data) || !props.data.length) return ''
  if (chart.type === 'line') {
    return renderToStaticMarkup(<LineChart {...props} />)
  }
  if (chart.type === 'bar') {
    return renderToStaticMarkup(<BarChart {...props} />)
  }
  if (chart.type === 'donut') {
    return renderToStaticMarkup(<DonutChart {...props} />)
  }
  return ''
}

function renderMetadataGroups(groups = []) {
  if (!groups.length) return ''
  return `
    <section class="meta-grid">
      ${groups.map((group) => `
        <article class="meta-card">
          <h2 class="section-title">${escapeHtml(group.title || 'Report metadata')}</h2>
          ${group.subtitle ? `<p class="section-subtitle">${escapeHtml(group.subtitle)}</p>` : ''}
          <div class="meta-list">
            ${(group.rows || []).map((row) => `
              <div class="meta-row">
                <span class="meta-label">${escapeHtml(row.label || '')}</span>
                <span class="meta-value">${formatCellValue(row.value)}</span>
              </div>
            `).join('')}
          </div>
        </article>
      `).join('')}
    </section>
  `
}

function renderSummaryCards(cards = []) {
  if (!cards.length) return ''
  return `
    <section class="summary-grid">
      ${cards.map((card) => `
        <article class="summary-card">
          <div class="summary-label">${escapeHtml(card.label || '')}</div>
          <div class="summary-value">${formatCellValue(card.value)}</div>
          ${card.sub ? `<div class="summary-sub">${escapeHtml(card.sub)}</div>` : ''}
        </article>
      `).join('')}
    </section>
  `
}

function renderCharts(charts = []) {
  const usableCharts = charts
    .map((chart) => ({ ...chart, markup: renderChartMarkup(chart) }))
    .filter((chart) => chart.markup)
  if (!usableCharts.length) return ''
  return `
    <section class="chart-grid">
      ${usableCharts.map((chart) => `
        <article class="chart-card">
          <h2 class="section-title">${escapeHtml(chart.title || 'Chart')}</h2>
          ${chart.subtitle ? `<p class="section-subtitle">${escapeHtml(chart.subtitle)}</p>` : ''}
          <div class="chart-frame">${chart.markup}</div>
        </article>
      `).join('')}
    </section>
  `
}

function renderTables(tables = []) {
  const usableTables = (tables || []).filter((table) => table && table.title)
  if (!usableTables.length) return ''
  return `
    <section class="table-grid">
      ${usableTables.map((table) => {
        const rows = Array.isArray(table.rows) ? table.rows : []
        const limitedRows = table.limit ? rows.slice(0, table.limit) : rows
        const headers = limitedRows[0] ? Object.keys(limitedRows[0]) : []
        return `
          <article class="table-card">
            <h2 class="section-title">${escapeHtml(table.title)}</h2>
            ${table.subtitle ? `<p class="section-subtitle">${escapeHtml(table.subtitle)}</p>` : ''}
            ${limitedRows.length
              ? `
                <table>
                  <thead>
                    <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
                  </thead>
                  <tbody>
                    ${limitedRows.map((row) => `
                      <tr>${headers.map((header) => `<td>${formatCellValue(row[header])}</td>`).join('')}</tr>
                    `).join('')}
                  </tbody>
                </table>
              `
              : `<div class="empty-state">${escapeHtml(table.emptyLabel || 'No data available for this section.')}</div>`}
          </article>
        `
      }).join('')}
    </section>
  `
}

function renderNotes(notes = []) {
  if (!notes.length) return ''
  return `
    <section class="table-card">
      <h2 class="section-title">Notes</h2>
      <ul class="footnote-list">
        ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
    </section>
  `
}

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
  report = null,
}) {
  const files = [...csvFiles]
  if (manifestRows.length) {
    files.push({
      name: `${baseName}-manifest-${exportStamp}.csv`,
      content: buildCSV(manifestRows),
    })
  }
  if (report) {
    files.push({
      name: report.fileName || `${baseName}-report.html`,
      content: buildStandaloneReportHtml(report),
    })
  }
  return files
}

export function buildStandaloneReportHtml({
  title,
  subtitle = '',
  exportedAt = new Date().toISOString(),
  summaryCards = [],
  metadataGroups = [],
  charts = [],
  tables = [],
  notes = [],
}) {
  const formattedExportTime = fmtTime(exportedAt)
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title || 'Export report')}</title>
    <style>${REPORT_STYLES}</style>
  </head>
  <body>
    <main class="report-shell">
      <header class="report-header">
        <div>
          <h1 class="report-title">${escapeHtml(title || 'Export report')}</h1>
          ${subtitle ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <p class="report-meta">Generated ${escapeHtml(formattedExportTime)}<br />Self-contained HTML report with inline SVG charts</p>
      </header>
      ${renderSummaryCards(summaryCards)}
      ${renderMetadataGroups(metadataGroups)}
      ${renderCharts(charts)}
      ${renderTables(tables)}
      ${renderNotes(notes)}
    </main>
  </body>
</html>`
}
