'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

runTest('portal membership lookup builds customer match clauses without nullable parameter type checks', () => {
  const source = readSource('src/routes/portal.js')
  assert.match(source, /const salesWhere = \[\]/, 'membership route should build sales clauses dynamically')
  assert.match(source, /const returnsWhere = \[\]/, 'membership route should build return clauses dynamically')
  assert.match(source, /const submissionWhere = \[\]/, 'membership route should build submission clauses dynamically')
  assert.match(source, /const salesWhereSql = salesWhere\.length \? salesWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty sales clauses')
  assert.match(source, /const returnsWhereSql = returnsWhere\.length \? returnsWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty return clauses')
  assert.match(source, /const submissionWhereSql = submissionWhere\.length \? submissionWhere\.map\(\(clause\) => `\(\$\{clause\}\)`\)\.join\(' OR '\) : 'FALSE'/, 'membership route should guard empty submission clauses')
  assert.match(source, /salesWhere\.push\('s\.customer_id = @customerId'\)/, 'membership route should still prefer customer_id matching')
  assert.match(source, /submissionWhere\.push\("lower\(trim\(COALESCE\(membership_number, ''\)\)\) = lower\(trim\(@membershipNumber\)\)"\)/, 'membership route should still fall back to membership number matching')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND s\.customer_id = @customerId/, 'membership route must not use nullable parameter type guards in SQL')
  assert.doesNotMatch(source, /@customerId IS NOT NULL AND r\.customer_id = @customerId/, 'returns lookup must not use nullable parameter type guards in SQL')
})

runTest('inventory movements accept large page sizes and use text-safe created_at ordering', () => {
  const source = readSource('src/routes/inventory.js')
  assert.match(source, /normalizePositiveInt\(requestedPageSize,\s*50000,\s*\{\s*min:\s*1,\s*max:\s*50000\s*\}\)/, 'movements route should allow explicit pageSize values up to 50000')
  assert.match(source, /COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) AS created_at/, 'movement rows should keep text-safe created_at fallback')
  assert.match(source, /ORDER BY COALESCE\(NULLIF\(im\.created_at::text,\s*''\), CURRENT_TIMESTAMP::text\) DESC, im\.id DESC/, 'movement ordering should avoid timestamp/text COALESCE mismatches')
})

if (failed > 0) {
  process.exitCode = 1
}
