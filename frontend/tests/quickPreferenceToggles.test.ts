import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const render = require('react-dom/server').renderToStaticMarkup
let language = 'en'
let theme = 'light'
let toggles = 0
const source = readFileSync(new URL('../src/components/shared/QuickPreferenceToggles.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const mod = { exports: {} as Record<string, any> }
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id.includes('AppContextCore')) return { useApp: () => ({ language, theme, toggleLanguage: () => { toggles++ }, toggleTheme: () => { toggles++ } }) }
  if (id.startsWith('lucide-react/')) return (props: object) => React.createElement('svg', props)
  return require(id)
}, mod, mod.exports)
for (const [lang, mode, label] of [['en', 'light', 'EN'], ['km', 'dark', 'KM']]) {
  language = lang
  theme = mode
  const tree = mod.exports.default({})
  const html = render(tree)
  assert.equal((html.match(/h-10 w-10/g) || []).length, 2, 'glyphs retain two 40px controls')
  assert.equal((html.match(/<svg class="h-6 w-6"/g) || []).length, 2, 'both glyphs grow to 24px')
  assert.ok(html.includes(`>${label}</span>`))
  assert.ok(html.includes('left-1/2 -translate-x-1/2'), 'language code is anchored on globe')
  assert.ok(!html.includes('-right-1'), 'badge does not hang off the control edge')
  for (const button of tree.props.children) button.props.onClick()
}
assert.equal(toggles, 4, 'both actions remain connected in both states')
console.log('PASS preference glyph size, labels, anchoring and actions')
