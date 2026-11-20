// S2-F1 rests on one claim: outside the Account sheet, the storefront has no field where a guest types personal data. Google's translate
// script may read any field on the page, and portalTranslateAllowed (portalLanguageOptions.ts) keeps it off the page while the sheet is open
// or a shopper is signed in. This test pins the claim: every <input>, <textarea>, <select> and contentEditable that the storefront can
// render is listed below with its class, and a new one fails the build until somebody classifies it.
//
// Classes:
//   account-sheet   inside the Account sheet (CatalogAccountSection): the rule blocks Google while the sheet is open
//   not-personal    search, filters, page number, consent box, hidden select value
//   free-text       the Beauty Assistant: a question and two short notes about products, not contact details
//   editor-only     reachable only through the Website Editor's file picker, never opened by the public page
//
// Run: node tests/portalFieldInventory.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

type FieldClass = 'account-sheet' | 'not-personal' | 'free-text' | 'editor-only'
type Entry = { file: string; marker: string; count: number; purpose: string; cls: FieldClass }

const CATALOG = 'src/components/catalog/'
export const FIELD_INVENTORY: Entry[] = [
  { file: `${CATALOG}CatalogAccountSection.tsx`, marker: 'name="username"', count: 1, purpose: 'sign-in: membership id or phone', cls: 'account-sheet' },
  { file: `${CATALOG}CatalogAccountSection.tsx`, marker: 'name="tel" type="tel"', count: 2, purpose: 'sign-in phone and sign-up phone', cls: 'account-sheet' },
  { file: `${CATALOG}CatalogAccountSection.tsx`, marker: 'name="name"', count: 1, purpose: 'sign-up: name', cls: 'account-sheet' },
  { file: `${CATALOG}CatalogAccountSection.tsx`, marker: 'name="membership_id"', count: 1, purpose: 'sign-up: membership number', cls: 'account-sheet' },
  { file: `${CATALOG}CatalogAccountSection.tsx`, marker: "'password'", count: 1, purpose: 'password field (sign-in and sign-up, show/hide)', cls: 'account-sheet' },
  { file: `${CATALOG}CatalogProductsSection.tsx`, marker: 'name="product_search"', count: 1, purpose: 'product search', cls: 'not-personal' },
  { file: `${CATALOG}CatalogSecondaryTabs.tsx`, marker: 'name="portal_faq_search"', count: 1, purpose: 'FAQ search', cls: 'not-personal' },
  { file: `${CATALOG}CatalogSecondaryTabs.tsx`, marker: 'name="portal_assistant_question"', count: 1, purpose: 'Beauty Assistant question box', cls: 'free-text' },
  { file: `${CATALOG}CatalogSecondaryTabs.tsx`, marker: 'name="portal_assistant_goal"', count: 1, purpose: 'Beauty Assistant: goal', cls: 'free-text' },
  { file: `${CATALOG}CatalogSecondaryTabs.tsx`, marker: 'name="portal_assistant_concerns"', count: 1, purpose: 'Beauty Assistant: concerns', cls: 'free-text' },
  { file: `${CATALOG}PortalFilterCombobox.tsx`, marker: 'id={searchId}', count: 1, purpose: 'filter list search', cls: 'not-personal' },
  { file: `${CATALOG}legal/SignupConsentField.tsx`, marker: 'name="consent"', count: 1, purpose: 'sign-up consent checkbox (inside the sheet)', cls: 'not-personal' },
  { file: 'src/components/shared/AppSelect.tsx', marker: 'type="hidden"', count: 1, purpose: 'select value carried for forms', cls: 'not-personal' },
  { file: 'src/components/shared/PaginationControls.tsx', marker: 'aria-label={pageLabel}', count: 4, purpose: 'go-to-page number (four layouts)', cls: 'not-personal' },
  { file: 'src/components/files/FilePickerModal.tsx', marker: 'search_files', count: 1, purpose: 'file search (Website Editor picker)', cls: 'editor-only' },
  { file: 'src/components/files/FilePickerModal.tsx', marker: 'type="file"', count: 1, purpose: 'file upload (Website Editor picker)', cls: 'editor-only' },
  { file: 'src/components/shared/useConfirmDialog.tsx', marker: 'name="current_password"', count: 1, purpose: 'staff re-authentication in a confirm dialog', cls: 'editor-only' },
]

const FIELD_PATTERN = /<input\b|<textarea\b|<select\b|contentEditable|createElement\(\s*['"](?:input|textarea|select)['"]|role=["']textbox["']/g
const PERSONAL_PATTERN = /type=(?:["']|\{[^}]*)(?:password|tel|email)|inputMode=["']tel["']|autoComplete=(?:["'](?:username|tel|email|name|given-name|family-name|street-address|address-line1|postal-code|current-password|new-password|one-time-code)["']|\{)/
const WINDOW = 900

export type Field = { index: number; line: number; window: string }

export function scanFields(source: string): Field[] {
  const hits = [...source.matchAll(FIELD_PATTERN)].map((match) => match.index ?? 0)
  return hits.map((index, position) => {
    const end = Math.min(index + WINDOW, hits[position + 1] ?? Infinity)
    return { index, line: source.slice(0, index).split('\n').length, window: source.slice(index, end) }
  })
}

const resolveImport = (from: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.(ts|tsx)$/.test(candidate)) return candidate
  }
  return null
}

// Every source file the storefront entry can reach through import() and import ... from, minus the edges named in `skip`.
export function storefrontClosure(entry: string, skip: RegExp[] = []): string[] {
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      if (skip.some((pattern) => pattern.test(match[1]))) continue
      const next = resolveImport(file, match[1])
      if (next) walk(next)
    }
  }
  walk(path.join(frontend, entry))
  return [...seen].map((file) => path.relative(frontend, file).split(path.sep).join('/')).sort()
}

const read = (relative: string) => fs.readFileSync(path.join(frontend, relative), 'utf8').replace(/\r\n/g, '\n')

// Returns the problems found in `files`, given an inventory. Pure, so the positive control can drive it with a sample.
export function inventoryProblems(files: Record<string, string>, inventory: Entry[]): string[] {
  const problems: string[] = []
  const guidance = 'Classify it in tests/portalFieldInventory.test.ts. If it takes personal data (phone, e-mail, name, address, membership number, ID, password, code, or a message meant to carry contact details) outside the Account sheet, also extend portalTranslateAllowed in src/components/catalog/portalLanguageOptions.ts with a fourth input wired from that surface.'
  for (const [file, source] of Object.entries(files)) {
    const entries = inventory.filter((entry) => entry.file === file)
    const left = new Map(entries.map((entry) => [entry, entry.count]))
    for (const field of scanFields(source)) {
      const owner = entries.find((entry) => (left.get(entry) ?? 0) > 0 && field.window.includes(entry.marker))
      if (!owner) {
        problems.push(`unclassified field in ${file}:${field.line}: ${field.window.split('\n')[0].trim().slice(0, 100)}. ${guidance}`)
        continue
      }
      left.set(owner, (left.get(owner) ?? 0) - 1)
      if (PERSONAL_PATTERN.test(field.window) && owner.cls !== 'account-sheet' && owner.cls !== 'editor-only') {
        problems.push(`${file}:${field.line} takes personal data (${owner.purpose}) but is classed ${owner.cls}; only account-sheet fields may. ${guidance}`)
      }
      if (PERSONAL_PATTERN.test(field.window) && owner.cls === 'not-personal') {
        problems.push(`${file}:${field.line} looks personal but is classed not-personal`)
      }
    }
    for (const [entry, remaining] of left) {
      if (remaining > 0) problems.push(`stale inventory row in ${file}: "${entry.marker}" (${entry.purpose}) matched ${entry.count - remaining} of ${entry.count} fields`)
    }
  }
  return problems
}

const failures: string[] = []
const check = (name: string, run: () => void) => {
  try { run() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n').slice(0, 12).join(' | ')}`) }
}

check('positive control: a new input, a new textarea and a tel field in an unlisted spot are all flagged', () => {
  const sample = '<div><input type="tel" name="contact_phone" autoComplete="tel" /><textarea name="msg" /><select name="s"></select><div contentEditable /></div>'
  assert.equal(scanFields(sample).length, 4, 'all four kinds are found')
  const problems = inventoryProblems({ 'src/components/catalog/Sample.tsx': sample }, [])
  assert.equal(problems.length, 4)
  assert.match(problems[0], /extend portalTranslateAllowed/)
})

check('positive control: a personal field classed not-personal is refused, and a stale row is reported', () => {
  const file = 'src/components/catalog/Sample.tsx'
  const wrong = inventoryProblems({ [file]: '<input type="email" name="who" />' }, [{ file, marker: 'name="who"', count: 1, purpose: 'x', cls: 'not-personal' }])
  assert.ok(wrong.length > 0)
  const stale = inventoryProblems({ [file]: '<div />' }, [{ file, marker: 'name="who"', count: 1, purpose: 'x', cls: 'not-personal' }])
  assert.match(stale[0], /stale inventory row/)
})

const closure = storefrontClosure('src/PublicCatalogRoot.tsx')

check('every field the storefront can render is classified, none is stale, personal kinds sit only in the Account sheet', () => {
  const files: Record<string, string> = {}
  for (const file of closure) files[file] = read(file)
  // Rows for files that are no longer reachable are stale too.
  for (const entry of FIELD_INVENTORY) assert.ok(closure.includes(entry.file), `inventory row for ${entry.file}, which the storefront no longer reaches`)
  const problems = inventoryProblems(files, FIELD_INVENTORY)
  assert.deepEqual(problems, [], `${problems.length} field problem(s):\n  ${problems.join('\n  ')}`)
})

check('there is no personal-outside-sheet field: every personal kind lives in CatalogAccountSection or an editor-only file', () => {
  for (const file of closure) {
    for (const field of scanFields(read(file))) {
      if (!PERSONAL_PATTERN.test(field.window)) continue
      const cls = FIELD_INVENTORY.find((entry) => entry.file === file && field.window.includes(entry.marker))?.cls
      assert.ok(cls === 'account-sheet' || cls === 'editor-only', `${file}:${field.line} is personal and classed ${cls}`)
    }
  }
  const sheetFiles = new Set(FIELD_INVENTORY.filter((entry) => entry.cls === 'account-sheet').map((entry) => entry.file))
  assert.deepEqual([...sheetFiles], [`${CATALOG}CatalogAccountSection.tsx`])
})

check('editor-only files are reached only through the Website Editor file picker, which the public page never opens', () => {
  const withoutPicker = storefrontClosure('src/PublicCatalogRoot.tsx', [/files\/FilePickerModal/])
  for (const entry of FIELD_INVENTORY.filter((row) => row.cls === 'editor-only')) {
    assert.ok(!withoutPicker.includes(entry.file), `${entry.file} is reachable without the file picker`)
  }
  const page = read(`${CATALOG}PublicCatalogPage.tsx`)
  assert.equal((page.match(/setFilePicker/g) || []).length, 3, 'declared, and handed to the surface as setFilePicker={setFilePicker}; never called by the public page')
  assert.doesNotMatch(page, /setFilePicker\(/, 'the public page never opens a picker')
  const surface = read(`${CATALOG}CatalogPreviewSurface.tsx`)
  assert.doesNotMatch(surface, /setFilePicker\(\{ open: true/, 'the shared surface never opens a picker either')
})

check('the Account sheet fields are inside CatalogAccountSection, which the page mounts only in the sheet', () => {
  const page = read(`${CATALOG}PublicCatalogPage.tsx`)
  assert.equal((page.match(/<CatalogAccountSection\b/g) || []).length, 1, 'one mount')
  assert.match(page, /const accountDrawer = accountOpen \? \(/)
})

assert.deepEqual(failures, [], `field inventory:\n  ${failures.join('\n  ')}`)
console.log(`PASS field inventory: ${FIELD_INVENTORY.reduce((sum, entry) => sum + entry.count, 0)} fields in ${closure.length} storefront files, all classified, personal kinds only in the Account sheet`)
