// S4-32 (owner ruling, 2026-09-04): "the add and divide is only for those
// similar costs...not the 0 cost etc...".
//
// Half of that ruling was already implemented -- a cost of 0/blank/null is
// read as NOT RECORDED and excluded from the mean (S4-17). The half that was
// missing is the word SIMILAR: before this test, resolveMergedCost happily
// averaged $2 and $200 into $101, a figure nobody had ever paid for anything,
// and stored it as the survivor's cost with nothing anywhere saying so.
//
// This file pins BOTH halves at once, because the danger in adding the
// similarity guard is breaking the zero rule that already works. The seven
// zero/blank/null cases below must be green before AND after the guard.
//
// It loads the REAL lib/productDetailRule.ts (transpiled, dependency-free by
// design) and the REAL lib/importEngine.ts warning helpers, so what is
// asserted is production's rule, not a re-statement of it.
//
// Run (from cloudflare/): node scripts/test-merge-cost-similarity-guard-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')

let checks = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  ok  ${label}`)
    checks++
  } catch (e) {
    console.log(`FAIL ${label} - ${e.message}`)
    process.exitCode = 1
  }
}

function loadTs(relPath, requireShim) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const req = (id) => (requireShim && requireShim[id] !== undefined ? requireShim[id] : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  return mod.exports
}

const rule = loadTs('lib/productDetailRule.ts', {})
const { resolveMergedCost, resolveMergedCostDetail, COST_OUTLIER_RATIO } = rule

const usd = (rows) => resolveMergedCost(rows).cost_price_usd

// ---------------------------------------------------------------------------
// The missing half of the ruling: costs that are NOT similar are not averaged.
// ---------------------------------------------------------------------------
check('the resolver exposes the threshold as a named constant rather than a magic 2', () => {
  assert.equal(COST_OUTLIER_RATIO, 2, 'measured against production: nothing in the catalogue spreads even 2x')
})

check('$2 and $200 are NOT averaged into $101 -- the higher cost is kept', () => {
  // THE defect. A mistyped cost (a $2 item entered as $200) used to blend into
  // $101: wrong for both rows, and wrong in the direction that overstates
  // profit for the real one. Highest, on the same reasoning as roundCostUp4
  // rounding up -- when the rule cannot know which figure is real, it must not
  // pick the one that flatters the margin.
  assert.equal(usd([{ cost_price_usd: 2 }, { cost_price_usd: 200 }]), 200)
})

check('the refusal is REPORTED, not silent', () => {
  const { merged, outliers } = resolveMergedCostDetail([{ cost_price_usd: 2 }, { cost_price_usd: 200 }])
  assert.equal(merged.cost_price_usd, 200)
  assert.equal(outliers.length, 1, 'a merge that rewrote a cost this way must be able to say so')
  assert.deepEqual(outliers[0], { field: 'cost_price_usd', min: 2, max: 200, chosen: 200 })
})

check('exactly at the threshold still averages -- the guard is > ratio, not >=', () => {
  // $5 and $10 are 2.0x apart: a plausible restock swing, so it averages.
  assert.equal(usd([{ cost_price_usd: 5 }, { cost_price_usd: 10 }]), 7.5)
  const { outliers } = resolveMergedCostDetail([{ cost_price_usd: 5 }, { cost_price_usd: 10 }])
  assert.equal(outliers.length, 0)
  // A hair over, and it does not.
  assert.equal(usd([{ cost_price_usd: 5 }, { cost_price_usd: 10.01 }]), 10.01)
})

check('the widest REAL production pair still averages -- the guard fires on nothing today', () => {
  // "maybelline concealer eraser n.110", $5.00 and $7.90: 1.58x, the widest
  // spread in the 353 active merge-candidate groups on 2026-09-04. Same
  // article restocked at a different supplier price -- exactly what the mean
  // is for. If this ever goes red, the threshold was tuned into real data.
  assert.equal(usd([{ cost_price_usd: 5 }, { cost_price_usd: 7.9 }]), 6.45)
  const { outliers } = resolveMergedCostDetail([{ cost_price_usd: 5 }, { cost_price_usd: 7.9 }])
  assert.equal(outliers.length, 0, 'the real catalogue must never trip this guard')
})

check('the guard reads the WIDEST spread in the set, not neighbouring pairs', () => {
  // 10 and 12 are similar; 10 and 30 are not. One outlier poisons the mean of
  // the whole set, so the whole set stops averaging.
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: 12 }, { cost_price_usd: 30 }]), 30)
})

check('USD and KHR are guarded independently', () => {
  const { merged, outliers } = resolveMergedCostDetail([
    { cost_price_usd: 4, cost_price_khr: 16000 },
    { cost_price_usd: 5, cost_price_khr: 900000 },
  ])
  assert.equal(merged.cost_price_usd, 4.5, 'the similar USD pair still averages')
  assert.equal(merged.cost_price_khr, 900000, 'the wild KHR pair does not')
  assert.deepEqual(outliers.map((o) => o.field), ['cost_price_khr'])
})

check('a single distinct cost is never an outlier, however large', () => {
  assert.equal(usd([{ cost_price_usd: 130.541696 }, { cost_price_usd: 130.541696 }]), 130.5417)
  assert.equal(resolveMergedCostDetail([{ cost_price_usd: 999 }]).outliers.length, 0)
})

// ---------------------------------------------------------------------------
// The half that ALREADY worked (S4-17). Green before and after the guard --
// the point of listing them here is that adding the guard must not disturb
// them, and a 0 must never be read as "infinitely far from the real cost".
// ---------------------------------------------------------------------------
check('0 is NOT RECORDED, not a free item: 10 + 0 -> 10', () => {
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: 0 }]), 10)
})
check('50.70 + 0 -> 50.70', () => {
  assert.equal(usd([{ cost_price_usd: 50.7 }, { cost_price_usd: 0 }]), 50.7)
})
check("10 + '' -> 10 (a blank cell is not a cost)", () => {
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: '' }]), 10)
})
check('10 + null -> 10', () => {
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: null }]), 10)
})
check('10 + an unreadable cell -> 10', () => {
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: 'n/a' }]), 10)
})
check('10 + 20 + 0 -> 15 (the zero drops out, the two real costs average)', () => {
  assert.equal(usd([{ cost_price_usd: 10 }, { cost_price_usd: 20 }, { cost_price_usd: 0 }]), 15)
})
check('0 + 0 -> 0, unchanged from what every row already said', () => {
  assert.equal(usd([{ cost_price_usd: 0 }, { cost_price_usd: 0 }]), 0)
})
check('a field no row carried is still omitted, so it cannot clobber with zeros', () => {
  assert.deepEqual(Object.keys(resolveMergedCost([{ cost_price_usd: 2 }, { cost_price_usd: 200 }])), ['cost_price_usd'])
  assert.deepEqual(resolveMergedCost([]), {})
})

// ---------------------------------------------------------------------------
// Visibility. A guard that fires silently is the same failure it prevents.
// ---------------------------------------------------------------------------
check('the importer can carry the refusal as a per-row warning of its own kind', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts'), 'utf8')
  assert.ok(/export function costOutlierWarning/.test(engineSrc), 'a shared message builder, so both fold sites word it identically')
  assert.ok(/'cost_outlier'/.test(engineSrc), "'cost_outlier' must be a real ImportWarningKind, not folded into 'other'")
  assert.ok(/cost_outlier: '[^']+'/.test(engineSrc), 'IMPORT_WARNING_LABELS must give it a human label')
  assert.ok(/SERIOUS_IMPORT_WARNING_KINDS[^\n]*'cost_outlier'/.test(engineSrc), 'a cost nobody typed is serious, not routine noise')
  // Both places two costs can fold must report, not just the first.
  const detailCalls = engineSrc.match(/resolveMergedCostDetail\(/g) || []
  assert.equal(detailCalls.length, 2, 'both fold sites (row->catalog product, and row->earlier row of the same file) must use the detail form')
  const pushes = engineSrc.match(/costOutlierWarning\(outlier\)/g) || []
  assert.equal(pushes.length, 2, 'and both must actually raise the warning')
})

check('the merge endpoints report the refusal in the audit entry and the response', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
  assert.ok(/resolveMergedCostDetail\(\[canonicalBefore \|\| \{\}, dupPricing \|\| \{\}\]\)/.test(routeSrc), 'the fold must use the detail form')
  assert.ok(/costOutliers: MergedCostOutlier\[\]/.test(routeSrc), 'the fold must return the flag to its callers')
  assert.ok(/\.\.\.\(costOutliers\.length \? \{ costOutliers \} : \{\}\)/.test(routeSrc), 'the audit entry must record it when it happens')
  assert.ok(/costOutliers: costOutlierReports/.test(routeSrc), 'the whole-catalog merge response must surface it')
  // The one-pair review merge spreads the fold's public stats verbatim, so it
  // carries costOutliers with no extra plumbing -- pin that spread so a future
  // edit cannot quietly start allow-listing fields and drop it.
  assert.ok(/const \{ reversal: _reversal[^\n]*\.\.\.publicStats \} = stats/.test(routeSrc))
  assert.ok(/return c\.json\(\{[\s\S]*?actionHistoryId: undoRecord\.actionHistoryId,[\s\S]*?\.\.\.publicStats,[\s\S]*?\}\)/.test(routeSrc))
})

check('the frontend translates the new kind and files it under "needs attention"', () => {
  const modal = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'shared', 'ImportReportModal.tsx'), 'utf8')
  assert.ok(/cost_outlier: 'import_warning_kind_cost_outlier'/.test(modal), 'a Khmer user must not see this one label in English')
  assert.ok(/SERIOUS_KINDS = new Set\(\[[^\]]*'cost_outlier'/.test(modal), "the frontend's own serious list must agree with the backend's")
  for (const pack of ['en', 'km']) {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lang', `${pack}.json`), 'utf8'))
    assert.ok(json.import_warning_kind_cost_outlier, `${pack}.json must carry the label`)
  }
})

console.log(`\n${checks} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
