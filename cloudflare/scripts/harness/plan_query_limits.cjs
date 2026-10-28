'use strict'
// The per-invocation D1 call budgets of both plans, read from
// src/lib/planTier.ts so a native test's "fits Free" assertion can never keep a
// number that planTier.ts has since changed (it used to be a literal 50 in two
// files). These harnesses count every statement of a batch, which is stricter
// than the platform (a batch is one call), so a pass here is conservative.
const fs = require('node:fs')
const path = require('node:path')
const ts = require(path.join(__dirname, '..', '..', 'node_modules', 'typescript'))

const sourcePath = path.join(__dirname, '..', '..', 'src', 'lib', 'planTier.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'planTier.ts',
})
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', outputText)(moduleObj.exports, () => { throw new Error('planTier.ts must have no runtime imports') }, moduleObj)
const { PLAN_LIMITS_BY_TIER } = moduleObj.exports

module.exports = {
  FREE_QUERY_LIMIT: PLAN_LIMITS_BY_TIER.free.d1QueriesPerInvocation,
  PAID_QUERY_LIMIT: PLAN_LIMITS_BY_TIER.paid.d1QueriesPerInvocation,
}
