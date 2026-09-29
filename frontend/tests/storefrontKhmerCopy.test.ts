// A first-time storefront visitor reads Khmer (P-public-1), so every string the
// storefront renders through its translator must resolve to real Khmer, not
// fall through to the English fallback.
//
// Run: node tests/storefrontKhmerCopy.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { localizeDefaultConfigCopy, resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { PORTAL_LEGAL_EN, legalText } from '../src/components/catalog/legal/legalContent.ts'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(ROOT, 'src')
const STOREFRONT_ENTRY = path.join(SRC, 'PublicCatalogRoot.tsx')
const KHMER_SCRIPT = /[ក-៿]/
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')
const read = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8')

const sourceCache = new Map<string, ts.SourceFile>()
function parse(file: string): ts.SourceFile {
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
  visit(parse(file))
  return found
}

function storefrontModules(): string[] {
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
{
  const core = read('app/AppContextCore.tsx')
  const provider = read('app/PublicCatalogAppProvider.tsx')
  assert.match(core, /\bt: \(key: string\) => key,/, 'FALLBACK_APP_CONTEXT.t must be the identity this test models')
  assert.match(provider, /\.\.\.FALLBACK_APP_CONTEXT,/, 'the storefront provider must spread FALLBACK_APP_CONTEXT')
  assert.doesNotMatch(provider, /\bt:/, 'the storefront provider must not bring its own t')
}
const STOREFRONT_T = (key: string) => key

type Entry = { key: string; en: string; km?: string; site: string }

function stringValue(node: ts.Expression | undefined, file: string): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression, file)
  if (!ts.isIdentifier(node)) return undefined
  const source = parse(file)
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
{
  const page = parse(path.join(SRC, 'components/catalog/PublicCatalogPage.tsx'))
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

function objectLiteralEntries(file: string, site: string): Entry[] {
  const entries: Entry[] = []
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
  visit(parse(file))
  return entries
}

function keyFallbackTuples(file: string, site: string): Entry[] {
  const entries: Entry[] = []
  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
      const [key, en] = node.elements.map((element) => stringValue(element as ts.Expression, file))
      if (key && en !== undefined && /^[a-z][A-Za-z]+$/.test(key)) entries.push({ key, en, site })
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(file))
  return entries
}

const legalEntries = (site: string): Entry[] =>
  Object.keys(PORTAL_LEGAL_EN).map((key) => ({ key, en: legalText('en', key), km: legalText('km', key), site }))

const DYNAMIC_KEY_SOURCES: Record<string, (file: string, site: string) => Entry[]> = {
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

const entries: Entry[] = []
const unresolved: string[] = []
const unaccountedDynamic: string[] = []
const usedDynamicSources = new Set<string>()
for (const file of storefrontModules()) {
  const source = parse(file)
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

assert.deepEqual(unaccountedDynamic, [], `a storefront translator call has a computed key; add where its keys come from:\n  ${unaccountedDynamic.join('\n  ')}`)
assert.deepEqual(Object.keys(DYNAMIC_KEY_SOURCES).filter((signature) => !usedDynamicSources.has(signature)), [], 'every dynamic key source still matches a call')
assert.deepEqual(unresolved, [], `a storefront translator call has a fallback this test cannot read:\n  ${unresolved.join('\n  ')}`)
// A floor against a broken scan, not a quota.
assert.ok(entries.length >= 300, `expected the storefront's translator calls, found ${entries.length}`)

// Proper names, spelled the same in every language.
const PROPER_NAME_KEYS: Record<string, string> = {
  messenger: 'Facebook Messenger, a product name',
  facebook: 'Facebook, a brand name',
  instagram: 'Instagram, a brand name',
  telegram: 'Telegram, a brand name',
  whatsapp: 'WhatsApp, a brand name',
}
const renderedKeys = new Set(entries.map((entry) => entry.key))
for (const key of Object.keys(PROPER_NAME_KEYS)) assert.ok(renderedKeys.has(key), `${key} is allow-listed but the storefront no longer renders it`)

const gaps = new Map<string, { english: string; khmer: string; sites: Set<string> }>()
for (const entry of entries) {
  if (entry.key in PROPER_NAME_KEYS) continue
  const english = resolveStorefrontCopy('en', STOREFRONT_T, entry.key, entry.en, entry.km)
  if (!/[A-Za-z]/.test(english.replace(PLACEHOLDER, ''))) continue
  const khmer = resolveStorefrontCopy('km', STOREFRONT_T, entry.key, entry.en, entry.km)
  if (khmer.trim() && khmer !== english && KHMER_SCRIPT.test(khmer)) continue
  const gap = gaps.get(entry.key) || { english, khmer, sites: new Set<string>() }
  gap.sites.add(entry.site)
  gaps.set(entry.key, gap)
}
const report = [...gaps].sort(([a], [b]) => a.localeCompare(b)).map(([key, gap]) => `${key} = "${gap.english}" -> km "${gap.khmer}" [${[...gap.sites].join(', ')}]`)
assert.deepEqual(report, [], `${report.length} storefront string(s) render English on the Khmer storefront:\n  ${report.join('\n  ')}`)

// The Worker fills these config fields with English when the merchant left them empty;
// that system text renders in Khmer too, while a merchant's own wording is kept.
{
  const worker = fs.readFileSync(path.join(ROOT, '..', 'cloudflare', 'src', 'routes', 'portal.ts'), 'utf8')
  const workerDefault = (pattern: RegExp) => {
    const match = pattern.exec(worker)
    assert.ok(match, `the Worker no longer fills ${pattern}`)
    return match[1]
  }
  const workerDefaults = {
    faqTitle: workerDefault(/faqTitle: settings\.customer_portal_faq_title \|\| '([^']+)'/),
    aiTitle: workerDefault(/aiTitle: settings\.customer_portal_ai_title \|\| '([^']+)'/),
    aiDisclaimer: workerDefault(/aiDisclaimer: settings\.customer_portal_ai_disclaimer\s*\|\| '([^']+)'/),
  }
  const website = workerDefault(/website: settings\.customer_portal_website_label \|\| '([^']+)'/)
  const config = { ...workerDefaults, linkLabels: { website, facebook: 'Facebook' } }

  const khmer = localizeDefaultConfigCopy(config, 'km')
  for (const [field, english] of Object.entries(workerDefaults)) {
    const value = String(khmer[field as keyof typeof workerDefaults])
    assert.ok(KHMER_SCRIPT.test(value) && value !== english, `the Worker default ${field} "${english}" renders "${value}" on the Khmer storefront`)
  }
  assert.ok(KHMER_SCRIPT.test(khmer.linkLabels.website), `the Worker default website label renders "${khmer.linkLabels.website}" on the Khmer storefront`)
  assert.equal(khmer.linkLabels.facebook, 'Facebook')
  assert.deepEqual(localizeDefaultConfigCopy(config, 'en'), config)
  const merchantWording = { faqTitle: 'Ask us anything', aiTitle: 'Skin coach', linkLabels: { website: 'Our online shop' } }
  assert.deepEqual(localizeDefaultConfigCopy(merchantWording, 'km'), merchantWording)
  assert.match(
    read('components/catalog/PublicCatalogPage.tsx'),
    /localizeDefaultConfigCopy\(\{ \.\.\.DEFAULT_PUBLIC_CONFIG, \.\.\.config \}, pageLanguage\)/,
    'the storefront displayConfig applies it in the routed page language',
  )
}

console.log(`storefrontKhmerCopy: ${renderedKeys.size} storefront keys from ${entries.length} translator calls resolve to Khmer, and so do the Worker's default config texts`)
