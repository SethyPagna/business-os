// FX-ui (H-ui findings 2 + 3, 27 Sep 2026): a Khmer session must never be
// handed an English string by a local "English, then Khmer" copy helper.
//
// The app has two families of local helpers that sit beside the real packs:
//
//   en-first   posCopy(en, km = en)            -- POS.tsx, ProductOptionSheet,
//              copy: (en, km?) => string props  the ProductCard / detail sheet
//   key-first  translateOr(key, en, km = en)   -- Sales, SaleDetailModal,
//              tr / copy (key, en, km = en)      Dashboard and ~15 more
//
// Both default the Khmer argument to the English one. So a call that passes
// only English compiles, looks finished, and renders English in a Khmer
// session -- the hunt found 15 such posCopy calls on the till and a dozen
// translateOr keys that exist in neither pack. verify:i18n cannot see this:
// its call-shape scan does not know the name translateOr, and en-first
// helpers take no key at all.
//
// This check finds every such helper by SHAPE (a parameter whose default is
// the previous parameter, or a `(string, string?) => string` prop type), not
// by a fixed list of names, so the next local helper is covered on arrival.
// A call fails when:
//   - en-first: it omits the Khmer argument, or passes a Khmer literal that is
//     identical to its English literal (the same bug, spelled out);
//   - key-first: its literal key resolves in neither pack AND it omits the
//     Khmer argument; or its key is missing from the packs while a Khmer
//     literal is passed that is identical to the English one.
// A call whose key is not a literal (computed) is only held to the Khmer-
// argument rule when its English fallback is a literal with Latin text --
// tr(key, '') is a pass-through lookup, not English copy.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(FRONTEND, 'src')

type Tree = Record<string, unknown>
function flatten(input: Tree, target: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Tree, target)
    else target[key] = String(value)
  }
  return target
}
const readPack = (name: string) => flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', name), 'utf8')) as Tree)
const EN = readPack('en.json')
const KM = readPack('km.json')
const inBothPacks = (key: string) => EN[key] !== undefined && KM[key] !== undefined

type HelperKind = 'en-first' | 'key-first'

function unwrapHook(node: ts.Expression | undefined): ts.Expression | undefined {
  // useCallback((...) => ..., deps) and useMemo(() => (...) => ..., deps)
  if (node && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const hook = node.expression.text
    const first = node.arguments[0]
    if (hook === 'useCallback') return first
    if (hook === 'useMemo' && first && ts.isArrowFunction(first)) return returnedFunction(first)
  }
  return node
}

function returnedFunction(fn: ts.SignatureDeclaration & { body?: ts.Node }): ts.Expression | undefined {
  const body = fn.body
  if (!body) return undefined
  if (!ts.isBlock(body)) return body as ts.Expression
  let found: ts.Expression | undefined
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) found = statement.expression
  }
  return found
}

// A parameter list whose LAST parameter is the Khmer one (named km/khmer)
// and defaults to the one before it: the "km = en" shape. Two parameters is
// en-first; three is key-first. The name test keeps unrelated functions with
// a chained default (formatPhoneInputEdit, ...) out.
function helperKindOf(node: ts.Node | undefined): HelperKind | null {
  if (!node || !(ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))) return null
  const params = node.parameters
  if (params.length < 2) return null
  const last = params[params.length - 1]
  const prev = params[params.length - 2]
  if (!last.initializer || !ts.isIdentifier(last.initializer)) return null
  if (!ts.isIdentifier(prev.name) || last.initializer.text !== prev.name.text) return null
  if (!ts.isIdentifier(last.name) || !/km|khmer/i.test(last.name.text)) return null
  if (params.length === 2) return 'en-first'
  if (params.length === 3) return 'key-first'
  return null
}

function isStringKeyword(type: ts.TypeNode | undefined): boolean {
  return !!type && type.kind === ts.SyntaxKind.StringKeyword
}

// `(en: string, km?: string) => string` -- a prop/alias that carries an
// en-first helper across a file boundary (ProductCard.copy, PosCopy).
function isEnFirstFunctionType(type: ts.TypeNode | undefined): boolean {
  if (!type || !ts.isFunctionTypeNode(type)) return false
  const [en, km] = type.parameters
  return type.parameters.length === 2
    // (key: string, fallback?: string) is a pack lookup, not an en/km pair.
    && ts.isIdentifier(en.name) && !/key/i.test(en.name.text)
    && isStringKeyword(en.type) && !en.questionToken
    && isStringKeyword(km.type) && !!km.questionToken
    && isStringKeyword(type.type)
}

function collectHelpers(sf: ts.SourceFile): Map<string, HelperKind> {
  const helpers = new Map<string, HelperKind>()
  const enFirstAliases = new Set<string>()
  const factories = new Map<string, HelperKind>()

  const visitDefs = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && isEnFirstFunctionType(node.type)) enFirstAliases.add(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const kind = helperKindOf(unwrapHook(node.initializer))
      if (kind) helpers.set(node.name.text, kind)
      // const useLocalCopy = () => { ...; return (key, en, km = en) => ... }
      if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const factoryKind = helperKindOf(unwrapHook(returnedFunction(node.initializer)))
        if (factoryKind) factories.set(node.name.text, factoryKind)
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const kind = helperKindOf(node)
      if (kind) helpers.set(node.name.text, kind)
      const factoryKind = helperKindOf(unwrapHook(returnedFunction(node)))
      if (factoryKind) factories.set(node.name.text, factoryKind)
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const kind = helperKindOf(node.initializer)
      if (kind) helpers.set(node.name.text, kind)
    }
    ts.forEachChild(node, visitDefs)
  }
  visitDefs(sf)

  const visitUses = (node: ts.Node): void => {
    // const tr = useLocalCopy()
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)) {
      const factoryKind = factories.get(node.initializer.expression.text)
      if (factoryKind) helpers.set(node.name.text, factoryKind)
    }
    // copy: (en: string, km?: string) => string   /   posCopy: PosCopy
    if ((ts.isPropertySignature(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const type = node.type
      const aliased = type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && enFirstAliases.has(type.typeName.text)
      if (isEnFirstFunctionType(type) || aliased) helpers.set(node.name.text, 'en-first')
    }
    ts.forEachChild(node, visitUses)
  }
  visitUses(sf)
  return helpers
}

function literalText(node: ts.Expression | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

const LATIN = /[A-Za-z]/

type Violation = { file: string; line: number; helper: string; problem: string }

function scanSource(file: string, text: string): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const helpers = collectHelpers(sf)
  if (!helpers.size) return []
  const violations: Violation[] = []
  const report = (node: ts.Node, helper: string, problem: string) => {
    violations.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, helper, problem })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
      const helper = node.expression.text
      const kind = helpers.get(helper)!
      const args = node.arguments
      if (kind === 'en-first') {
        const en = literalText(args[0])
        const km = literalText(args[1])
        if (args.length < 2) report(node, helper, `English only: ${JSON.stringify(literalText(args[0]) ?? args[0]?.getText(sf))}`)
        else if (en !== null && km !== null && en === km && LATIN.test(en)) report(node, helper, `Khmer argument repeats the English ${JSON.stringify(en)}`)
      } else {
        const key = literalText(args[0])
        const en = literalText(args[1])
        const km = literalText(args[2])
        const resolved = key !== null && inBothPacks(key)
        if (!resolved && args.length < 3 && (key !== null || (en !== null && LATIN.test(en)))) {
          report(node, helper, `key ${JSON.stringify(key ?? args[0]?.getText(sf))} is in neither pack and no Khmer fallback is passed`)
        } else if (!resolved && key !== null && en !== null && km !== null && en === km && LATIN.test(en)) {
          report(node, helper, `key ${JSON.stringify(key)} is in neither pack and the Khmer fallback repeats the English`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return violations
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'lang') walk(full, out); continue }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

// ---- The instrument has to tell right from wrong (positive controls). ----
const fixtures = scanSource('fixture.tsx', `
  const posCopy = useCallback((en: string, km = en) => km, [])
  const translateOr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn) => fallbackKm, [])
  function useLocalCopy() { return (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => fallbackKm }
  const tr = useLocalCopy()
  type PosCopy = (en: string, km?: string) => string
  function Card({ copy, pc, t }: { copy: (en: string, km?: string) => string; pc: PosCopy; t: (key: string, fallback?: string) => string }) { return null }
  posCopy('Balance')                                    // bad: English only
  posCopy('Balance', 'Balance')                         // bad: km repeats en
  posCopy('Balance', 'សមតុល្យ')                         // ok
  translateOr('definitely_not_a_pack_key', 'No driver') // bad: unknown key, no km
  translateOr('definitely_not_a_pack_key', 'X', 'X')    // bad: unknown key, km repeats en
  translateOr('definitely_not_a_pack_key', 'No driver', 'គ្មានអ្នកដឹក') // ok: Khmer given
  translateOr('cancel', 'Cancel')                       // ok: key is in both packs
  tr('definitely_not_a_pack_key', 'Oops')               // bad: factory-made helper
  copy('Total')                                         // bad: prop-typed helper
  pc('Total')                                           // bad: alias-typed helper
  t('promo_new_rule')                                   // ok: a pack lookup, not an en/km pair
  tr(computedKey, '')                                   // ok: pass-through lookup
`)
assert.deepEqual(
  fixtures.map((v) => `${v.helper}@${v.line}`),
  ['posCopy@8', 'posCopy@9', 'translateOr@11', 'translateOr@12', 'tr@15', 'copy@16', 'pc@17'],
  'the scanner flags exactly the English-only calls in the fixture',
)

// ---- The real source. ----
const violations = walk(SRC).flatMap((file) => scanSource(path.relative(FRONTEND, file).replace(/\\/g, '/'), fs.readFileSync(file, 'utf8')))
if (violations.length) {
  console.error(`localCopyKhmerFallback: ${violations.length} call(s) would show English in a Khmer session:`)
  for (const v of violations) console.error(`  ${v.file}:${v.line} ${v.helper}() -- ${v.problem}`)
}
assert.equal(violations.length, 0, 'every local en/km copy call gives Khmer a real string (a pack key or a Khmer argument)')
console.log('PASS every local English/Khmer copy helper call resolves to Khmer in a Khmer session')
