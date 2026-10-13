// Permission catalog parity: the Worker's per-action checks and the role editor's rows must describe the
// same set of permissions. A row the Worker never checks is a fake control; a Worker check with no row is a
// permission an administrator can never switch off. Every difference must be listed here with its reason,
// and a listing that stops being true fails too, so an exception cannot outlive its cause.
//
//   Worker action  (section:action)  -> needs an editor row, or a reason in ALWAYS_REFUSED / SECTION_LEVEL
//   Editor row     (section:action)  -> needs a Worker check, or a place in BROWSER_ONLY
//   Editor key     (top-level)       -> needs a Worker check, or a place in BROWSER_ONLY / PENDING_OWNER / MASTER_KEY
//
// Worker actions are read from the comment-free emit of every cloudflare/src file: each literal
// getActionTier/isActionBlocked(user, 'section', 'action') call, plus the call sites whose section or action is a
// variable (DYNAMIC_SITES). A variable call site that is not registered fails, so a new one cannot slip in.
//
// Run: node scripts/test-permission-catalog-parity-pure.cjs [--table]
// Test-only override: PARITY_REPO_ROOT points at a copy of the tree (used to prove the test goes RED).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = process.env.PARITY_REPO_ROOT ? path.resolve(process.env.PARITY_REPO_ROOT) : path.join(__dirname, '..', '..')
const WORKER = path.join(ROOT, 'cloudflare', 'src')
const SHOW_TABLE = process.argv.includes('--table')

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
  } catch (error) {
    failed += 1
    console.log('FAIL', name)
    console.log(String(error.message).split('\n').map((line) => `     ${line}`).join('\n'))
  }
}

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------
// The emit drops every comment, so a call named in a comment is never read as a check.
const emit = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, jsx: ts.JsxEmit.Preserve },
}).outputText

const loadModule = (file) => {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', js)(module, module.exports)
  return module.exports
}

const workerFiles = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) workerFiles.push(full)
  }
})(WORKER)
const rel = (file) => path.relative(WORKER, file).split(path.sep).join('/')
const collapse = (text) => text.replace(/\s+/g, ' ').trim()

// Only a file that names a permission helper (or is a lookup table) can hold a check; emit just those, once.
const CHECK_CALLEES = 'hasPermission|hasAnyPermission|getPermissionTier|getActionTier|isActionBlocked|isReviewRequired|denyUnless|requireReadKey|requirePermission|requireKey'
// Keys enforced through a lookup table rather than a call carrying the key.
const TABLE_FILES = ['routes/settings.ts', 'lib/productWrites.ts', 'lib/acquisitionCostAccess.ts']
const mentionsCheck = new RegExp(`\\b(?:${CHECK_CALLEES})\\b`)
const workerText = new Map()
for (const file of workerFiles) {
  if (TABLE_FILES.includes(rel(file)) || mentionsCheck.test(fs.readFileSync(file, 'utf8'))) workerText.set(rel(file), emit(file))
}

// ---------------------------------------------------------------------------
// Worker actions
// ---------------------------------------------------------------------------
const CALLEE = /\b(getActionTier|isActionBlocked)\s*\(/g
const LITERAL_ARGS = /^\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/
const HELPERS_FILE = 'lib/permissions.ts'

function snippetAt(text, open) {
  let depth = 0
  for (let i = open; i < text.length && i < open + 400; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')' && --depth === 0) return collapse(text.slice(open, i + 1))
  }
  return collapse(text.slice(open, open + 160))
}

// Whether a Partial Access caller gets past one getActionTier call: true when only 'none' stops it or it queues,
// false when the call demands Full Access (or the result is tested for it, or a 'review' branch refuses with 403),
// null when the result is used some other way.
function passesPartial(text, callStart, callEnd) {
  const compare = /^\s*(===|!==)\s*'(none|full|review|view)'/.exec(text.slice(callEnd, callEnd + 40))
  if (compare) {
    if (compare[2] === 'full') return false
    if (compare[2] === 'none') return true
    return compare[2] === 'review' && compare[1] === '===' ? true : null
  }
  const assigned = /(?:const|let)\s+(\w+)\s*=\s*$/.exec(text.slice(Math.max(0, callStart - 60), callStart))
  if (!assigned) return null
  const name = assigned[1]
  const after = text.slice(callEnd, callEnd + 1500)
  if (new RegExp(`\\b${name}\\s*!==\\s*'full'`).test(after)) return false
  if (new RegExp(`\\b${name}\\s*===\\s*'review'\\)\\s*\\{(?:(?!maybeQueueForReview|pending)[\\s\\S]){0,400}?\\b403\\b`).test(after)) return false
  return new RegExp(`\\b${name}\\s*(?:===|!==)\\s*'(?:none|review)'`).test(after) ? true : null
}

const literalPairs = new Map()
const partialSites = new Map()
const variableSites = []
for (const [file, text] of workerText) {
  if (file === HELPERS_FILE) continue
  for (const match of text.matchAll(CALLEE)) {
    const open = match.index + match[0].length - 1
    const literal = LITERAL_ARGS.exec(text.slice(open, open + 300))
    if (literal) {
      const pair = `${literal[1]}:${literal[2]}`
      literalPairs.set(pair, [...(literalPairs.get(pair) || []), file])
      if (match[1] === 'getActionTier') {
        partialSites.set(pair, [...(partialSites.get(pair) || []), { file, passes: passesPartial(text, match.index, open + literal[0].length) }])
      }
    } else {
      variableSites.push({ file, text: `${match[1]}${snippetAt(text, open)}` })
    }
  }
}

const quoted = (text, pattern) => [...text.matchAll(pattern)]
const sectionsReturnedBy = (text, name) => {
  const start = text.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `function ${name} not found`)
  const body = text.slice(start, text.indexOf('\n}', start))
  return [...body.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1])
}
const textOf = (file) => {
  assert.ok(workerText.has(file), `${file} is not in cloudflare/src any more`)
  return workerText.get(file)
}

// Call sites whose section or action is a variable. `reach` names every pair the variable can take, read from
// the same file wherever the source states the set, so the list cannot be wrong about it.
const IMPORT_SECTIONS = (file) => () => sectionsReturnedBy(textOf(file), 'importActionSection').map((section) => `${section}:import`)
const SALE_BULK_ACTIONS = () => {
  const text = textOf('lib/saleBulkUpdate.ts')
  const pairs = []
  for (const name of ['actionKey', 'underlyingAction']) {
    const found = new RegExp(`const ${name} = [^;]*?\\? '([a-z_]+)' : '([a-z_]+)'`).exec(text)
    assert.ok(found, `lib/saleBulkUpdate.ts no longer picks ${name} between two literals`)
    pairs.push(`sales:${found[1]}`, `sales:${found[2]}`)
  }
  return pairs
}
const DYNAMIC_SITES = [
  { file: 'lib/importEngine.ts', needle: "isActionBlocked(actor, section, 'import')", reach: IMPORT_SECTIONS('lib/importEngine.ts') },
  { file: 'routes/importJobs.ts', needle: "isActionBlocked(user, overrideSection, 'import')", reach: IMPORT_SECTIONS('routes/importJobs.ts') },
  {
    file: 'lib/reviewApprovalPermission.ts',
    needle: 'getActionTier(user, row.section, action)',
    reach: () => quoted(textOf('lib/reviewApprovalPermission.ts'), /'([a-z_]+):[a-z_]+:[a-z_]+':\s*'([a-z_]+)'/g).map((m) => `${m[1]}:${m[2]}`),
  },
  { file: 'lib/saleBulkUpdate.ts', needle: "getActionTier(user, 'sales', actionKey)", reach: SALE_BULK_ACTIONS },
  { file: 'lib/saleBulkUpdate.ts', needle: "getActionTier(user, 'sales', underlyingAction)", reach: SALE_BULK_ACTIONS },
  {
    file: 'lib/transferOperation.ts',
    needle: "getActionTier(user, payload.permission, 'transfer')",
    reach: () => quoted(textOf('lib/transferOperation.ts'), /payload\.permission === '([a-z_]+)'/g).map((m) => `${m[1]}:transfer`),
  },
  {
    file: 'lib/transferOperation.ts',
    needle: "getActionTier(user, permission, 'transfer')",
    reach: () => quoted(textOf('lib/transferOperation.ts'), /request\.kind === '[a-z-]+' \? '([a-z_]+)' : '([a-z_]+)'/g).flatMap((m) => [`${m[1]}:transfer`, `${m[2]}:transfer`]),
  },
  {
    file: 'lib/undoAppliers.ts',
    needle: 'getActionTier(user, applier.permission, applier.action)',
    reach: () => quoted(textOf('lib/undoAppliers.ts'), /permission:\s*'([a-z_]+)',\s*action:\s*'([a-z_]+)'/g).map((m) => `${m[1]}:${m[2]}`),
  },
  {
    file: 'routes/contacts.ts',
    needle: "getActionTier(c.get('user'), 'contacts', action)",
    reach: () => quoted(textOf('routes/contacts.ts'), /denyUnlessFullContactAction\(c, '([a-z_]+)'\)/g).map((m) => `contacts:${m[1]}`),
  },
  {
    file: 'routes/promotions.ts',
    needle: "getActionTier(c.get('user'), key, action)",
    reach: () => quoted(textOf('routes/promotions.ts'), /requireAction\('([a-z_]+)',\s*'([a-z_]+)'\)/g).map((m) => `${m[1]}:${m[2]}`),
  },
  {
    file: 'routes/reports.ts',
    needle: "getActionTier(user, kind === 'expenses' ? 'fees' : kind, 'export')",
    reach: () => {
      const kinds = /for \(const kind of \[([^\]]*)\]\)/.exec(textOf('routes/reports.ts'))
      assert.ok(kinds, 'routes/reports.ts no longer loops over its report kinds')
      return [...kinds[1].matchAll(/'([a-z_]+)'/g)].map((m) => `${m[1] === 'expenses' ? 'fees' : m[1]}:export`)
    },
  },
  {
    file: 'routes/sales.ts',
    needle: "getActionTier(user, 'sales', kind === 'add_items' ? 'add_items' : 'amend')",
    reach: () => ['sales:add_items', 'sales:amend'],
  },
]

const workerActions = new Map()
for (const [pair, files] of literalPairs) workerActions.set(pair, [...new Set(files)].map((file) => `${file} (literal)`))
const unregistered = []
const matchedSites = new Set()
for (const site of variableSites) {
  const entry = DYNAMIC_SITES.find((candidate) => candidate.file === site.file && site.text.includes(candidate.needle))
  if (!entry) { unregistered.push(`${site.file}: ${site.text}`); continue }
  matchedSites.add(entry)
}
for (const entry of DYNAMIC_SITES) {
  if (!matchedSites.has(entry)) continue
  for (const pair of entry.reach()) workerActions.set(pair, [...(workerActions.get(pair) || []), `${entry.file} (variable)`])
}

// ---------------------------------------------------------------------------
// Worker checks on top-level permission keys
// ---------------------------------------------------------------------------
// The helper file holds the key sets and fallbacks, and the invariants file the default seeds: neither is a check.
const NOT_EVIDENCE = new Set([HELPERS_FILE, 'lib/coreDataInvariants.ts'])
const checkStatements = []
for (const [file, text] of workerText) {
  if (NOT_EVIDENCE.has(file)) continue
  for (const match of text.matchAll(new RegExp(`\\b(?:${CHECK_CALLEES})\\s*\\(`, 'g'))) {
    const end = text.indexOf(';', match.index)
    checkStatements.push({ file, text: text.slice(match.index, Math.min(end < 0 ? Infinity : end, match.index + 200)) })
  }
}

function workerChecksKey(key) {
  const quotedKey = [`'${key}'`, `"${key}"`]
  const call = checkStatements.find((statement) => quotedKey.some((form) => statement.text.includes(form)))
  if (call) return `${call.file} (check call)`
  const table = new RegExp(`(?:'${key}'|"${key}"|\\.${key}\\b|(?:^|[\\s,{(])${key}\\s*:)`)
  const tableFile = TABLE_FILES.find((file) => table.test(workerText.get(file) || ''))
  return tableFile ? `${tableFile} (table)` : null
}

// ---------------------------------------------------------------------------
// The role editor
// ---------------------------------------------------------------------------
const { PERMISSION_ACTIONS, outcomeAt, actionAllowed } = loadModule(path.join(ROOT, 'frontend', 'src', 'utils', 'permissionActions.ts'))
const { PERMISSION_SECTIONS } = loadModule(path.join(ROOT, 'frontend', 'src', 'components', 'users', 'permissionDefinitions.ts'))
const definitionByKey = new Map(PERMISSION_SECTIONS.flatMap((section) => section.permissions.map((permission) => [permission.key, permission])))
const editorAction = new Map(Object.entries(PERMISSION_ACTIONS).flatMap(([key, actions]) => actions.map((action) => [`${key}:${action.key}`, action])))
const editorRows = new Set(editorAction.keys())

// ---------------------------------------------------------------------------
// Listed differences, each with the reason it is allowed
// ---------------------------------------------------------------------------
const ALWAYS_REFUSED = {
  'branches:add': 'Shop and Warehouse are fixed: the route checks the switch and then always answers 409, so there is nothing to grant.',
  'branches:delete': 'Shop and Warehouse are fixed: the route checks the switch and then always answers 409, so there is nothing to grant.',
}
const SECTION_LEVEL = {
  'audit_log:view': 'The section tier is the switch (None / View only = own entries / Full = everyone), so a separate row would say the same thing twice.',
  'promotions:view': 'The section tier is the switch (None / View only / Full), so a separate row would say the same thing twice.',
}
const BROWSER_ONLY = {
  dashboard_export: { gate: ['frontend/src/components/dashboard/Dashboard.tsx', /hasPermission\('dashboard_export'\)/], why: 'The export file is built in the browser from data already loaded.' },
  'products:export': { gate: ['frontend/src/components/products/Products.tsx', /can\('products',\s*'export'\)/], why: 'The export file is built from rows the page already loaded.' },
  'contacts:export': { gate: ['frontend/src/components/contacts/CustomersTab.tsx', /can\('contacts',\s*'export'\)/], why: 'The export file is built from rows the page already loaded.' },
  'branches:export': { gate: ['frontend/src/components/branches/Branches.tsx', /can\('branches',\s*'export'\)/], why: 'The export file is built from rows the page already loaded.' },
}
const PENDING_OWNER = {
  security_settings: 'Owner question Q6: the row grants nothing today because no Worker route checks it; hide it or give it a feature.',
  drive_credentials: 'Owner question Q6: the only trace is a fallback to the Settings grant in lib/permissions.ts; every Settings save is refused for it.',
}
const MASTER_KEY = { all: 'The administrator override, evaluated by isAdminControlUser in lib/permissions.ts.' }
// Rows that show Partial Access as blocked although a gate on the same action only stops 'none': the route first
// refuses a Partial Access caller outright, then honours the switch for a Full Access one.
const REFUSED_AT_PARTIAL = {
  'contacts:delete': { file: 'routes/contacts.ts', proof: [/Deleting a \$\{config\.entity\} requires Full Access to Contacts -- Partial Access support for this action is not built/] },
  'contacts:merge': { file: 'routes/contacts.ts', proof: [/Merging \$\{config\.entity\}s requires Full Access to Contacts -- Partial Access support for this action is not built/] },
  'contacts:bulk_delete': { file: 'routes/contacts.ts', proof: [/Bulk delete requires Full Access to Contacts -- Partial Access support for this action is not built/] },
  'contacts:bulk': {
    file: 'routes/contacts.ts',
    proof: [/Merging \$\{config\.entity\}s requires Full Access to Contacts -- Partial Access support/, /Bulk delete requires Full Access to Contacts -- Partial Access support/],
  },
  'returns:edit': { file: 'routes/returns.ts', proof: [/Editing a return requires Full Access to Returns -- Partial Access support for this action is not built yet/] },
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
check('every Worker action check is either a literal pair or a registered variable site', () => {
  assert.deepEqual(unregistered, [], `Register these in DYNAMIC_SITES with the pairs they can reach:\n${unregistered.join('\n')}`)
  const stale = DYNAMIC_SITES.filter((entry) => !matchedSites.has(entry)).map((entry) => `${entry.file}: ${entry.needle}`)
  assert.deepEqual(stale, [], `DYNAMIC_SITES entries that match no call site any more (remove them):\n${stale.join('\n')}`)
  assert.ok(workerActions.size > 55, `only ${workerActions.size} Worker actions found; the scan is broken`)
})

check('every editor row belongs to a permission key the editor renders', () => {
  const orphans = Object.keys(PERMISSION_ACTIONS).filter((key) => !definitionByKey.has(key))
  assert.deepEqual(orphans, [], `PERMISSION_ACTIONS rows for keys the editor never lists (they would never render): ${orphans.join(', ')}`)
})

check('every Worker action has an editor row, or is listed with its reason', () => {
  const unexplained = [...workerActions.keys()].filter((pair) => !editorRows.has(pair) && !ALWAYS_REFUSED[pair] && !SECTION_LEVEL[pair]).sort()
  assert.deepEqual(unexplained, [], `Worker checks these actions but the editor cannot switch them off.\nAdd a row to PERMISSION_ACTIONS (frontend/src/utils/permissionActions.ts) or list a reason here:\n${unexplained.map((pair) => `${pair}  <- ${workerActions.get(pair).join(', ')}`).join('\n')}`)
})

check('every row shows the Partial Access outcome the Worker gives its switch', () => {
  const problems = []
  for (const [pair, action] of editorAction) {
    const sites = (partialSites.get(pair) || []).filter((site) => site.passes !== null)
    const passes = sites.filter((site) => site.passes)
    const refuses = sites.filter((site) => !site.passes)
    const where = (list) => [...new Set(list.map((site) => site.file))].join(', ')
    if (action.controlReview) {
      if (!passes.length || !refuses.length) problems.push(`${pair}: the row separates its badge from its page tool, but the Worker has ${passes.length} lenient and ${refuses.length} Full-only gates`)
    } else if (action.review === 'block') {
      if (passes.length && !REFUSED_AT_PARTIAL[pair]) problems.push(`${pair}: the editor shows Partial Access as blocked, but the Worker lets it through (only 'none' stops it) in ${where(passes)}`)
    } else if (sites.length && !passes.length) {
      problems.push(`${pair}: the editor shows ${action.review} at Partial Access, but every Worker gate demands Full Access (${where(refuses)})`)
    }
  }
  assert.deepEqual(problems, [], `The role editor and the Worker disagree about Partial Access.\nFix the row in PERMISSION_ACTIONS (frontend/src/utils/permissionActions.ts), or list a refusal in REFUSED_AT_PARTIAL:\n${problems.join('\n')}`)
})

check('a listed Partial Access refusal is still true', () => {
  const problems = []
  for (const [pair, entry] of Object.entries(REFUSED_AT_PARTIAL)) {
    const action = editorAction.get(pair)
    if (!action || action.review !== 'block') problems.push(`${pair} is listed as refused at Partial Access but the editor row is ${action ? action.review : 'gone'}`)
    if (!(partialSites.get(pair) || []).some((site) => site.passes === true)) problems.push(`${pair}: no Worker gate lets Partial Access through any more; remove it from REFUSED_AT_PARTIAL`)
    for (const proof of entry.proof) if (!proof.test(textOf(entry.file))) problems.push(`${pair}: ${entry.file} no longer refuses a Partial Access caller (${proof})`)
  }
  assert.deepEqual(problems, [])
})

check('every editor action row has a Worker check, or is listed as browser-only', () => {
  const unexplained = [...editorRows].filter((pair) => !workerActions.has(pair) && !BROWSER_ONLY[pair]).sort()
  assert.deepEqual(unexplained, [], `The editor offers these rows but no Worker route checks them (a fake control):\n${unexplained.join('\n')}`)
})

check('every top-level editor key has a Worker check, or is listed', () => {
  const unexplained = []
  for (const key of definitionByKey.keys()) {
    if (workerChecksKey(key) || BROWSER_ONLY[key] || PENDING_OWNER[key] || MASTER_KEY[key]) continue
    unexplained.push(key)
  }
  assert.deepEqual(unexplained, [], `The editor lists these keys but no Worker code checks them:\n${unexplained.join('\n')}`)
})

check('a listed exception is still true (no stale listing)', () => {
  const problems = []
  for (const pair of Object.keys(ALWAYS_REFUSED)) {
    if (!workerActions.has(pair)) problems.push(`${pair} is listed as always refused but the Worker no longer checks it`)
    if (editorRows.has(pair)) problems.push(`${pair} has an editor row although the Worker always refuses it: the switch would do nothing`)
  }
  for (const pair of Object.keys(SECTION_LEVEL)) {
    const [section] = pair.split(':')
    if (!workerActions.has(pair)) problems.push(`${pair} is listed as section-level but the Worker no longer checks it`)
    if (editorRows.has(pair)) problems.push(`${pair} now has an editor row; remove it from SECTION_LEVEL`)
    if (!definitionByKey.get(section)?.tier) problems.push(`${pair} is section-level but ${section} is not a tiered editor key`)
  }
  for (const [name, entry] of Object.entries(BROWSER_ONLY)) {
    const isAction = name.includes(':')
    if (isAction ? workerActions.has(name) : workerChecksKey(name)) problems.push(`${name} is listed as browser-only but the Worker now checks it; remove it from BROWSER_ONLY`)
    if (isAction ? !editorRows.has(name) : !definitionByKey.has(name)) problems.push(`${name} is listed as browser-only but the editor has no such row`)
    const [file, pattern] = entry.gate
    const gateFile = path.join(ROOT, file)
    if (!fs.existsSync(gateFile) || !pattern.test(emit(gateFile))) problems.push(`${name} is listed as browser-only but ${file} no longer gates on it`)
  }
  for (const key of Object.keys(PENDING_OWNER)) {
    if (!definitionByKey.has(key)) problems.push(`${key} is listed as pending Q6 but the editor no longer has the row; remove it from PENDING_OWNER`)
    const hit = workerChecksKey(key)
    if (hit) problems.push(`${key} is listed as pending Q6 but ${hit} now checks it; remove it from PENDING_OWNER`)
  }
  assert.deepEqual(problems, [])
})

check('always-refused branch actions really are refused after the switch check', () => {
  const text = textOf('routes/branches.ts')
  const handlers = [["app.post('/'", "app.put('/:id'", 'add'], ["app.delete('/:id'", 'export default app', 'delete']]
  for (const [startMarker, endMarker, action] of handlers) {
    const start = text.indexOf(startMarker)
    const end = text.indexOf(endMarker, start)
    assert.ok(start >= 0 && end > start, `routes/branches.ts handler ${startMarker} not found`)
    const body = text.slice(start, end)
    assert.match(body, new RegExp(`getActionTier\\(user, 'branches', '${action}'\\)`), `${action} handler no longer checks its switch`)
    assert.match(body, /CANONICAL_BRANCH_IDENTITY_CODE\s*\}\s*,\s*409/, `${action} handler no longer ends in the canonical 409 refusal`)
  }
})

check('control: the scan sees known checks and misses a known gap', () => {
  assert.ok(workerActions.has('pos:manage_address_presets'), 'literal pair in routes/pos.ts')
  assert.ok(workerActions.has('contacts:resolve_conflicts'), 'variable site: denyUnlessFullContactAction')
  assert.ok(workerActions.has('fees:export'), 'variable site: reports kinds')
  assert.ok(workerActions.has('products:import_replace_all') && workerActions.has('sales:import'), 'import sections')
  assert.ok(!workerActions.has('products:export'), 'products:export is browser-only, never checked by the Worker')
  assert.ok(workerChecksKey('backup_restore') && workerChecksKey('contacts_suppliers') && workerChecksKey('product_cost_view'), 'check calls and table lookups')
  assert.equal(workerChecksKey('security_settings'), null, 'security_settings has no Worker check')
  assert.equal(workerChecksKey('drive_credentials'), null, 'drive_credentials has no Worker check')
})

if (SHOW_TABLE) {
  const verdict = (pair) => {
    const inEditor = editorRows.has(pair)
    const inWorker = workerActions.has(pair)
    if (inEditor && inWorker) return 'matched'
    if (inWorker) return ALWAYS_REFUSED[pair] ? 'worker only: always refused' : SECTION_LEVEL[pair] ? 'worker only: section-level' : 'UNEXPLAINED worker only'
    return BROWSER_ONLY[pair] ? 'editor only: browser-only' : 'UNEXPLAINED editor only'
  }
  const pairs = [...new Set([...workerActions.keys(), ...editorRows])].sort()
  console.log('\nsection:action'.padEnd(44) + 'editor  worker  verdict')
  for (const pair of pairs) console.log(pair.padEnd(43) + (editorRows.has(pair) ? 'yes' : '-').padEnd(8) + (workerActions.has(pair) ? 'yes' : '-').padEnd(8) + verdict(pair))
  console.log('\ntop-level key'.padEnd(44) + 'worker check / listing')
  for (const key of definitionByKey.keys()) {
    const listing = BROWSER_ONLY[key] ? 'browser-only' : PENDING_OWNER[key] ? 'pending owner Q6' : MASTER_KEY[key] ? 'master key' : workerChecksKey(key) || 'UNEXPLAINED'
    console.log(key.padEnd(43) + listing)
  }
  console.log('\nsection:action'.padEnd(44) + 'off    middle   (page tool)  full   Worker gates at the middle tier')
  for (const [pair, action] of editorAction) {
    const definition = definitionByKey.get(pair.split(':')[0])
    const middle = !definition?.tier ? '-' : definition.middleTier === 'view' ? 'view' : 'review'
    const outcome = (tier) => (tier === '-' ? '-' : outcomeAt(action, tier))
    const tool = middle === '-' ? '-' : actionAllowed(pair.split(':')[0], action.key, middle) ? 'usable' : 'blocked'
    const sites = (partialSites.get(pair) || []).filter((site) => site.passes !== null)
    const gates = sites.length ? `${sites.filter((site) => site.passes).length} let it through / ${sites.filter((site) => !site.passes).length} Full only` : 'no literal gate'
    console.log(pair.padEnd(43) + outcome('none').padEnd(7) + outcome(middle).padEnd(9) + tool.padEnd(13) + outcome('full').padEnd(7) + gates)
  }
}

const counts = { matched: 0, workerOnly: 0, editorOnly: 0 }
for (const pair of new Set([...workerActions.keys(), ...editorRows])) {
  if (editorRows.has(pair) && workerActions.has(pair)) counts.matched += 1
  else if (workerActions.has(pair)) counts.workerOnly += 1
  else counts.editorOnly += 1
}
console.log(`\n${workerActions.size} Worker actions, ${editorRows.size} editor rows: ${counts.matched} matched, ${counts.workerOnly} Worker-only (listed), ${counts.editorOnly} editor-only (listed)`)
if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exitCode = 1
} else {
  console.log('permission catalog parity passed')
}
