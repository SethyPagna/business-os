// Owner, 29 Sep 2026: the Telegram overview stays short, and each extra
// section is a Settings switch that is off until the owner turns it on.
//
// Pins the Settings toggles to the Worker: the same six keys as
// cloudflare/src/lib/telegram.ts TELEGRAM_SUMMARY_SWITCHES, shown on only for
// the stored value the Worker treats as on, written as 'true'/'false' (the
// only values routes/settings.ts accepts), and labelled in both packs.
//
// Run: node tests/telegramSummarySections.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const workerSource = read('..', 'cloudflare', 'src', 'lib', 'telegram.ts')
const switchBlock = workerSource.match(/export const TELEGRAM_SUMMARY_SWITCHES = \{([\s\S]*?)\} as const/)
assert.ok(switchBlock, 'lib/telegram.ts must export TELEGRAM_SUMMARY_SWITCHES')
const WORKER_KEYS = [...switchBlock[1].matchAll(/'(telegram_summary_[a-z]+_enabled)'/g)].map((match) => match[1])
assert.equal(WORKER_KEYS.length, 6, `expected six Worker switches, found ${WORKER_KEYS.join(', ')}`)
assert.ok(workerSource.includes("String(values[key] ?? '').trim() === 'true'"), 'the Worker reads a switch as on only for a trimmed \'true\'')

type Element = { type: unknown; key: string | null; props: Record<string, unknown> & { children?: unknown } }
type Props = { form: Record<string, string | undefined>; setValue: (key: string, value: string) => void; disabled: boolean; t: (key: string) => string }

async function loadComponent(): Promise<(props: Props) => Element> {
  const bundle = await build({
    entryPoints: [path.join(ROOT, 'src', 'components', 'utils-settings', 'TelegramSummarySections.tsx')],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'],
    plugins: [{ name: 'hint-stub', setup(builder) {
      builder.onResolve({ filter: /InfoHint(?:\.tsx)?$/ }, () => ({ path: 'hint', namespace: 'stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: "import React from 'react'; export default function Hint(p) { return React.createElement('i', { 'data-hint': p.text }) }", loader: 'js' }))
    } }],
  })
  const mod = { exports: {} as { default: (props: Props) => Element } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports)
  return mod.exports.default
}

function buttonsOf(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) { for (const child of node) buttonsOf(child, found); return found }
  if (!node || typeof node !== 'object') return found
  const element = node as Element
  if (element.type === 'button') found.push(element)
  buttonsOf(element.props?.children, found)
  return found
}

const TelegramSummarySections = await loadComponent()
const t = (key: string) => `[${key}]`
const writes: Array<[string, string]> = []
const render = (form: Props['form'], disabled = false) =>
  buttonsOf(TelegramSummarySections({ form, setValue: (key, value) => { writes.push([key, value]) }, disabled, t }))

const unset = render({})
assert.deepEqual(unset.map((button) => button.key), WORKER_KEYS, 'one toggle per Worker switch, in the Worker\'s order')
assert.ok(unset.every((button) => button.props['aria-pressed'] === false), 'an unset switch shows off: the Worker sends nothing extra for it')

const stored = {
  telegram_summary_sales_enabled: 'true',
  telegram_summary_cashiers_enabled: 'TRUE',
  telegram_summary_products_enabled: '1',
  telegram_summary_returns_enabled: ' true ',
  telegram_summary_expenses_enabled: 'false',
  telegram_summary_compare_enabled: 'yes',
}
const shown = render(stored)
assert.deepEqual(shown.map((button) => button.props['aria-pressed']), [true, false, false, true, false, false],
  'a toggle shows on exactly when the Worker would print the section')

for (const button of shown) (button.props.onClick as () => void)()
assert.deepEqual(writes, [
  ['telegram_summary_sales_enabled', 'false'],
  ['telegram_summary_cashiers_enabled', 'true'],
  ['telegram_summary_products_enabled', 'true'],
  ['telegram_summary_returns_enabled', 'false'],
  ['telegram_summary_expenses_enabled', 'true'],
  ['telegram_summary_compare_enabled', 'true'],
], 'a tap writes the opposite of what is shown, and only \'true\' or \'false\'')

assert.ok(render({}, true).every((button) => button.props.disabled === true), 'a read-only Settings grant cannot flip a switch')
assert.ok(unset.every((button) => button.props.type === 'button'), 'a toggle never submits the Settings form')

const sectionNames = ['sales', 'cashiers', 'products', 'returns', 'expenses', 'compare']
unset.forEach((button, index) => {
  const name = sectionNames[index]
  assert.equal(button.props.title, `[telegram_summary_${name}_desc]`, `${name}: the detail is the tooltip, not a line of text`)
  const children = ([] as unknown[]).concat(button.props.children)
  const icon = children.find((child) => child && typeof child === 'object' && typeof (child as Element).type !== 'string') as Element | undefined
  assert.ok(icon && icon.props['aria-hidden'], `${name}: an icon, hidden from screen readers`)
  assert.ok(children.includes(`[telegram_summary_${name}]`), `${name}: a short visible label`)
})

const markup = renderToStaticMarkup(React.createElement(TelegramSummarySections as unknown as React.ComponentType<Props>, { form: stored, setValue: () => {}, disabled: false, t }))
assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 2)
assert.equal((markup.match(/aria-pressed="false"/g) || []).length, 4)
assert.ok(markup.includes('role="group"') && markup.includes('data-hint="[telegram_summary_sections_hint]"'), 'one titled group, its explanation behind the info hint')

type Pack = Record<string, unknown>
function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Pack)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') { flatten(value, target); continue }
    target[key] = String(value)
  }
  return target
}
const componentSource = read('src', 'components', 'utils-settings', 'TelegramSummarySections.tsx')
const usedKeys = [...new Set([...componentSource.matchAll(/\bt\('([a-z0-9_]+)'\)/g)].map((match) => match[1]))]
assert.equal(usedKeys.length, 14, `expected the title, its hint and six label/detail pairs, found ${usedKeys.join(', ')}`)
for (const pack of ['en', 'km'] as const) {
  const raw = read('src', 'lang', `${pack}.json`)
  const values = flatten(JSON.parse(raw))
  for (const key of usedKeys) assert.ok(values[key]?.trim(), `${pack}.json is missing ${key}`)
  const order = Object.keys(JSON.parse(raw) as Pack)
  const anchor = order.indexOf('telegram_reports_overview_desc')
  assert.deepEqual(order.slice(anchor + 1, anchor + 1 + usedKeys.length).sort(), [...usedKeys].sort(),
    `${pack}.json keeps the keys beside the Reports overview switch they extend`)
}
const en = flatten(JSON.parse(read('src', 'lang', 'en.json')))
const km = flatten(JSON.parse(read('src', 'lang', 'km.json')))
for (const key of usedKeys) {
  assert.notEqual(km[key], en[key], `km.json ${key} is still English`)
  assert.ok(/[ក-៿]/.test(km[key]), `km.json ${key} is not Khmer`)
}

const settingsSource = read('src', 'components', 'utils-settings', 'Settings.tsx')
const telegramStart = settingsSource.indexOf("title={t('telegram_automation_title')")
const topicsStart = settingsSource.indexOf("t('telegram_topics_title')")
const mounted = settingsSource.indexOf('<TelegramSummarySections form={form} setValue={setValue} disabled={!canEditSettings} t={t} />')
assert.ok(telegramStart > 0 && mounted > telegramStart && mounted < topicsStart,
  'Settings renders the toggles inside the admin-only Telegram automation section, gated by the Settings grant')

console.log(`telegramSummarySections.test.ts: ${WORKER_KEYS.length} switches pinned to the Worker; ${usedKeys.length} keys in both packs`)
