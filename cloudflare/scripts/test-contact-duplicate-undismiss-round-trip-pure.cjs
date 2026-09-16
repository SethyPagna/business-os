// Pins the p8/efficiency fix to lib/contactDuplicates.ts's
// undismissDuplicateCluster (NAME path): before, it fired one DELETE per
// matching cluster_value row (a genuine N+1 -- N dismissed-name rows sharing
// this normalized name meant N sequential D1 round trips). After, the
// matching cluster_values are collected first and removed in a single
// chunked `DELETE ... WHERE cluster_value IN (...)`, via the same
// chunkForBinding/buildInClause helpers used elsewhere in this codebase.
//
// Same transpile-in-memory approach as test-contact-duplicates-pure.cjs (no
// bundler in this sandbox): the REAL contactDuplicates.ts is loaded and run
// against a fake db that counts calls and records every issued statement, so
// a regression that reintroduces the per-row loop fails this test even
// though it would still "work" logically.
//
// Run (from cloudflare/): node scripts/test-contact-duplicate-undismiss-round-trip-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const libDir = path.join(__dirname, '..', 'src', 'lib')
const sourcePath = path.join(libDir, 'contactDuplicates.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

function transpileTs(tsPath) {
  const tsSource = fs.readFileSync(tsPath, 'utf8')
  const { outputText } = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(tsPath),
  })
  const mod = { exports: {} }
  const w = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
  w(mod.exports, require, mod, tsPath, path.dirname(tsPath))
  return mod.exports
}
const contactOptionsExports = transpileTs(path.join(libDir, 'contactOptions.ts'))
const phoneExports = transpileTs(path.join(libDir, 'phone.ts'))
const sqlBindingExports = transpileTs(path.join(libDir, 'sqlBinding.ts'))

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'contactDuplicates.ts',
})
const moduleObj = { exports: {} }
function fakeRequire(specifier) {
  if (specifier === './contactOptions' || specifier === './contactOptions.ts') return contactOptionsExports
  if (specifier === './phone' || specifier === './phone.ts') return phoneExports
  if (specifier === './sqlBinding' || specifier === './sqlBinding.ts') return sqlBindingExports
  return require(specifier)
}
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, fakeRequire, moduleObj, sourcePath, path.dirname(sourcePath))
const { undismissDuplicateCluster } = moduleObj.exports

let failed = 0
async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Builds a fake db.prepare(sql).all/.run(params) that records every issued
// statement (sql + params), same minimal shape contactDuplicates.ts always
// calls it with, per the file's own header comment.
function makeFakeDb(selectRows) {
  const calls = []
  return {
    calls,
    prepare(sql) {
      return {
        all: async (params) => { calls.push({ sql, params }); return selectRows },
        run: async (params) => { calls.push({ sql, params }); return { success: true } },
      }
    },
  }
}

async function main() {
  // 12 dismissed rows that all normalize to the same target name, each with
  // a different display casing/spacing, so the old per-row loop would have
  // issued 12 DELETEs and the new path must issue exactly 1 (well under the
  // 100-bound-parameter chunk size).
  await runTest('undismiss (name): 12 matching rows collapse to 1 chunked DELETE, not 12', async () => {
    const variants = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 'Ly Ratha' : 'LY   ratha'))
    const rows = variants.map((v) => ({ cluster_value: v }))
    const db = makeFakeDb(rows)
    await undismissDuplicateCluster(db, 'customers', 'name', 'ly ratha')

    const selects = db.calls.filter((c) => /^SELECT/.test(c.sql))
    const deletes = db.calls.filter((c) => /^DELETE/.test(c.sql))
    assert.strictEqual(selects.length, 1, 'exactly one SELECT to read the dismissed rows')
    assert.strictEqual(deletes.length, 1, 'BEFORE: 12 DELETEs (one per matching row). AFTER: exactly 1 chunked DELETE')
    assert.match(deletes[0].sql, /cluster_value IN \(/, 'delete must use a single IN(...) clause, not a per-row equality')
    // Every one of the 12 matching display-casing variants must be bound —
    // dropping one silently would leave a dismissal behind (the exact
    // regression class this file's own header comment warns about).
    const boundValues = Object.values(deletes[0].params).filter((v) => v !== 'customers')
    assert.strictEqual(boundValues.length, 12, 'all 12 matching cluster_values must be bound into the single DELETE')
    assert.deepStrictEqual([...boundValues].sort(), [...variants].sort(), 'bound values are exactly the matching rows, byte-identical to what the old per-row loop would have deleted one at a time')
  })

  // Over the 100-bound-parameter chunk size: proves the fix stays chunked
  // (ceil(N/100) DELETEs) rather than silently reverting to N or blowing past
  // D1's per-statement bound-parameter ceiling with one giant IN(...).
  await runTest('undismiss (name): 150 matching rows chunk into 2 DELETEs (before: 150)', async () => {
    const rows = Array.from({ length: 150 }, () => ({ cluster_value: 'Ly Ratha' }))
    const db = makeFakeDb(rows)
    await undismissDuplicateCluster(db, 'suppliers', 'name', 'ly ratha')
    const deletes = db.calls.filter((c) => /^DELETE/.test(c.sql))
    assert.strictEqual(deletes.length, 2, 'BEFORE: 150 sequential DELETEs. AFTER: ceil(150/100) = 2 chunked DELETEs')
    const totalBound = deletes.reduce((sum, c) => sum + Object.values(c.params).filter((v) => v !== 'suppliers').length, 0)
    assert.strictEqual(totalBound, 150, 'every matching row across both chunks is still deleted')
  })

  // Non-matching rows (different normalized name) must never be touched --
  // the filter-then-batch-delete rewrite must not widen the match set.
  await runTest('undismiss (name): non-matching normalized names are never bound into the DELETE', async () => {
    const rows = [{ cluster_value: 'Ly Ratha' }, { cluster_value: 'Someone Else' }, { cluster_value: 'ly   ratha' }]
    const db = makeFakeDb(rows)
    await undismissDuplicateCluster(db, 'customers', 'name', 'Ly Ratha')
    const deletes = db.calls.filter((c) => /^DELETE/.test(c.sql))
    assert.strictEqual(deletes.length, 1)
    const boundValues = Object.values(deletes[0].params).filter((v) => v !== 'customers')
    assert.strictEqual(boundValues.length, 2, 'only the two rows that normalize to the target name are bound')
    assert.ok(!boundValues.includes('Someone Else'), 'a differently-named dismissal must never be deleted')
  })

  // Zero matches: no DELETE at all (chunkForBinding([]) === [], not a
  // no-op empty-IN() statement) -- same as the original loop firing zero
  // iterations.
  await runTest('undismiss (name): zero matching rows issues zero DELETEs', async () => {
    const db = makeFakeDb([{ cluster_value: 'Totally Different' }])
    await undismissDuplicateCluster(db, 'customers', 'name', 'Ly Ratha')
    const deletes = db.calls.filter((c) => /^DELETE/.test(c.sql))
    assert.strictEqual(deletes.length, 0, 'no matching row means no DELETE is issued')
  })

  // Phone path is untouched by this fix (single exact-match DELETE, no read
  // first) -- must still be exactly one statement, one round trip.
  await runTest('undismiss (phone): unchanged single-statement path', async () => {
    const db = makeFakeDb([])
    await undismissDuplicateCluster(db, 'customers', 'phone', '012000111')
    assert.strictEqual(db.calls.length, 1)
    assert.match(db.calls[0].sql, /^DELETE FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'phone'/)
  })

  if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
  console.log('\nAll contact-duplicate undismiss round-trip checks passed')
}

main()
