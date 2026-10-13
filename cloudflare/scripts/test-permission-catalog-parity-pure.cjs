// Permission catalog parity: the Worker's per-action checks and the role editor's rows must describe the
// same set of permissions. A row the Worker never checks is a fake control; a Worker check with no row is a
// permission an administrator can never switch off. Every difference must be listed here with its reason,
// and a listing that stops being true fails too, so an exception cannot outlive its cause.
//
//   Worker action  (section:action)  -> needs an editor row, or a reason in ALWAYS_REFUSED / SECTION_LEVEL
//   Editor row     (section:action)  -> needs a Worker check, or a place in BROWSER_ONLY
//   Editor key     (top-level)       -> needs a Worker check, or a place in BROWSER_ONLY / PENDING_OWNER / MASTER_KEY
//   Worker key     (top-level)       -> needs an editor key, or a reason in WORKER_ONLY_KEYS
//
// Worker actions are read from the comment-free emit of every cloudflare/src file: each literal
// getActionTier/isActionBlocked(user, 'section', 'action') call (under its own name or an import or local alias),
// plus the call sites whose section or action is a variable (DYNAMIC_SITES) and the literals passed to the
// registered wrappers (WRAPPERS). A variable call site, a wrapper call with a variable, or a use of either helper
// other than a direct call fails, so a new one cannot slip in.
//
// Each editor row's Partial Access outcome is also compared with how the Worker's getActionTier gates treat a
// Partial Access caller (passesPartial): a row cannot show Hidden where the Worker only stops 'none', nor Allowed
// where every gate demands Full Access.
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
// The emit drops every comment, so a call named in a comment is never read as a check, and every plain string is
// single-quoted, so 'archive' and "archive" read alike.
const emit = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, jsx: ts.JsxEmit.Preserve },
}).outputText.replace(/"([^"'`\\\n]*)"/g, "'$1'")

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
const HELPERS = ['getActionTier', 'isActionBlocked']
const LITERAL_ARGS = /^\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/
const HELPERS_FILE = 'lib/permissions.ts'
const IMPORT_CLAUSE = /import\s*(?:type\s*)?\{[^}]*\}\s*from\s*'[^']*';?/g
const ALIAS_DECLARATION = /\b(?:const|let|var)\s+(\w+)\s*=\s*(getActionTier|isActionBlocked)\b(?!\s*\()/g

// The names a file calls the two helpers by: their own, an import alias, or a local alias.
function calleeNames(text) {
  const names = new Map(HELPERS.map((name) => [name, name]))
  for (const clause of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[^']*'/g)) {
    for (const part of clause[1].split(',')) {
      const [original, alias] = part.trim().split(/\s+as\s+/)
      if (alias && HELPERS.includes(original.trim())) names.set(alias.trim(), original.trim())
    }
  }
  for (const declaration of text.matchAll(ALIAS_DECLARATION)) names.set(declaration[1], declaration[2])
  return names
}
const calleePattern = (names) => new RegExp(`\\b(${[...names.keys()].join('|')})\\s*\\(`, 'g')

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
const indirectUses = []
for (const [file, text] of workerText) {
  if (file === HELPERS_FILE) continue
  const names = calleeNames(text)
  for (const match of text.matchAll(calleePattern(names))) {
    const helper = names.get(match[1])
    const open = match.index + match[0].length - 1
    const literal = LITERAL_ARGS.exec(text.slice(open, open + 300))
    if (literal) {
      const pair = `${literal[1]}:${literal[2]}`
      literalPairs.set(pair, [...(literalPairs.get(pair) || []), file])
      if (helper === 'getActionTier') {
        partialSites.set(pair, [...(partialSites.get(pair) || []), { file, passes: passesPartial(text, match.index, open + literal[0].length) }])
      }
    } else {
      variableSites.push({ file, text: `${helper}${snippetAt(text, open)}` })
    }
  }
  const bare = text.replace(IMPORT_CLAUSE, '').replace(ALIAS_DECLARATION, '')
  for (const use of bare.matchAll(new RegExp(`\\b(${[...names.keys()].join('|')})\\b(?!\\s*\\()`, 'g'))) {
    indirectUses.push(`${file}: ${collapse(bare.slice(Math.max(0, use.index - 40), use.index + 60))}`)
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
// Wrappers that forward a literal action to getActionTier. Every call must pass literals the scan can read: a
// call with a variable would hide its action, and fails.
const WRAPPERS = {
  denyUnlessFullContactAction: { file: 'routes/contacts.ts', literal: /denyUnlessFullContactAction\(\s*c\s*,\s*'([a-z_]+)'\s*\)/g },
  requireAction: { file: 'routes/promotions.ts', literal: /requireAction\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g },
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
    reach: () => quoted(textOf('routes/contacts.ts'), WRAPPERS.denyUnlessFullContactAction.literal).map((m) => `contacts:${m[1]}`),
  },
  {
    file: 'routes/promotions.ts',
    needle: "getActionTier(c.get('user'), key, action)",
    reach: () => quoted(textOf('routes/promotions.ts'), WRAPPERS.requireAction.literal).map((m) => `${m[1]}:${m[2]}`),
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

// Which argument of each helper carries the permission key (hasAnyPermission takes an array, denyUnless a list).
const KEY_ARGUMENTS = {
  hasPermission: (args) => args.slice(1, 2),
  getPermissionTier: (args) => args.slice(1, 2),
  isReviewRequired: (args) => args.slice(1, 2),
  hasAnyPermission: (args) => args.slice(1, 2),
  denyUnless: (args) => args.slice(1),
  requireReadKey: (args) => args.slice(0, 1),
  requireKey: (args) => args.slice(0, 1),
  requirePermission: (args) => args.slice(0, 1),
  getActionTier: (args) => args.slice(1, 2),
  isActionBlocked: (args) => args.slice(1, 2),
}

function topLevelArguments(text, open) {
  const args = []
  let depth = 0
  let start = open + 1
  let quote = ''
  for (let i = open; i < text.length && i < open + 600; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '`') {
      quote = ch
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) { args.push(text.slice(start, i)); return args }
    } else if (ch === ',' && depth === 1) {
      args.push(text.slice(start, i))
      start = i + 1
    }
  }
  return args
}

const checkedKeys = new Map()
for (const [file, text] of workerText) {
  if (NOT_EVIDENCE.has(file)) continue
  const names = new Map([...Object.keys(KEY_ARGUMENTS).map((name) => [name, name]), ...calleeNames(text)])
  for (const match of text.matchAll(new RegExp(`\\b(${[...names.keys()].join('|')})\\s*\\(`, 'g'))) {
    const helper = names.get(match[1])
    const args = topLevelArguments(text, match.index + match[0].length - 1)
    for (const argument of KEY_ARGUMENTS[helper](args)) {
      const literals = /^\s*(?:\[[^\]]*\]|'[a-z_]+')\s*$/.test(argument) ? [...argument.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : []
      for (const key of literals) checkedKeys.set(key, [...(checkedKeys.get(key) || []), `${file} ${helper}`])
    }
  }
}

function workerChecksKey(key) {
  const call = checkedKeys.get(key)
  if (call) return `${call[0].split(' ')[0]} (check call)`
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
const allActions = new Map(Object.entries(PERMISSION_ACTIONS).flatMap(([key, actions]) => actions.map((action) => [`${key}:${action.key}`, action])))
// A followed control rides another row's switch and has no row of its own.
const editorAction = new Map([...allActions].filter(([, action]) => !action.follows))
const followedControl = new Map([...allActions].filter(([, action]) => action.follows))
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
  dashboard_export: { gates: [['frontend/src/components/dashboard/Dashboard.tsx', /hasPermission\('dashboard_export'\)/]], why: 'The export file is built in the browser from data already loaded.' },
  'products:export': { gates: [['frontend/src/components/products/Products.tsx', /can\('products',\s*'export'\)/]], why: 'The export file is built from rows the page already loaded.' },
  'contacts:export': {
    gates: ['CustomersTab', 'SuppliersTab', 'DeliveryTab'].map((tab) => [`frontend/src/components/contacts/${tab}.tsx`, /can\('contacts',\s*'export'\)/]),
    why: 'The export file is built from rows the page already loaded, on each of the three contact tabs.',
  },
  'branches:export': { gates: [['frontend/src/components/branches/Branches.tsx', /can\('branches',\s*'export'\)/]], why: 'The export file is built from rows the page already loaded.' },
}
const PENDING_OWNER = {
  security_settings: 'Owner decision pending: the row grants nothing today because no Worker route checks it; hide it or give it a feature.',
  drive_credentials: 'Owner decision pending: the only trace is a fallback to the Settings grant in lib/permissions.ts; every Settings save is refused for it.',
}
const MASTER_KEY = { all: 'The administrator override, evaluated by isAdminControlUser in lib/permissions.ts.' }
// Keys the Worker checks that the editor has no key for.
const WORKER_ONLY_KEYS = {}
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
// Page controls that ride an editor row's switch but are gated more tightly (a followed control in
// PERMISSION_ACTIONS), each proved against the route that refuses a weaker caller.
const FOLLOWED_CONTROLS = {
  'contacts:relink_sales': {
    file: 'routes/contacts.ts',
    proof: [
      /app\.post\('\/customers\/link-conflicts\/relink'[\s\S]{0,700}?denyUnlessFullContactAction\(c, 'resolve_conflicts'\)/,
      /app\.post\('\/customers\/link-conflicts\/resolve-missing'[\s\S]{0,700}?denyUnlessFullContactAction\(c, 'resolve_conflicts'\)/,
    ],
  },
  'inventory:rename_reasons': {
    file: 'routes/inventory.ts',
    proof: [/app\.post\('\/reasons\/replace'[\s\S]{0,700}?getActionTier\(user, 'inventory', 'edit_reasons'\) === 'none'[\s\S]{0,400}?getPermissionTier\(user, 'inventory'\) !== 'full'[\s\S]{0,300}?full_access_required/],
  },
}
// Second grants a row or followed control names (`requires`), each proved against the Worker code that demands it.
const SALE_LINK_GRANTS = [
  /app\.post\('\/customers\/link-conflicts\/relink'[\s\S]{0,900}?getActionTier\(user, 'sales', 'customer'\) !== 'full' \|\| getActionTier\(user, 'sales', 'customer_reassign'\) !== 'full'/,
  /app\.post\('\/customers\/link-conflicts\/resolve-missing'[\s\S]{0,900}?getActionTier\(user, 'sales', 'customer'\) !== 'full' \|\| getActionTier\(user, 'sales', 'customer_reassign'\) !== 'full'/,
]
const REQUIREMENT_PROOFS = {
  product_cost_edit: { file: 'routes/importJobs.ts', proof: [/const allowed = isRead \? canViewAcquisitionCosts\(user\) : canEditAcquisitionCosts\(user\)/, /code: isRead \? 'product_cost_view_required' : 'product_cost_edit_required'/] },
  product_cost_view: { file: 'routes/importJobs.ts', proof: [/const isRead = c\.req\.method === 'GET' \|\| c\.req\.method === 'HEAD'/, /const allowed = isRead \? canViewAcquisitionCosts\(user\) : canEditAcquisitionCosts\(user\)/] },
  destructive_delete: { file: 'lib/importEngine.ts', proof: [/!hasPermission\(user, 'destructive_delete'\)\)\s*return 'destructive_delete'/] },
  'products:import': { file: 'routes/importJobs.ts', proof: [/requireImportPermission\(c, undefined, type\)[\s\S]{0,300}?missingDestructiveImportPermission\(/, /isActionBlocked\(user, overrideSection, 'import'\)/] },
  'sales:customer': { file: 'routes/contacts.ts', proof: SALE_LINK_GRANTS },
  'sales:customer_reassign': { file: 'routes/contacts.ts', proof: SALE_LINK_GRANTS },
}
// Every Worker refusal that names a cost grant, and what it means for the editor. `row`: the grant is a `requires`
// on an import row. `input`: only a request that carries a cost field is refused, so a role without the grant just
// leaves the field out and no row is affected. `unmodelled`: refuses a whole control for a role without the grant and
// the editor does not say so yet (listed so it is a decision, not an oversight).
const COST_GATES = [
  { text: 'Cost-entry permission is required for this import format', how: 'row' },
  { text: 'Cost-view permission is required to read financial import data', how: 'row' },
  { text: 'Cost-entry permission is required to enter receipt costs', how: 'input' },
  { text: 'Cost-entry permission is required to change receipt costs', how: 'input' },
  { text: 'Cost-entry permission is required to change stored receipt costs', how: 'input' },
  { text: 'Cost-entry permission is required to reverse a cost change', how: 'input' },
  { text: 'Cost-entry permission is required to change catalog costs', how: 'input' },
  { text: 'Cost-entry permission is required to set catalog costs', how: 'input' },
  { text: 'Cost-entry permission is required to submit return cost overrides', how: 'input' },
  { text: 'Cost-entry permission is required to submit cost changes', how: 'input' },
  { text: 'Changing the cost needs the cost edit permission', how: 'input' },
  { text: 'Cost-entry permission is required to record supplier return costs and settlement', how: 'unmodelled', why: 'POST /returns/supplier (a supplier return, under returns:add) also needs Edit and View product costs.' },
  { text: 'Cost-view permission is required to review supplier return compensation and settlement', how: 'unmodelled', why: 'POST /returns/supplier (a supplier return, under returns:add) also needs Edit and View product costs.' },
  { text: 'Cost-view permission is required to export an unredacted database backup', how: 'unmodelled', why: 'Creating a backup needs View product costs on top of the backup key.' },
  { text: 'Cost-entry permission is required to restore database costs', how: 'unmodelled', why: 'Restoring a backup needs Edit product costs on top of backup_restore.' },
  { text: 'Cost-view permission is required to export database backups', how: 'unmodelled', why: 'Drive sync needs View product costs on top of the backup key.' },
  { text: 'Cost-entry permission is required to prepare a database restore', how: 'unmodelled', why: 'Staging a Drive restore needs Edit product costs on top of backup_restore.' },
]

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
check('every Worker action check is either a literal pair or a registered variable site', () => {
  assert.deepEqual(unregistered, [], `Register these in DYNAMIC_SITES with the pairs they can reach:\n${unregistered.join('\n')}`)
  const stale = DYNAMIC_SITES.filter((entry) => !matchedSites.has(entry)).map((entry) => `${entry.file}: ${entry.needle}`)
  assert.deepEqual(stale, [], `DYNAMIC_SITES entries that match no call site any more (remove them):\n${stale.join('\n')}`)
  assert.ok(workerActions.size > 55, `only ${workerActions.size} Worker actions found; the scan is broken`)
})

check('every use of the two action helpers is a direct call the scan can read', () => {
  assert.deepEqual(indirectUses, [], `getActionTier / isActionBlocked (or an alias of them) is used other than as a direct call, so its actions are invisible to this test:\n${indirectUses.join('\n')}`)
})

check('every call to an action wrapper passes literals', () => {
  const problems = []
  for (const [name, wrapper] of Object.entries(WRAPPERS)) {
    const text = textOf(wrapper.file)
    const calls = [...text.matchAll(new RegExp(`(?<!function\\s)\\b${name}\\s*\\(`, 'g'))].length
    const readable = [...text.matchAll(wrapper.literal)].length
    if (!calls) problems.push(`${name} is registered in WRAPPERS but ${wrapper.file} never calls it; remove it`)
    else if (calls !== readable) problems.push(`${wrapper.file}: ${calls - readable} of ${calls} calls to ${name} pass something other than literals, so the action they check is invisible`)
  }
  assert.deepEqual(problems, [])
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

check('every permission key the Worker checks has an editor key, or is listed', () => {
  const sections = new Set([...workerActions.keys()].map((pair) => pair.split(':')[0]))
  const keys = new Set([...checkedKeys.keys(), ...sections])
  const unexplained = [...keys].filter((key) => !definitionByKey.has(key) && !WORKER_ONLY_KEYS[key]).sort()
  assert.deepEqual(unexplained, [], `The Worker checks these permission keys but the editor has no key an administrator could switch off.\nAdd the key to PERMISSION_SECTIONS (frontend/src/components/users/permissionDefinitions.ts) or list it in WORKER_ONLY_KEYS with its reason:\n${unexplained.map((key) => `${key}  <- ${(checkedKeys.get(key) || ['an action check']).join(', ')}`).join('\n')}`)
  const stale = Object.keys(WORKER_ONLY_KEYS).filter((key) => definitionByKey.has(key) || !keys.has(key))
  assert.deepEqual(stale, [], `WORKER_ONLY_KEYS entries the editor now has or the Worker no longer checks (remove them):\n${stale.join('\n')}`)
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
    for (const [file, pattern] of entry.gates) {
      const gateFile = path.join(ROOT, file)
      if (!fs.existsSync(gateFile) || !pattern.test(emit(gateFile))) problems.push(`${name} is listed as browser-only but ${file} no longer gates on it`)
    }
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

const costImportTypes = () => {
  const found = /function isAcquisitionCostImport\([^)]*\) \{\s*return \[([^\]]*)\]\.includes/.exec(textOf('lib/acquisitionCostAccess.ts'))
  assert.ok(found, 'lib/acquisitionCostAccess.ts no longer lists the cost import types in isAcquisitionCostImport')
  return [...found[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}
const importSectionFor = (type) => {
  const text = textOf('routes/importJobs.ts')
  const start = text.indexOf('function importActionSection(')
  assert.ok(start >= 0, 'routes/importJobs.ts no longer defines importActionSection')
  const body = text.slice(start, text.indexOf('\n}', start))
  const rule = [...body.matchAll(/if \(([^\n]*)\)\s*return '([a-z_]+)'/g)].find((entry) => entry[1].includes(`'${type}'`))
  return rule ? rule[2] : [...body.matchAll(/return '([a-z_]+)'/g)].pop()[1]
}

check('every second grant a row names is one the Worker demands', () => {
  const problems = []
  const used = new Set()
  for (const [pair, action] of allActions) {
    for (const requirement of action.requires ?? []) {
      used.add(requirement.key)
      const entry = REQUIREMENT_PROOFS[requirement.key]
      if (!entry) { problems.push(`${pair} requires ${requirement.key} but REQUIREMENT_PROOFS has no Worker proof for it`); continue }
      for (const proof of entry.proof) if (!proof.test(textOf(entry.file))) problems.push(`${pair} requires ${requirement.key} but ${entry.file} no longer demands it (${proof})`)
    }
  }
  for (const key of Object.keys(REQUIREMENT_PROOFS)) if (!used.has(key)) problems.push(`${key} is in REQUIREMENT_PROOFS but no editor row requires it any more; remove it`)
  assert.deepEqual(problems, [], 'The role editor and the Worker disagree about a second grant.\nFix the `requires` on the row in PERMISSION_ACTIONS (frontend/src/utils/permissionActions.ts), or update REQUIREMENT_PROOFS:')
})

check('every import type the Worker treats as a cost import has an import row that names both cost grants', () => {
  const problems = []
  const types = costImportTypes()
  assert.ok(types.length >= 3, `only ${types.length} cost import types found; the scan is broken`)
  const sections = new Set()
  for (const type of types) {
    const section = importSectionFor(type)
    sections.add(section)
    const keys = (allActions.get(`${section}:import`)?.requires ?? []).map((requirement) => requirement.key)
    for (const grant of ['product_cost_edit', 'product_cost_view']) {
      if (!keys.includes(grant)) problems.push(`import type '${type}' is a cost import in the Worker, but the ${section}:import row does not require ${grant}`)
    }
  }
  for (const [pair, action] of allActions) {
    if (pair.endsWith(':import') && (action.requires ?? []).some((requirement) => requirement.key === 'product_cost_edit') && !sections.has(pair.split(':')[0])) {
      problems.push(`${pair} requires the cost grants but the Worker does not treat ${pair.split(':')[0]} imports as cost imports`)
    }
  }
  assert.deepEqual(problems, [])
})

check('every followed control rides a row the Worker checks, is stricter than it, and is proved against its route', () => {
  const problems = []
  for (const [pair, action] of followedControl) {
    const parent = `${pair.split(':')[0]}:${action.follows}`
    if (!editorRows.has(parent)) problems.push(`${pair} follows ${parent}, which is not an editor row`)
    else if (!workerActions.has(parent)) problems.push(`${pair} follows ${parent}, which the Worker never checks`)
    if (action.review !== 'block') problems.push(`${pair}: a followed control is the Full Access part of its row, so review must be 'block'`)
    const entry = FOLLOWED_CONTROLS[pair]
    if (!entry) { problems.push(`${pair} is a followed control but FOLLOWED_CONTROLS has no Worker proof for it`); continue }
    for (const proof of entry.proof) if (!proof.test(textOf(entry.file))) problems.push(`${pair}: ${entry.file} no longer refuses a weaker caller (${proof})`)
  }
  for (const pair of Object.keys(FOLLOWED_CONTROLS)) if (!followedControl.has(pair)) problems.push(`${pair} is in FOLLOWED_CONTROLS but the editor table has no such followed control; remove it`)
  assert.deepEqual(problems, [])
})

check('every Worker refusal that names a cost grant is classified', () => {
  const seen = new Map()
  for (const file of workerFiles) {
    if (!/permission is required|needs the cost edit permission/.test(fs.readFileSync(file, 'utf8'))) continue
    const text = workerText.get(rel(file)) ?? emit(file)
    for (const match of text.matchAll(/'((?:Cost-entry|Cost-view) permission is required[^']*|Changing the cost needs the cost edit permission[^']*)'/g)) {
      seen.set(match[1], [...(seen.get(match[1]) || []), rel(file)])
    }
  }
  const known = (message) => COST_GATES.some((gate) => message.startsWith(gate.text))
  const unclassified = [...seen.keys()].filter((message) => !known(message))
  assert.deepEqual(unclassified, [], `A Worker route refuses a role for lacking a cost grant and COST_GATES does not say what that means for the editor (a \`requires\` on a row, an input-only refusal, or a listed gap):\n${unclassified.map((message) => `${message}  <- ${[...new Set(seen.get(message))].join(', ')}`).join('\n')}`)
  const stale = COST_GATES.filter((gate) => ![...seen.keys()].some((message) => message.startsWith(gate.text))).map((gate) => gate.text)
  assert.deepEqual(stale, [], `COST_GATES entries no Worker route refuses with any more (remove them):\n${stale.join('\n')}`)
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
  console.log('\nrow or control'.padEnd(44) + 'second grants the Worker also demands')
  for (const [pair, action] of allActions) {
    if (action.requires?.length) console.log(pair.padEnd(43) + (action.follows ? `(rides ${action.follows}) ` : '') + action.requires.map((requirement) => requirement.key).join(', '))
  }
  console.log('\ncost grant refusals the editor does not state'.padEnd(44) + 'why')
  for (const gate of COST_GATES.filter((entry) => entry.how === 'unmodelled')) console.log(gate.text.slice(0, 42).padEnd(43) + gate.why)
}

const counts = { matched: 0, workerOnly: 0, editorOnly: 0 }
for (const pair of new Set([...workerActions.keys(), ...editorRows])) {
  if (editorRows.has(pair) && workerActions.has(pair)) counts.matched += 1
  else if (workerActions.has(pair)) counts.workerOnly += 1
  else counts.editorOnly += 1
}
console.log(`\n${workerActions.size} Worker actions, ${editorRows.size} editor rows: ${counts.matched} matched, ${counts.workerOnly} Worker-only (listed), ${counts.editorOnly} editor-only (listed); ${followedControl.size} followed controls, ${[...allActions.values()].filter((action) => action.requires?.length).length} rows or controls with second grants`)
if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exitCode = 1
} else {
  console.log('permission catalog parity passed')
}
