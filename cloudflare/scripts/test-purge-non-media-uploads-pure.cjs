// S-uploads (owner ruling 2026-09-26, "delete them all"): the owner-run
// ops/scripts/purge-non-media-uploads.mjs keeps images and videos and
// removes everything else.
//
// S-uploads2a fix 1: the BYTES decide, never the name. A refuter showed the
// first version would have deleted real photos and videos: JPEGs saved as
// .jfif, .jpe or blob-*.bin, a PNG with no extension, an .m4v, QuickTime
// movies that start with a wide/mdat/moov/free/skip atom -- and their
// Library rows. Pinned here, against the shared fixture catalogue
// (harness/upload_fixtures.cjs):
//   - every photo, video or recording is KEPT whatever it is called, and so
//     is every other photo/video/audio format (HEIC, BMP, TIFF, raw, M4A...);
//   - media under a misleading name is kept and listed as such;
//   - unrecognised and empty files, images carrying web-page code and
//     compressed objects go to REVIEW (kept);
//   - only documents, web pages, text, archives and programs are purged;
//   - a Library row is never removed while any file it points at is kept;
//   - the D1 SQL guards abort on a count mismatch (real SQLite).
// No network, no Cloudflare API, no production state. Every failure is
// listed before the exit code is set; to run against an older script:
//   PURGE_SCRIPT=/tmp/purge.mjs node test-purge-non-media-uploads-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const F = require('./harness/upload_fixtures.cjs')

const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')
const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

// The owner's rule, stated here rather than read from the script under test.
const EXPECTED_ACTION = {
  images: 'keep', videos: 'keep', 'unusual-name': 'keep', 'misleading-name': 'keep', 'other-images': 'keep',
  'other-video-audio': 'keep', 'running-import': 'keep',
  'image-with-code': 'review', compressed: 'review', unrecognised: 'review', empty: 'review',
  documents: 'purge', 'web-pages': 'purge', text: 'purge', archives: 'purge', programs: 'purge',
}
const KEEP_MEDIA_GROUPS = ['images', 'videos', 'unusual-name', 'misleading-name', 'other-images', 'other-video-audio']
const HOSTILE_NAMES = ['.html', '.htm', '.svg', '.xml', '.js', '.pdf', '.txt', '.csv', '.json', '.zip', '.exe', '.php', '']
const UNUSUAL_NAMES = ['.jfif', '.jpe', '.bin', '.dat', '.tmp', '.m4v', '.qt', '.3gp', '.heic', '']

async function main() {
  const script = await import(pathToFileURL(PURGE_SOURCE).href)
  const active = new Set(['live-job'])
  const classify = (key, data, extra = {}) => script.classifyObject({ key, size: data.length, bytes: data, complete: true, activeJobIds: active, ...extra })
  const catalogue = F.catalogue()
  const groupAction = new Map(Object.entries(EXPECTED_ACTION))

  // ---------------------------------------------- 1. catalogue verdicts
  for (const entry of catalogue) {
    check(`${entry.name} (${entry.key}) -> ${entry.group}`, () => {
      const verdict = classify(entry.key, entry.bytes)
      assert.equal(verdict.group, entry.group, JSON.stringify(verdict))
      assert.equal(verdict.action, groupAction.get(entry.group), 'action matches its group')
    })
  }
  check('the refuter probes are all present and kept', () => {
    const probes = catalogue.filter((entry) => entry.name.startsWith('probe:'))
    assert.equal(probes.length, 10)
    for (const probe of probes) assert.equal(classify(probe.key, probe.bytes).action, 'keep', probe.name)
  })
  check("groups: the script's groups and actions are exactly the owner's rule", () => {
    assert.deepEqual(Object.fromEntries((script.GROUPS || []).map((group) => [group.id, group.action])), EXPECTED_ACTION)
  })

  // --------------------------- 2. bytes decide: media under any name
  const mediaEntries = catalogue.filter((entry) => KEEP_MEDIA_GROUPS.includes(entry.group))
  for (const entry of mediaEntries) {
    check(`${entry.name}: kept under every name and prefix`, () => {
      for (const prefix of ['uploads/', 'private/library/', 'imports/done-job/incoming/']) {
        for (const extension of [...HOSTILE_NAMES, ...UNUSUAL_NAMES, '.jpg', '.mp4']) {
          const verdict = classify(`${prefix}file${extension}`, entry.bytes)
          assert.equal(verdict.action, 'keep', `${prefix}file${extension}: ${JSON.stringify(verdict)}`)
          assert.ok(KEEP_MEDIA_GROUPS.includes(verdict.group), verdict.group)
          if (extension && HOSTILE_NAMES.includes(extension)) assert.equal(verdict.group, 'misleading-name', `${extension} is a misleading name`)
        }
      }
    })
  }
  check('a HEIC, BMP and TIFF are photos: kept on their own line, never review or purge', () => {
    for (const [label, data] of [['HEIC', F.heic()], ['HEIF mif1', F.heifMif1()], ['BMP', F.bmp()], ['TIFF II', F.tiffLe()], ['TIFF MM', F.tiffBe()]]) {
      const verdict = classify(`uploads/photo-${label}.bin`, data)
      assert.equal(verdict.group, 'other-images', `${label}: ${JSON.stringify(verdict)}`)
    }
  })
  const purgeEntries = catalogue.filter((entry) => groupAction.get(entry.group) === 'purge')
  for (const entry of purgeEntries) {
    check(`${entry.name}: purged under an image or video name too`, () => {
      for (const extension of ['.jpg', '.png', '.mp4', '.mov', '']) {
        const verdict = classify(`uploads/file${extension}`, entry.bytes)
        assert.equal(verdict.group, entry.group, `${extension}: ${JSON.stringify(verdict)}`)
      }
    })
  }

  // ------------------------------------ 3. partial reads and review
  check('a large image checked from its first 4 KB is kept, and says so', () => {
    const big = F.jpeg({ scan: F.randomBytes(F.mulberry32(5), 200000) })
    const head = big.subarray(0, script.HEAD_BYTES)
    const verdict = script.classifyObject({ key: 'uploads/big.jpg', size: big.length, bytes: head, complete: false, activeJobIds: active })
    assert.equal(verdict.group, 'images')
    assert.equal(verdict.checked, `first ${script.HEAD_BYTES} bytes`)
  })
  check('heads of large media stay media; heads of large documents stay purgeable', () => {
    const cases = [
      ['uploads/long.mov', F.quickTime('wide'), 'videos'],
      ['uploads/big.mp4', F.bytes(F.ftyp('isom', 'isom'), F.u32be(900000), 'mdat', F.randomBytes(F.mulberry32(6), 8000)), 'videos'],
      ['uploads/big.heic', F.bytes(F.heic(), F.randomBytes(F.mulberry32(7), 8000)), 'other-images'],
      ['uploads/big.pdf', F.bytes(F.pdf(), F.randomBytes(F.mulberry32(8), 8000)), 'documents'],
      ['uploads/big.zip', F.bytes(F.zip(), F.randomBytes(F.mulberry32(9), 8000)), 'archives'],
      // A Khmer CSV whose 4 KB head ends in the middle of a character.
      ['uploads/big.csv', F.enc(`${'x'.repeat(4095)}ឈ្មោះ,តម្លៃ\n`.repeat(3)), 'text'],
    ]
    for (const [key, data, group] of cases) {
      const verdict = script.classifyObject({ key, size: data.length + 1000000, bytes: data.subarray(0, script.HEAD_BYTES), complete: false, activeJobIds: active })
      assert.equal(verdict.group, group, `${key}: ${JSON.stringify(verdict)}`)
    }
  })
  check('an object stored compressed is never judged or purged', () => {
    const verdict = classify('uploads/page.html', F.html(), { contentEncoding: 'gzip' })
    assert.equal(verdict.group, 'compressed')
    assert.equal(verdict.action, 'review')
  })
  check('a failed read is unrecognised, not empty', () => {
    const verdict = script.classifyObject({ key: 'uploads/x.pdf', size: 500, bytes: new Uint8Array(0), complete: false, activeJobIds: active })
    assert.equal(verdict.group, 'unrecognised')
  })
  check('an import file of a running job is kept whatever it is', () => {
    for (const data of [F.pdf(), F.html(), F.zip(), F.randomBytes(F.mulberry32(10), 100)]) {
      assert.equal(classify('imports/live-job/incoming/x', data).group, 'running-import')
    }
  })
  check('text strictness: binary, NUL, control bytes and BOM-less UTF-16 are not text', () => {
    assert.equal(script.decodeText(F.enc('name,price\nSerum,1\n')), 'name,price\nSerum,1\n')
    assert.equal(script.decodeText(F.enc('a\u0000b')), null)
    assert.equal(script.decodeText(F.bytes('abc', [0x07], 'def')), null)
    assert.equal(script.decodeText(F.utf16le('abc')), null)
    assert.equal(script.decodeText(F.randomBytes(F.mulberry32(11), 64)), null)
    assert.equal(script.decodeText(F.bytes([0x80, 0x81, 0x82])), null, 'mostly non-ASCII 8-bit bytes')
    assert.equal(script.decodeText(F.bytes('old dos file\r\n', [0x1a])), 'old dos file\r\n', 'a trailing DOS end-of-file byte')
  })

  // ---------------------------------- 4. Library and import rows
  check('rows: a Library row survives while any file it points at is kept', () => {
    const entries = [
      { key: 'uploads/photo.jfif', action: 'keep' },
      { key: 'uploads/invoice.pdf', action: 'purge' },
      { key: 'uploads/dup.pdf', action: 'keep' },
      { key: 'private/library/dup.pdf', action: 'purge' },
      { key: 'uploads/blob.dat', action: 'review' },
      { key: 'imports/done-job/incoming/items.csv', action: 'purge' },
      { key: 'imports/done-job/incoming/p.jpg', action: 'keep' },
    ]
    const assetRows = [
      { id: 1, stored_name: 'photo.jfif', public_path: '/uploads/photo.jfif' },
      { id: 2, stored_name: 'invoice.pdf', public_path: '/uploads/invoice.pdf' },
      { id: 3, stored_name: 'dup.pdf', public_path: '/uploads/dup.pdf' },
      { id: 4, stored_name: 'blob.dat', public_path: '/uploads/blob.dat' },
      { id: 5, stored_name: 'gone.pdf', public_path: '/uploads/gone.pdf' },
    ]
    const jobFileRows = [
      { id: 10, stored_path: 'uploads/invoice.pdf', file_asset_id: 2 },
      { id: 11, stored_path: 'imports/done-job/incoming/items.csv', file_asset_id: null },
      { id: 12, stored_path: 'imports/done-job/incoming/p.jpg', file_asset_id: null },
      { id: 13, stored_path: 'uploads/photo.jfif', file_asset_id: 1 },
    ]
    const plan = script.planRowChanges(entries, assetRows, jobFileRows)
    assert.deepEqual(plan.fileAssetIds, [2], 'only the purged invoice; the kept photo, the dup with a kept image, the review file and a missing file stay')
    assert.deepEqual(plan.importFileIds, [11], 'the purged import CSV; row 10 goes with its Library row')
  })

  // -------------------------------------------------- 5. the report
  check('the dry-run report has one line per group, with the owner-facing wording', () => {
    const entries = catalogue.map((entry) => ({ key: entry.key, size: entry.bytes.length, ...classify(entry.key, entry.bytes) }))
    const lines = script.formatReport(entries, { purgeTitle: 'PURGE', rowPlan: { fileAssetIds: [1, 2], importFileIds: [3] }, manifestPath: '/tmp/manifest.json' })
    const text = lines.join('\n')
    assert.match(text, /media with a misleading name: kept/)
    assert.match(text, /photos in formats not every browser shows \(HEIC\/BMP\/TIFF\): kept/)
    assert.match(text, /images containing web-page code: kept, check them/)
    assert.match(text, /files of a type this script does not recognise: kept, check them/)
    assert.match(text, /\n {26}uploads\/evil\.html {2}\(image\/png\)/, 'misleading names are listed by key')
    assert.match(text, /\n {26}uploads\/blob\.dat/, 'unrecognised files are listed by key')
    const unusualLine = lines.find((line) => line.includes('images and videos with an unusual or no file extension: kept')) || ''
    for (const count of ['.jfif 1', '.jpe 1', '.m4v 1', '.bin 1', '(none) 1']) assert.ok(unusualLine.includes(count), `unusual extensions are counted: ${count} in ${unusualLine}`)
    assert.ok(!/unknown/.test(lines.find((line) => line.includes('empty files')) || ''), 'no meaningless breakdown on the empty line')
    for (const group of script.GROUPS) assert.ok(text.includes(group.label), `a line for ${group.id}`)
    assert.match(text, /Library rows of these files: 2/)
  })

  // ------------------------------------------ 6. D1 SQL (real SQLite)
  check('D1 SQL: exact changes on a match; guards abort on a count mismatch; ids are integers only', () => {
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
    const db = fresh()
    db.exec(sql)
    assert.deepEqual(db.prepare('SELECT id FROM file_assets ORDER BY id').all().map((r) => r.id), [3])
    assert.deepEqual(db.prepare('SELECT id, status, file_asset_id FROM import_job_files ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 10, status: 'purged', file_asset_id: null },
      { id: 11, status: 'purged', file_asset_id: null },
      { id: 12, status: 'stored', file_asset_id: 3 },
    ])
    const short = fresh()
    short.exec('DELETE FROM file_assets WHERE id = 2')
    assert.throws(() => short.exec(`BEGIN; ${sql} COMMIT;`), /malformed JSON|guard failed/)
    short.exec('ROLLBACK')
    assert.equal(short.prepare('SELECT COUNT(*) n FROM file_assets').get().n, 2, 'nothing deleted when a guard fails')
    assert.equal(short.prepare("SELECT COUNT(*) n FROM import_job_files WHERE status = 'purged'").get().n, 0)
  })
  check('prefixes', () => assert.deepEqual(script.PREFIXES, ['uploads/', 'private/', 'imports/']))

  if (failures.length) {
    for (const failure of failures.slice(0, 80)) console.error(`FAIL ${failure}`)
    if (failures.length > 80) console.error(`...and ${failures.length - 80} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: bytes decide (every photo and video kept under any name, HEIC/BMP/TIFF and other media kept), unsure files reviewed, only documents/pages/text/archives/programs purged; rows of kept files untouched; D1 guards abort on a mismatch`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
