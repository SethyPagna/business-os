// The photo viewer's zoom buttons are named in the viewer's language: the storefront passes its
// portal_a11y_* pack names, the admin viewers their t() names, and the viewer keeps only an English fallback.
//
// Run: node tests/lightboxZoomLabels.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { SRC, parseSource, storefrontTranslator } from './storefrontCopyScan.ts'

const LIGHTBOX = 'components/shared/ImageGalleryLightbox.tsx'
const STOREFRONT_CALLERS = ['components/catalog/CatalogPreviewSurface.tsx', 'components/catalog/ProductDetailFlyout.tsx']
const ADMIN_CALLERS = ['components/pos/POS.tsx', 'components/products/Products.tsx']
const ZOOM_LABELS = { zoomIn: { storefront: 'portal_a11y_zoom_in', admin: 'zoom_in' }, zoomOut: { storefront: 'portal_a11y_zoom_out', admin: 'zoom_out' } } as const

const readPack = (name: string) => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', `${name}.json`), 'utf8')) as Record<string, unknown>
const en = readPack('en')
const km = readPack('km')
const KHMER_SCRIPT = /[ក-៿]/

function jsxAttributes(file: string, visit: (element: ts.JsxOpeningLikeElement, source: ts.SourceFile) => void) {
  const source = parseSource(path.join(SRC, file))
  const walk = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) visit(node, source)
    ts.forEachChild(node, walk)
  }
  walk(source)
}

const literalAriaLabels: string[] = []
jsxAttributes(LIGHTBOX, (element, source) => {
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'aria-label' && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
      literalAriaLabels.push(`${attribute.initializer.text} (line ${source.getLineAndCharacterOfPosition(attribute.getStart()).line + 1})`)
    }
  }
})
assert.deepEqual(literalAriaLabels, [], 'every accessible name in the viewer comes from its labels, never an English literal')

function constInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let initializer: ts.Expression | undefined
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer
    ts.forEachChild(node, walk)
  }
  walk(source)
  return initializer
}

function lightboxLabelsOf(file: string): Map<string, ts.Expression>[] {
  const found: Map<string, ts.Expression>[] = []
  jsxAttributes(file, (element, source) => {
    if (element.tagName.getText(source) !== 'ImageGalleryLightbox') return
    const labels = element.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'labels')
    assert.ok(labels && ts.isJsxAttribute(labels) && labels.initializer && ts.isJsxExpression(labels.initializer), `${file}: the viewer gets its labels`)
    const expression = labels.initializer.expression
    const literal = expression && ts.isIdentifier(expression) ? constInitializer(source, expression.text) : expression
    assert.ok(literal && ts.isObjectLiteralExpression(literal), `${file}: labels is an object literal`)
    found.push(new Map(literal.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(source), property.initializer])))
  })
  assert.ok(found.length, `${file} opens the viewer`)
  return found
}

const stringArguments = (expression: ts.Expression | undefined) =>
  expression && ts.isCallExpression(expression) ? expression.arguments.map((argument) => (ts.isStringLiteralLike(argument) ? argument.text : undefined)) : []

const t = storefrontTranslator()
for (const file of STOREFRONT_CALLERS) {
  for (const labels of lightboxLabelsOf(file)) {
    for (const [label, keys] of Object.entries(ZOOM_LABELS)) {
      const [key, fallback, fallbackKm] = stringArguments(labels.get(label))
      assert.equal(key, keys.storefront, `${file}: ${label} is the storefront's ${keys.storefront} name`)
      assert.equal(resolveStorefrontCopy('en', t, key, fallback, fallbackKm), en[key], `${file}: English ${label} is the pack's`)
      const khmer = resolveStorefrontCopy('km', t, key, fallback, fallbackKm)
      assert.equal(khmer, km[key], `${file}: Khmer ${label} is the pack's`)
      assert.match(khmer, KHMER_SCRIPT, `${file}: Khmer shoppers hear ${label} in Khmer`)
    }
    const [closeKey, closeFallback, closeFallbackKm] = stringArguments(labels.get('close'))
    assert.match(resolveStorefrontCopy('km', t, String(closeKey), closeFallback, closeFallbackKm), KHMER_SCRIPT, `${file}: Khmer shoppers hear the close button in Khmer`)
  }
}
for (const file of ADMIN_CALLERS) {
  for (const labels of lightboxLabelsOf(file)) {
    for (const [label, keys] of Object.entries(ZOOM_LABELS)) {
      const call = labels.get(label)
      assert.ok(call && ts.isCallExpression(call) && call.expression.getText() === 't', `${file}: ${label} comes from t()`)
      assert.equal(stringArguments(call)[0], keys.admin, `${file}: ${label} reads ${keys.admin}`)
      assert.match(String(km[keys.admin]), KHMER_SCRIPT, `km.json names ${keys.admin} in Khmer`)
      assert.ok(en[keys.admin], `en.json names ${keys.admin}`)
    }
  }
}

const requireActual = createRequire(import.meta.url)
const inlinePortals = (specifier: string) =>
  specifier === 'react-dom' ? { ...requireActual('react-dom'), createPortal: (children: React.ReactNode) => children } : requireActual(specifier)
const bundle = buildSync({
  entryPoints: [path.join(SRC, LIGHTBOX)],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  write: false,
  logLevel: 'silent',
})
const module = { exports: {} as Record<string, unknown> }
const portalTarget = { body: null }
new Function('require', 'module', 'exports', 'document', bundle.outputFiles[0].text)(inlinePortals, module, module.exports, portalTarget)
const ImageGalleryLightbox = module.exports.default as React.ComponentType<Record<string, unknown>>
const khmerLabels = { zoomIn: String(km.portal_a11y_zoom_in), zoomOut: String(km.portal_a11y_zoom_out), close: 'បិទ' }
for (const variant of ['immersive', 'default']) {
  const html = renderToStaticMarkup(React.createElement(ImageGalleryLightbox, { open: true, images: ['/a.png', '/b.png'], labels: khmerLabels, variant }))
  assert.ok(html.includes(`aria-label="${khmerLabels.zoomIn}"`), `the ${variant} viewer names zoom in from its labels`)
  assert.ok(html.includes(`aria-label="${khmerLabels.zoomOut}"`), `the ${variant} viewer names zoom out from its labels`)
  assert.doesNotMatch(html, /aria-label="Zoom (?:in|out)"/, `the ${variant} viewer never falls back to English when labels are given`)
  const fallback = renderToStaticMarkup(React.createElement(ImageGalleryLightbox, { open: true, images: ['/a.png'], variant }))
  assert.ok(fallback.includes('aria-label="Zoom in"') && fallback.includes('aria-label="Zoom out"'), `the ${variant} viewer keeps an English fallback`)
}

console.log(`lightboxZoomLabels: ${STOREFRONT_CALLERS.length} storefront and ${ADMIN_CALLERS.length} admin callers name the zoom buttons from the packs; both viewer variants render them`)
