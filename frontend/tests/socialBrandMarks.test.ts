import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

function compile(rel: string, resolve: (id: string) => unknown): Record<string, any> {
  const code = transformSync(read(rel), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}

const reactOnly = (name: string) => (id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  throw new Error(`${name} imports ${id}, which this harness does not provide`)
}
const brand = compile('../src/components/shared/BrandIcons.tsx', reactOnly('BrandIcons.tsx'))
const legalContent = await import('../src/components/catalog/legal/legalContent.ts') as Record<string, any>
const Icon = () => null
const legal = compile('../src/components/catalog/legal/LegalPages.tsx', (id) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.startsWith('lucide-react/')) return { __esModule: true, default: Icon }
  if (id.endsWith('/legalContent.ts')) return legalContent
  if (id.endsWith('/BrandIcons.tsx')) return brand
  if (id.endsWith('/documentScrollLock.ts')) return { lockDocumentScroll: () => () => {} }
  throw new Error(`LegalPages.tsx imports ${id}, which this harness does not provide`)
})

const FACEBOOK_PATH_START = 'M9.101 23.691v-7.98H6.627v-3.667h2.474'
const INSTAGRAM_PATH_START = 'M7.0301.084c-1.2768.0602'
const render = (component: unknown, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(component, props))

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

runCase('Facebook and Instagram are inline SVG marks that take their colour and size from the caller, like the Lucide icons they replace', () => {
  for (const [component, start, mark] of [[brand.FacebookIcon, FACEBOOK_PATH_START, 'facebook'], [brand.InstagramIcon, INSTAGRAM_PATH_START, 'instagram']] as const) {
    const markup = render(component, { className: 'h-4 w-4 shrink-0 text-[#1877F2]' })
    assert.match(markup, /^<svg /)
    assert.match(markup, /viewBox="0 0 24 24"/)
    assert.match(markup, /fill="currentColor"/)
    assert.match(markup, /class="h-4 w-4 shrink-0 text-\[#1877F2\]"/)
    assert.match(markup, /aria-hidden="true"/)
    assert.ok(markup.includes(`data-brand-mark="${mark}"`))
    assert.ok(markup.includes(`d="${start}`), `${mark}: not the brand's own mark`)
    assert.equal((markup.match(/<path /g) || []).length, 1)
    assert.match(render(component, { size: 40, color: '#111' }), /width="40" height="40"[^>]*fill="#111"/)
  }
  assert.notEqual(render(brand.FacebookIcon), render(brand.InstagramIcon))
})

runCase('Telegram, WhatsApp and TikTok are inline SVG marks with the same contract, each distinct from every other mark', () => {
  const marks = [
    [brand.TelegramIcon, 'M11.944 0A12 12 0 0 0 0 12', 'telegram'],
    [brand.WhatsAppIcon, 'M17.472 14.382c-.297-.149', 'whatsapp'],
    [brand.TikTokIcon, 'M12.525.02c1.31-.02', 'tiktok'],
  ] as const
  for (const [component, start, mark] of marks) {
    const markup = render(component, { className: 'h-4 w-4 shrink-0' })
    assert.match(markup, /^<svg /)
    assert.match(markup, /viewBox="0 0 24 24"/)
    assert.match(markup, /fill="currentColor"/)
    assert.match(markup, /class="h-4 w-4 shrink-0"/)
    assert.match(markup, /aria-hidden="true"/)
    assert.ok(markup.includes(`data-brand-mark="${mark}"`))
    assert.ok(markup.includes(`d="${start}`), `${mark}: not the brand's own mark`)
    assert.equal((markup.match(/<path /g) || []).length, 1)
    assert.match(render(component, { size: 40, color: '#111' }), /width="40" height="40"[^>]*fill="#111"/)
  }
  const all = [brand.FacebookIcon, brand.InstagramIcon, ...marks.map(([component]) => component)].map((component) => render(component))
  assert.equal(new Set(all).size, all.length, 'every brand mark renders differently')
})

runCase('the storefront footer shows the Facebook and Instagram marks beside their labels, and nothing else changed in the link', () => {
  const copy = (_key: string, fallbackEn?: string) => fallbackEn ?? _key
  const markup = render(legal.default, {
    copy,
    businessName: 'Leang Cosmetics',
    socialLinks: [
      { key: 'facebook', label: 'Facebook', value: 'https://facebook.com/x' },
      { key: 'instagram', label: 'Instagram', value: 'https://instagram.com/x' },
      { key: 'website', label: 'Website', value: 'https://example.com' },
    ],
  })
  const links = [...markup.matchAll(/<a class="[^"]*" href="(https:\/\/[^"]+)" target="_blank" rel="noreferrer">([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], inner: m[2] }))
  assert.equal(links.length, 3)
  assert.ok(links[0].inner.includes('data-brand-mark="facebook"') && links[0].inner.includes('>Facebook</span>'))
  assert.ok(links[1].inner.includes('data-brand-mark="instagram"') && links[1].inner.includes('>Instagram</span>'))
  assert.ok(!links[2].inner.includes('data-brand-mark'), 'the website link keeps the generic globe, not a brand mark')
})

const CONSUMERS: Array<[string, string]> = [
  ['../src/components/catalog/legal/LegalPages.tsx', 'storefront footer'],
  ['../src/components/catalog/PublicCatalogPage.tsx', 'storefront header and contact buttons'],
  ['../src/components/catalog/CatalogPage.tsx', 'editor preview header'],
  ['../src/components/catalog/CatalogSecondaryTabs.tsx', 'About links'],
  ['../src/components/catalog/CatalogEditorSurface.tsx', 'editor field labels and contact guide'],
]

runCase('every surface that shows these two brands takes the marks from BrandIcons, and none imports a Lucide brand glyph', () => {
  for (const [file, where] of CONSUMERS) {
    const source = read(file)
    assert.doesNotMatch(source, /lucide-react\/dist\/esm\/icons\/(?:facebook|instagram|chrome)\.js/, `${where}: still imports a Lucide brand glyph`)
    assert.match(source, /import \{[^}]*\b(?:FacebookIcon|InstagramIcon)\b[^}]*\} from '(?:\.\.\/)+shared\/BrandIcons\.tsx'/, `${where}: does not import the marks`)
  }
  const offenders: string[] = []
  const walk = (dir: URL): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) { walk(child); continue }
      if (/\.(ts|tsx)$/.test(entry.name) && /lucide-react\/dist\/esm\/icons\/(?:facebook|instagram|chrome)\.js/.test(fs.readFileSync(child, 'utf8'))) offenders.push(entry.name)
    }
  }
  walk(new URL('../src/', import.meta.url))
  assert.deepEqual(offenders, [])
})

runCase('sibling parity: each place that picks a glyph by network maps facebook to the Facebook mark and instagram to the Instagram mark', () => {
  const footer = read('../src/components/catalog/legal/LegalPages.tsx')
  assert.match(footer, /kind === 'facebook' \? FacebookIcon : kind === 'instagram' \? InstagramIcon : kind === 'telegram' \? Send : Globe/)
  for (const file of ['../src/components/catalog/PublicCatalogPage.tsx', '../src/components/catalog/CatalogPage.tsx']) {
    const source = read(file)
    assert.match(source, /socialIconByKey: Record<string, LucideIcon> = \{\s*facebook: FacebookIcon,\s*instagram: InstagramIcon,\s*telegram: Send,\s*website: Globe,/, file)
  }
  assert.match(read('../src/components/catalog/PublicCatalogPage.tsx'), /contactIconByKey: Record<string, LucideIcon> = \{[\s\S]*?instagram: InstagramIcon,/)
  assert.match(read('../src/components/catalog/CatalogSecondaryTabs.tsx'), /item\.key === 'facebook'\s*\? FacebookIcon\s*: item\.key === 'instagram'\s*\? InstagramIcon\s*: item\.key === 'telegram'\s*\? Send\s*: Globe/)
  const editor = read('../src/components/catalog/CatalogEditorSurface.tsx')
  assert.equal((editor.match(/<FacebookIcon /g) || []).length, 1)
  assert.equal((editor.match(/<InstagramIcon /g) || []).length, 3)
  assert.doesNotMatch(editor, /<(?:Facebook|Instagram) /)
})

runCase('the build config no longer pins the two Lucide brand modules, and says who imports BrandIcons', () => {
  const vite = read('../vite.config.ts')
  assert.doesNotMatch(vite.match(/const routeSharedIconNames = new Set\(\[[\s\S]*?\]\)/)?.[0] || '', /'facebook'|'instagram'/)
  assert.match(vite, /BrandIcons\.tsx lives under components\/shared\/ but is only ever imported by\s*\/\/ catalog surfaces \(CatalogEditorSurface -> catalog-editor, PublicCatalogPage\s*\/\/ -> catalog-public, CatalogPage -> catalog, CatalogSecondaryTabs,\s*\/\/ LegalPages -> catalog-legal\)/)
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS social brand marks: Facebook and Instagram are inline SVG on every storefront and editor surface, with no Lucide brand glyph left')
