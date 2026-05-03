'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.join(__dirname, '../src/services/importJobs.js'), 'utf8')
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/importJobs.js'), 'utf8')

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
assert.match(
  source,
  /function resetImportJobForRetry/,
  'cancelled import jobs must have an explicit retry reset path',
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

console.log('PASS import decision integrity source checks')
