const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const compat = fs.readFileSync(path.join(root, 'cloudflare', 'src', 'routes', 'compat.ts'), 'utf8')
const branches = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'branches', 'Branches.tsx'), 'utf8')
const transport = fs.readFileSync(path.join(root, 'frontend', 'src', 'api', 'branchTransport.ts'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'cloudflare', 'migrations', '0100_sales_filter_paging_indexes.sql'), 'utf8')

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

check('transfer transport accepts and serializes query params', () => {
  assert.match(transport, /getTransfers\(params: QueryParams = \{\}\)/)
  assert.match(transport, /buildQueryString\(params\)/)
  assert.match(transport, /appendQuery\('\/api\/transfers', query\)/)
})

check('transfer history is database-paged with a total count', () => {
  assert.match(compat, /const hasPaging = .*'page'.*'pageSize'/s)
  assert.match(compat, /SELECT COUNT\(\*\) AS count FROM stock_transfers st/)
  assert.match(compat, /LIMIT @pageSize OFFSET @offset/)
  assert.match(compat, /totalPages: Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/)
})

check('transfer date filters use Cambodia UTC+7 business-day helpers', () => {
  assert.match(compat, /localDateAtOrAfter\('st\.created_at'\)/)
  assert.match(compat, /localDateAtOrBefore\('st\.created_at'\)/)
  assert.doesNotMatch(compat, /date\(st\.created_at\) >= date\(@startDate\)/)
})

check('transfer branch filters are applied before pagination', () => {
  assert.match(compat, /st\.from_branch_id = @fromBranchId/)
  assert.match(compat, /st\.to_branch_id = @toBranchId/)
  assert.match(branches, /fromBranchId: transferFromFilter !== 'all'/)
  assert.match(branches, /toBranchId: transferToFilter !== 'all'/)
})

check('transfer note field matches the frontend contract', () => {
  assert.match(compat, /st\.notes AS note/)
  assert.match(branches, /transfer\.note \|\| '-'/)
})

check('Branches uses server pagination and does not locally re-filter UTC dates', () => {
  assert.match(branches, /page: transferPage/)
  assert.match(branches, /pageSize: transferPageSize/)
  assert.match(branches, /const visibleTransfers = transfers/)
  assert.doesNotMatch(branches, /String\(transferItem\.created_at \|\| ''\)\.slice\(0, 10\)/)
  assert.match(branches, /<PaginationControls[\s\S]*?totalItems=\{transferTotalCount\}/)
})

check('transfer paging query shapes have supporting indexes', () => {
  assert.match(migration, /idx_stock_transfers_created/)
  assert.match(migration, /idx_stock_transfers_from_created/)
  assert.match(migration, /idx_stock_transfers_to_created/)
})

if (failed) process.exit(1)
console.log('\nAll transfer-history paging checks passed')
