// Which row a scan singles out (utils/scanExactHit.ts).
//
// The owner rule (2 Sep, still binding): a scan fills the search and the list
// narrows; only a single EXACT barcode match may be highlighted. So the traps
// here are the plausible wrong implementations: a substring check, a name
// match, a leading-zero-blind comparison, and "first of two".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { findScanHit, isExactBarcodeHit } from '../src/utils/scanExactHit.ts'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const DIOR = '3348901729222'

runTest('a longer GTIN that merely contains the scanned code is not a hit', () => {
  const longer = { name: 'Dior Sauvage', barcode: `1${DIOR}` }
  assert.ok(String(longer.barcode).includes(DIOR), 'the fixture is what a naive substring check would accept')
  assert.equal(isExactBarcodeHit(longer, DIOR), false)
  assert.equal(isExactBarcodeHit({ name: 'Dior Sauvage', barcode: DIOR }, `1${DIOR}`), false)
  assert.equal(isExactBarcodeHit({ name: 'Dior Sauvage', barcode: DIOR }, DIOR), true)
})

runTest('a name or a prefix is never a barcode hit', () => {
  assert.equal(isExactBarcodeHit({ name: DIOR, barcode: '9999999999999' }, DIOR), false, 'only the barcode field counts')
  assert.equal(isExactBarcodeHit({ name: 'Dior', barcode: DIOR }, 'dior'), false, 'a word is a name search')
  assert.equal(isExactBarcodeHit({ name: 'x', barcode: DIOR }, DIOR.slice(0, 8)), false, 'a prefix of the code is not the code')
})

runTest('leading zeros fold, so a GTIN-14 row and an EAN-13 scan are the same code', () => {
  assert.equal(isExactBarcodeHit({ barcode: `0${DIOR}` }, DIOR), true)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `0${DIOR}`), true)
})

runTest('a UPC-E scan hits the UPC-A row (and the reverse)', () => {
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '012345000065' }, '01234565'), true)
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '01234565' }, '012345000065'), true)
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '1234565' }, '01234565'), false, 'seven digits is not the UPC-E')
})

runTest('a multi-word or comma query is a text search, never a scan', () => {
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `${DIOR} dior`), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `${DIOR},4006381333931`), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, ''), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, null), false)
})

runTest('placeholder and empty barcodes never match', () => {
  assert.equal(isExactBarcodeHit({ barcode: '0' }, '0'), false, '238 production rows share the literal "0"')
  assert.equal(isExactBarcodeHit({ barcode: '' }, '000000'), false)
  assert.equal(isExactBarcodeHit({ barcode: null }, DIOR), false)
  assert.equal(isExactBarcodeHit(null, DIOR), false)
})

runTest('one matching child row is singled out together with the group that owns it', () => {
  const groups = [
    { name: 'Dior Sauvage', rows: [{ name: 'Dior Sauvage', barcode: '3348901729000' }, { name: 'Dior Sauvage', barcode: DIOR }] },
    { name: 'Chanel', rows: [{ name: 'Chanel', barcode: '3145891264003' }] },
  ]
  const hit = findScanHit(groups, (group) => group.rows, DIOR)
  assert.equal(hit?.group, groups[0])
  assert.equal(hit?.row, groups[0].rows[1])
})

runTest('two different products sharing the barcode single out nothing, in one group or across two', () => {
  const sameGroup = [{ rows: [{ name: 'Dior Sauvage', barcode: DIOR }, { name: 'Dior Sauvage Travel', barcode: DIOR }] }]
  assert.equal(findScanHit(sameGroup, (group) => group.rows, DIOR), null, 'two names, one code: genuinely ambiguous')
  const twoGroups = [{ rows: [{ name: 'Dior Sauvage', barcode: DIOR }] }, { rows: [{ name: 'Dior Sauvage', barcode: `0${DIOR}` }] }]
  assert.equal(findScanHit(twoGroups, (group) => group.rows, DIOR), null, 'the same code in two groups is still ambiguous')
})

// Owner, 16 Nov 2026: an unmerged duplicate is its own row, so a group now lists one row per record. Two
// records with the same normalised name and the same identity barcode are one product to a scanner.
const ROWS_OF = (group: { rows: Array<{ id?: number; name?: string; barcode?: string }> }) => group.rows
const pairProbe = (find: typeof findScanHit): string[] => {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  check('a same-name same-barcode pair is one hit: the first twin of the group', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }, { id: 2, name: 'glow  serum ', barcode: DIOR }] }
    const hit = find([group], ROWS_OF, DIOR)
    assert.equal(hit?.group, group)
    assert.equal(hit?.row.id, 1)
  })
  check('a leading-zero twin is the same barcode, so the pair is one hit', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: `0${DIOR}` }, { id: 2, name: 'Glow Serum', barcode: DIOR }] }
    assert.equal(find([group], ROWS_OF, DIOR)?.row.id, 1)
    assert.equal(find([group], ROWS_OF, `0${DIOR}`)?.row.id, 1)
  })
  check('the pair is one hit even with an unrelated row between the twins', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }, { id: 3, name: 'Glow Serum', barcode: '3348901729000' }, { id: 2, name: 'Glow Serum', barcode: DIOR }] }
    assert.equal(find([group], ROWS_OF, DIOR)?.row.id, 1)
  })
  check('two different names on one barcode stay ambiguous', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }, { id: 2, name: 'Glow Serum Mini', barcode: DIOR }] }
    assert.equal(find([group], ROWS_OF, DIOR), null)
  })
  check('a pair plus a third different product on the code stays ambiguous', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }, { id: 2, name: 'Glow Serum', barcode: DIOR }, { id: 3, name: 'Glow Serum Mini', barcode: DIOR }] }
    assert.equal(find([group], ROWS_OF, DIOR), null)
  })
  check('a pair of twins in two different groups is ambiguous (the groups are different cards)', () => {
    const a = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }] }
    const b = { rows: [{ id: 2, name: 'Glow Serum', barcode: DIOR }] }
    assert.equal(find([a, b], ROWS_OF, DIOR), null)
  })
  check('one name, two different identity barcodes that both match the scan (UPC-E and UPC-A) stay ambiguous', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: '01234565' }, { id: 2, name: 'Glow Serum', barcode: '012345000065' }] }
    assert.equal(find([group], ROWS_OF, '01234565'), null)
  })
  check('two genuinely different real barcodes never collide', () => {
    const group = { rows: [{ id: 1, name: 'Glow Serum', barcode: DIOR }, { id: 2, name: 'Glow Serum', barcode: '3348901729000' }] }
    assert.equal(find([group], ROWS_OF, DIOR)?.row.id, 1)
    assert.equal(find([group], ROWS_OF, '3348901729000')?.row.id, 2)
  })
  return failures
}

runTest('unmerged twins count as one scan hit, different products stay ambiguous', () => {
  assert.deepEqual(pairProbe(findScanHit), [])
})

runTest('mutants of the twin rule are killed', () => {
  const require = createRequire(import.meta.url)
  const read = (file: string) => readFileSync(new URL(`../src/utils/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const compile = (code: string, resolve: (id: string) => unknown): Record<string, any> => {
    const mod: { exports: Record<string, any> } = { exports: {} }
    new Function('require', 'module', 'exports', transformSync(code, { loader: 'ts', format: 'cjs' }).code)(resolve, mod, mod.exports)
    return mod.exports
  }
  const scanSource = read('scanExactHit.ts')
  const groupingSource = read('productGrouping.ts')
  const load = (scan: string, grouping: string): typeof findScanHit => {
    const groupingModule = compile(grouping, (id) => require(id.replace(/^\.\//, '../src/utils/')))
    return compile(scan, (id) => (id.endsWith('productGrouping.ts') ? groupingModule : require(id.replace(/^\.\//, '../src/utils/')))).findScanHit
  }
  assert.deepEqual(pairProbe(load(scanSource, groupingSource)), [], 'the unmutated copy passes')
  const keyLine = 'return `${normalizeProductGroupName(row.name)}|${identityBarcodeKey(row.barcode)}`'
  const mutants: Array<[string, 'scan' | 'grouping', string, string]> = [
    ['no twin rule at all (the regression)', 'scan', 'if (key && hit.group === group && key === hitKey) continue', 'if (false) continue'],
    ['twins matched across groups', 'scan', 'if (key && hit.group === group && key === hitKey) continue', 'if (key && key === hitKey) continue'],
    ['twin rule stops after the first twin', 'scan', 'hitKey = key\n', 'hitKey = key + hit.row.id\n'],
    ['twins matched on barcode alone, any name', 'grouping', keyLine, 'return identityBarcodeKey(row.barcode)'],
    ['twins matched on name alone', 'grouping', keyLine, 'return normalizeProductGroupName(row.name)'],
    ['raw barcode, leading zeros not folded', 'grouping', 'identityBarcodeKey(row.barcode)}`\n}', 'String(row.barcode)}`\n}'],
    ['raw name, not normalised', 'grouping', 'normalizeProductGroupName(row.name)}|${identityBarcodeKey', 'String(row.name)}|${identityBarcodeKey'],
  ]
  for (const [name, file, from, to] of mutants) {
    const target = file === 'scan' ? scanSource : groupingSource
    assert.ok(target.includes(from), `mutant "${name}" no longer matches the source (stale mutant)`)
    const mutated = target.replace(from, to)
    assert.notDeepEqual(pairProbe(file === 'scan' ? load(mutated, groupingSource) : load(scanSource, mutated)), [], `mutant survived: ${name}`)
  }
})

runTest('only the child rows count: a group lead that is not among its rows is ignored', () => {
  const lead = { name: 'Dior Sauvage', barcode: DIOR }
  const groups = [{ lead, rows: [{ name: 'Dior Sauvage', barcode: '3348901729000' }] }]
  assert.equal(findScanHit(groups, (group) => group.rows, DIOR), null)
})

runTest('no row, no groups and a non-barcode query give no hit', () => {
  assert.equal(findScanHit([], () => [], DIOR), null)
  assert.equal(findScanHit([{ rows: [{ barcode: '4006381333931' }] }], (group) => group.rows, DIOR), null)
  assert.equal(findScanHit([{ rows: [{ name: 'Dior', barcode: DIOR }] }], (group) => group.rows, 'dior'), null)
})

if (failed > 0) process.exitCode = 1
