// A return takes points back only if the sale it refunds earned them (owner standing rule 13 Oct 2026: historical,
// imported old-system sales never accrue loyalty; loyalty_accrual = 0 is how a sale is marked as earning nothing).
//
// Balances are derived by summing ledgers, so the rule lives in ONE shared SQL predicate, customerPointsReturnSql
// (lib/customerPointsReturn.ts), that every reader of the returns term applies. This proves, against the REAL
// migration schema and the REAL transpiled source (no restatement of the SQL):
//   1. the predicate itself, row by row: supplier returns, returns of a non-accruing sale (out); customer returns of an
//      accruing sale, returns that name no sale, NULL scope (in);
//   2. the checkout / reassignment raw balance (rawPointsSql) uses it;
//   3. the reassignment guard's "does this sale affect loyalty" (loyaltyAffectingSaleSql) agrees with it;
//   4. all three readers (customer membership balance in routes/contacts.ts, the loyalty notification in
//      routes/notifications.ts, the raw balance) take the predicate from the one constant -- none hand-copies it.
// The full Worker (auth, routes, native D1) is driven by test-loyalty-nonaccruing-return-native.cjs.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO customers (id, name) VALUES (7, 'Dara')`).run()
const sale = sqlite.prepare(`INSERT INTO sales (id, receipt_number, customer_id, total_usd, total_khr, membership_points_redeemed, sale_status, loyalty_accrual)
  VALUES (@id, @r, 7, @usd, @khr, @redeemed, 'completed', @accrual)`)
sale.run({ id: 11, r: 'R-EARNED', usd: 10, khr: 40000, redeemed: 0, accrual: 1 })
sale.run({ id: 12, r: 'R-HISTORICAL', usd: 90, khr: 360000, redeemed: 0, accrual: 0 })
sale.run({ id: 13, r: 'R-HISTORICAL-REDEEMED', usd: 30, khr: 120000, redeemed: 4, accrual: 0 })
sale.run({ id: 14, r: 'R-EARNED-NO-RETURN', usd: 1, khr: 4000, redeemed: 0, accrual: 1 })
const ret = sqlite.prepare(`INSERT INTO returns (id, return_number, customer_id, sale_id, return_scope, status, total_refund_usd, total_refund_khr)
  VALUES (@id, @n, 7, @sale, @scope, @status, @usd, @khr)`)
ret.run({ id: 1, n: 'RET-HIST', sale: 12, scope: 'customer', status: 'completed', usd: 20, khr: 80000 })       // refund of a non-accruing sale
ret.run({ id: 2, n: 'RET-EARNED', sale: 11, scope: 'customer', status: 'completed', usd: 2, khr: 8000 })       // refund of an accruing sale
ret.run({ id: 3, n: 'RET-NO-SALE', sale: null, scope: 'customer', status: 'completed', usd: 1, khr: 4000 })    // names no sale
ret.run({ id: 4, n: 'RET-NULL-SCOPE', sale: 11, scope: null, status: 'completed', usd: 1, khr: 4000 })        // legacy NULL scope
ret.run({ id: 5, n: 'RET-SUPPLIER', sale: null, scope: 'supplier', status: 'completed', usd: 9, khr: 36000 }) // supplier return
ret.run({ id: 6, n: 'RET-CANCELLED', sale: 11, scope: 'customer', status: 'cancelled', usd: 5, khr: 20000 })   // cancelled
ret.run({ id: 7, n: 'RET-HIST-REDEEMED', sale: 13, scope: 'customer', status: 'completed', usd: 3, khr: 12000 })

// ---- 1. The predicate, row by row ----
const scope = (() => {
  const out = ts.transpileModule(read(path.join('lib', 'customerPointsReturn.ts')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', out)(mod.exports, mod)
  return mod.exports
})()
assert.equal(typeof scope.customerPointsReturnSql, 'string', 'the shared predicate is exported')
const counted = sqlite.prepare(`SELECT id FROM returns WHERE ${scope.customerPointsReturnSql} ORDER BY id`).all().map(r => r.id)
assert.deepEqual(counted, [2, 3, 4, 6],
  'counted returns: accruing-sale refund, no-sale refund, NULL-scope refund (and the cancelled one, which readers drop by status); NOT the non-accruing sale refunds (1, 7) and NOT the supplier return (5)')

// ---- 2. The raw checkout / reassignment balance ----
const guardSource = read(path.join('lib', 'saleCustomerAssignmentGuard.ts'))
const transpiled = (from, to) => ts.transpileModule(guardSource.slice(guardSource.indexOf(from), guardSource.indexOf(to, guardSource.indexOf(from))).replace(/^export function/, 'function'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const rawPointsSql = new Function('customerPointsReturnSql', transpiled('function rawPointsSql(', '\nfunction configCte(') + ';return rawPointsSql;')(scope.customerPointsReturnSql)
const rawBalance = (basis = 'usd', usd = 1.5, khr = 0) => sqlite.prepare(`WITH cfg AS (SELECT ? AS basis,? AS usd,? AS khr) SELECT ${rawPointsSql('7')} AS raw FROM cfg`).get(basis, usd, khr).raw
// earned: 10 + 1 = 11 USD of accruing sales x 1.5 = 16.5; redeemed 4 (on the non-accruing sale 13: still spent);
// returns that count and are not cancelled: RET-EARNED 2 USD + RET-NO-SALE 1 + RET-NULL-SCOPE 1 = 4 USD x 1.5 = 6.
assert.equal(rawBalance(), 16.5 - 4 - 6, 'raw balance: the refunds of the non-accruing sales (20 + 3 USD) take no points back')

// ---- 3. loyaltyAffectingSaleSql agrees ----
const affecting = new Function(transpiled('export function loyaltyAffectingSaleSql(', '\nexport function isLoyaltyAssignmentError') + ';return loyaltyAffectingSaleSql;')()
const isAffecting = (id) => sqlite.prepare(`SELECT ${affecting('s')} AS a FROM sales s WHERE s.id = ?`).get(id).a
assert.equal(isAffecting(11), 1, 'an accruing sale (earned + refunded) affects loyalty')
assert.equal(isAffecting(12), 0, 'a non-accruing sale whose only other fact is a refund affects nothing: the refund takes no points')
assert.equal(isAffecting(13), 1, 'a non-accruing sale that REDEEMED points still affects loyalty (those points are spent)')
assert.equal(isAffecting(14), 1, 'an accruing sale with no return affects loyalty (earned)')

// ---- 4. One source for the predicate ----
const contacts = read(path.join('routes', 'contacts.ts'))
const notifications = read(path.join('routes', 'notifications.ts'))
assert.match(contacts, /FROM returns WHERE customer_id IN \(\$\{placeholders\}\) AND \$\{customerPointsReturnSql\}/, 'customer membership balance reads returns through the shared predicate')
assert.match(notifications, /table: 'returns'[^\n]*\$\{customerPointsReturnSql\}/, 'the loyalty notification reads returns through the shared predicate')
assert.match(guardSource, /FROM returns WHERE customer_id=\$\{accountSql\} AND \$\{customerPointsReturnSql\}/, 'the raw checkout balance reads returns through the shared predicate')
for (const [name, text] of [['contacts.ts', contacts], ['notifications.ts', notifications], ['saleCustomerAssignmentGuard.ts', guardSource]]) {
  assert.ok(!/return_scope/.test(text), `${name} does not hand-copy the return-scope rule; it takes it from customerPointsReturnSql`)
  assert.ok(!/loyalty_accrual\s*=\s*0[\s\S]{0,80}returns|returns[\s\S]{0,80}loyalty_accrual\s*=\s*0/.test(text.replace(/--[^\n]*/g, '')), `${name} does not restate the non-accruing-sale rule`)
}
console.log('PASS a return of a non-accruing sale takes no points back: shared predicate, raw checkout balance, reassignment guard and the three readers agree')
