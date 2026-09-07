// Regression for a product image uploaded immediately before an atomic stock
// session commit. URL.pathname percent-encodes spaces/Khmer, while file_assets
// stores the literal R2 public path; the session must resolve both identities.
// Run from cloudflare/: node scripts/test-stock-session-image-path-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')

function loadModule(entry) {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (name === './cache') return { bumpVersion: async () => {} }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name.startsWith('./')) return load(`lib/${name.slice(2)}.ts`)
      if (name.startsWith('../')) return load(`${name.slice(3)}.ts`)
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load(entry)
}

function fixture(publicPaths) {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.pragma('foreign_keys = ON')
  sql.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  const insertAsset = sql.prepare("INSERT INTO file_assets(original_name,stored_name,public_path,mime_type,media_type,byte_size) VALUES(?,?,?,?, 'image', 10)")
  for (const publicPath of publicPaths) {
    const storedName = publicPath.slice('/uploads/'.length)
    insertAsset.run(storedName, storedName, publicPath, 'image/webp')
  }
  const wrap = (text, params = []) => ({
    text, params,
    async first() { return sql.prepare(text).get(...params) || null },
    async all() { return { results: sql.prepare(text).all(...params) } },
    async run() {
      const result = sql.prepare(text).run(...params)
      return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    },
  })
  const envDb = {
    prepare(text) {
      const bare = wrap(text)
      return {
        bind(...params) { return wrap(text, params) },
        first: () => bare.first(), all: () => bare.all(), run: () => bare.run(),
      }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((statement) => {
        const result = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  }
  return { sql, env: { DB: envDb } }
}

const user = {
  id: 7, username: 'admin', name: 'Stock User', organization_id: null,
  role_id: null, permissions: JSON.stringify({ all: true }), is_active: 1,
}

async function main() {
  const { commitStockSession } = loadModule('lib/stockSession.ts')
  const literalPaths = [
    '/uploads/Lovenude Lip Stain 7.webp',
    '/uploads/ក្រែម ខ្មែរ.webp',
    '/uploads/100% Pure.webp',
    '/uploads/literal%20name.webp',
    '/uploads/folder%2Fname.webp',
  ]
  const encodedPaths = [
    '/uploads/Lovenude%20Lip%20Stain%207.webp',
    encodeURI('/uploads/ក្រែម ខ្មែរ.webp'),
    '/uploads/100%25%20Pure.webp',
    '/uploads/literal%2520name.webp',
    '/uploads/folder%2Fname.webp',
  ]

  const exactPercentPath = '/uploads/exact%2520identity.webp'
  const decodedPercentPath = '/uploads/exact%20identity.webp'
  const { sql, env } = fixture([...literalPaths, exactPercentPath, decodedPercentPath])
  const product = {
    name: 'Encoded path fixture', barcode: 'ENCODED-PATH-1', cost_price_usd: 1,
    selling_price_usd: 2, stock_quantity: 0, branch_id: 1,
    image_path: encodedPaths[0], image_gallery: [...encodedPaths.slice(1), exactPercentPath],
  }
  const receipt = await commitStockSession(env, user, {
    client_request_id: 'encoded-image-session-1', mode: 'stock_in',
    defaults: { branch_id: 1, received_date: '2026-09-07', supplier_name: 'Fixture supplier' },
    items: [{ line_id: 'encoded-image-line', kind: 'create_receive', quantity: 0, product }],
  })
  assert.equal(receipt.createdCount, 1)
  const saved = sql.prepare("SELECT id,image_path FROM products WHERE barcode='ENCODED-PATH-1'").get()
  assert.equal(saved.image_path, literalPaths[0])
  assert.deepEqual(
    sql.prepare('SELECT image_path FROM product_images WHERE product_id=? ORDER BY sort_order,id').all(saved.id).map((row) => row.image_path),
    [...literalPaths.slice(1), exactPercentPath],
    'all gallery links persist the exact file_assets public_path identities',
  )
  assert.equal(
    sql.prepare('SELECT COUNT(*) count FROM product_images WHERE product_id=? AND image_path=?').get(saved.id, decodedPercentPath).count,
    0,
    'an exact literal %2520 identity wins even when its decoded candidate also exists',
  )
  const retried = await commitStockSession(env, user, {
    client_request_id: 'encoded-image-session-1', mode: 'stock_in',
    defaults: { branch_id: 1, received_date: '2026-09-07', supplier_name: 'Fixture supplier' },
    items: [{ line_id: 'encoded-image-line', kind: 'create_receive', quantity: 0,
      product: { ...product, image_path: literalPaths[0], image_gallery: [...literalPaths.slice(1), exactPercentPath] } }],
  })
  assert.equal(retried.replayed, true, 'fixed-client literal paths retry the legacy encoded request idempotently')
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM stock_session_operations').get().count, 1)
  console.log('PASS encoded upload paths resolve to literal file_assets identities in one atomic stock session')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
