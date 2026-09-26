// S-uploads (owner ruling 2026-09-26, "delete them all"): the owner-run
// ops/scripts/purge-non-media-uploads.mjs keeps images and videos and
// deletes everything else. This pins its classifier (same allowlist as the
// Worker's lib/uploadSecurity.ts) and proves its D1 SQL file's guard
// statements abort on a count mismatch and pass on a match, against a real
// SQLite (node:sqlite). No network, no Cloudflare API, no production state.
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', new Array(40).fill(1))
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(40).fill(2))
const MP4 = bytes([0, 0, 0, 24], 'ftypisom', new Array(40).fill(0))
const MOV = bytes([0, 0, 0, 20], 'ftypqt  ', new Array(40).fill(0))
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], new Array(40).fill(0))
const HEIC = bytes([0, 0, 0, 24], 'ftypheic', new Array(40).fill(0))
const PDF = enc('%PDF-1.7\n1 0 obj\n')
const CSV = enc('name,price\nSerum,1\n')
const ZIP = bytes([0x50, 0x4b, 3, 4], new Array(40).fill(0))
const HTML = enc('<!doctype html><script>alert(1)</script>')
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
const POLYGLOT = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', '<html><body><script>x</script></body></html>')

async function main() {
  const script = await import(pathToFileURL(path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')).href)
  const active = new Set(['live-job'])
  const classify = (key, data) => script.classifyObject({ key, bytes: data, fullScan: true, activeJobIds: active })

  for (const [key, data, category] of [
    ['uploads/a.png', PNG, 'image'], ['uploads/b.jpg', JPEG, 'image'], ['uploads/b2.JPEG', JPEG, 'image'],
    ['uploads/c.mp4', MP4, 'video'], ['uploads/d.mov', MOV, 'video'], ['uploads/e.webm', WEBM, 'video'],
    // Legacy photos are kept (not an XSS risk), counted apart.
    ['uploads/f.heic', HEIC, 'legacy-image'],
    ['imports/live-job/incoming/items.csv', CSV, 'import-file-of-running-job'],
  ]) {
    const verdict = classify(key, data)
    assert.equal(verdict.decision, 'keep', `${key}: ${JSON.stringify(verdict)}`)
    assert.equal(verdict.category, category, key)
  }
  for (const [key, data, category] of [
    ['uploads/invoice.pdf', PDF, 'not-media'], ['uploads/stock.csv', CSV, 'not-media'], ['uploads/x.zip', ZIP, 'not-media'],
    ['uploads/page.html', HTML, 'not-media'], ['uploads/logo.svg', SVG, 'not-media'], ['private/library/r.pdf', PDF, 'not-media'],
    // Media bytes under a name the server serves as something else.
    ['uploads/evil.html', PNG, 'media-bytes-wrong-extension'], ['uploads/noext', PNG, 'media-bytes-wrong-extension'],
    ['uploads/poly.jpg', POLYGLOT, 'image-with-markup'],
    // HTML named .png: bytes decide.
    ['uploads/fake.png', HTML, 'not-media'],
    // Every import file of a finished or missing job, even an image or ZIP.
    ['imports/done-job/incoming/images.zip', ZIP, 'import-file'], ['imports/done-job/incoming/p.png', PNG, 'import-file'],
    ['imports/other/incoming/items.csv', CSV, 'import-file'],
  ]) {
    const verdict = classify(key, data)
    assert.equal(verdict.decision, 'delete', `${key}: ${JSON.stringify(verdict)}`)
    assert.equal(verdict.category, category, key)
  }
  // A large image checked from its header only is kept but labelled.
  assert.equal(script.classifyObject({ key: 'uploads/big.png', bytes: PNG, fullScan: false, activeJobIds: active }).category, 'image-large-header-checked')
  assert.deepEqual(script.PREFIXES, ['uploads/', 'private/', 'imports/'])
  console.log('PASS classifier keeps images/videos (and legacy photos), deletes documents, markup, wrong extensions and finished-job import files')

  // ---- D1 SQL: guards run against a real SQLite.
  assert.equal(script.buildD1Sql({ fileAssetIds: [], importFileIds: [] }), null)
  assert.throws(() => script.buildD1Sql({ fileAssetIds: ['1; DROP TABLE x'], importFileIds: [] }), /non-integer/)
  const fresh = () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE file_assets(id INTEGER PRIMARY KEY, stored_name TEXT);
      CREATE TABLE import_job_files(id INTEGER PRIMARY KEY, job_id TEXT, stored_path TEXT, status TEXT DEFAULT 'stored', file_asset_id INTEGER, updated_at TEXT);
      INSERT INTO file_assets(id, stored_name) VALUES (1,'a.pdf'),(2,'b.csv'),(3,'keep.png');
      INSERT INTO import_job_files(id, job_id, stored_path, file_asset_id) VALUES (10,'j','uploads/b.csv',2),(11,'j','imports/j/incoming/x.csv',NULL),(12,'j','uploads/keep.png',3);`)
    return db
  }
  const sql = script.buildD1Sql({ fileAssetIds: [1, 2], importFileIds: [11] })
  assert.match(sql, /-- pre-assertions[\s\S]*-- changes[\s\S]*-- post-assertions/)
  {
    const db = fresh()
    db.exec(sql)
    assert.deepEqual(db.prepare('SELECT id FROM file_assets ORDER BY id').all().map((r) => r.id), [3])
    assert.deepEqual(db.prepare('SELECT id, status, file_asset_id FROM import_job_files ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 10, status: 'purged', file_asset_id: null },
      { id: 11, status: 'purged', file_asset_id: null },
      { id: 12, status: 'stored', file_asset_id: 3 },
    ])
  }
  {
    // A row the manifest expected is already gone: the pre-assertion must
    // abort before any change.
    const db = fresh()
    db.exec('DELETE FROM file_assets WHERE id = 2')
    assert.throws(() => db.exec(`BEGIN; ${sql} COMMIT;`), /malformed JSON|guard failed/)
    db.exec('ROLLBACK')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM file_assets').get().n, 2, 'nothing deleted when a guard fails')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM import_job_files WHERE status = 'purged'").get().n, 0)
  }
  console.log('PASS D1 SQL file: exact changes on a match; guards abort on a count mismatch; ids are integers only')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
