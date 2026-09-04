const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const source = fs.readFileSync(path.join(__dirname, '../src/routes/sales.ts'), 'utf8')
// Execute the actual list query and actual response mapper. Fail closed if
// either moves or stops being extractable; a copied facsimile is not parity.
const query = source.match(/const sales = await db\.prepare\(`([\s\S]*?linked_driver_name[\s\S]*?)`\)\.all<SaleRow>\(params\)/)?.[1]
assert.ok(query, 'driver-enriched sales list SQL was not found')
const mapStart = source.indexOf('return sales.map((sale) => {')
const mapEnd = source.indexOf('\n    })', mapStart)
assert.ok(mapStart > 0 && mapEnd > mapStart, 'list response mapper was not found')
const mapper = ts.transpileModule(source.slice(mapStart, mapEnd + '\n    })'.length),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const shape = new Function('sales', 'refundsBySale', 'itemsBySale', mapper)
const db = new Database(':memory:')
db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY, membership_number TEXT);
CREATE TABLE delivery_contacts(id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY, customer_id INTEGER, delivery_contact_id INTEGER, is_delivery INTEGER,
delivery_contact_name TEXT, delivery_contact_phone TEXT);
INSERT INTO delivery_contacts VALUES(1,'ដារ៉ា','0012034567');
INSERT INTO sales VALUES(1,NULL,1,1,NULL,'  '),(2,NULL,1,1,'Original name','000123'),
(3,NULL,1,0,NULL,NULL),(4,NULL,99,1,NULL,NULL),(5,NULL,1,1,'','00456');`)
const sql = query.replace("${where.join(' AND ')}", '1=1').replace('${orderSql}', 's.id ASC')
assert.ok(!sql.includes('${'), 'unresolved query template')
const rows = shape(db.prepare(sql).all({limit:20,offset:0}), new Map(), new Map())
assert.equal(rows.length,5)
assert.equal(rows[0].delivery_contact_name,'ដារ៉ា');assert.equal(rows[0].delivery_contact_phone,'0012034567')
assert.equal(rows[1].delivery_contact_name,'Original name');assert.equal(rows[1].delivery_contact_phone,'000123')
assert.equal(rows[2].delivery_contact_name,null);assert.equal(rows[2].delivery_contact_phone,null)
assert.equal(rows[3].delivery_contact_name,null)
assert.equal(rows[4].delivery_contact_name,'ដារ៉ា');assert.equal(rows[4].delivery_contact_phone,'00456')
assert.ok(rows.every(row=>!('linked_driver_name' in row)&&!('linked_driver_phone' in row)))
db.close()
console.log('PASS sale driver: actual SQL/map, linked fallback, immutable snapshot priority, leading zero phone, walk-in and missing contact')
