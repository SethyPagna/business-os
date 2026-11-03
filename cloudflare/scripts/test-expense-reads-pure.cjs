'use strict'
// E1-F: the pure half of the Expenses read cuts (lib/expenseReads.ts), without a database.
//   - the switch: only a stored 'on' enables `expense_reads` (a shadow token or anything else serves the old code);
//   - foldFeeGroups: the one-pass report fold gives what the four statements give: totals, days, types and type+label rows, their rounding, their
//     sort and its ties, the label (binary-smallest trimmed spelling, '' when blank), code point order for astral characters, and null (= use the
//     four statements) on a rounding boundary;
//   - the export cursor: round trip, and every malformed shape is refused (the route then pages by offset);
//   - the plan fields exist on both tiers and the call sites read them (no bare page size or group cap in the routes);
//   - mutants of the source each turn a check red (the plausible wrong implementations: ties by the wrong key, a lost label minimum, UTF-16 order,
//     no rounding guard, a cursor that accepts anything).
// The parity against real SQLite (the four statements as oracle) and the rows read are in test-expense-reads-native.cjs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const seam = (text, before, after) => { assert.equal(text.split(before).length, 2, 'MUTANT_SEAM_MISSING: ' + before); return text.replace(before, () => after) }

const MUTANTS = {
  'ties-by-name-descending': (t) => seam(t, "[...types].sort((a, b) => compareCodePoints(a[0], b[0]))", "[...types].sort((a, b) => compareCodePoints(b[0], a[0]))"),
  'types-unsorted-by-money': (t) => seam(t, '  outTypes.sort(cmpMoney)\n', '\n'),
  'category-label-tiebreak-dropped': (t) => seam(t, '|| compareCodePoints(a.label, b.label)', ''),
  'label-minimum-lost': (t) => seam(t, 'compareCodePoints(row.label, cat.label) < 0', 'false'),
  'label-maximum': (t) => seam(t, 'compareCodePoints(row.label, cat.label) < 0', 'compareCodePoints(row.label, cat.label) > 0'),
  'utf16-order': (t) => seam(t, "const x = a.codePointAt(i) as number\n    const y = b.codePointAt(j) as number", "const x = a.charCodeAt(i)\n    const y = b.charCodeAt(j)"),
  'no-rounding-guard': (t) => seam(t, 'if (Math.abs(frac - 0.5) <= 1e-6 + scaled * 1e-12) return null', ''),
  'rounds-half-down': (t) => seam(t, 'Math.floor(scaled + 0.5) / scale', 'Math.floor(scaled) / scale'),
  'days-ascending': (t) => seam(t, 'compareCodePoints(b[0], a[0]))', 'compareCodePoints(a[0], b[0]))'),
  'blank-label-kept-null': (t) => seam(t, "label: sum.label || ''", 'label: sum.label as string'),
  'sale-cursor-optional': (t) => seam(t, 'if (s !== null && !(Array.isArray(s) && s.length === 3 && (s[0] === null || keyText(s[0])) && (s[1] === null || keyText(s[1])) && !(s[0] !== null && s[1] === null) && rowId(s[2]))) return null', ''),
  'dated-sale-key-may-lack-its-time': (t) => seam(t, ' && !(s[0] !== null && s[1] === null)', ''),
  'null-day-refused': (t) => seam(t, '(s[0] === null || keyText(s[0]))', 'keyText(s[0])'),
  'cursor-forgets-the-undated-count': (t) => seam(t, ', h: cursor.h, u: cursor.u }', ', h: cursor.h }'),
  'missing-undated-count-reads-as-none': (t) => seam(t, 'parsed.u === undefined ? 1 : parsed.u', 'parsed.u === undefined ? 0 : parsed.u'),
  'undated-count-unchecked': (t) => seam(t, "if (!(typeof u === 'number' && Number.isSafeInteger(u) && u >= 0)) return null", ''),
  'cursor-negative-high-water': (t) => seam(t, 'id >= 0))) return null', 'true))) return null'),
  'cursor-version-ignored': (t) => seam(t, 'if (!parsed || parsed.v !== 1) return null', 'if (!parsed) return null'),
  'switch-name-typo': (t) => seam(t, "export const EXPENSE_READS_SWITCH = 'expense_reads'", "export const EXPENSE_READS_SWITCH = 'expense_read'"),
}

function load(mutant) {
  let text = read('lib/expenseReads.ts')
  if (mutant) text = MUTANTS[mutant](text)
  const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  const asked = []
  new Function('module', 'exports', 'require', out)(mod, mod.exports, (request) => {
    if (request === './readSwitches') return { readSwitch: async (env, name) => { asked.push(name); return env.stored === 'on' && env.names.includes(name) } }
    throw new Error('unexpected require ' + request)
  })
  mod.exports.__asked = asked
  return mod.exports
}

const row = (d, t, k, label, n, usd, khr) => ({ d, t, k, label, n, usd, khr })
const json = (value) => JSON.stringify(value)
const sampleRows = () => [
  row('2026-10-12', 'other', 'tape', 'Tape', 2, 3, 0),
  row('2026-10-12', 'delivery', 'courier a', 'Courier A', 1, 5, 0),
  row('2026-10-11', 'other', 'tape', 'tape', 1, 1, 0),
  row('2026-10-11', 'other', 'tape', 'Tape', 1, 2, 0),
  row('2026-10-11', 'expense', 'ice', 'Ice', 3, 0, 24000),
  row('2026-10-10', 'other', '', null, 1, 0.5, 0),
  row('2026-10-10', 'other', '', '', 2, 0.5, 1000),
]

async function run(mutant) {
  const lib = load(mutant)
  const fold = lib.foldFeeGroups
  const results = []
  const check = async (name, fn) => { try { await fn(); results.push({ name, ok: true }) } catch (error) { results.push({ name, ok: false, error }) } }

  await check('switch: only a stored "on" enables expense_reads, and the name is the one the Server page and the ops task will flip', () => {
    assert.equal(lib.EXPENSE_READS_SWITCH, 'expense_reads')
    return Promise.all([
      lib.expenseReadsOn({ stored: 'on', names: ['expense_reads'] }).then((v) => assert.equal(v, true)),
      lib.expenseReadsOn({ stored: 'on', names: ['report_atomic'] }).then((v) => assert.equal(v, false)),
      lib.expenseReadsOn({ stored: 'shadow:0.05', names: ['expense_reads'] }).then((v) => assert.equal(v, false)),
    ])
  })

  await check('fold: totals, days (newest first), types and type+label rows from one pass', () => {
    const out = fold(sampleRows())
    assert.deepEqual(out.totals, { count: 11, amount_usd: 12, amount_khr: 25000 })
    assert.deepEqual(out.days, [
      { date: '2026-10-12', count: 3, amount_usd: 8, amount_khr: 0 },
      { date: '2026-10-11', count: 5, amount_usd: 3, amount_khr: 24000 },
      { date: '2026-10-10', count: 3, amount_usd: 1, amount_khr: 1000 },
    ])
    assert.deepEqual(out.byType, [
      { fee_type: 'delivery', count: 1, amount_usd: 5, amount_khr: 0 },
      { fee_type: 'other', count: 7, amount_usd: 7, amount_khr: 1000 },
      { fee_type: 'expense', count: 3, amount_usd: 0, amount_khr: 24000 },
    ].sort((a, b) => b.amount_usd - a.amount_usd || b.amount_khr - a.amount_khr))
    assert.deepEqual(out.byCategory.map((c) => [c.fee_type, c.label, c.count, c.amount_usd, c.amount_khr]), [
      ['other', 'Tape', 4, 6, 0],
      ['delivery', 'Courier A', 1, 5, 0],
      ['other', '', 3, 1, 1000],
      ['expense', 'Ice', 3, 0, 24000],
    ])
  })

  await check('fold: the label of a type+label group is the binary-smallest trimmed spelling ("Tape" before "tape"), and a blank or missing one is ""', () => {
    const out = fold([row('d', 'other', 'tape', 'tape', 1, 1, 0), row('d', 'other', 'tape', 'Tape', 1, 1, 0), row('e', 'other', 'tape', null, 1, 1, 0)])
    assert.equal(out.byCategory[0].label, 'Tape')
    assert.equal(fold([row('d', 'other', '', null, 1, 1, 0)]).byCategory[0].label, '')
    assert.equal(fold([row('d', 'other', '', '', 1, 1, 0), row('e', 'other', '', null, 1, 1, 0)]).byCategory[0].label, '')
  })

  await check('fold: the days list merges rows of one day that differ in type and label, and a day is never split', () => {
    const out = fold([row('2026-10-12', 'a', 'x', 'X', 1, 1, 0), row('2026-10-12', 'b', 'y', 'Y', 1, 2, 0), row('2026-10-12', 'a', 'z', 'Z', 1, 4, 0)])
    assert.deepEqual(out.days, [{ date: '2026-10-12', count: 3, amount_usd: 7, amount_khr: 0 }])
    assert.deepEqual(out.byType.map((t) => [t.fee_type, t.count, t.amount_usd]), [['a', 2, 5], ['b', 1, 2]])
  })

  await check('fold: ties keep the order the four statements emit them in (group key ascending, stable) and the sort is money descending', () => {
    // two types with the same money; two labels of one type with the same money; one label shared by two types
    const out = fold([
      row('d', 'zeta', 'a', 'A', 1, 2, 0), row('d', 'alpha', 'a', 'A', 1, 2, 0), row('d', 'mid', 'big', 'Big', 1, 9, 0),
      row('d', 'alpha', 'b', 'B', 1, 2, 0), row('d', 'alpha', 'c', 'B', 1, 2, 0), row('d', 'beta', 'q', 'Q', 1, 6, 0),
    ])
    assert.deepEqual(out.byType.map((t) => [t.fee_type, t.amount_usd]), [['mid', 9], ['alpha', 6], ['beta', 6], ['zeta', 2]], 'alpha and beta tie on money: alpha (the earlier key) stays first')
    assert.deepEqual(out.byCategory.map((c) => `${c.fee_type}/${c.label}/${c.amount_usd}`), ['mid/Big/9', 'beta/Q/6', 'alpha/A/2', 'zeta/A/2', 'alpha/B/2', 'alpha/B/2'])
    assert.deepEqual(out.byCategory.map((c) => c.fee_type + c.label).slice(2, 4), ['alphaA', 'zetaA'], 'equal money and label: the type that comes first in the group key stays first')
  })

  await check('fold: money descending decides before the label', () => {
    const out = fold([row('d', 't', 'a', 'Aaa', 1, 1, 0), row('d', 't', 'z', 'Zzz', 1, 5, 0)])
    assert.deepEqual(out.byCategory.map((c) => c.label), ['Zzz', 'Aaa'])
  })

  await check('fold: UTF-8 byte order, as SQLite compares text: a character above U+FFFF sorts after U+FF21 (UTF-16 order puts it first)', () => {
    const astral = '\u{1F4E6}', fullwidth = 'Ａ'
    assert.ok(astral < fullwidth, 'control: JS compares UTF-16 units and puts the astral character first')
    assert.ok(lib.compareCodePoints(astral, fullwidth) > 0)
    assert.ok(lib.compareCodePoints(fullwidth, astral) < 0)
    assert.equal(lib.compareCodePoints('a', 'a'), 0)
    assert.ok(lib.compareCodePoints('a', 'ab') < 0 && lib.compareCodePoints('ab', 'a') > 0)
    const out = fold([row('d', 't', 'k', astral, 1, 1, 0), row('d', 't', 'k', fullwidth, 1, 1, 0)])
    assert.equal(out.byCategory[0].label, fullwidth, 'the byte-smallest spelling is the label')
    assert.deepEqual(fold([row(astral, 't', 'k', 'x', 1, 1, 0), row(fullwidth, 't', 'k', 'x', 1, 1, 0)]).days.map((d) => d.date), [astral, fullwidth], 'days newest first in byte order')
  })

  await check('rounding: ROUND(x, 2) and ROUND(x, 0) as SQLite answers; a sum of float noise rounds to the cent', () => {
    assert.equal(lib.roundLikeSqlite(0.1 + 0.2, 100), 0.3)
    assert.equal(lib.roundLikeSqlite(12.100000000000001, 100), 12.1)
    assert.equal(lib.roundLikeSqlite(1234.5678, 100), 1234.57)
    assert.equal(lib.roundLikeSqlite(0.994, 100), 0.99)
    assert.equal(lib.roundLikeSqlite(24000, 1), 24000)
    assert.equal(lib.roundLikeSqlite(-3.456, 100), -3.46)
    assert.equal(Object.is(lib.roundLikeSqlite(-0.001, 100), -0), false, 'no negative zero')
    assert.equal(lib.roundLikeSqlite(0, 100), 0)
    assert.equal(lib.roundLikeSqlite(Number.NaN, 100), null)
  })

  await check('rounding boundary: a figure on a half cent or half riel is null (the route then runs the four statements)', () => {
    assert.equal(lib.roundLikeSqlite(2.005, 100), null)
    assert.equal(lib.roundLikeSqlite(1.0025 + 1.0025, 100), null)
    assert.equal(lib.roundLikeSqlite(0.5, 1), null)
    assert.equal(lib.roundLikeSqlite(12000.5, 1), null)
    assert.equal(fold([row('d', 't', 'k', 'x', 1, 1.0025, 0), row('e', 't', 'k', 'x', 1, 1.0025, 0)]), null, 'the total 2.005 is on the boundary')
    assert.equal(fold([row('d', 't', 'k', 'x', 1, 0, 0.5)]), null)
    assert.notEqual(fold([row('d', 't', 'k', 'x', 1, 2.0049, 0)]), null, 'a figure clear of the boundary folds')
    // a boundary in ONE day makes the answer null even when the total is clean
    assert.equal(fold([row('d', 't', 'k', 'x', 1, 1.005, 0), row('e', 't', 'k', 'x', 1, 0.995, 0)]), null)
  })

  await check('fold: no rows is the empty report (what four statements over no rows answer)', () => {
    assert.equal(json(fold([])), json({ totals: { count: 0, amount_usd: 0, amount_khr: 0 }, days: [], byType: [], byCategory: [] }))
  })

  const cursor = { e: ['2026-10-11', 41], s: ['2026-10-11', '2026-10-11 03:00:00', 7], h: [900, 5000], u: 0 }
  await check('cursor: round trip, url-safe, and null keys survive', () => {
    const text = lib.encodeFeeCursor(cursor)
    assert.match(text, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(lib.decodeFeeCursor(text), cursor)
    const empty = { e: null, s: null, h: [0, 0], u: 0 }
    assert.deepEqual(lib.decodeFeeCursor(lib.encodeFeeCursor(empty)), empty)
    const half = { e: ['2026-10-11', 41], s: null, h: [9, 0], u: 0 }
    assert.deepEqual(lib.decodeFeeCursor(lib.encodeFeeCursor(half)), half)
  })

  // A sale row whose created_at has no readable day has a NULL day (and, for garbage or an empty string, a NULL entry time); the list puts it last.
  // Its key must travel as null: the text 'null' is a day nothing matches, so the next page would look for it and find nothing.
  const token = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  await check('cursor: a sale key with no day (and no entry time) survives as null, with the count of such rows', () => {
    for (const s of [[null, null, 99002], [null, '2026-10-11 03:00:00', 99001], ['2026-10-11', '2026-10-11 03:00:00', 7]]) {
      const c = { e: ['2026-10-11', 41], s, h: [900, 5000], u: 2 }
      const back = lib.decodeFeeCursor(lib.encodeFeeCursor(c))
      assert.deepEqual(back, c)
      assert.equal(back.s[0] === null, s[0] === null)
    }
    const nulls = JSON.parse(Buffer.from(lib.encodeFeeCursor({ e: null, s: [null, null, 5], h: [1, 1], u: 3 }), 'base64url').toString())
    assert.deepEqual(nulls.s, [null, null, 5], 'null, not the text "null"')
    assert.equal(nulls.u, 3, 'the undated count is in the token')
  })

  await check('cursor: a token from before the undated count reads as "some" (1), a negative or fractional count is refused', () => {
    assert.equal(lib.decodeFeeCursor(token({ v: 1, e: null, s: null, h: [3, 4] })).u, 1)
    for (const u of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2]) {
      assert.equal(lib.decodeFeeCursor(token({ v: 1, e: null, s: null, h: [3, 4], u })), null, 'refused u=' + String(u))
    }
    // a dated sale key always carries its entry time
    assert.equal(lib.decodeFeeCursor(token({ v: 1, e: null, s: ['2026-10-11', null, 7], h: [3, 4], u: 0 })), null)
  })

  const make = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  await check('cursor: anything the Worker did not hand out is refused (null), so the route pages by offset', () => {
    for (const bad of ['', 'start', '!!!', 'AAAA', 'e30', make(null), make([]), make('x'), make({}), make({ v: 2, e: null, s: null, h: [1, 1] }),
      make({ v: 1, e: [], s: null, h: [1, 1] }), make({ v: 1, e: ['d', 0], s: null, h: [1, 1] }), make({ v: 1, e: ['d', 1.5], s: null, h: [1, 1] }), make({ v: 1, e: ['d', '1'], s: null, h: [1, 1] }),
      make({ v: 1, e: [7, 1], s: null, h: [1, 1] }), make({ v: 1, e: ['', 1], s: null, h: [1, 1] }), make({ v: 1, e: ['x'.repeat(65), 1], s: null, h: [1, 1] }),
      make({ v: 1, e: null, s: ['d', 'dt'], h: [1, 1] }), make({ v: 1, e: null, s: ['d', 'dt', -1], h: [1, 1] }), make({ v: 1, e: null, s: ['d', 'dt', 1, 9], h: [1, 1] }),
      make({ v: 1, e: null, s: null }), make({ v: 1, e: null, s: null, h: [1] }), make({ v: 1, e: null, s: null, h: [-1, 1] }), make({ v: 1, e: null, s: null, h: [1, '1'] }),
      make({ v: 1, e: null, s: null, h: [Number.MAX_SAFE_INTEGER + 2, 1] }), make({ v: 1, s: null, h: [1, 1] }), make({ v: 1, e: null, h: [1, 1] })]) {
      assert.equal(lib.decodeFeeCursor(bad), null, `refused: ${bad.slice(0, 60)}`)
    }
    assert.equal(lib.decodeFeeCursor(lib.encodeFeeCursor(cursor).slice(0, -3)), null, 'a truncated token')
    assert.notEqual(lib.decodeFeeCursor(make({ v: 1, e: null, s: null, h: [0, 0], extra: 1 })), null, 'an unknown extra key is dropped, not trusted')
    assert.deepEqual(Object.keys(lib.decodeFeeCursor(make({ v: 1, e: null, s: null, h: [0, 0], extra: 1 })).h), ['0', '1'])
  })

  return results
}

;(async () => {
  const base = await run(null)
  const red = base.filter((r) => !r.ok)
  for (const r of base) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : '\n  ' + (r.error && r.error.message)}`)

  // source pins: the call sites read the plan fields, and the old statements are still in the file for the switch-off path
  const fees = read('routes/fees.ts'), catalog = read('routes/feesCatalog.ts'), tier = read('lib/planTier.ts'), switches = read('lib/readSwitches.ts')
  const pins = [
    ['the report reads its row cap from getPlanLimits(env), not a literal', /getPlanLimits\(env\)\.expenseReportFoldMaxRows/.test(fees) && !/rowCap: \d/.test(fees)],
    ['the grouped scan stops after cap + 1 rows INSIDE the scan (a window over the cap is turned away after about cap rows, not after grouping the table)', /FROM \(SELECT f\.fee_date, f\.fee_type, f\.label, f\.amount_usd, f\.amount_khr FROM fees f WHERE \$\{where\} LIMIT @rowCap\) s/.test(fees) && /rowCap: cap \+ 1/.test(fees) && /return rows <= cap \? foldFeeGroups\(groups\) : null/.test(fees)],
    ['the export reads its page cap from getPlanLimits(env), not a literal', /getPlanLimits\(c\.env\)\.expenseExportPageRows/.test(catalog)],
    ['expense_reads is a known read switch on this base', /KNOWN_READ_SWITCHES = \[[^\]]*'expense_reads'/.test(switches)],
    ['both plan fields exist on the type and on both tiers', ['expenseExportPageRows', 'expenseReportFoldMaxRows'].every((f) => (tier.match(new RegExp(`\\b${f}\\b`, 'g')) || []).length >= 3)],
    ['the four old report statements are still in the file (the switch-off path)', ['SELECT COUNT(*) AS count, ${money} FROM fees f WHERE ${where}', 'GROUP BY f.fee_date ORDER BY f.fee_date DESC', 'GROUP BY f.fee_type ORDER BY amount_usd DESC, amount_khr DESC', "GROUP BY f.fee_type, lower(trim(COALESCE(f.label, '')))"].every((s) => fees.includes(s))],
    ['the report consults the switch once and only before the old statements', (fees.match(/expenseReadsOn\(env\)/g) || []).length === 1 && fees.indexOf('groupedFeeReport(c.env') < fees.indexOf('const [totals, days, byType, byCategory]') + 200],
    ['the list consults the switch only for a request that carries a cursor (a plain list page pays no switch read)', /if \(cursorText && await expenseReadsOn\(c\.env\)\)/.test(catalog)],
    ['the old list statement text is untouched: no keyset clause outside the keyset branch', fees.includes("ORDER BY f.fee_date DESC, f.id DESC\n    LIMIT @limit OFFSET @offset") && /if \(keyset\?\.upToId != null\) \{/.test(fees)],
    ['the sale statement is the 6.0.1053 text unless keyed', /sales\.branch_id,\$\{keyed \? ' datetime\(sales\.created_at\) AS dt,' : ''\}\n/.test(catalog)],
  ]
  for (const [name, ok] of pins) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) red.push({ name }) }

  // every mutant must turn at least one check red
  const mutantReport = {}
  for (const name of Object.keys(MUTANTS)) {
    let killed
    try { killed = (await run(name)).filter((r) => !r.ok).length } catch (error) { killed = 1 }
    mutantReport[name] = killed
    console.log(`${killed ? 'PASS' : 'FAIL'} mutant ${name} killed by ${killed} check(s)`)
    if (!killed) red.push({ name: 'mutant survived: ' + name })
  }
  // the promise returned by the switch check is awaited above through run(); a rejected one would have been unhandled
  console.log(JSON.stringify({ status: red.length ? 'FAIL' : 'PASS', checks: base.length + pins.length, mutants: mutantReport }))
  if (red.length) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
