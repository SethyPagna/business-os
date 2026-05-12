import fs from 'node:fs/promises'
import path from 'node:path'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMs(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `${Math.round(number)} ms`
}

function formatCls(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toFixed(3)
}

function formatCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : ''
}

function formatBytes(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return ''
  if (number >= 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(2)} MB`
  if (number >= 1024) return `${Math.round(number / 1024)} KB`
  return `${number} B`
}

function toRelativeLink(reportDir, candidatePath) {
  if (!candidatePath) return ''
  const resolved = path.resolve(candidatePath)
  return path.relative(reportDir, resolved).replaceAll('\\', '/')
}

function inferHotPath(routeEntry) {
  const readyMs = Number(routeEntry.readyMs || routeEntry.ms || 0)
  const apiMaxMs = Number(routeEntry.maxApiMs || 0)
  const lcpMs = Number(routeEntry.lcpMs || 0)
  const longTaskCount = Number(routeEntry.longTaskCount || 0)
  const interactionMs = Number(routeEntry.maxInteractionMs || 0)
  const jsBytes = Number(routeEntry.scriptBytes || 0)
  const directHtmlMs = Number(routeEntry.directHtmlMs || 0)
  const documentRequestMs = Number(routeEntry.documentRequestMs || 0)
  if (apiMaxMs >= Math.max(1200, readyMs * 0.45)) return 'server/API latency'
  if (directHtmlMs > 0 && documentRequestMs > 0 && documentRequestMs >= directHtmlMs * 4 && lcpMs >= 1200) {
    return 'auth/bootstrap or navigation churn'
  }
  if (jsBytes >= 220 * 1024) return 'chunk/load cost'
  if (longTaskCount >= 2 || interactionMs >= 250) return 'render or interaction churn'
  if (Number(routeEntry.cls || 0) >= 0.08) return 'post-render layout churn'
  if (lcpMs >= 1200) return 'render cost'
  return 'mixed / minor'
}

function renderFindings(findings) {
  if (!Array.isArray(findings) || !findings.length) {
    return '<p>No findings recorded.</p>'
  }
  const rows = findings
    .slice()
    .sort((left, right) => Number(left.priority || 9) - Number(right.priority || 9))
    .map((finding) => `
      <tr>
        <td>${escapeHtml(finding.priority)}</td>
        <td>${escapeHtml(finding.area)}</td>
        <td>${escapeHtml(finding.message)}</td>
        <td><pre>${escapeHtml(JSON.stringify(finding, null, 2))}</pre></td>
      </tr>
    `)
    .join('')
  return `
    <table>
      <thead><tr><th>P</th><th>Area</th><th>Message</th><th>Context</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderSummaryCards(summary) {
  const cards = [
    ['Started', summary?.audit?.startedAt || ''],
    ['Finished', summary?.audit?.finishedAt || ''],
    ['Duration', formatMs(summary?.audit?.durationMs)],
    ['Frontend hash', summary?.health?.after?.frontendHash || summary?.health?.before?.frontendHash || ''],
    ['Findings', formatCount(summary?.findings?.length || 0)],
  ]
  return `
    <section class="cards">
      ${cards.map(([label, value]) => `<article class="card"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></article>`).join('')}
    </section>
  `
}

export async function writeDeepAuditHtmlReport({
  reportDir,
  summary,
  performanceReport = [],
  networkReport = [],
  consoleReport = [],
  outputFile = 'summary.html',
}) {
  const routeRows = performanceReport.map((entry) => {
    const metrics = entry?.performance?.metrics || {}
    const postMetrics = entry?.postInteractionPerformance?.metrics || {}
    const matchingNetwork = networkReport.filter((item) => item.profile === entry.profile && item.route === entry.route && /\/api\//i.test(item.url || ''))
    const maxApiMs = matchingNetwork.reduce((max, item) => Math.max(max, Number(item.durationMs || 0)), 0)
    const appConsoleIssues = consoleReport.filter((item) => item.profile === entry.profile && item.route === entry.route && item.appOwned)
    const interactions = Array.isArray(entry.interactions) ? entry.interactions : []
    const maxInteractionMs = interactions.reduce((max, item) => Math.max(max, Number(item.ms || 0)), 0)
    const routeSummary = {
      profile: entry.profile,
      route: entry.route,
      path: entry.path,
      readyMs: entry.readyMs,
      domContentLoadedMs: entry.domContentLoadedMs,
      directHtmlMs: entry.fullAuditRouteMs,
      documentRequestMs: entry.documentRequestMs,
      documentDeltaMs: entry.documentRequestMs && entry.fullAuditRouteMs
        ? Math.max(0, Number(entry.documentRequestMs) - Number(entry.fullAuditRouteMs))
        : 0,
      documentCacheStatus: entry.documentCacheStatus,
      lcpMs: metrics.lcp,
      cls: metrics.layoutShift,
      inpMs: metrics.inp,
      postLcpMs: postMetrics.lcp,
      postCls: postMetrics.layoutShift,
      postInpMs: postMetrics.inp,
      lcpSelector: metrics.lcpSelector,
      shiftSourceSelector: metrics.shiftSourceSelector,
      postLcpSelector: postMetrics.lcpSelector,
      postShiftSourceSelector: postMetrics.shiftSourceSelector,
      maxApiMs,
      maxInteractionMs,
      longTaskCount: Array.isArray(metrics.longTasks) ? metrics.longTasks.length : 0,
      scriptBytes: Number(entry?.performance?.resourceBytes?.scripts || 0),
      consoleErrors: appConsoleIssues.length,
      screenshot: entry.screenshot,
    }
    return {
      ...routeSummary,
      hotPath: inferHotPath(routeSummary),
    }
  })

  const rows = routeRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.profile)}</td>
      <td>${escapeHtml(row.route)}</td>
      <td>${escapeHtml(row.path)}</td>
      <td>${escapeHtml(formatMs(row.domContentLoadedMs))}</td>
      <td>${escapeHtml(formatMs(row.directHtmlMs))}</td>
      <td>${escapeHtml(formatMs(row.documentRequestMs))}</td>
      <td>${escapeHtml(formatMs(row.documentDeltaMs))}</td>
      <td>${escapeHtml(row.documentCacheStatus || '')}</td>
      <td>${escapeHtml(formatMs(row.readyMs))}</td>
      <td>${escapeHtml(formatMs(row.lcpMs))}</td>
      <td>${escapeHtml(formatCls(row.cls))}</td>
      <td>${escapeHtml(formatMs(row.inpMs))}</td>
      <td>${escapeHtml(formatMs(row.postLcpMs))}</td>
      <td>${escapeHtml(formatCls(row.postCls))}</td>
      <td>${escapeHtml(formatMs(row.postInpMs))}</td>
      <td>${escapeHtml(formatMs(row.maxApiMs))}</td>
      <td>${escapeHtml(formatMs(row.maxInteractionMs))}</td>
      <td>${escapeHtml(formatCount(row.longTaskCount))}</td>
      <td>${escapeHtml(formatBytes(row.scriptBytes))}</td>
      <td>${escapeHtml(row.lcpSelector || '')}</td>
      <td>${escapeHtml(row.shiftSourceSelector || '')}</td>
      <td>${escapeHtml(row.postLcpSelector || '')}</td>
      <td>${escapeHtml(row.postShiftSourceSelector || '')}</td>
      <td>${escapeHtml(row.hotPath)}</td>
      <td>${row.screenshot ? `<a href="${escapeHtml(toRelativeLink(reportDir, row.screenshot))}">screenshot</a>` : ''}</td>
    </tr>
  `).join('')

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Deep Live Audit</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
    h1, h2 { margin-bottom: 8px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0 24px; }
    .card { background: white; border: 1px solid #dbe2ea; border-radius: 10px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; background: white; margin: 16px 0 24px; }
    th, td { border: 1px solid #dbe2ea; padding: 8px; vertical-align: top; font-size: 12px; }
    th { background: #eff6ff; text-align: left; }
    pre { white-space: pre-wrap; margin: 0; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Deep Live Audit</h1>
  <p>Canonical whole-app browser audit with route metrics, selectors, and interaction timing.</p>
  ${renderSummaryCards(summary)}
  <h2>Route Metrics</h2>
  <table>
    <thead>
      <tr>
        <th>Profile</th><th>Route</th><th>Path</th><th>DCL</th><th>Direct HTML</th><th>Browser Doc</th><th>Doc Delta</th><th>Doc Cache</th><th>Ready</th><th>Load LCP</th><th>Load CLS</th><th>Load INP</th>
        <th>Post LCP</th><th>Post CLS</th><th>Post INP</th><th>Max API</th><th>Max Interaction</th><th>Long Tasks</th><th>Script Bytes</th><th>Load LCP Selector</th><th>Load Shift Selector</th><th>Post LCP Selector</th><th>Post Shift Selector</th><th>Hot Path</th><th>Artifact</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Findings</h2>
  ${renderFindings(summary?.findings)}
</body>
</html>`
  await fs.writeFile(path.join(reportDir, outputFile), html, 'utf8')
}

export async function writeFullAuditHtmlReport({
  reportDir,
  summary,
  outputFile = 'summary.html',
}) {
  const routeRows = (summary?.routes || []).map((route) => `
    <tr>
      <td>${escapeHtml(route.name)}</td>
      <td>${escapeHtml(route.path)}</td>
      <td>${escapeHtml(route.status)}</td>
      <td>${escapeHtml(route.ok)}</td>
      <td>${escapeHtml(formatMs(route.ms))}</td>
      <td>${escapeHtml(route.containsAppRoot)}</td>
      <td>${escapeHtml(route.containsServerHash)}</td>
      <td>${escapeHtml(route.error || '')}</td>
    </tr>
  `).join('')
  const apiRows = (summary?.api || []).map((entry) => `
    <tr>
      <td>${escapeHtml(entry.name)}</td>
      <td>${escapeHtml(entry.status)}</td>
      <td>${escapeHtml(entry.ok)}</td>
      <td>${escapeHtml(formatMs(entry.ms))}</td>
      <td>${escapeHtml(entry.error || '')}</td>
    </tr>
  `).join('')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Full App Audit</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
    h1, h2 { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; background: white; margin: 16px 0 24px; }
    th, td { border: 1px solid #dbe2ea; padding: 8px; vertical-align: top; font-size: 12px; }
    th { background: #eff6ff; text-align: left; }
    pre { white-space: pre-wrap; margin: 0; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Full App Audit</h1>
  <p>Canonical route shell, API, and write-flow audit.</p>
  ${renderSummaryCards(summary)}
  <h2>HTML Routes</h2>
  <table>
    <thead><tr><th>Route</th><th>Path</th><th>Status</th><th>OK</th><th>Latency</th><th>App Root</th><th>Hash</th><th>Error</th></tr></thead>
    <tbody>${routeRows}</tbody>
  </table>
  <h2>API Checks</h2>
  <table>
    <thead><tr><th>Name</th><th>Status</th><th>OK</th><th>Latency</th><th>Error</th></tr></thead>
    <tbody>${apiRows}</tbody>
  </table>
  <h2>Findings</h2>
  ${renderFindings(summary?.findings)}
</body>
</html>`
  await fs.writeFile(path.join(reportDir, outputFile), html, 'utf8')
}
