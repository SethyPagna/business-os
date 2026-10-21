// Not-Paid conversion census runner (lane 6.0.891, plan slice S0). Read-only.
//
//   node ops/scripts/census/not-paid-conversion-census.mjs --db <local sqlite restore> [--json]
//
// Runs every "-- @query" block of not-paid-conversion-census.sql, judges the
// C2/C3 candidates with the exact half-cent payable rule the Worker and the
// till use (recordedSaleOutstandingUsd, loaded from the parity-tested frontend
// copy), and prints the control-set counts. Exit 2 when a control proves a
// join or the database itself unreadable: a census that matched nothing must
// never read as "no wrong conversions".
//
// The database opens read-only and every block is checked to be a SELECT/WITH
// statement before it runs. A remote run (owner-gated, not done here) feeds
// the same runCensus() a `query(sql)` backed by `wrangler d1 execute --remote
// --json --command`; never `--file`, which returns no rows.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SQL_PATH = path.join(here, 'not-paid-conversion-census.sql')
const RULE_PATH = path.join(here, '..', '..', '..', 'frontend', 'src', 'utils', 'saleStatusResolution.ts')

export class CensusControlError extends Error {}

export function parseQueries(text) {
  const queries = new Map()
  let name = null
  let lines = []
  const flush = () => { if (name) queries.set(name, lines.join('\n').trim()) }
  for (const line of text.split(/\r?\n/)) {
    const marker = /^-- @query (\w+)\s*$/.exec(line)
    if (marker) { flush(); name = marker[1]; lines = []; continue }
    if (name) lines.push(line)
  }
  flush()
  return queries
}

const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i
export function assertSelectOnly(name, sql) {
  const body = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '')
  if (!/^(select|with)\b/i.test(body)) throw new Error(`${name}: not a SELECT/WITH statement`)
  if (body.includes(';')) throw new Error(`${name}: more than one statement`)
  const hit = WRITE_WORDS.exec(body)
  if (hit) throw new Error(`${name}: contains the write keyword "${hit[0]}"`)
}

let outstandingFn = null
async function loadOutstanding() {
  if (!outstandingFn) outstandingFn = (await import(pathToFileURL(RULE_PATH).href)).recordedSaleOutstandingUsd
  return outstandingFn
}

function owed(fn, row, refundUsd) {
  try {
    return { usd: fn({
      total_usd: row.total_usd, amount_paid_usd: row.amount_paid_usd, amount_paid_khr: row.amount_paid_khr,
      exchange_rate: row.exchange_rate, money_precision_version: row.money_precision_version,
      calculated_total_usd: row.calculated_total_usd, refund_usd: refundUsd,
    }) }
  } catch { return { unreadable: true } }
}

// The half-cent rule applied to the C2 candidates, with and without the debt the returns lowered.
export function judgeC2(fn, rows) {
  return rows.map(row => {
    const without = owed(fn, row, 0)
    const withReturns = owed(fn, row, Number(row.lowered_usd) || 0)
    let verdict
    if (without.unreadable || withReturns.unreadable) verdict = 'unreadable_money'
    else if (without.usd === 0) verdict = 'covered_by_tender'
    else if (withReturns.usd === 0) verdict = 'cleared_by_returns'
    else verdict = 'wrong_conversion'
    return { ...row, owed_without_returns_usd: without.usd ?? null, owed_after_returns_usd: withReturns.usd ?? null, verdict }
  })
}

export function judgeC3(fn, rows) {
  return rows.map(row => {
    const without = owed(fn, { ...row, total_usd: row.original_total_usd, amount_paid_usd: row.original_paid_usd,
      amount_paid_khr: row.original_paid_khr, exchange_rate: row.original_rate, money_precision_version: row.original_mpv,
      calculated_total_usd: row.original_calc_total }, 0)
    const originalDebt = row.original_pay_class === 'awaiting_payment' || (row.original_born_not_paid === 1 && !without.unreadable && without.usd > 0)
    const tender = (Number(row.replacement_paid_usd) || 0) > 0 || (Number(row.replacement_paid_khr) || 0) > 0 || !!String(row.payment_method ?? '').trim()
    const inventedPayment = row.replacement_status !== 'awaiting_payment' || tender
    return { ...row, verdict: originalDebt && inventedPayment ? 'wrong_replacement_tender' : 'not_a_hit' }
  })
}

const asNumber = value => Number(value) || 0

export function checkControls(control) {
  const problems = []
  const warnings = []
  if (asNumber(control.sales_total) === 0) problems.push('sales_total is 0: the database is empty or the read returned no rows')
  if (asNumber(control.ar_rows) > 0 && asNumber(control.ar_rows_with_sale_composite) === 0) {
    problems.push('customer_receivables has rows but the invoice_no@date join matched no sale: the C5 join is broken')
  }
  if (asNumber(control.replacement_sales_direct) > 0 && asNumber(control.replacement_sales_joined) === 0) {
    problems.push('replacement sales exist but the return/original join matched none: the C3 join is broken')
  }
  if (asNumber(control.replacement_sales_joined) !== asNumber(control.replacement_sales_direct)) {
    warnings.push(`replacement sales: ${control.replacement_sales_direct} by source_return_id, ${control.replacement_sales_joined} through the original sale`)
  }
  return { problems, warnings }
}

// query(sql) -> array of row objects. Returns the full report; throws CensusControlError on a broken control.
export async function runCensus({ query, sqlText = fs.readFileSync(SQL_PATH, 'utf8'), fn }) {
  const queries = parseQueries(sqlText)
  for (const required of ['CONTROL', 'C1', 'C1B', 'C2', 'C3', 'C4', 'C5', 'C6']) {
    if (!queries.has(required)) throw new Error(`census SQL has no "${required}" block`)
  }
  for (const [name, sql] of queries) assertSelectOnly(name, sql)
  const rule = fn ?? await loadOutstanding()
  const rows = {}
  for (const [name, sql] of queries) rows[name] = await query(sql)
  const control = rows.CONTROL[0] ?? {}
  const { problems, warnings } = checkControls(control)
  if (problems.length) throw new CensusControlError(problems.join('; '))
  const c2 = judgeC2(rule, rows.C2)
  const c3 = judgeC3(rule, rows.C3)
  return {
    control, warnings,
    C1: rows.C1, C1B: rows.C1B,
    C2: { hits: c2.filter(r => r.verdict === 'wrong_conversion'), review: c2.filter(r => r.verdict === 'cleared_by_returns'),
      unreadable: c2.filter(r => r.verdict === 'unreadable_money'), covered: c2.filter(r => r.verdict === 'covered_by_tender').length },
    C3: { hits: c3.filter(r => r.verdict === 'wrong_replacement_tender'), considered: c3.length },
    C4: { hits: rows.C4 },
    C5: { hits: rows.C5 },
    C6: rows.C6,
  }
}

export function formatReport(report) {
  const out = []
  const c = report.control
  out.push('CONTROL SETS (a join count that disagrees with its twin, or is 0, means the bucket cannot be trusted)')
  for (const key of Object.keys(c)) out.push(`  ${key.padEnd(30)} ${c[key]}`)
  for (const warning of report.warnings) out.push(`  WARNING ${warning}`)
  out.push('', `C1 leftover retired statuses: ${report.C1.reduce((sum, r) => sum + asNumber(r.n), 0)} sales in ${report.C1.length} groups; cancelled with a retired status_before_cancel: ${report.C1B.reduce((sum, r) => sum + asNumber(r.n), 0)}`)
  for (const r of report.C1) out.push(`  ${r.sale_status} / before_return=${r.status_before_return ?? 'NULL'} / origin=${r.origin || '-'} / snapshot=${r.snapshot_status || '-'}: ${r.n} sales, $${r.total_usd}`)
  out.push('', `C2 born Not Paid, reads paid, tender short after returns: ${report.C2.hits.length} hit(s); cleared by returns (review): ${report.C2.review.length}; unreadable money: ${report.C2.unreadable.length}; covered by tender: ${report.C2.covered}`)
  for (const r of report.C2.hits) out.push(`  HIT sale ${r.id} ${r.receipt_number}: ${r.sale_status}/${r.status_before_return ?? 'NULL'}, total ${r.total_usd}, owes ${r.owed_after_returns_usd}`)
  for (const r of report.C2.review) out.push(`  REVIEW sale ${r.id} ${r.receipt_number}: returns cleared a debt of ${r.owed_without_returns_usd}`)
  out.push('', `C3 replacement sales off a Not Paid original with tender or a paid status: ${report.C3.hits.length} hit(s) of ${report.C3.considered} considered`)
  for (const r of report.C3.hits) out.push(`  HIT replacement ${r.replacement_id} ${r.replacement_receipt} (original ${r.original_id}): ${r.replacement_status}, paid ${r.replacement_paid_usd}/${r.replacement_paid_khr}, method ${r.payment_method ?? 'NULL'}`)
  out.push('', `C4 884 flip (expected 0): ${report.C4.hits.length}`)
  for (const r of report.C4.hits) out.push(`  HIT return ${r.return_id} on sale ${r.sale_id}`)
  out.push('', `C5 legacy receivable still owed, sale reads paid: ${report.C5.hits.length} hit(s)`)
  for (const r of report.C5.hits) out.push(`  HIT receivable ${r.receivable_id} ${r.invoice_no}@${r.invoice_date}: owed ${r.outstanding_balance_usd}, sale ${r.sale_id} ${r.sale_status}`)
  out.push('', `C6 integrity-repair events: ${report.C6.length}`)
  for (const r of report.C6) out.push(`  ${r.created_at} by ${r.user_name ?? '?'}: ${r.casualties_since} return-status sales without a kept payment state touched since`)
  return out.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const dbIndex = args.indexOf('--db')
  if (dbIndex < 0 || !args[dbIndex + 1]) {
    console.error('usage: node not-paid-conversion-census.mjs --db <local sqlite file> [--json]')
    process.exit(64)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(args[dbIndex + 1], { readOnly: true })
  try {
    const report = await runCensus({ query: sql => db.prepare(sql).all().map(row => ({ ...row })) })
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report))
  } catch (error) {
    if (error instanceof CensusControlError) { console.error(`CONTROL FAILED: ${error.message}`); process.exit(2) }
    throw error
  } finally {
    db.close()
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
