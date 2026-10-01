// Loads the REAL lib/undoAppliers.ts (transpiled) against a harness D1Compat
// (harness/d1compat.cjs over the real migrated schema), for the staleness
// tests of the branch.update and supplier.backfill appliers.
//
// Unlike the older per-file loaders, the branch write path is loaded for real
// (branchWrites -> canonicalBranchIdentity -> branchRoles), and toDbBool is
// lifted out of the real lib/db.ts by AST rather than copied, so a change to
// either is exercised here instead of hidden behind a stub. Only side
// channels (audit, broadcast, permissions) and the appliers these tests do not
// drive are stubbed; a stubbed replay throws if it is ever invoked.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const LIB_DIR = path.join(__dirname, '..', '..', 'src', 'lib')
const moneyPrecision = require(path.join(LIB_DIR, 'moneyPrecision.ts'))
const MONEY_PRECISION_REQUESTS = ['./moneyPrecision', '../lib/moneyPrecision', './moneyPrecision.ts', '../lib/moneyPrecision.ts']

function transpile(filename, target = ts.ScriptTarget.ES2022) {
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target },
    fileName: path.basename(filename),
  }).outputText
}

// The real toDbBool, lifted from lib/db.ts without loading that module's
// Cloudflare-only dependencies.
function realToDbBool() {
  const file = path.join(LIB_DIR, 'db.ts')
  const source = ts.createSourceFile('db.ts', fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const decl = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'toDbBool')
  if (!decl) throw new Error('lib/db.ts no longer declares toDbBool')
  const out = {}
  new Function('exports', ts.transpileModule(decl.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(out)
  return out.toDbBool
}

function unexpected(name) {
  return () => { throw new Error(`Unexpected ${name} replay in the undo staleness harness`) }
}

// `stubs` replaces a stubbed dependency, e.g. a replay that throws the refusal
// a test drives through the route.
function loadUndoAppliers(d1, { audit = async () => {}, realSaleModules = false, stubs: extraStubs = {} } = {}) {
  const dbAdapter = {
    prepare(sql) {
      const st = d1.prepare(sql)
      return {
        get: (p) => st.get(p == null ? {} : p),
        all: (p) => st.all(p == null ? {} : p),
        run: (p) => {
          const r = st.run(p == null ? {} : p)
          return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (stmts) => d1.batch(stmts),
  }
  const stubs = {
    '../index': {},
    './auth': {},
    './db': { getDb: () => dbAdapter, toDbBool: realToDbBool() },
    './audit': { audit },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    './saleBulkStatus': { replaySaleBulkStatus: unexpected('bulk status') },
    './saleBulkUpdate': {
      BULK_UPDATE_KIND: 'sale.fields.bulk',
      BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk',
      MULTI_CUSTOMER_UPDATE_KIND: 'sale.customer.v2.bulk',
      SINGLE_CUSTOMER_UPDATE_KIND: 'sale.customer.single',
      replaySaleBulkUpdate: unexpected('bulk sale update'),
    },
    './returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk', replayReturnBulkAction: unexpected('return bulk') },
    './saleSettlementAction': {
      SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement',
      replaySaleSettlementAction: unexpected('settlement'),
      saleMutationGuard: () => ({ sql: 'SELECT 1' }),
      samePrecisionCompatibleState: () => false,
    },
    './stockSession': { STOCK_SESSION_KIND: 'stock.session', replayStockSession: unexpected('stock session') },
    './saleLineAddition': {
      buildAllocationStatements: () => [],
      buildOperationAllocationStatements: () => [],
      planSaleLineAddition: unexpected('sale add-items'),
      planUnlottedSaleLineGuards: () => [],
      planSaleLineRemoval: unexpected('sale add-items'),
      plannedLineFromRecord: (record) => record,
      saleLineKhrSnapshotStatement: () => ({ sql: 'SELECT 1' }),
      saleMoneyUpdateStatement: () => ({ sql: 'SELECT 1' }),
    },
    './saleAmendments': { amendmentEntryStatement: () => ({ sql: 'SELECT 1' }) },
    './productDelete': {
      PRODUCT_REMOVE_ACTION_KIND: 'product.remove',
      parseProductRemoveSnapshot: (value) => value,
      productRemovePlanDigest: async () => '',
      productRemoveReplayStatements: () => [],
    },
    ...extraStubs,
  }
  const loaded = new Map()
  function loadDependency(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports
    const dependency = { exports: {} }
    loaded.set(filename, dependency)
    const dependencyRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
      if (MONEY_PRECISION_REQUESTS.includes(request)) return moneyPrecision
      if (request.startsWith('.')) {
        return loadDependency(path.resolve(path.dirname(filename), request.endsWith('.ts') ? request : `${request}.ts`))
      }
      return require(request)
    }
    new Function('exports', 'require', 'module', transpile(filename))(dependency.exports, dependencyRequire, dependency)
    return dependency.exports
  }
  if (!Object.prototype.hasOwnProperty.call(stubs, './stockLifecycle')) stubs['./stockLifecycle'] = loadDependency(path.join(LIB_DIR, 'stockLifecycle.ts'))
  for (const name of ['branchWrites', 'customerGenderRestoration', 'saleMoneyPrecision', 'productMergeLineage',
    'promotionRules', 'saleItemPricing', 'catalogCostRecompute', 'actorSnapshot', 'productMerge']) {
    stubs[`./${name}`] = loadDependency(path.join(LIB_DIR, `${name}.ts`))
  }
  // A test that drives the sale add-items replay asks for the real line planner
  // and amendment ledger. saleLineAddition first: saleAmendments imports it.
  if (realSaleModules) {
    for (const name of ['saleLineAddition', 'saleAmendments']) stubs[`./${name}`] = loadDependency(path.join(LIB_DIR, `${name}.ts`))
  }
  const original = Module._load
  Module._load = (request, parent, isMain) => MONEY_PRECISION_REQUESTS.includes(request) ? moneyPrecision
    : Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : original.call(Module, request, parent, isMain)
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(path.join(LIB_DIR, 'undoAppliers.ts'), ts.ScriptTarget.ES2020))(
      mod.exports, require, mod, path.join(LIB_DIR, 'undoAppliers.ts'), LIB_DIR,
    )
  } finally {
    Module._load = original
  }
  return { undoAppliers: mod.exports, branchWrites: stubs['./branchWrites'], db: dbAdapter }
}

module.exports = { loadUndoAppliers }
