// Owner, 16 Nov 2026: "Keep both" is a ruling, so a twin cluster the person dismissed from Conflicts must not keep its Duplicate tag, its open state or
// its one-product scan (round 3/4 review, finding (a)). The Conflicts sweep (cloudflare findPossiblySameProductClusters) skips a dismissed cluster and
// Resolve refuses a pair no listed cluster holds; utils/productTwinDismissals.ts is the client half of that identity. The same rule over the real
// Worker routes and a real database is cloudflare/scripts/test-twin-conflicts-resolve-native.cjs; this file pins the rule itself, kind of pair by kind
// of pair, and the name key the twin rule compares with (the Worker's lower(trim(name))).
// Mutants edit the real sources and must each turn it red. Fixtures are synthetic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const norm = (file: string) => file.split(path.sep).join('/')

type Patch = { file: string; from: string; to: string }
async function load(patches: Patch[] = []): Promise<Record<string, any>> {
  const applied = new Set<string>()
  const plugin = {
    name: 'patches',
    setup(b: any) {
      b.onLoad({ filter: /\.ts$/ }, (args: any) => {
        let text = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        const rel = norm(path.relative(SRC, args.path))
        for (const patch of patches.filter((candidate) => candidate.file === rel)) {
          assert.equal(text.split(patch.from).length, 2, `mutant anchor must occur exactly once in ${rel}: ${patch.from}`)
          text = text.replace(patch.from, () => patch.to)
          applied.add(`${patch.file}|${patch.from}`)
        }
        return { contents: text, loader: 'ts' }
      })
    },
  }
  const entry = `export * from './utils/productGrouping.ts'\nexport * from './utils/productTwinDismissals.ts'\n`
  const out = await build({ stdin: { contents: entry, resolveDir: SRC, loader: 'ts' }, plugins: [plugin], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
  for (const patch of patches) assert.ok(applied.has(`${patch.file}|${patch.from}`), `mutant anchor not found: ${patch.from}`)
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

const REAL = '8851234567890'
const OTHER = '8859999999999'
// A barcode cluster spans names (the Worker groups it by the code alone), so every kind below owns its code: dismissing one pair's code never touches another's.
const VARIANT = '8857777777777'
const row = (id: number, name: string, barcode: string | null, extra: Record<string, unknown> = {}) => ({ id, name, barcode, stock_quantity: 0, is_active: 1, is_group: 0, ...extra })

// Every kind of twin pair, with the Conflicts clusters that hold it (the dismissal keys the Worker's sweep stores them under).
// `holders` is what a person can click "Keep both" on; the pair stays flagged until every one of them is dismissed.
const KINDS: Array<{ label: string; rows: ReturnType<typeof row>[]; holders: Array<[string, string]> }> = [
  { label: 'real/empty', rows: [row(1, 'Kind Real Empty', REAL), row(2, 'Kind Real Empty', '')], holders: [['name', 'kind real empty']] },
  { label: 'real/null', rows: [row(3, 'Kind Real Null', REAL), row(4, 'Kind Real Null', null)], holders: [['name', 'kind real null']] },
  { label: 'real/real same code', rows: [row(5, 'Kind Real Real', REAL), row(6, 'Kind Real Real', REAL)], holders: [['barcode', REAL]] },
  { label: 'real/real leading zero', rows: [row(7, 'Kind Leading Zero', REAL), row(8, 'Kind Leading Zero', '0' + REAL)], holders: [['leadingzero', REAL]] },
  { label: 'MAC shade 0601/601', rows: [row(9, 'Kind Shade', '0601'), row(10, 'Kind Shade', '601')], holders: [['leadingzero', '601']] },
  { label: 'word/word different', rows: [row(11, 'Kind Word Word', 'NoBox188'), row(12, 'Kind Word Word', 'BrowWizTaupe')], holders: [['name', 'kind word word']] },
  { label: 'word/word same', rows: [row(13, 'Kind Word Same', 'NoBox188'), row(14, 'Kind Word Same', 'NoBox188')], holders: [['barcode', 'NoBox188']] },
  { label: 'short/short 12345/12346', rows: [row(15, 'Kind Short', '12345'), row(16, 'Kind Short', '12346')], holders: [['name', 'kind short']] },
  { label: 'short/short same 12345', rows: [row(17, 'Kind Short Same', '12345'), row(18, 'Kind Short Same', '12345')], holders: [['barcode', '12345']] },
  { label: '0/0', rows: [row(19, 'Kind Zero Zero', '0'), row(20, 'Kind Zero Zero', '0')], holders: [['name', 'kind zero zero']] },
  { label: '0/00', rows: [row(21, 'Kind Zero Double', '0'), row(22, 'Kind Zero Double', '00')], holders: [['name', 'kind zero double']] },
  { label: 'empty/empty', rows: [row(23, 'Kind Empty Empty', ''), row(24, 'Kind Empty Empty', '')], holders: [['name', 'kind empty empty']] },
  { label: 'real/word', rows: [row(25, 'Kind Real Word', REAL), row(26, 'Kind Real Word', 'Mask')], holders: [['name', 'kind real word']] },
  // Two real clusters under one name: a variant pair, plus a third row of the first code. The twin cluster is held by the barcode cluster of its own code
  // AND by the name cluster of the whole name; each is a separate ruling.
  { label: 'twin cluster beside a real variant', rows: [row(27, 'Kind Variant', VARIANT), row(28, 'Kind Variant', VARIANT), row(29, 'Kind Variant', OTHER)], holders: [['barcode', VARIANT], ['name', 'kind variant']] },
]

const idsOf = (api: Record<string, any>, items: any[]): number[] => {
  const keys = api.unmergedTwinKeys(items) as string[]
  return items.filter((_, index) => keys[index]).map((item) => item.id)
}
const worldOf = (kinds = KINDS) => kinds.flatMap((kind) => kind.rows)
const dismissals = (pairs: Array<[string, string]>) => ({ dismissals: pairs })

async function probe(patches: Patch[] = []): Promise<string[]> {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  const api = await load(patches)
  const items = worldOf()
  const twinIdsOf = (kind: (typeof KINDS)[number]) => kind.rows.map((r) => r.id).filter((id) => kind.label === 'twin cluster beside a real variant' ? id !== 29 : true)

  check('before any ruling every kind of pair is a twin, and the lone real variant beside a twin cluster is not', () => {
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    const tagged = idsOf(api, items)
    for (const kind of KINDS) for (const id of twinIdsOf(kind)) assert.ok(tagged.includes(id), `${kind.label}: row ${id}`)
    assert.ok(!tagged.includes(29), 'the lone variant is nobody\'s twin')
  })

  for (const kind of KINDS) {
    check(`${kind.label}: "Keep both" on every cluster that lists it takes the tag off, and only this pair loses it`, () => {
      api.setTwinDismissals(api.parseTwinDismissals(dismissals(kind.holders)))
      const tagged = idsOf(api, items)
      for (const id of twinIdsOf(kind)) assert.ok(!tagged.includes(id), `row ${id} is still tagged after Keep both`)
      for (const other of KINDS.filter((candidate) => candidate !== kind)) for (const id of twinIdsOf(other)) assert.ok(tagged.includes(id), `${other.label}: row ${id} lost its tag`)
    })
    if (kind.holders.length > 1) {
      for (const [type, value] of kind.holders) {
        check(`${kind.label}: dismissing only the ${type} cluster leaves the other one listing the pair, so it stays tagged`, () => {
          api.setTwinDismissals(api.parseTwinDismissals(dismissals([[type, value]])))
          const tagged = idsOf(api, items)
          for (const id of twinIdsOf(kind)) assert.ok(tagged.includes(id), `row ${id} lost its tag while a cluster still lists it`)
        })
      }
    }
  }

  check('a ruling on another kind of cluster, or on a name nobody has, changes nothing', () => {
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['similar', 'kind real empty'], ['name', 'no such name'], ['barcode', '0000000'], ['leadingzero', '999999']])))
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    const before = idsOf(api, items)
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['similar', 'kind real empty'], ['name', 'no such name'], ['barcode', '0000000'], ['leadingzero', '999999']])))
    assert.deepEqual(idsOf(api, items), before)
  })

  check('the dismissal of the same type and value under a different type does not count (the delimiter keeps them apart)', () => {
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['barcode', 'kind real empty'], ['name', REAL]])))
    const tagged = idsOf(api, items)
    for (const id of [1, 2, 5, 6]) assert.ok(tagged.includes(id), `row ${id}`)
  })

  check('the ruling reaches what a person sees: the row flag and the open state of the group', () => {
    const kind = KINDS[0]
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    const open = api.buildProductGroups(kind.rows, new Map(), { preserveInputOrder: false })[0]
    assert.ok(open.rows.every((r: any) => r.__unmergedTwin === true && r.__twinKey))
    api.setTwinDismissals(api.parseTwinDismissals(dismissals(kind.holders)))
    const ruled = api.buildProductGroups(kind.rows, new Map(), { preserveInputOrder: false })[0]
    assert.ok(ruled.rows.every((r: any) => r.__unmergedTwin === false && !r.__twinKey), 'no tag, and no twin key for the scan to merge two rows into one hit')
  })

  check('garbage from the server is "no rulings", never a throw', () => {
    for (const payload of [null, undefined, {}, { dismissals: 'x' }, { dismissals: [null, [1, 2], ['name']] }]) assert.equal(api.parseTwinDismissals(payload).size, 0)
  })

  check('a ruling is a set: two reads with the same keys leave the loaded set (and every list memo) untouched', () => {
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    let notified = 0
    const stop = api.subscribeTwinDismissals(() => { notified += 1 })
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['name', 'a']])))
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['name', 'a']])))
    api.setTwinDismissals(api.parseTwinDismissals(dismissals([['name', 'a'], ['barcode', 'b']])))
    stop()
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    assert.equal(notified, 2)
  })

  // ---- the name the twin rule compares: exactly the Worker's name_key, SQLite lower(trim(name)) -------------------------------------------------
  check('names that differ only in inner spaces are NOT twins (the Worker keeps inner spaces in name_key), Latin and Khmer alike', () => {
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    assert.deepEqual(idsOf(api, [row(1, 'Glow  Serum', REAL), row(2, 'Glow Serum', '')]), [])
    assert.deepEqual(idsOf(api, [row(1, 'ក្រែម  លាប', REAL), row(2, 'ក្រែម លាប', '')]), [])
    assert.deepEqual(idsOf(api, [row(1, 'ក្រែម  លាប', REAL), row(2, 'ក្រែម  លាប', '')]), [1, 2], 'the identical Khmer name is a twin')
  })
  check('case and the spaces trim() takes off do not separate a name; non-ASCII case does (SQLite lower() folds A-Z only)', () => {
    api.setTwinDismissals(api.NO_TWIN_DISMISSALS)
    assert.deepEqual(idsOf(api, [row(1, 'Glow Serum', REAL), row(2, '  GLOW serum ', '')]), [1, 2])
    assert.deepEqual(idsOf(api, [row(1, 'Crème Éclat', REAL), row(2, 'crème éclat', '')]), [], 'É stays É in name_key, so these are two names on the server')
    assert.deepEqual(idsOf(api, [row(1, 'Glow Serum', REAL), row(2, '\tglow serum', '')]), [], 'trim() takes off spaces, not tabs')
  })
  return failures
}

const real = await probe()
assert.deepEqual(real, [], `the unmutated rule is red:\n${real.join('\n')}`)

const DISMISS = 'utils/productTwinDismissals.ts'
const GROUPING = 'utils/productGrouping.ts'
const MUTANTS: Array<{ name: string; patches: Patch[] }> = [
  { name: 'the dismissal keys are ignored (the rule never dismisses)', patches: [{ file: GROUPING, from: 'if (cluster.length < 2 || twinDismissalRule?.(cluster, name, rows)) continue', to: 'if (cluster.length < 2) continue' }] },
  { name: 'the store never registers the rule', patches: [{ file: DISMISS, from: '  setTwinDismissalRule(rule)\n', to: '' }] },
  { name: 'one dismissed cluster hides the pair even while another still lists it (some, not every)', patches: [{ file: DISMISS, from: 'holders.every((key) => dismissals.has(key))', to: 'holders.some((key) => dismissals.has(key))' }] },
  { name: 'the barcode cluster is never a holder', patches: [{ file: DISMISS, from: "if (code !== null) keys.push(twinDismissalKey('barcode', code))", to: '' }] },
  { name: 'the leading-zero cluster is never a holder', patches: [{ file: DISMISS, from: "if (fold !== null) keys.push(twinDismissalKey('leadingzero', fold))", to: '' }] },
  { name: 'the name cluster is always a holder, even when the Worker folds it into the barcode cluster', patches: [{ file: DISMISS, from: "if (sharedBarcode(nameGroup) === null && leadingZeroFold(nameGroup) === null) keys.push(twinDismissalKey('name', nameKey))", to: "keys.push(twinDismissalKey('name', nameKey))" }] },
  { name: 'the name cluster is never a holder', patches: [{ file: DISMISS, from: "if (sharedBarcode(nameGroup) === null && leadingZeroFold(nameGroup) === null) keys.push(twinDismissalKey('name', nameKey))", to: '' }] },
  { name: 'the dismissal key drops the type (a barcode ruling and a name ruling are one)', patches: [{ file: DISMISS, from: 'export const twinDismissalKey = (type: string, value: string): string => `${type}${DELIM}${value}`', to: 'export const twinDismissalKey = (_type: string, value: string): string => `${value}`' }] },
  { name: 'the twin rule compares the collapsed name (inner spaces ignored), not the Worker\'s name_key', patches: [{ file: GROUPING, from: 'const name = serverNameKey(item?.name)', to: 'const name = normalizeProductGroupName(item?.name)' }] },
  { name: 'the name key lowers every letter, Unicode included (JS toLowerCase, not SQLite lower)', patches: [{ file: GROUPING, from: ".replace(/^ +| +$|[A-Z]/g, (found) => (found < 'A' ? '' : found.toLowerCase()))", to: ".replace(/^ +| +$|[A-Z]/g, (found) => (found < 'A' ? '' : found.toLowerCase())).toLowerCase()" }] },
  { name: 'the name key trims every kind of whitespace (JS trim, not SQLite trim)', patches: [{ file: GROUPING, from: ".replace(/^ +| +$|[A-Z]/g, (found) => (found < 'A' ? '' : found.toLowerCase()))", to: '.trim().replace(/[A-Z]/g, (found) => found.toLowerCase())' }] },
  { name: 'the barcode cluster floor is 6, not 4 (a 5-character shared code stops being a holder)', patches: [{ file: DISMISS, from: 'const MIN_BARCODE_CLUSTER_LENGTH = 4', to: 'const MIN_BARCODE_CLUSTER_LENGTH = 6' }] },
]
for (const mutant of MUTANTS) {
  const failures = await probe(mutant.patches)
  assert.ok(failures.length > 0, `mutant survived: ${mutant.name}`)
}

console.log(`PASS twin dismissals: ${KINDS.length} kinds of pair before and after "Keep both", partial rulings leave a still-listed pair tagged, the twin rule compares the Worker's name_key; ${MUTANTS.length} mutants killed`)
