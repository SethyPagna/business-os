import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// tr() and t() look a key up. Neither interpolates.
//
// So a pack value containing {count} renders a LITERAL "{count}" to the
// operator unless the call site substitutes it by hand. The bug is invisible in
// review because the idiomatic call passes a template-literal fallback that
// reads perfectly:
//
//   tr('export_products_desc', `Choose which fields to include for ${n} ...`)
//
// The fallback is the only version a reader parses, and it is never reached:
// tr() falls back only when the key MISSES, and a key that ships in both packs
// never misses. Three sites shipped to production that way. This test pins the
// whole class rather than the three.
//
// There are TWO substitution idioms in this codebase and a check that knows
// only one over-reports 4x: chained `.replace('{k}', v)`, and a local
// `replaceVars(template, values)` helper (defined five times over, in
// CatalogPage, PublicCatalogPage, DuplicatesTab, SaleLinkConflictsSection and
// ProductDuplicatesTab). The window scans BACKWARD as well as forward because
// SaleLinkConflictsSection wraps a ternary of two tr() calls in a single
// replaceVars(), putting the substitution above both keys.

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')

// Mirrors AppContext.flattenTranslationTree, including its last-write-wins
// behaviour on duplicate leaf names -- that shadowing is what actually resolves
// at runtime, so the check must see the same values the operator does.
function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      target[key] = String(value)
      continue
    }
    if (Array.isArray(value)) continue
    flatten(value, target)
  }
  return target
}

const readPack = (name: string): Record<string, string> =>
  flatten(JSON.parse(fs.readFileSync(path.join(frontend, 'src', 'lang', name), 'utf8')))

const en = readPack('en.json')
const km = readPack('km.json')

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g

function placeholdersOf(key: string): string[] {
  const names = new Set<string>()
  for (const value of [en[key], km[key]]) {
    if (typeof value !== 'string') continue
    PLACEHOLDER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = PLACEHOLDER.exec(value)) !== null) names.add(match[1])
  }
  return [...names]
}

const placeholderKeys = new Set<string>()
for (const key of new Set([...Object.keys(en), ...Object.keys(km)])) {
  if (placeholdersOf(key).length) placeholderKeys.add(key)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

type Site = { file: string; line: number; key: string; unmet: string[] }

const sites: Site[] = []
let substitutedCount = 0

for (const file of walk(path.join(frontend, 'src'))) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    // tr('key', ...), the module-level tr(t, 'key', ...) form, and bare t('key').
    const call = line.match(/\b(?:tr|t)\s*\(\s*(?:t\s*,\s*)?['"]([a-z0-9_]+)['"]/)
    if (!call) return
    const key = call[1]
    if (!placeholderKeys.has(key)) return
    const window = lines
      .slice(Math.max(0, index - 6), Math.min(lines.length, index + 11))
      .join('\n')
    const unmet = placeholdersOf(key).filter((name) => {
      if (window.includes(`{${name}}`)) return false
      return !new RegExp(`replaceVars[\\s\\S]{0,400}?[{,]\\s*${name}\\s*[:,}]`).test(window)
    })
    if (unmet.length) sites.push({ file: path.relative(frontend, file).split(path.sep).join('/'), line: index + 1, key, unmet })
    else substitutedCount += 1
  })
}

// A SELF-RETIRING exemption, not a tolerated baseline. This site is already
// fixed on lane-a commit 6b2acc88; this branch is based on a486d82e, which
// predates it, so fixing it here would collide on the same line. The assertions
// below require it to be BOTH still present AND still broken -- so the moment
// lane-a merges, this test goes red and tells whoever merged it to delete this
// entry. It cannot rot into a permanent allowance.
const EXPECTED_UNFIXED = new Map<string, string>([
  ['src/components/inventory/FastStockInModal.tsx', 'stock_session_completed'],
])

const found = sites.map((s) => `${s.file}:${s.line} ${s.key} [${s.unmet.join(',')}]`).sort()

// 1. Nothing outside the exemption may render a literal placeholder.
const unexpected = sites.filter((s) => EXPECTED_UNFIXED.get(s.file) !== s.key)
assert.deepEqual(
  unexpected.map((s) => `${s.file}:${s.line} ${s.key} [${s.unmet.join(',')}]`).sort(),
  [],
  `these call sites resolve a pack key containing a placeholder but never substitute it, so the operator reads a literal {brace} in BOTH languages:\n  ${found.join('\n  ')}`,
)

// 2. The exemption must still be earning its place. When lane-a's fix arrives,
//    this fails -- delete the EXPECTED_UNFIXED entry, do not weaken the test.
for (const [file, key] of EXPECTED_UNFIXED) {
  assert.ok(
    sites.some((s) => s.file === file && s.key === key),
    `${file} (${key}) is no longer unfixed -- lane-a's fix has landed. Delete its EXPECTED_UNFIXED entry rather than keeping a permanent allowance.`,
  )
}

// 3. Non-vacuity. A scanner that silently matched nothing would satisfy check 1
//    while pinning nothing at all, so the corpus it actually walked is asserted.
assert.ok(placeholderKeys.size >= 150, `expected the packs to carry many placeholder keys, saw ${placeholderKeys.size}`)
assert.ok(substitutedCount >= 80, `expected the scan to find the substituting call sites too, saw ${substitutedCount}`)

// 4. The site this test was written for must keep substituting, named
//    individually so a future edit that reverts it is reported by name.
{
  const file = 'src/components/products/ExportFieldsModal.tsx'
  const key = 'export_products_desc'
  assert.ok(
    !sites.some((s) => s.file === file && s.key === key),
    `${file} stopped substituting ${key} -- it would ship a literal {count} again`,
  )
  assert.ok(
    fs.readFileSync(path.join(frontend, file), 'utf8').includes(`'${key}'`),
    `${file} must still resolve ${key} through the pack`,
  )
}

// 5. A SOURCE-TEXT assertion cannot see a sentence that lives in a language
//    pack, and that is how the worst of these shipped.
//
//    salesImportWorker.test.ts and inventoryImportWorker.test.ts each assert
//    `doesNotMatch(source, /Review and approve it from the top progress bar/)`,
//    because those two modals review and auto-approve IN-MODAL: their only
//    "later" affordance is the button labelled continue_in_background, and
//    there is no top-progress-bar approval step to send anyone to. Both
//    assertions passed. The sentence had moved into en.json/km.json, where a
//    source grep cannot reach it, so production told operators in BOTH
//    languages to go approve an import that had already been applied -- with a
//    literal {count} in it for good measure.
//
//    The fix was the pack value, not the call site: the fallback was right all
//    along. These assertions extend the existing source-level invariant to the
//    place the string actually lives.
for (const key of ['sales_import_started', 'inventory_import_started', 'stock_import_started_bg']) {
  for (const [lang, pack] of [['en', en], ['km', km]] as const) {
    assert.ok(pack[key], `${key} must exist in the ${lang} pack`)
    assert.doesNotMatch(
      pack[key],
      /top progress bar|របារវឌ្ឍនភាពខាងលើ/,
      `${lang}.${key} must not send the operator to a top-progress-bar approval: these imports auto-approve in-modal (see salesImportWorker.test.ts / inventoryImportWorker.test.ts)`,
    )
    assert.doesNotMatch(
      pack[key],
      /\{[a-zA-Z_][a-zA-Z0-9_]*\}/,
      `${lang}.${key} is a background-continuation notice with no count to report -- it must stay placeholder-free`,
    )
  }
}
//    contacts_import_started keeps the other shape on purpose: that flow really
//    does queue rows for a top-progress-bar approval, and it substitutes {count}
//    correctly at ContactImportModal.tsx.
assert.match(en.contacts_import_started, /\{count\} row\(s\) queued/)
assert.match(en.contacts_import_started, /top progress bar/)

console.log(`trPlaceholderSubstitution.test.ts OK (${placeholderKeys.size} placeholder keys, ${substitutedCount} substituting call sites, ${sites.length} exempt)`)
