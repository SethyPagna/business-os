// A ratchet on plan-sized literals outside lib/planTier.ts.
//
// The owner's rule (3 Nov 2026): every number sized for the Cloudflare Free plan is a field of
// getPlanLimits(env) in lib/planTier.ts -- a Free value and a Paid value, chosen by PLAN_TIER --
// never a bare literal at the call site. Moving to Paid, or growing the shop, must be a config edit
// and a deploy, not a code hunt. Records/Incidents/2026-11-03/PLAN-LIMITS-AUDIT.md lists the 19
// places that already break the rule. This test does not move any of them. It stops the count from
// growing, and it makes each cleanup remove its own entry.
//
// WHAT IT SCANS: every .ts file under cloudflare/src except lib/planTier.ts, as a syntax tree (so
// comments and strings never match). Five patterns:
//   tier-compare       a tier compared with 'free' or 'paid': `x.tier === 'free'`, `tier !== 'paid'`,
//                      `resolvePlanTier(env) === 'free'`.
//   plan-tier-read     a direct read of PLAN_TIER: `env.PLAN_TIER`, `env['PLAN_TIER']`, `{ PLAN_TIER } = env`.
//                      Only resolvePlanTier() may read it.
//   d1-queries-literal d1QueriesPerInvocation (or a variable copied from it) compared with a number, or
//                      with a same-file `const X = <number>`. A magic threshold on a planTier field.
//   tier-ternary       `<plan condition> ? <number> : <number>`. A literal Free/Paid fork.
//   plan-name          a declared name containing FREE or SMALL_PLAN as a whole word: FREE_X, X_FREE,
//                      SMALL_PLAN_X.
// It also checks that every PlanLimits field has a reader outside planTier.ts (a limit nobody reads
// changes nothing when edited).
//
// WHAT IT CANNOT SEE: a bare constant with no plan marker (`const BATCH = 500`) matches none of the five
// patterns, so most audit rows (3, 5, 7, 8, 11, 12, 13, 15, 16, 17, 18, 19) are outside this ratchet. They are
// found by review and by the later steps that move them. The patterns are the cheap, high-precision
// ones: every hit below is a real fork on the plan, not a guess. `tier` alone is not enough (permission
// tiers, search tiers and stock-alert tiers share the word); a tier counts only when it meets 'free' or 'paid'.
//
// HOW THE ALLOWLIST WORKS: one entry per current hit, keyed by file + rule + matched text (never a
// line number, so an unrelated edit above a hit does not touch this file), with a count for
// identical texts in one file. It can only shrink:
//   - a hit that is not listed fails: add a field to planTier.ts instead of an entry here;
//   - a listed entry that no longer matches fails: the cleanup that moved the number deletes its entry
//     (or lowers its count) in the same commit.
// `row` is the audit row the entry belongs to; null means the audit did not list the site.
//
// HOW TO CHANGE A LIMIT: edit the Free or Paid table in lib/planTier.ts and deploy. This test never
// needs to change for that. Run `node scripts/test-plan-literals-pure.cjs --print` to list the
// current hits as allowlist-ready JSON (useful when composing branches that each shrank the list).
//
// Run: node scripts/test-plan-literals-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
const K = ts.SyntaxKind

const PLAN_TIER_FILE = 'lib/planTier.ts'
const NAME_RULE = /(^|_)FREE(_|$)|SMALL_PLAN/
// Declared names that carry FREE in another sense: free login attempts (loginLockout.ts), free goods and free
// units on a stock receipt (stockReceiptGate.ts). They are not plan limits and can never be "moved", so they are
// excluded here by exact name rather than listed as debt. Add to this set only for a name that is not about the plan.
const NOT_A_PLAN_NAME = new Set(['FREE_ATTEMPTS', 'FREE_GOODS_REASON_NOTE', 'FREE_QUANTITY_MAX', 'FREE_QUANTITY_NOT_RECEIPT'])
const isPlanName = (name) => NAME_RULE.test(name) && !NOT_A_PLAN_NAME.has(name)
const BUDGET_FIELD = 'd1QueriesPerInvocation'
const PLAN_IDENTIFIERS = new Set(['resolvePlanTier', 'getPlanLimits', 'PLAN_TIER', BUDGET_FIELD])
const EQUALITY_OPS = new Set([K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken])
const ORDER_OPS = new Set([K.LessThanToken, K.LessThanEqualsToken, K.GreaterThanToken, K.GreaterThanEqualsToken])
const ARITHMETIC_OPS = new Set([K.PlusToken, K.MinusToken, K.AsteriskToken, K.SlashToken, K.AsteriskAsteriskToken])
const DECLARATION_KINDS = new Set([
  K.VariableDeclaration, K.FunctionDeclaration, K.ClassDeclaration, K.EnumDeclaration, K.EnumMember, K.TypeAliasDeclaration,
  K.InterfaceDeclaration, K.PropertyAssignment, K.PropertySignature, K.PropertyDeclaration, K.MethodDeclaration, K.MethodSignature, K.Parameter,
])

const RULE_ADVICE = {
  'tier-compare': 'a branch on the plan tier',
  'plan-tier-read': 'a direct read of PLAN_TIER',
  'd1-queries-literal': 'a magic threshold on d1QueriesPerInvocation',
  'tier-ternary': 'a literal Free/Paid fork',
  'plan-name': 'a Free/Small-plan constant',
}

// ---- The scanner ----------------------------------------------------------

const norm = (text) => text.replace(/\s+/g, ' ').trim()

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
  return node
}

function visit(node, fn) {
  fn(node)
  ts.forEachChild(node, (child) => visit(child, fn))
}

function isNumberConst(node) {
  node = unwrap(node)
  if (ts.isNumericLiteral(node)) return true
  if (ts.isPrefixUnaryExpression(node)) return isNumberConst(node.operand)
  return ts.isBinaryExpression(node) && ARITHMETIC_OPS.has(node.operatorToken.kind) && isNumberConst(node.left) && isNumberConst(node.right)
}

const isZero = (node) => ts.isNumericLiteral(unwrap(node)) && Number(unwrap(node).text.replace(/_/g, '')) === 0

function stringValue(node) {
  node = unwrap(node)
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

// `x`, `a.b.x` and `x?.y` all answer with their last name; anything else answers null.
function lastName(node) {
  node = unwrap(node)
  if (ts.isIdentifier(node)) return node.text
  return ts.isPropertyAccessExpression(node) ? node.name.text : null
}

function isTierValue(node) {
  node = unwrap(node)
  if (ts.isCallExpression(node)) return lastName(node.expression) === 'resolvePlanTier'
  const name = lastName(node)
  return name !== null && /tier$/i.test(name)
}

function isTierCompare(node) {
  if (!ts.isBinaryExpression(node) || !EQUALITY_OPS.has(node.operatorToken.kind)) return false
  const planValue = (side) => ['free', 'paid'].includes(stringValue(side))
  return (isTierValue(node.left) && planValue(node.right)) || (isTierValue(node.right) && planValue(node.left))
}

// What a file declares that later checks need: `const X = <number>`, variables copied from
// d1QueriesPerInvocation, and variables holding the whole PlanLimits object.
function collectFileFacts(sourceFile) {
  const numberConsts = new Set()
  const budgetAliases = new Set()
  const limitsAliases = new Set()
  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer)
      if ((node.parent.flags & ts.NodeFlags.Const) && isNumberConst(init)) numberConsts.add(node.name.text)
      if (lastName(init) === BUDGET_FIELD) budgetAliases.add(node.name.text)
      if (ts.isCallExpression(init) && lastName(init.expression) === 'getPlanLimits') limitsAliases.add(node.name.text)
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && (node.propertyName ?? node.name).text === BUDGET_FIELD) budgetAliases.add(node.name.text)
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type && ts.isTypeReferenceNode(node.type) && lastName(node.type.typeName) === 'PlanLimits') limitsAliases.add(node.name.text)
  })
  return { numberConsts, budgetAliases, limitsAliases }
}

// Returns { hits: [{ rule, text }], reads: Set<string> }. `reads` is every property name the file reads.
function scanSource(fileName, sourceText) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const facts = collectFileFacts(sourceFile)
  const hits = []
  const reads = new Set()
  const hit = (rule, node, extra) => hits.push({ rule, text: norm(node.getText(sourceFile)), start: node.getStart(sourceFile), end: node.end, ...extra })

  const isBudget = (node) => lastName(node) === BUDGET_FIELD || (ts.isIdentifier(unwrap(node)) && facts.budgetAliases.has(unwrap(node).text))
  const isThreshold = (node) => !isZero(node) && (isNumberConst(node) || (ts.isIdentifier(unwrap(node)) && facts.numberConsts.has(unwrap(node).text)))
  const isPlanCondition = (condition) => {
    let found = false
    visit(condition, (node) => {
      if (isTierCompare(node)) found = true
      if (ts.isIdentifier(node) && (PLAN_IDENTIFIERS.has(node.text) || isPlanName(node.text) || facts.limitsAliases.has(node.text) || facts.budgetAliases.has(node.text))) found = true
    })
    return found
  }

  visit(sourceFile, (node) => {
    let read = null
    if (ts.isPropertyAccessExpression(node)) read = node.name.text
    else if (ts.isElementAccessExpression(node)) read = stringValue(node.argumentExpression)
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      read = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null
    }
    if (read) {
      reads.add(read)
      if (read === 'PLAN_TIER') hit('plan-tier-read', node)
    }

    if (isTierCompare(node)) hit('tier-compare', node)
    if (ts.isBinaryExpression(node) && (ORDER_OPS.has(node.operatorToken.kind) || EQUALITY_OPS.has(node.operatorToken.kind))
      && ((isBudget(node.left) && isThreshold(node.right)) || (isBudget(node.right) && isThreshold(node.left)))) hit('d1-queries-literal', node)
    if (ts.isConditionalExpression(node) && isNumberConst(node.whenTrue) && isNumberConst(node.whenFalse) && isPlanCondition(node.condition)) {
      hit('tier-ternary', node, { conditionStart: node.condition.getStart(sourceFile), conditionEnd: node.condition.end })
    }
    if (ts.isIdentifier(node) && isPlanName(node.text) && DECLARATION_KINDS.has(node.parent.kind) && node.parent.name === node) hit('plan-name', node)
  })

  // A fork that is already reported as a tier-ternary is one site, not two: drop what sits in its condition.
  const forks = hits.filter((h) => h.rule === 'tier-ternary')
  const kept = hits.filter((h) => h.rule === 'tier-ternary' || !forks.some((f) => h.start >= f.conditionStart && h.end <= f.conditionEnd))
  return { hits: kept.map(({ rule, text }) => ({ rule, text })), reads }
}

function* walkTs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTs(full)
    else if (/\.tsx?$/.test(entry.name)) yield full
  }
}

function planLimitFields() {
  const source = fs.readFileSync(path.join(srcRoot, PLAN_TIER_FILE), 'utf8')
  const sourceFile = ts.createSourceFile(PLAN_TIER_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let fields = null
  visit(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'PlanLimits' && ts.isTypeLiteralNode(node.type)) fields = node.type.members.map((member) => member.name.text)
  })
  return fields
}

// Every file under src except planTier.ts, reduced to: Map<key, { file, rule, text, count }> and the set of
// property names read. Files that mention none of the trigger words are skipped before parsing.
function scanTree(fields) {
  const trigger = new RegExp(['[Tt]ier', 'TIER', 'FREE', 'SMALL_PLAN', BUDGET_FIELD, ...fields].join('|'))
  const found = new Map()
  const reads = new Set()
  let files = 0
  for (const full of walkTs(srcRoot)) {
    const file = path.relative(srcRoot, full).split(path.sep).join('/')
    if (file === PLAN_TIER_FILE) continue
    files++
    const text = fs.readFileSync(full, 'utf8')
    if (!trigger.test(text)) continue
    const scanned = scanSource(file, text)
    for (const name of scanned.reads) reads.add(name)
    for (const { rule, text: hitText } of scanned.hits) {
      const key = [file, rule, hitText].join('\u0000')
      const entry = found.get(key) ?? { file, rule, text: hitText, count: 0 }
      entry.count++
      found.set(key, entry)
    }
  }
  return { found, reads, files }
}

// ---- The ratchet ----------------------------------------------------------

const entryKey = (entry) => [entry.file, entry.rule, entry.text].join('\u0000')
const describe = (entry) => `${entry.file} [${entry.rule}] \`${entry.text}\``

// Pure comparison of what the scan found against an allowlist. Exported shape is tested by the positive control.
function compareToAllowlist(found, allowlist) {
  const listed = new Map(allowlist.map((entry) => [entryKey(entry), entry]))
  const problems = []
  for (const entry of found.values()) {
    const allowed = listed.get(entryKey(entry))
    if (!allowed) {
      problems.push(`NEW plan literal: ${describe(entry)} x${entry.count} is ${RULE_ADVICE[entry.rule]}. Do NOT add it to the allowlist. Add a field to PlanLimits in lib/planTier.ts (a Free value and a Paid value, pinned in test-plan-tier-pure.cjs) and read it with getPlanLimits(env).<field>.`)
    } else if (entry.count > (allowed.count ?? 1)) {
      problems.push(`MORE copies than allowed: ${describe(entry)} found x${entry.count}, allowlisted x${allowed.count ?? 1}. The list can only shrink; use a planTier field for the new copy.`)
    }
  }
  for (const allowed of allowlist) {
    const entry = found.get(entryKey(allowed))
    const have = entry ? entry.count : 0
    if (have < (allowed.count ?? 1)) {
      problems.push(`STALE allowlist entry: ${describe(allowed)} is allowlisted x${allowed.count ?? 1} (audit row ${allowed.row}) but found x${have}. The literal moved or changed; delete the entry or lower its count in the same commit.`)
    }
  }
  return problems
}

// ---- The allowlist (audit rows from PLAN-LIMITS-AUDIT.md section 2) -------

const ALLOWED_HITS = [
  { file: 'lib/branchCutoverOperator.ts', rule: 'plan-tier-read', text: 'env?.PLAN_TIER', row: 10, why: 'reads PLAN_TIER itself instead of resolvePlanTier(); gates paid-only cutover actions' },
  { file: 'lib/failedSignInCost.ts', rule: 'tier-compare', text: "tier === 'free'", count: 2, row: null, why: 'not in audit: picks the failed-sign-in hash algorithm by tier, a sibling of row 18; needs a PlanLimits capability field' },
  { file: 'lib/quotaGuard.ts', rule: 'plan-name', text: 'FREE_QUOTA_LIMITS', row: 9, why: 'second Free/Paid table (KV, video, zones) living outside planTier.ts' },
  { file: 'lib/quotaGuard.ts', rule: 'tier-compare', text: "resolvePlanTier(env) === 'paid'", row: 9, why: 'KV write accounting forked on tier' },
  { file: 'lib/reportAtomicSwitch.ts', rule: 'tier-compare', text: "resolvePlanTier(env) === 'free'", row: 6, why: 'Free never shadow-compares reports; needs a capability field' },
  { file: 'lib/returnBulkAction.ts', rule: 'd1-queries-literal', text: 'getPlanLimits(env).d1QueriesPerInvocation < SMALL_PLAN_QUERY_LIMIT', row: 4, why: 'take-back-per-line gate: magic threshold 200 on the call budget' },
  { file: 'lib/returnBulkAction.ts', rule: 'plan-name', text: 'SMALL_PLAN_QUERY_LIMIT', row: 4, why: 'the 200 behind the take-back-per-line gate' },
  { file: 'lib/transferRunBudget.ts', rule: 'tier-compare', text: "budget.tier !== 'free'", row: 1, why: 'validates an explicit tier passed in by the caller' },
  { file: 'lib/transferRunBudget.ts', rule: 'tier-compare', text: "budget.tier !== 'paid'", row: 1, why: 'validates an explicit tier passed in by the caller' },
  { file: 'lib/transferRunBudget.ts', rule: 'tier-ternary', text: "budget.tier === 'free' ? 50 : 1000", row: 1, why: 'literal copy of d1QueriesPerInvocation (50 Free / 1000 Paid)' },
  { file: 'routes/notifications.ts', rule: 'tier-ternary', text: "limits.tier === 'free' ? 10_000 : 100_000", row: 2, why: 'loyalty row ceiling forked on tier' },
  { file: 'routes/products.ts', rule: 'd1-queries-literal', text: 'getPlanLimits(c.env).d1QueriesPerInvocation < 100', count: 6, row: 4, why: 'Resolve capability gates: magic threshold 100 on the call budget' },
  { file: 'routes/products.ts', rule: 'd1-queries-literal', text: 'getPlanLimits(c.env).d1QueriesPerInvocation >= 100', count: 2, row: 4, why: 'Resolve capability gates: magic threshold 100 on the call budget' },
  { file: 'routes/returns.ts', rule: 'd1-queries-literal', text: 'getPlanLimits(c.env).d1QueriesPerInvocation < 200', row: 4, why: 'export page size picked by a magic threshold 200' },
  { file: 'routes/returns.ts', rule: 'plan-name', text: 'RETURN_EXPORT_PAGE_MAX_FREE', row: 4, why: 'the Free export page size 250 as a bare constant' },
  { file: 'routes/system.ts', rule: 'tier-compare', text: "resolvePlanTier(c.env) === 'free'", row: null, why: 'not in audit: refuses a products reset with images on Free; needs a capability field' },
]

// PlanLimits fields no code reads yet (audit row 14). An entry goes the moment a reader lands; a new field with
// no reader and no entry fails.
const NO_READER_YET = [
  { field: 'stockActionAddConcurrency', row: 14, why: 'importEngine.ts keeps its own STOCK_ACTION_ADD_CONCURRENCY (row 13); changing this field does nothing' },
  { field: 'd1DailyRowsRead', row: 14, why: 'reported platform fact; the 70/85/95 governor (S1) is its first reader and is not built' },
  { field: 'd1DailyRowsWritten', row: 14, why: 'reported platform fact; the 70/85/95 governor (S1) is its first reader and is not built' },
  { field: 'd1MaxDatabaseBytes', row: 14, why: 'reported platform fact; no reader in any tree' },
]

// ---- Checks ---------------------------------------------------------------

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

const fields = planLimitFields()
const scan = scanTree(fields)

function printCurrentHits() {
  const rows = [...scan.found.values()].sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
  for (const { file, rule, text, count } of rows) console.log(JSON.stringify({ file, rule, text, count }))
  const missing = fields.filter((field) => field !== 'tier' && !scan.reads.has(field))
  console.log(JSON.stringify({ noReaderYet: missing }))
}

check('the scan sees the source tree (a wrong root must not look like a clean tree)', async () => {
  assert.ok(Array.isArray(fields) && fields.length > 15, `could not read the PlanLimits fields from ${PLAN_TIER_FILE}`)
  assert.ok(scan.files > 100, `only ${scan.files} source files scanned under ${srcRoot}`)
  assert.ok(scan.found.size > 0 || ALLOWED_HITS.length === 0, 'the scan found no plan literals at all while the allowlist expects some')
})

check('every allowlist entry is well-formed: a reason, an audit row, one entry per file+rule+text', async () => {
  const seen = new Set()
  for (const entry of ALLOWED_HITS) {
    assert.ok(Object.hasOwn(RULE_ADVICE, entry.rule), `unknown rule in ${describe(entry)}`)
    assert.ok(typeof entry.why === 'string' && entry.why.length > 0 && !entry.why.includes('\n'), `a one-line reason is required: ${describe(entry)}`)
    assert.ok(entry.row === null || (Number.isInteger(entry.row) && entry.row >= 1 && entry.row <= 19), `row must be an audit row 1-19, or null for a site the audit missed: ${describe(entry)}`)
    assert.ok(entry.count === undefined || (Number.isInteger(entry.count) && entry.count >= 2), `count is only written when it is 2 or more: ${describe(entry)}`)
    assert.ok(!seen.has(entryKey(entry)), `duplicate entry, raise its count instead: ${describe(entry)}`)
    seen.add(entryKey(entry))
  }
  const seenFields = new Set()
  for (const entry of NO_READER_YET) {
    assert.ok(typeof entry.field === 'string' && typeof entry.why === 'string' && entry.why.length > 0 && !entry.why.includes('\n'), `a field and a one-line reason are required: ${JSON.stringify(entry)}`)
    assert.ok(!seenFields.has(entry.field), `duplicate no-reader entry: ${entry.field}`)
    seenFields.add(entry.field)
  }
})

check('no plan-sized literal outside planTier.ts beyond the allowlist, and no stale allowlist entry', async () => {
  const problems = compareToAllowlist(scan.found, ALLOWED_HITS)
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})

check('every PlanLimits field has a reader outside planTier.ts, apart from the listed ones', async () => {
  const unread = fields.filter((field) => field !== 'tier' && !scan.reads.has(field))
  const listed = new Set(NO_READER_YET.map((entry) => entry.field))
  const problems = []
  for (const field of unread) {
    if (!listed.has(field)) problems.push(`NEW unread field: PlanLimits.${field} has no reader. Add the call site that reads getPlanLimits(env).${field} in the same commit (planTier.ts header rule).`)
  }
  for (const entry of NO_READER_YET) {
    if (!fields.includes(entry.field)) problems.push(`STALE no-reader entry: PlanLimits.${entry.field} no longer exists. Delete the entry.`)
    else if (!unread.includes(entry.field)) problems.push(`STALE no-reader entry: PlanLimits.${entry.field} now has a reader. Delete the entry.`)
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
})

// ---- POSITIVE CONTROL -----------------------------------------------------
//
// A scanner that finds nothing looks exactly like a tree with nothing to find. So the scanner is run
// here on a sample holding one of every forbidden pattern, and must report each; then on a sample of
// look-alikes that must report none; and the ratchet comparison is run on invented inputs.
const SAMPLE_FORBIDDEN = `
import { getPlanLimits, resolvePlanTier } from './planTier'
const SMALL_PLAN_QUERY_LIMIT = 200
const FREE_PAGE_MAX = 250
const RESOLVE_MIN = 100
export function sample(env: any, limits: any) {
  const plan = getPlanLimits(env)
  const budget = plan.d1QueriesPerInvocation
  if (limits.tier === 'free') return 1
  if (resolvePlanTier(env) !== 'paid') return 2
  const raw = env.PLAN_TIER
  const { PLAN_TIER: pulled } = env
  if (plan.d1QueriesPerInvocation < 100) return 3
  if (budget >= 100) return 4
  if (plan.d1QueriesPerInvocation < RESOLVE_MIN) return 5
  const rows = limits.tier === 'free' ? 10_000 : 100_000
  const pages = plan.rowsPerImportChunk > 10 ? 5 : 50
  return plan.someFieldNobodyListed
}
`
const SAMPLE_LOOKALIKES = `
// limits.tier === 'free' ? 1 : 2, env.PLAN_TIER, d1QueriesPerInvocation < 100 and FREE_IN_A_COMMENT
const text = "tier === 'free' and env.PLAN_TIER and d1QueriesPerInvocation < 100"
export function lookalikes(user: any, plan: any, limit: number, crossing: any) {
  const FREE_GOODS_REASON_NOTE = 'Free goods (no cost)'
  const stockTier = crossing.tier === 'out' ? 0 : 1
  const permission = user.tier !== 'full' ? 5 : 6
  if (plan.d1QueriesPerInvocation > 0) return limit > 0
  const spent = plan.d1QueriesPerInvocation - 10
  return limit < 100 ? stockTier : permission + spent
}
`

check('POSITIVE CONTROL: the scanner reports one of every forbidden pattern', async () => {
  const { hits, reads } = scanSource('sample-forbidden.ts', SAMPLE_FORBIDDEN)
  const byRule = (rule) => hits.filter((h) => h.rule === rule).map((h) => h.text)
  assert.deepEqual(byRule('tier-compare'), ["limits.tier === 'free'", "resolvePlanTier(env) !== 'paid'"])
  assert.deepEqual(byRule('plan-tier-read'), ['env.PLAN_TIER', 'PLAN_TIER: pulled'])
  assert.deepEqual(byRule('d1-queries-literal'), ['plan.d1QueriesPerInvocation < 100', 'budget >= 100', 'plan.d1QueriesPerInvocation < RESOLVE_MIN'])
  assert.deepEqual(byRule('tier-ternary'), ["limits.tier === 'free' ? 10_000 : 100_000", 'plan.rowsPerImportChunk > 10 ? 5 : 50'])
  assert.deepEqual(byRule('plan-name'), ['SMALL_PLAN_QUERY_LIMIT', 'FREE_PAGE_MAX'])
  assert.ok(reads.has('someFieldNobodyListed') && reads.has('rowsPerImportChunk'), 'the reader scan must see property reads')
  assert.equal(hits.length, 2 + 2 + 3 + 2 + 2, 'no hit may be missing or double-counted (a fork reported as a ternary is not also a tier-compare)')
})

check('POSITIVE CONTROL: look-alikes (comments, strings, other tiers, comparisons with 0, arithmetic) report nothing', async () => {
  const { hits } = scanSource('sample-lookalikes.ts', SAMPLE_LOOKALIKES)
  assert.deepEqual(hits, [], 'a permission tier, a stock tier, a comment or a string must not count as a plan literal')
})

check('POSITIVE CONTROL: the ratchet reports a new hit, a stale entry and a changed count', async () => {
  const hit = (file, rule, text, count) => ({ file, rule, text, count })
  const found = new Map([
    hit('a.ts', 'tier-ternary', 'x ? 1 : 2', 1),
    hit('b.ts', 'tier-compare', "tier === 'free'", 3),
    hit('c.ts', 'plan-name', 'FREE_A', 1),
  ].map((entry) => [entryKey(entry), entry]))
  const allowlist = [
    { file: 'b.ts', rule: 'tier-compare', text: "tier === 'free'", count: 2, row: 1, why: 'x' },
    { file: 'c.ts', rule: 'plan-name', text: 'FREE_A', row: 1, why: 'x' },
    { file: 'd.ts', rule: 'plan-name', text: 'FREE_GONE', row: 1, why: 'x' },
  ]
  const problems = compareToAllowlist(found, allowlist)
  assert.equal(problems.length, 3, problems.join('\n'))
  assert.ok(problems.some((p) => p.startsWith('NEW plan literal') && p.includes('a.ts')), 'an unlisted hit must fail')
  assert.ok(problems.some((p) => p.startsWith('MORE copies') && p.includes('b.ts')), 'a third copy of a listed text must fail')
  assert.ok(problems.some((p) => p.startsWith('STALE allowlist entry') && p.includes('d.ts')), 'an entry that matches nothing must fail')
  assert.deepEqual(compareToAllowlist(new Map([[entryKey(hit('c.ts', 'plan-name', 'FREE_A', 1)), hit('c.ts', 'plan-name', 'FREE_A', 1)]]), [allowlist[1]]), [], 'an exact match is clean')
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

if (process.argv.includes('--print')) printCurrentHits()
else void main()
