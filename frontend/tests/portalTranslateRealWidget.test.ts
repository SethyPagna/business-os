// Storefront Google Translate against a fake Google that behaves like the real one.
//
// Observed on Google's real script on 21 Nov 2026 (the facts this fake reproduces):
// - Built with the default layout (no `layout` option), the widget renders <select class="goog-te-combo">.
// - Built with ANY `layout` (SIMPLE = 2, from TranslateElement.InlineLayout), it renders a
//   <div class="goog-te-gadget-simple"> and NO select, ever.
// - Either way Google translates from a `googtrans=/en/<x>` cookie present at construction, and then sets
//   <html class="translated-ltr" lang="<x>">. A `change` on the select translates too.
//
// Why this file exists: tests/storefrontLanguagesSix.test.ts hands the code a canned select through
// document.querySelector whatever options the widget was built with, so it could not see that a SIMPLE
// layout never makes a select (live defect, deploy 10: the page translated, then reloaded back at 10 s).
// Here `querySelector('.goog-te-combo')` answers only from the DOM the fake widget actually built.
//
// Run: node tests/portalTranslateRealWidget.test.ts
import assert from 'node:assert/strict'

const globals = globalThis as unknown as { window?: unknown; document?: unknown }
const savedWindow = globals.window
const savedDocument = globals.document

// ---- fake DOM --------------------------------------------------------------------------------

class FakeElement extends EventTarget {
  tagName: string
  id = ''
  className = ''
  style: Record<string, string> = {}
  attrs = new Map<string, string>()
  children: FakeElement[] = []
  parent: FakeElement | null = null
  tabIndex = 0
  src = ''
  onerror: (() => void) | null = null
  private optionValues: string[] = []
  private current = ''
  constructor(tag: string) {
    super()
    this.tagName = tag
  }
  setAttribute(name: string, value: string) { this.attrs.set(name, String(value)) }
  hasAttribute(name: string) { return this.attrs.has(name) }
  getAttribute(name: string) { return this.attrs.get(name) ?? null }
  appendChild(child: FakeElement) {
    child.parent = this
    this.children.push(child)
    return child
  }
  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }
  set innerHTML(_value: string) { this.children.forEach((child) => { child.parent = null }); this.children = [] }
  get innerHTML() { return '' }
  setOptions(values: string[]) { this.optionValues = values }
  // A real <select> ignores a value that is not one of its options.
  set value(next: string) { if (this.optionValues.includes(next)) this.current = next }
  get value() { return this.current }
  find(match: (node: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (match(child)) return child
      const deeper = child.find(match)
      if (deeper) return deeper
    }
    return null
  }
}

type GoogleMode = {
  // Does the default layout render a select? (true today; false models a future Google change)
  defaultLayoutRendersSelect: boolean
  // Does the widget translate from the googtrans cookie at construction? (true on the real script)
  translatesFromCookie: boolean
}
type ScriptMode = 'loads' | 'refused' | 'silent'

function installFakeBrowser(options: { google: GoogleMode; script: ScriptMode; html?: { className?: string; lang?: string } }) {
  let now = 0
  let nextTimer = 1
  const timers: Array<{ id: number; at: number; fn: () => void }> = []
  const jar = new Map<string, string>()
  const constructed: Array<{ options: Record<string, unknown>; hostId: string }> = []
  const calls = { reload: 0 }

  const html = { className: options.html?.className ?? '', lang: options.html?.lang ?? '' }
  const body = new FakeElement('body')
  const head = new FakeElement('head')
  const byId = (id: string) => body.find((node) => node.id === id) ?? head.find((node) => node.id === id)

  const translateTo = (language: string) => {
    html.className = `${html.className} translated-ltr`.trim()
    html.lang = language
  }

  const win: Record<string, unknown> & { setTimeout: (fn: () => void, ms?: number) => number } = {
    location: { hostname: 'leangbeauty.com', pathname: '/', reload() { calls.reload += 1 } },
    setTimeout: (fn: () => void, ms?: number) => {
      const id = nextTimer++
      timers.push({ id, at: now + (Number(ms) || 0), fn })
      return id
    },
    clearTimeout: (id: number) => {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
  }

  const doc = {
    documentElement: html,
    head,
    body,
    get cookie() { return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ') },
    set cookie(line: string) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      const expired = attributes.some((attribute) => /^expires=/i.test(attribute) && new Date(attribute.slice(8)).getTime() < 1e12 + now)
      if (expired || value === '') jar.delete(name)
      else jar.set(name, value)
    },
    getElementById: (id: string) => byId(id),
    // Answers from the fake DOM only: a select the widget did not build cannot be found.
    querySelector: (selector: string) => {
      if (selector === '.goog-te-combo') return body.find((node) => node.tagName === 'select' && / goog-te-combo /.test(` ${node.className} `))
      return null
    },
    createElement: (tag: string) => new FakeElement(tag),
  }

  class FakeTranslateElement {
    static InlineLayout = { VERTICAL: 0, HORIZONTAL: 1, SIMPLE: 2 }
    constructor(widgetOptions: Record<string, unknown>, hostId: string) {
      constructed.push({ options: widgetOptions, hostId })
      const host = byId(hostId)
      if (!host) throw new Error('no such element')
      const cookie = /(?:^|; )googtrans=\/en\/([^;]+)/.exec(doc.cookie)
      if (cookie && options.google.translatesFromCookie) translateTo(cookie[1])
      const rendersSelect = widgetOptions.layout === undefined && options.google.defaultLayoutRendersSelect
      if (rendersSelect) {
        win.setTimeout(() => {
          const select = new FakeElement('select')
          select.className = 'goog-te-combo'
          select.setOptions(['', 'zh-CN', 'zh-TW', 'fr', 'es'])
          select.addEventListener('change', () => { if (select.value) translateTo(select.value) })
          host.appendChild(select)
        }, 300)
      } else {
        const gadget = new FakeElement('div')
        gadget.className = 'goog-te-gadget-simple'
        host.appendChild(gadget)
      }
    }
  }

  // The script element loads (or is refused, or never answers) once the code appends it.
  const appendToBody = body.appendChild.bind(body)
  body.appendChild = (child: FakeElement) => {
    appendToBody(child)
    if (child.tagName === 'script' && options.script !== 'silent') {
      win.setTimeout(() => {
        if (options.script === 'refused') { child.onerror?.(); return }
        win.google = { translate: { TranslateElement: FakeTranslateElement } }
        const callback = /[?&]cb=([^&]+)/.exec(child.src)?.[1]
        const init = callback ? win[decodeURIComponent(callback)] : undefined
        if (typeof init === 'function') init()
      }, 50)
    }
    return child
  }

  globals.window = win
  globals.document = doc

  // Run timers up to `ms` of fake time, letting promise callbacks settle between them.
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  const advance = async (ms: number) => {
    const target = now + ms
    await settle()
    for (;;) {
      const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      timers.splice(timers.indexOf(due), 1)
      now = due.at
      due.fn()
      await settle()
    }
    now = target
    await settle()
  }
  return { advance, html, jar, constructed, calls, byId, doc, win, FakeTranslateElement, elapsed: () => now }
}

const REAL: GoogleMode = { defaultLayoutRendersSelect: true, translatesFromCookie: true }
const NO_SELECT_BUT_TRANSLATES: GoogleMode = { defaultLayoutRendersSelect: false, translatesFromCookie: true }
const NO_SELECT_NO_TRANSLATION: GoogleMode = { defaultLayoutRendersSelect: false, translatesFromCookie: false }

const controller = await import('../src/components/catalog/portalTranslateController.ts')
const LIMIT = controller.PORTAL_TRANSLATE_TIMEOUT_MS

function fallbackRecorder() {
  const seen = { restored: [] as string[], notices: [] as string[] }
  return {
    seen,
    fallback: {
      previous: 'km' as const,
      restoreChoice: (previous: 'en' | 'km') => { seen.restored.push(previous) },
      showNotice: (previous: 'en' | 'km') => { seen.notices.push(previous) },
    },
  }
}

// A promise that never settles must fail the case, not hang the file: read it only after asserting it is done.
function track<T>(promise: Promise<T>) {
  const state = { done: false, value: undefined as T | undefined }
  promise.then((value) => { state.done = true; state.value = value }, () => { state.done = true })
  return state
}

let failed = 0
async function runTest(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`  ${(error as Error).message.split('\n')[0]}`)
  }
}

// Positive control: the fake must really separate the two layouts, or every case below proves nothing.
await runTest('control: the fake makes a select only for the default layout, and only from its own DOM', async () => {
  for (const [widgetOptions, expectSelect] of [[{ pageLanguage: 'en' }, true], [{ pageLanguage: 'en', layout: 2 }, false], [{ pageLanguage: 'en', layout: 0 }, false]] as const) {
    const fake = installFakeBrowser({ google: REAL, script: 'loads' })
    assert.equal(fake.doc.querySelector('.goog-te-combo'), null, 'no select before a widget is built')
    const host = new FakeElement('div')
    host.id = 'h'
    fake.doc.body.appendChild(host)
    new fake.FakeTranslateElement({ ...widgetOptions }, 'h')
    await fake.advance(1000)
    assert.equal(Boolean(fake.doc.querySelector('.goog-te-combo')), expectSelect, JSON.stringify(widgetOptions))
  }
})

await runTest('A: default layout gives a select, the pick resolves true well before the limit, and the widget is built without a layout option', async () => {
  const fake = installFakeBrowser({ google: REAL, script: 'loads' })
  const pick = track(controller.applyPortalGoogleTranslate('fr'))
  await fake.advance(2000)
  assert.ok(pick.done, 'the pick settled within 2 s of fake time, long before the limit')
  assert.equal(pick.value, true, 'the pick resolves true')
  assert.ok(fake.elapsed() < LIMIT, 'it did not have to wait for the limit')
  assert.equal(fake.constructed.length, 1, 'the widget was built once')
  assert.ok(!('layout' in fake.constructed[0].options), 'no layout key in the options: a layout makes Google skip the select')
  const select = fake.doc.querySelector('.goog-te-combo') as unknown as FakeElement
  assert.ok(select, 'the select exists in the widget')
  assert.equal(select.value, 'fr', 'the select was set to the pick')
  assert.equal(select.tabIndex, -1, 'the select is out of the tab order')
  const host = fake.byId(controller.PORTAL_TRANSLATE_WIDGET_HOST_ID)
  assert.ok(host, 'the widget host exists')
  assert.equal(host.hasAttribute('inert'), true, 'the host is inert')
  assert.equal(host.getAttribute('aria-hidden'), 'true', 'the host is hidden from a screen reader')
  assert.equal(fake.html.lang, 'fr', 'Google translated the page')
  assert.equal(fake.calls.reload, 0)
})

await runTest('B: no select but the page is translated into the pick: true at the limit, nothing restored, no notice, no reload, cookie kept', async () => {
  const bare = installFakeBrowser({ google: NO_SELECT_BUT_TRANSLATES, script: 'loads' })
  const first = track(controller.applyPortalGoogleTranslate('fr'))
  await bare.advance(5000)
  assert.equal(first.done, false, 'it waits for a select that never comes')
  await bare.advance(LIMIT)
  assert.ok(first.done, 'it gave up at the limit')
  assert.equal(first.value, true, 'a page translated into the pick is a success')
  assert.equal(bare.doc.querySelector('.goog-te-combo'), null, 'this variant really has no select')

  const fake = installFakeBrowser({ google: NO_SELECT_BUT_TRANSLATES, script: 'loads' })
  const { seen, fallback } = fallbackRecorder()
  const pending = track(controller.applyPortalGoogleTranslateOrFallBack('fr', fallback))
  await fake.advance(LIMIT + 1000)
  assert.ok(pending.done, 'the wrapper settled')
  assert.equal(pending.value, true, 'the fallback wrapper answers true')
  assert.deepEqual(seen.restored, [], 'the menu is not put back')
  assert.deepEqual(seen.notices, [], 'no notice')
  assert.equal(fake.calls.reload, 0, 'no reload')
  assert.equal(fake.jar.get('googtrans'), '/en/fr', 'the googtrans cookie is still there')
})

await runTest('C: no select and the mark is left from another language (es): the pick fr resolves false', async () => {
  const fake = installFakeBrowser({ google: NO_SELECT_NO_TRANSLATION, script: 'loads', html: { className: 'translated-ltr', lang: 'es' } })
  const pending = track(controller.applyPortalGoogleTranslate('fr'))
  await fake.advance(LIMIT + 1000)
  assert.ok(pending.done, 'it settled at the limit')
  assert.equal(fake.html.lang, 'es', 'the widget did not re-translate')
  assert.equal(pending.value, false, 'a mark from another language does not count as the pick')
})

await runTest('D: no select and no mark: falls back once, notice once, no reload, cookie cleared, script and host removed', async () => {
  const fake = installFakeBrowser({ google: NO_SELECT_NO_TRANSLATION, script: 'loads' })
  const { seen, fallback } = fallbackRecorder()
  const pending = track(controller.applyPortalGoogleTranslateOrFallBack('fr', fallback))
  await fake.advance(LIMIT + 1000)
  assert.ok(pending.done, 'it settled at the limit')
  assert.equal(pending.value, false)
  assert.deepEqual(seen.restored, ['km'], 'restoreChoice called once with the previous language')
  assert.deepEqual(seen.notices, ['km'], 'showNotice called once')
  assert.equal(fake.calls.reload, 0, 'no reload: nothing was rewritten')
  assert.equal(fake.jar.has('googtrans'), false, 'the cookie is cleared')
  assert.equal(fake.byId(controller.PORTAL_TRANSLATE_SCRIPT_ID), null, 'the script tag is removed')
  assert.equal(fake.byId(controller.PORTAL_TRANSLATE_WIDGET_HOST_ID), null, 'the widget host is removed')
})

await runTest('E: a refused script ends the same way as D, and promptly', async () => {
  const fake = installFakeBrowser({ google: REAL, script: 'refused' })
  const { seen, fallback } = fallbackRecorder()
  const pending = track(controller.applyPortalGoogleTranslateOrFallBack('fr', fallback))
  await fake.advance(1000)
  assert.ok(pending.done, 'it settled within 1 s of fake time, not at the limit')
  assert.equal(pending.value, false)
  assert.deepEqual(seen.restored, ['km'], 'restoreChoice called once')
  assert.deepEqual(seen.notices, ['km'], 'showNotice called once')
  assert.equal(fake.calls.reload, 0, 'no reload')
  assert.equal(fake.jar.has('googtrans'), false, 'the cookie is cleared')
  assert.equal(fake.byId(controller.PORTAL_TRANSLATE_SCRIPT_ID), null, 'the script tag is removed')
  assert.equal(fake.byId(controller.PORTAL_TRANSLATE_WIDGET_HOST_ID), null, 'the widget host is removed')
})

await runTest('F: the language match ignores case: lang zh-cn with the mark counts for the pick zh-CN', async () => {
  const fake = installFakeBrowser({ google: NO_SELECT_NO_TRANSLATION, script: 'loads', html: { className: 'translated-ltr', lang: 'zh-cn' } })
  const pending = track(controller.applyPortalGoogleTranslate('zh-CN'))
  await fake.advance(LIMIT + 1000)
  assert.ok(pending.done, 'it settled at the limit')
  assert.equal(pending.value, true)
})

globals.window = savedWindow
globals.document = savedDocument

if (failed) {
  console.log(`FAIL ${failed} case(s) red`)
  process.exitCode = 1
} else {
  console.log('PASS portal translate against a fake Google that only makes a select for the default layout')
}
