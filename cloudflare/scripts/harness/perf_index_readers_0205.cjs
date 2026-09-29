'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const CLOUDFLARE_DIR = path.join(__dirname, '..', '..')
const MIGRATION_FILE = '0205_perf_indexes.sql'

const NEW_INDEXES = [
  { name: 'idx_audit_logs_sale_ref', table: 'audit_logs', keys: ['CAST(COALESCE(entity_id, record_id) AS TEXT)'], where: "entity = 'sale' OR table_name = 'sale'" },
  { name: 'idx_audit_logs_entity_id_text', table: 'audit_logs', keys: ['CAST(entity_id AS TEXT)'], where: null },
  { name: 'idx_audit_logs_record_id_text', table: 'audit_logs', keys: ['CAST(record_id AS TEXT)'], where: null },
  { name: 'idx_products_active_expiry', table: 'products', keys: ['is_active', 'expiry_date'], where: 'expiry_date IS NOT NULL' },
  { name: 'idx_product_batches_credit_due', table: 'product_batches', keys: ['credit_due_date'], where: "payment_status = 'credit'" },
  { name: 'idx_product_batches_supplier', table: 'product_batches', keys: ['supplier_id'], where: 'supplier_id IS NOT NULL' },
  { name: 'idx_returns_customer', table: 'returns', keys: ['customer_id'], where: 'customer_id IS NOT NULL' },
  { name: 'idx_returns_supplier', table: 'returns', keys: ['supplier_id'], where: 'supplier_id IS NOT NULL' },
  { name: 'idx_returns_return_number', table: 'returns', keys: ['return_number'], where: null },
  { name: 'idx_sales_delivery_contact_created', table: 'sales', keys: ['delivery_contact_id', 'created_at'], where: 'delivery_contact_id IS NOT NULL' },
  { name: 'idx_customer_share_submissions_customer_status', table: 'customer_share_submissions', keys: ['customer_id', 'status'], where: null },
]

const templateCache = new Map()

function templatesIn(file) {
  if (templateCache.has(file)) return templateCache.get(file)
  const text = fs.readFileSync(path.join(CLOUDFLARE_DIR, file), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found = []
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans.map((span) => `\${${span.expression.getText(source)}}${span.literal.text}`)
      found.push({ text: node.head.text + spans.join(''), line: lineOf(node), start: node.getStart(source), end: node.getEnd() })
    } else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
      found.push({ text: node.text, line: lineOf(node), start: node.getStart(source), end: node.getEnd() })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  templateCache.set(file, found)
  return found
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function quoteSql(file, anchor) {
  const wanted = normalizeSql(anchor)
  const matches = templatesIn(file).filter((template) => normalizeSql(template.text).includes(wanted))
  if (!matches.length) throw new Error(`${file}: no SQL literal contains "${anchor}"; the reader moved or changed, so re-point this pin`)
  const encloses = (outer, inner) => outer !== inner && outer.start <= inner.start && inner.end <= outer.end
  const innermost = matches.filter((outer) => !matches.some((inner) => encloses(outer, inner)))
  if (new Set(innermost.map((template) => template.text)).size !== 1) throw new Error(`${file}: "${anchor}" matches ${innermost.length} different SQL literals (lines ${innermost.map((t) => t.line).join(', ')}); make the anchor unique`)
  return innermost[0]
}

function fillSql(quoted, fills = {}) {
  const unfilled = new Set()
  const sql = quoted.replace(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, expression) => {
    if (!(expression in fills)) {
      unfilled.add(expression)
      return ''
    }
    const fill = fills[expression]
    return typeof fill === 'function' ? fill() : fill
  })
  if (unfilled.size) throw new Error(`no fill for \${${[...unfilled].join('}, ${')}}`)
  return sql
}

const moduleCache = new Map()

function loadPureModule(relativeFile) {
  const file = path.join(CLOUDFLARE_DIR, relativeFile)
  if (moduleCache.has(file)) return moduleCache.get(file).exports
  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(file),
  })
  const localRequire = (request) => {
    if (!request.startsWith('.')) throw new Error(`${relativeFile} imports ${request}: only pure relative modules load here`)
    return loadPureModule(path.relative(CLOUDFLARE_DIR, path.join(path.dirname(file), `${request}.ts`)))
  }
  new Function('require', 'module', 'exports', outputText)(localRequire, mod, mod.exports)
  return mod.exports
}

function renderReader(reader) {
  const quote = quoteSql(reader.file, reader.anchor)
  const sql = reader.render ? reader.render() : fillSql(quote.text, reader.fills)
  return { line: quote.line, sql: reader.wrap ? reader.wrap(sql) : sql }
}

const guardFile = 'src/lib/saleCustomerAssignmentGuard.ts'
const mergeFile = 'src/lib/contactMerge.ts'
const quoted = (file, anchor) => quoteSql(file, anchor).text
const rawPoints = (account) => fillSql(quoted(guardFile, 'FROM returns WHERE customer_id=${accountSql}'), { accountSql: account })
const configCte = () => fillSql(quoted(guardFile, 'cfg AS (SELECT @basis AS basis'), { settingsSql: "'exchange_rate'" })
const settingsMatch = () => quoted(guardFile, 'NOT EXISTS(SELECT key,value FROM actual_settings EXCEPT')
const idList = '?, ?, ?'
const recordTrailFilter = () => loadPureModule('src/lib/auditLogQuery.ts').buildAuditLogFilters({ entity: 'product', entityId: '42' }).where
const unfilteredAuditLog = () => loadPureModule('src/lib/auditLogQuery.ts').buildAuditLogFilters({}).where
const dateRange = (column) => loadPureModule('src/lib/businessDateWindow.ts').localDateRangeClause(column)
const mergeMovedById = (table, column) => fillSql(quoted(mergeFile, 'json_group_array(json_array(id, ${column}))'), {
  column, movedTable: table, 'listOf(`m${index}_`, mergedIds)': '@m0_0, @m0_1',
})
const analyticsFile = 'src/lib/salesAnalytics.ts'
const oneContactDeliveries = () => [
  dateRange('sales.created_at'),
  fillSql(quoted(analyticsFile, "COALESCE(${alias}.sale_status, 'completed') <> 'cancelled'"), { alias: 'sales' }),
  quoted(analyticsFile, 'COALESCE(sales.is_delivery, 0) = 1'),
  quoted(analyticsFile, 'sales.delivery_contact_id = @contactId'),
].join(' AND ')
const lotMatches = (anchor) => () => quoted('src/lib/undoAppliers.ts', anchor)
const usesIndex = (table, index, seek) => new RegExp(`(SEARCH|SCAN) ${table} USING (COVERING )?INDEX ${index}${seek ? ` \\(${seek.replace(/[?()]/g, '\\$&')}\\)` : '\\b'}`)

const contactsReader = ([id, anchor, index, table, seek]) => ({ id, file: 'src/routes/contacts.ts', anchor, index, plan: usesIndex(table, index, seek) })
const mergeReader = ([id, anchor, index, table, seek]) => ({ id, file: mergeFile, anchor, index, plan: usesIndex(table, index, seek) })

const READERS = [
  {
    id: 'settle: saleAllowsPaymentCorrection',
    file: 'src/routes/sales.ts',
    anchor: 'SELECT action, details FROM audit_logs',
    index: 'idx_audit_logs_sale_ref',
    plan: usesIndex('audit_logs', 'idx_audit_logs_sale_ref', '<expr>=?'),
    noTempSort: true,
  },
  {
    id: 'sales list: payment_correction_allowed (Not-paid page)',
    file: 'src/routes/sales.ts',
    anchor: 'END AS payment_correction_allowed',
    fills: { "where.join(' AND ')": () => `1=1 AND ${quoted('src/routes/sales.ts', 's.sale_status = @status')}`, orderSql: 's.created_at DESC, s.id DESC' },
    index: 'idx_audit_logs_sale_ref',
    plan: usesIndex('a', 'idx_audit_logs_sale_ref', '<expr>=?'),
    noTempSort: true,
  },
  {
    id: 'audit float: COUNT for one record (entity + entityId)',
    file: 'src/routes/compat.ts',
    anchor: 'SELECT COUNT(*) AS count FROM audit_logs ${where}',
    fills: { where: recordTrailFilter },
    index: ['idx_audit_logs_entity_id_text', 'idx_audit_logs_record_id_text'],
    plan: /MULTI-INDEX OR.*SEARCH audit_logs USING INDEX idx_audit_logs_entity_id_text \(<expr>=\?\).*SEARCH audit_logs USING INDEX idx_audit_logs_record_id_text \(<expr>=\?\)/,
  },
  {
    id: 'audit float: page for one record (entity + entityId)',
    file: 'src/routes/compat.ts',
    anchor: 'user_name AS username,',
    fills: { where: recordTrailFilter },
    index: ['idx_audit_logs_entity_id_text', 'idx_audit_logs_record_id_text'],
    plan: /MULTI-INDEX OR.*SEARCH audit_logs USING INDEX idx_audit_logs_entity_id_text \(<expr>=\?\).*SEARCH audit_logs USING INDEX idx_audit_logs_record_id_text \(<expr>=\?\)/,
  },
  {
    id: 'return detail: audit rows (return + return_create)',
    file: 'src/lib/returnRecords.ts',
    anchor: "OR (entity = 'return_create' AND CAST(record_id AS TEXT) = @idText)",
    index: 'idx_audit_logs_record_id_text',
    plan: /MULTI-INDEX OR.*idx_audit_logs_entity_entity_id \(entity=\? AND entity_id=\?\).*SEARCH audit_logs USING INDEX idx_audit_logs_record_id_text \(<expr>=\?\)/,
  },
  {
    id: 'bell: expiry section',
    file: 'src/routes/notifications.ts',
    anchor: "AND julianday(expiry_date) - julianday('now') <= @days",
    index: 'idx_products_active_expiry',
    plan: usesIndex('products', 'idx_products_active_expiry', 'is_active=? AND expiry_date>?'),
    noTempSort: true,
    orderBy: true,
  },
  {
    id: 'dashboard: expiring products card',
    file: 'src/routes/compat.ts',
    anchor: 'ORDER BY date(expiry_date) ASC LIMIT 10',
    index: 'idx_products_active_expiry',
    plan: usesIndex('p', 'idx_products_active_expiry', 'is_active=? AND expiry_date>?'),
  },
  {
    id: 'dashboard: expiring products count',
    file: 'src/routes/compat.ts',
    anchor: 'SELECT COUNT(*) AS count FROM products p WHERE p.is_active = 1 AND expiry_date IS NOT NULL',
    index: 'idx_products_active_expiry',
    plan: usesIndex('p', 'idx_products_active_expiry', 'is_active=? AND expiry_date>?'),
  },
  {
    id: 'dashboard insight: expiring products list',
    file: 'src/routes/compat.ts',
    anchor: 'ORDER BY date(expiry_date) ASC LIMIT ${DASHBOARD_INSIGHT_LIST_LIMIT}',
    fills: { DASHBOARD_INSIGHT_LIST_LIMIT: '50' },
    index: 'idx_products_active_expiry',
    plan: usesIndex('p', 'idx_products_active_expiry', 'is_active=? AND expiry_date>?'),
  },
  {
    id: 'bell: supplier credit section',
    file: 'src/routes/notifications.ts',
    anchor: "AND pb.payment_status = 'credit'",
    index: 'idx_product_batches_credit_due',
    plan: usesIndex('pb', 'idx_product_batches_credit_due'),
    noTempSort: true,
    orderBy: true,
  },
  {
    id: 'checkout: points redemption guard (returns + submissions halves)',
    file: guardFile,
    anchor: "balance AS (SELECT ${rawPointsSql('@customer')} AS raw FROM cfg)",
    fills: { 'configCte()': configCte, "rawPointsSql('@customer')": () => rawPoints('@customer'), settingsMatch },
    index: ['idx_returns_customer', 'idx_customer_share_submissions_customer_status'],
    plan: /SEARCH returns USING INDEX idx_returns_customer \(customer_id=\?\).*SEARCH customer_share_submissions USING INDEX idx_customer_share_submissions_customer_status \(customer_id=\? AND status=\?\)/,
  },
  {
    id: 'sale customer reassignment: balances (returns + submissions halves)',
    file: guardFile,
    anchor: "balances AS (SELECT accounts.id,${rawPointsSql('accounts.id')} AS raw FROM accounts CROSS JOIN cfg)",
    fills: { 'configCte()': configCte, "rawPointsSql('accounts.id')": () => rawPoints('accounts.id') },
    wrap: (cte) => `${cte} SELECT raw FROM balances`,
    index: ['idx_returns_customer', 'idx_customer_share_submissions_customer_status'],
    plan: /SEARCH returns USING INDEX idx_returns_customer \(customer_id=\?\).*SEARCH customer_share_submissions USING INDEX idx_customer_share_submissions_customer_status \(customer_id=\? AND status=\?\)/,
  },
  ...[
    ['customers list: points map, returns', 'SELECT customer_id, status, total_refund_usd, total_refund_khr FROM returns WHERE customer_id IN (${placeholders})', 'idx_returns_customer', 'returns', 'customer_id=?'],
    ['customers list: points map, submissions', 'SELECT customer_id, status, reward_points FROM customer_share_submissions WHERE customer_id IN (${placeholders})', 'idx_customer_share_submissions_customer_status', 'customer_share_submissions', 'customer_id=?'],
    ['customers list: returns count', 'SELECT customer_id, COUNT(*) as cnt FROM returns WHERE customer_id IN (${placeholders}) GROUP BY customer_id', 'idx_returns_customer', 'returns', 'customer_id=?'],
    ['suppliers list: returns count', 'SELECT supplier_id as id, COUNT(*) as cnt FROM returns WHERE supplier_id IN (${placeholders}) GROUP BY supplier_id', 'idx_returns_supplier', 'returns', 'supplier_id=?'],
    ['delivery contacts duplicates panel: sales count', 'SELECT delivery_contact_id as id, COUNT(*) as cnt FROM sales WHERE delivery_contact_id IN (${placeholders}) GROUP BY delivery_contact_id', 'idx_sales_delivery_contact_created', 'sales', 'delivery_contact_id=?'],
  ].map(contactsReader).map((reader) => ({ ...reader, fills: { placeholders: idList } })),
  ...[
    ['delete preview: customer returns', 'SELECT COUNT(*) AS n FROM returns WHERE customer_id = @id', 'idx_returns_customer', 'returns', 'customer_id=?'],
    ['delete preview: customer submissions', 'SELECT COUNT(*) AS n FROM customer_share_submissions WHERE customer_id = @id', 'idx_customer_share_submissions_customer_status', 'customer_share_submissions', 'customer_id=?'],
    ['delete preview: supplier returns', 'SELECT COUNT(*) AS n FROM returns WHERE supplier_id = @id', 'idx_returns_supplier', 'returns', 'supplier_id=?'],
    ['delete preview: supplier batches', 'SELECT COUNT(*) AS n FROM product_batches WHERE supplier_id = @id', 'idx_product_batches_supplier', 'product_batches', 'supplier_id=?'],
    ['delete preview: delivery sales', 'SELECT COUNT(*) AS n FROM sales WHERE delivery_contact_id = @id', 'idx_sales_delivery_contact_created', 'sales', 'delivery_contact_id=?'],
    ['customer edit: returns name carry', 'UPDATE returns SET customer_name = @name WHERE customer_id = @id', 'idx_returns_customer', 'returns', 'customer_id=?'],
    ['customer edit: submissions name carry', 'UPDATE customer_share_submissions SET customer_name = @name WHERE customer_id = @id', 'idx_customer_share_submissions_customer_status', 'customer_share_submissions', 'customer_id=?'],
    ['supplier rename: returns name carry', 'UPDATE returns SET supplier_name = @name WHERE supplier_id = @id', 'idx_returns_supplier', 'returns', 'supplier_id=?'],
    ['supplier rename: batches name carry', 'UPDATE product_batches SET supplier_name = @name WHERE supplier_id = @id', 'idx_product_batches_supplier', 'product_batches', 'supplier_id=?'],
    ['delivery rename: sales name carry', 'UPDATE sales SET delivery_contact_name = @name WHERE delivery_contact_id = @id', 'idx_sales_delivery_contact_created', 'sales', 'delivery_contact_id=?'],
  ].map(contactsReader),
  ...[
    ['merge: returns repoint (customer)', 'UPDATE returns SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', 'idx_returns_customer', 'returns', 'customer_id=?'],
    ['merge: submissions repoint', 'UPDATE customer_share_submissions SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', 'idx_customer_share_submissions_customer_status', 'customer_share_submissions', 'customer_id=?'],
    ['merge: returns repoint (supplier)', 'UPDATE returns SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', 'idx_returns_supplier', 'returns', 'supplier_id=?'],
    ['merge: batches repoint', 'UPDATE product_batches SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', 'idx_product_batches_supplier', 'product_batches', 'supplier_id=?'],
    ['merge: sales repoint (delivery)', 'UPDATE sales SET delivery_contact_id = @keepId, delivery_contact_name = @keeperName WHERE delivery_contact_id = @mergeId', 'idx_sales_delivery_contact_created', 'sales', 'delivery_contact_id=?'],
  ].map(mergeReader),
  ...[
    ['returns', 'customer_id', 'idx_returns_customer'],
    ['customer_share_submissions', 'customer_id', 'idx_customer_share_submissions_customer_status'],
    ['returns', 'supplier_id', 'idx_returns_supplier'],
    ['product_batches', 'supplier_id', 'idx_product_batches_supplier'],
    ['sales', 'delivery_contact_id', 'idx_sales_delivery_contact_created'],
  ].map(([table, column, index]) => ({
    id: `merge audit: rows moved by id (${table}.${column})`,
    file: mergeFile,
    anchor: 'json_group_array(json_array(id, ${column}))',
    render: () => `SELECT ${mergeMovedById(table, column)}`,
    index,
    plan: usesIndex(table, index, `${column}=?`),
  })),
  {
    id: 'portal: daily submission cap',
    file: 'src/routes/portal.ts',
    anchor: 'SELECT COUNT(*) AS n FROM customer_share_submissions WHERE customer_id = @cid AND created_at >= @cutoff',
    index: 'idx_customer_share_submissions_customer_status',
    plan: usesIndex('customer_share_submissions', 'idx_customer_share_submissions_customer_status', 'customer_id=?'),
  },
  {
    id: 'customer return: RET number probe',
    file: 'src/routes/returns.ts',
    anchor: 'SELECT 1 AS hit FROM returns WHERE return_number=? LIMIT 1',
    index: 'idx_returns_return_number',
    plan: usesIndex('returns', 'idx_returns_return_number', 'return_number=?'),
  },
  {
    id: 'supplier return: SRET number probe',
    file: 'src/routes/returns.ts',
    anchor: 'SELECT 1 AS hit FROM returns WHERE return_number = ? LIMIT 1',
    index: 'idx_returns_return_number',
    plan: usesIndex('returns', 'idx_returns_return_number', 'return_number=?'),
  },
  ...[
    ['reports: delivery totals for one contact', 'COUNT(*) AS deliveries,'],
    ['reports: delivery fees by payment method for one contact', "COALESCE(SUM(${customerDeliveryFeeExpr('')}), 0) AS fee_usd"],
  ].map(([id, anchor]) => ({
    id,
    file: analyticsFile,
    anchor,
    fills: { "collectedSaleExpr('')": '1', "customerDeliveryFeeExpr('')": '0', "awaitingExpr('')": '0', "clauses.join(' AND ')": oneContactDeliveries },
    index: 'idx_sales_delivery_contact_created',
    plan: usesIndex('sales', 'idx_sales_delivery_contact_created', 'delivery_contact_id=? AND created_at>? AND created_at<?'),
  })),
]

// Readers of the indexed tables whose plan must not move, or may move only as
// `accept` says: the NULL-side supplier lookups a full supplier_id index would
// capture, and whole-table reads.
const CONTROLS = [
  {
    id: 'supplier purchases float: totals (supplier id OR unlinked name)',
    file: 'src/routes/contacts.ts',
    anchor: 'SUM(CASE WHEN pb.received_cost_usd IS NULL THEN 1 ELSE 0 END) AS batches_without_cost',
    fills: { purchasesWhere: () => quoted('src/routes/contacts.ts', '(pb.supplier_id = @id') },
  },
  {
    id: 'merge audit: unlinked batches moved by name',
    file: mergeFile,
    anchor: "'${movedTable}_by_name', json((SELECT json_group_array(json_array(id, ${textColumn})) FROM ${movedTable}",
    fills: {
      movedTable: 'product_batches', textColumn: 'supplier_name',
      "unlinked ? `${unlinked} AND ` : ''": 'supplier_id IS NULL AND ', 'listOf(`n${index}_`, renamedFrom)': '@n0_0',
    },
    wrap: (pair) => `SELECT json_object(${pair})`,
  },
  {
    id: 'merge: unlinked batches renamed',
    file: mergeFile,
    anchor: 'UPDATE product_batches SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower',
  },
  {
    id: 'supplier backfill: unlinked lots of one product',
    file: 'src/routes/products.ts',
    anchor: 'WHERE variant_product_id = @productId AND is_active = 1 AND supplier_id IS NULL${narrow}',
    fills: { narrow: '' },
  },
  ...['b.supplier_id IS @supplierId', "b.supplier_id IS json_extract(l.value, '$.prevSupplierId')"].map((matches) => ({
    id: `supplier backfill undo/redo stale-lot guard (${matches.slice(0, 26)}...)`,
    file: 'src/lib/undoAppliers.ts',
    anchor: 'SELECT json_extract(l.value, \'$.id\') AS id FROM json_each(@lots) l',
    fills: { 'supplierBackfillLotMatchesSql(direction)': lotMatches(matches) },
  })),
  {
    id: 'stock ledger COUNT filtered by supplier',
    file: 'src/lib/stockLedgerQuery.ts',
    anchor: 'SELECT COUNT(*) AS total${LEDGER_FROM}',
    render: () => loadPureModule('src/lib/stockLedgerQuery.ts').buildStockLedgerQuery({ supplierId: 5 }).countSql,
  },
  {
    id: 'customer return: in-batch number guard (client_request_id OR return_number; PERF-predicates L16 residual)',
    file: 'src/routes/returns.ts',
    anchor: 'AND NOT EXISTS(SELECT 1 FROM returns WHERE client_request_id=@requestId OR return_number=@returnNumber)',
    wrap: (precondition) => `SELECT CASE WHEN ${precondition} THEN 1 ELSE 0 END`,
    fills: { 'customerReturnAuthorityPredicate()': '1', "customerReturnV1Plan?.lineage.condition ?? '1=1'": '1=1' },
  },
  {
    id: 'bell: loyalty returns grouped by customer',
    file: 'src/routes/notifications.ts',
    anchor: "SELECT customer_id, COALESCE(SUM(COALESCE(total_refund_usd, 0)), 0) AS refunds_usd",
    accept: { plan: /idx_returns_customer/, why: 'a whole-table GROUP BY customer_id may walk the new index instead of sorting; same rows read' },
  },
  {
    id: 'bell: loyalty submissions grouped by customer',
    file: 'src/routes/notifications.ts',
    anchor: 'SELECT customer_id, COALESCE(SUM(COALESCE(reward_points, 0)), 0) AS rewarded',
    accept: { plan: /idx_customer_share_submissions_customer_status/, why: 'a whole-table GROUP BY customer_id may walk the new index instead of sorting; same rows read' },
  },
  {
    id: 'audit log page, no filter',
    file: 'src/routes/compat.ts',
    anchor: 'user_name AS username,',
    fills: { where: unfilteredAuditLog },
  },
  {
    id: 'audit log COUNT, no filter',
    file: 'src/routes/compat.ts',
    anchor: 'SELECT COUNT(*) AS count FROM audit_logs ${where}',
    fills: { where: unfilteredAuditLog },
    accept: { plan: /COVERING INDEX idx_audit_logs_(entity_id|record_id)_text/, why: 'COUNT(*) counts through the narrowest full index; the new one-column indexes are narrower than 0196\'s' },
  },
]

module.exports = {
  CLOUDFLARE_DIR,
  CONTROLS,
  MIGRATION_FILE,
  NEW_INDEXES,
  READERS,
  normalizeSql,
  renderReader,
}
