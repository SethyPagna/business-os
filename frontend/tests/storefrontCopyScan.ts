// Every string the storefront renders through its translator, read from the real
// modules: the static import closure of PublicCatalogRoot.tsx, each copy(key,
// en, km) call outside an editor-only branch, and the computed-key sources named
// below. Shared by the tests that judge what a shopper reads.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { PORTAL_LEGAL_EN, legalText } from '../src/components/catalog/legal/legalContent.ts'

export const FRONTEND_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const SRC = path.join(FRONTEND_ROOT, 'src')
const STOREFRONT_ENTRY = path.join(SRC, 'PublicCatalogRoot.tsx')

export type StorefrontCopyEntry = { key: string; en: string; km?: string; site: string }

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')
export const readSource = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8')

const sourceCache = new Map<string, ts.SourceFile>()
export function parseSource(file: string): ts.SourceFile {
  let source = sourceCache.get(file)
  if (!source) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
    sourceCache.set(file, source)
  }
  return source
}

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return candidate
  }
  return null
}

function importedModules(file: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly
      const target = typeOnly ? null : resolveImport(file, node.moduleSpecifier.text)
      if (target) found.push(target)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      const target = specifier && ts.isStringLiteral(specifier) ? resolveImport(file, specifier.text) : null
      if (target) found.push(target)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(file))
  return found
}

export function storefrontModules(): string[] {
  const seen = new Set<string>()
  const queue = [STOREFRONT_ENTRY]
  while (queue.length) {
    const file = queue.shift() as string
    if (seen.has(file)) continue
    seen.add(file)
    queue.push(...importedModules(file))
  }
  return [...seen]
}

// The storefront `t` is AppContextCore's FALLBACK_APP_CONTEXT identity, so no
// src/lang/*.json value ever reaches a shopper; Khmer has to come from the portal pack.
export function storefrontTranslator(): (key: string) => string {
  const core = readSource('app/AppContextCore.tsx')
  const provider = readSource('app/PublicCatalogAppProvider.tsx')
  assert.match(core, /\bt: \(key: string\) => key,/, 'FALLBACK_APP_CONTEXT.t must be the identity this scan models')
  assert.match(provider, /\.\.\.FALLBACK_APP_CONTEXT,/, 'the storefront provider must spread FALLBACK_APP_CONTEXT')
  assert.doesNotMatch(provider, /\bt:/, 'the storefront provider must not bring its own t')
  return (key: string) => key
}

function stringValue(node: ts.Expression | undefined, file: string): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression, file)
  if (!ts.isIdentifier(node)) return undefined
  const source = parseSource(file)
  let value: string | undefined
  let importedFrom: string | null = null
  const visit = (child: ts.Node) => {
    if (value !== undefined) return
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === node.text && child.initializer) {
      value = stringValue(child.initializer as ts.Expression, file)
    }
    if (ts.isImportSpecifier(child) && child.name.text === node.text) {
      const declaration = child.parent.parent.parent
      if (ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)) {
        importedFrom = resolveImport(file, declaration.moduleSpecifier.text)
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(source)
  if (value === undefined && importedFrom) return stringValue(node, importedFrom)
  return value
}

// The storefront renders CatalogPreviewSurface with publicView and canEdit={false};
// anything behind the opposite guard is the admin Website Editor preview.
const STOREFRONT_GUARDS: Record<string, boolean> = { publicView: true, canEdit: false }

function assertStorefrontSurfaceGuards() {
  const page = parseSource(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'))
  const attributes = new Map<string, string>()
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(page) === 'CatalogPreviewSurface') {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(page), attribute.initializer ? attribute.initializer.getText(page) : 'true')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(page)
  assert.equal(attributes.get('publicView'), 'true', 'the storefront surface is rendered with publicView')
  assert.equal(attributes.get('canEdit'), '{false}', 'the storefront surface is rendered with canEdit={false}')
}

function guardValue(condition: ts.Expression, source: ts.SourceFile): boolean | undefined {
  const text = condition.getText(source)
  if (text in STOREFRONT_GUARDS) return STOREFRONT_GUARDS[text]
  if (text.startsWith('!') && text.slice(1) in STOREFRONT_GUARDS) return !STOREFRONT_GUARDS[text.slice(1)]
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (guardValue(condition.left, source) === false || guardValue(condition.right, source) === false) return false
  }
  if (ts.isParenthesizedExpression(condition)) return guardValue(condition.expression, source)
  return undefined
}

function editorOnly(node: ts.Node, source: ts.SourceFile): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) {
      const value = guardValue(parent.condition, source)
      if (value === false && child === parent.whenTrue) return true
      if (value === true && child === parent.whenFalse) return true
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && child === parent.right) {
      if (guardValue(parent.left, source) === false) return true
    }
  }
  return false
}

function objectLiteralEntries(file: string, site: string): StorefrontCopyEntry[] {
  const entries: StorefrontCopyEntry[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map<string, string | undefined>()
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) props.set(property.name.getText(), stringValue(property.initializer, file))
      }
      const key = props.get('labelKey')
      const en = props.get('fallback')
      if (key && en !== undefined) entries.push({ key, en, site })
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(file))
  return entries
}

function keyFallbackTuples(file: string, site: string): StorefrontCopyEntry[] {
  const entries: StorefrontCopyEntry[] = []
  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
      const [key, en] = node.elements.map((element) => stringValue(element as ts.Expression, file))
      if (key && en !== undefined && /^[a-z][A-Za-z]+$/.test(key)) entries.push({ key, en, site })
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(file))
  return entries
}

export const LEGAL_KEYS = new Set(Object.keys(PORTAL_LEGAL_EN))
const legalEntries = (site: string): StorefrontCopyEntry[] =>
  [...LEGAL_KEYS].map((key) => ({ key, en: legalText('en', key), km: legalText('km', key), site }))

const DYNAMIC_KEY_SOURCES: Record<string, (file: string, site: string) => StorefrontCopyEntry[]> = {
  'components/catalog/ProductDetailFlyout.tsx copy(meta.labelKey, meta.fallback)': objectLiteralEntries,
  'components/catalog/catalogUi.tsx copy(labelKey, fallback)': keyFallbackTuples,
  'components/catalog/legal/LegalPages.tsx copy(key, legalText(\'en\', key), legalText(\'km\', key))': (_file, site) => legalEntries(site),
  'components/catalog/PortalNoPaymentNotice.tsx copy(privacyKey, legalText(\'en\', privacyKey), legalText(\'km\', privacyKey))': (_file, site) => legalEntries(site),
  // InstallPromptBand's translate wrapper; its calls are scanned under `translate` below.
  'components/catalog/PublicCatalogPage.tsx copy(key, fallback, fallbackKm)': () => [],
}

// writeErrorPresentation has its own copy(t, key, fallback) over the admin `t`;
// PublicCatalogPage hands the storefront copy to InstallPromptBand as `translate`.
const TRANSLATORS: Record<string, (file: string) => boolean> = {
  copy: (file) => file !== 'utils/writeErrorPresentation.ts',
  translate: (file) => file === 'components/shared/InstallPromptBand.tsx',
}

export type StorefrontCopyScan = {
  entries: StorefrontCopyEntry[]
  unresolved: string[]
  unaccountedDynamic: string[]
  unmatchedDynamicSources: string[]
}

export function scanStorefrontCopy(): StorefrontCopyScan {
  assertStorefrontSurfaceGuards()
  const entries: StorefrontCopyEntry[] = []
  const unresolved: string[] = []
  const unaccountedDynamic: string[] = []
  const usedDynamicSources = new Set<string>()
  for (const file of storefrontModules()) {
    const source = parseSource(file)
    const relative = rel(file)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRANSLATORS[node.expression.text]?.(relative)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const site = `${relative}:${line}`
        const [keyNode, enNode, kmNode] = node.arguments
        const key = stringValue(keyNode, file)
        if (key === undefined) {
          const signature = `${relative} ${node.getText(source).replace(/\s+/g, ' ')}`
          const extract = DYNAMIC_KEY_SOURCES[signature]
          if (extract) {
            usedDynamicSources.add(signature)
            entries.push(...extract(file, site))
          } else {
            unaccountedDynamic.push(`${site} ${signature}`)
          }
        } else if (!editorOnly(node, source)) {
          const en = stringValue(enNode, file)
          const km = kmNode ? stringValue(kmNode, file) : undefined
          if (en === undefined || (kmNode && km === undefined)) unresolved.push(`${site} ${node.getText(source).slice(0, 120)}`)
          else entries.push({ key, en, km, site })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const unmatchedDynamicSources = Object.keys(DYNAMIC_KEY_SOURCES).filter((signature) => !usedDynamicSources.has(signature))
  return { entries, unresolved, unaccountedDynamic, unmatchedDynamicSources }
}

export function assertCompleteScan(scan: StorefrontCopyScan) {
  assert.deepEqual(scan.unaccountedDynamic, [], `a storefront translator call has a computed key; add where its keys come from:\n  ${scan.unaccountedDynamic.join('\n  ')}`)
  assert.deepEqual(scan.unmatchedDynamicSources, [], 'every dynamic key source still matches a call')
  assert.deepEqual(scan.unresolved, [], `a storefront translator call has a fallback this scan cannot read:\n  ${scan.unresolved.join('\n  ')}`)
  // A floor against a broken scan, not a quota.
  assert.ok(scan.entries.length >= 300, `expected the storefront's translator calls, found ${scan.entries.length}`)
}
