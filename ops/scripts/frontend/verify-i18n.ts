// verify:i18n — translation-coverage lock (Part 545).
//
// package.json has pointed `npm run verify:i18n` at this path since before
// Part 545, but the file itself never existed; the Part-545 sweep that added
// ~340 missing pack keys (import/export flows, ResetData finalize wizard,
// returns exchange, contact-import conflicts, ProductForm match dialogs,
// fast stock-in, restore maintenance, ...) created it as the regression
// lock. langKeyIntegrity.test.ts asserts only the bare-t() form and merely
// REPORTS fallback-wrapper coverage; this script asserts the whole thing:
//
//   1. en.json and km.json expose the same key set (top-level).
//   2. Every key the source references through ANY lookup shape resolves in
//      the FLATTENED packs (AppContext flattens nested trees like `common`):
//        t('key')  T('key', ...)  tr(...)  safeT(...)  copy(...)
//        translate(t, 'key', ...)  tProp?.('key', ...)
//      A key that resolves in neither pack renders raw-key or English in
//      Khmer mode — the "sections/buttons not translated" class of bug.
//   3. Every CORE_ENGLISH_PACK key in AppContext.tsx has a km.json entry.
//   4. No top-level key is DEFINED TWICE in either pack. Two lanes adding the
//      same key at different offsets auto-merge with no conflict -- the hunks
//      never touch -- and JSON.parse then keeps only the last, so the earlier
//      value is dead and unreachable. Checks 1-3 all run on the parsed object,
//      where the duplicate has already been resolved away; this one reads the
//      raw text. Found live in both packs on 2026-09-06.
//   5. No pack value DROPS a {placeholder} its own call site substitutes. The
//      slot check below compares en against km, so it passes when BOTH packs
//      lost the same slot -- which is how confirm_complete_stock_session_mixed
//      shipped in both languages with none of {lines}, {adds}, {removes},
//      {sets} or {branch}, silently dropping the breakdown and the branch name
//      from a mutating stock confirmation. The source's inline English
//      fallback states what the call site actually substitutes, so it is the
//      reference. Checks 4 and 5 are pure functions in ./i18nPackChecks.ts,
//      exercised on crafted input by frontend/tests/i18nPackGates.test.ts.
//
// Run: npm run verify:i18n   (from frontend/)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { duplicateTopLevelKeys, fallbackSlotRegressions } from './i18nPackChecks.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'frontend')

type Tree = Record<string, unknown>
const flatten = (input: Tree, target: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Tree, target)
    else target[key] = String(value)
  }
  return target
}

const readPack = (name: string): Tree => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', name), 'utf8')) as Tree
const rawText = (name: string): string => fs.readFileSync(path.join(FRONTEND, 'src', 'lang', name), 'utf8')
const enRaw = readPack('en.json')
const kmRaw = readPack('km.json')
const en = flatten(enRaw)
const km = flatten(kmRaw)

const failures: string[] = []

// 0. Duplicate top-level keys -- read from the RAW text, because every check
// below this line runs on the parsed object, where JSON.parse has already
// silently discarded the earlier definition.
for (const name of ['en.json', 'km.json']) {
  for (const problem of duplicateTopLevelKeys(rawText(name))) failures.push(`${name}: ${problem}`)
}

// 1. pack parity (top-level, same as langKeyIntegrity)
const enTop = new Set(Object.keys(enRaw))
const kmTop = new Set(Object.keys(kmRaw))
for (const k of enTop) if (!kmTop.has(k)) failures.push(`km.json missing key: ${k}`)
for (const k of kmTop) if (!enTop.has(k)) failures.push(`en.json missing key (stale km?): ${k}`)

// 2. every referenced key resolves
const files: string[] = []
const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (entry.name !== 'lang' && entry.name !== 'node_modules') walk(path.join(dir, entry.name)); continue }
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(path.join(dir, entry.name))
  }
}
walk(path.join(FRONTEND, 'src'))

const CALL_SHAPES = [
  /\b(?:T|tr|safeT|copy)\(\s*'([a-z][a-z0-9_]*)'/g,
  /\btranslate\(\s*t\s*,\s*'([a-z][a-z0-9_]*)'/g,
  /\bt(?:Prop)?\??\.?\(\s*'([a-z][a-z0-9_]*)'\s*[),]/g,
  // PermissionEditor-style local wrapper: translate('key', 'Fallback').
  /\btranslate\(\s*'([a-z][a-z0-9_]*)'\s*,/g,
  // Data-table translation references (PERMISSION_SECTIONS /
  // PERMISSION_ACTIONS): tKey: 'perm_...', reviewTKey: 'perm_...'. These
  // render through translate(action.tKey, ...) at runtime, which no call-
  // shape scan can see -- catch them at the table instead.
  /\btKey:\s*'([a-z][a-z0-9_]*)'/g,
  /\breviewTKey:\s*'([a-z][a-z0-9_]*)'/g,
]
const missing = new Map<string, Set<string>>()
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  for (const shape of CALL_SHAPES) {
    for (const m of src.matchAll(shape)) {
      const key = m[1]
      if (en[key] !== undefined || km[key] !== undefined) continue
      if (!missing.has(key)) missing.set(key, new Set())
      missing.get(key)!.add(path.relative(FRONTEND, file).replace(/\\/g, '/'))
    }
  }
}
for (const [key, where] of [...missing.entries()].sort()) {
  failures.push(`unresolved key '${key}' (${[...where].join(', ')}) — add it to en.json AND km.json`)
}

// 3. CORE_ENGLISH_PACK keys must be translatable
const appCtx = fs.readFileSync(path.join(FRONTEND, 'src', 'AppContext.tsx'), 'utf8')
const coreBlock = appCtx.match(/const CORE_ENGLISH_PACK: TranslationPack = \{([\s\S]*?)\n\}/)
if (coreBlock) {
  for (const m of coreBlock[1].matchAll(/^\s*([a-z0-9_]+):/gim)) {
    if (km[m[1]] === undefined) failures.push(`CORE_ENGLISH_PACK key '${m[1]}' has no km.json entry`)
  }
}

// 4. Interpolation slots must match between the packs.
//
// Every call site substitutes with a literal .replace('{n}', String(count)),
// so a slot that exists in one pack and not the other does NOT throw -- the
// replace is simply a no-op and the number vanishes from that language only.
// Two live keys shipped that way since the initial import: en's
// match_import_images and sync_online_devices had lost their {n} while km
// kept it, so Khmer showed the count and English did not. Key-set parity
// (check 2) cannot see this -- both packs have the key; only the value differs.
const SLOT = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g
const slotsOf = (v: string) => new Set(v.match(SLOT) ?? [])
for (const key of enTop) {
  const e = en[key]
  const k = km[key]
  if (typeof e !== 'string' || typeof k !== 'string') continue
  const inEn = slotsOf(e)
  const inKm = slotsOf(k)
  const enOnly = [...inEn].filter((x) => !inKm.has(x))
  const kmOnly = [...inKm].filter((x) => !inEn.has(x))
  if (enOnly.length || kmOnly.length) {
    const detail = [
      enOnly.length ? `en-only ${enOnly.join(' ')}` : '',
      kmOnly.length ? `km-only ${kmOnly.join(' ')}` : '',
    ].filter(Boolean).join(', ')
    failures.push(
      `interpolation slots differ for '${key}' (${detail}) — the pack missing the ` +
        `slot silently drops the value instead of failing; give both packs the same slots`,
    )
  }
}
// 5. A pack value that DROPS a slot its own call site substitutes. Check 4
// above only compares the two packs against each other, so it is blind to the
// case where both lost the same slot.
for (const problem of fallbackSlotRegressions(
  files.map((file) => ({ file: path.relative(FRONTEND, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') })),
  { en, km },
)) failures.push(problem)

if (failures.length) {
  console.error(`verify:i18n FAILED — ${failures.length} problem(s):`)
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log(`verify:i18n OK — ${enTop.size} pack keys, ${files.length} source files, every referenced key resolves in both packs`)
