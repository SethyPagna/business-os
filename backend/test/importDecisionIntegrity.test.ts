'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.join(__dirname, '../src/services/importJobs.js'), 'utf8')
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/importJobs.ts'), 'utf8')

assert.match(
  source,
  /importProductsBySignature:\s*new Map\(\)/,
  'product imports must track products created earlier in the same job by name/detail signature',
)
assert.match(
  source,
  /const importedSignatureMatch = ctx\.importProductsBySignature\.get/,
  'same-name rows with identical details should merge against earlier imported rows',
)
assert.match(
  source,
  /productRowsByName:\s*new Map\(\)/,
  'product imports should cache same-name product lookups per job',
)
assert.match(
  source,
  /function getProductsByNameForImport[\s\S]*ctx\.productRowsByName\.set/,
  'product import same-name cache should populate from the database only once per normalized name',
)
assert.match(
  source,
  /function rememberProductForImport[\s\S]*insertProductImportRow/,
  'product import cache should be updated when rows create or update products',
)
assert.match(
  source,
  /const supplierMap = buildLookupMap/,
  'product imports should cache supplier lookups instead of querying for every row',
)
assert.match(
  source,
  /const branchesByName = buildLookupMap\(activeBranches\)/,
  'product imports should index active branches by normalized name once per job',
)
assert.match(
  source,
  /ctx\.branchesByName\.get\(branchKey\)/,
  'product import branch resolution should use the per-job branch-name index',
)
assert.match(
  source,
  /ctx\.branchesByName\.set\(branchKey, branch\)/,
  'product import branch-name index should stay current when an import creates a branch',
)
assert.doesNotMatch(
  source,
  /ctx\.activeBranches\.find\(\(item\) => normalizeLookup\(item\.name\) === normalizeLookup\(name\)\)/,
  'product import branch resolution should not scan active branches for each row',
)
assert.match(
  source,
  /sameName\.length \|\| importedParent/,
  'same-name rows imported earlier in the same job should create variants instead of duplicate-name failures',
)
assert.match(
  source,
  /allowDuplicateName:\s*true/,
  'product names are not unique database identifiers during reviewed imports',
)
assert.match(
  source,
  /reason, reference_id, user_id, user_name/,
  'import inventory movements must retain a reference_id for reconciliation',
)
assert.match(
  source,
  /referenceId:\s*jobId/,
  'product import stock movements should reference the import job',
)
assert.doesNotMatch(
  source,
  /finished_at\s*=\s*COALESCE\(finished_at,\s*CURRENT_TIMESTAMP\)(?!::text)/,
  'import job timestamp reconciliation must not mix text columns with raw Postgres timestamps',
)
assert.doesNotMatch(
  source,
  /finished_at\s*=\s*CASE[\s\S]*?ELSE\s+CURRENT_TIMESTAMP\s+END/,
  'bulk import cancellation must not mix text columns with raw Postgres timestamps',
)
assert.match(
  source,
  /BLOCKING_BARCODE_ISSUES[\s\S]*barcode_scientific_notation/,
  'scientific-notation barcodes must be treated as blocking product import issues',
)
assert.doesNotMatch(
  source,
  /\? IS NOT NULL[\s\S]{0,80}(sku|barcode)/,
  'product import preflight must not use standalone null parameters for SKU/barcode checks on Postgres',
)
assert.match(
  source,
  /function resetImportJobForRetry/,
  'cancelled import jobs must have an explicit retry reset path',
)
assert.match(
  source,
  /function isCancelRequested[\s\S]*normalized === '1'/,
  'import cancellation flags from Postgres must be normalized before truth checks',
)
assert.match(
  source,
  /cancel_requested:\s*isCancelRequested\(row\.cancel_requested\) \? 1 : 0/,
  'decorated import jobs must expose a numeric cancellation flag to routes and workers',
)
assert.match(
  source,
  /resetImportJobForRetry,/,
  'retry reset helper must be exported for the import route',
)
assert.match(
  routeSource,
  /resetImportJobForRetry/,
  'retry route must reset cancelled jobs before requeueing analysis',
)
assert.match(
  source,
  /function listImportJobs\(\{ limit = 50, types = null \} = \{\}\)[\s\S]*WHERE type IN/,
  'import job list queries should support SQL-side type filtering for permission-scoped reads',
)
assert.match(
  routeSource,
  /types:\s*getPermittedImportTypes\(req\.user\)/,
  'import job list route should pass permitted import types into the service query',
)
assert.match(
  routeSource,
  /enqueueImportJob\(retryReady\.id,\s*\{[\s\S]*force:\s*wasCancelled/,
  'retry route must force the requeue after resetting a cancelled job',
)
assert.match(
  routeSource,
  /cancel_requested[\s\S]*409/,
  'start route must reject cancel-requested jobs with a clear conflict response',
)
assert.match(
  routeSource,
  /cancelImportJob\(job\.id,\s*\{[\s\S]*source:\s*req\.body\?\.source/,
  'cancel route must record the cancellation source for auditing',
)
assert.match(
  routeSource,
  /auditImportJobEvent\(.*import_job_start/s,
  'import start must be audited with actor and job metadata',
)
assert.doesNotMatch(
  source,
  /attempts\s*=\s*attempts\s*\+\s*1/,
  'import batch upserts must qualify attempts so Postgres does not see an ambiguous column reference',
)
assert.match(
  source,
  /attempts\s*=\s*COALESCE\(import_job_batches\.attempts,\s*0\)\s*\+\s*1/,
  'import batch attempts should increment the existing import_job_batches value on retry',
)

console.log('PASS import decision integrity source checks')
