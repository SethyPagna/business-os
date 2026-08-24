import assert from 'node:assert/strict'
import {
  ensurePortalTranslateWidgetHost,
  applyGoogleTranslateSelection,
  isPortalTranslateApplied,
  normalizeTranslateTarget,
  readStoredTranslateTarget,
  removePortalTranslateWidgetHost,
  storePortalTranslatePreference,
  writePortalTranslateTarget,
} from '../src/components/catalog/portalTranslateController.ts'

const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalEvent = globalThis.Event

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type FakeNode = {
  tagName?: string
  id: string
  className: string
  style?: Record<string, string>
  parentNode: FakeBody | null
  attributes?: Record<string, string>
  setAttribute?: (key: string, value: string) => void
  remove?: () => void
}
type FakeBody = {
  className: string
  appendChild: (node: FakeNode) => void
}
type FakeCombo = {
  value: string
  events: string[]
  dispatchEvent: (event: { type: string }) => void
}
type FakeDocument = {
  documentElement: { className: string }
  body: FakeBody
  cookie: string
  createElement: (tag: string) => FakeNode
  querySelectorAll: (selector: string) => Array<FakeNode | FakeCombo>
  __combo: FakeCombo
}

function createStorage(): MinimalStorage {
  const data = new Map<string, string>()
  return {
    getItem(key: string) {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
    removeItem(key: string) {
      data.delete(key)
    },
  }
}

function createDocument(): FakeDocument {
  const cookies = new Map<string, string>()
  const hosts: FakeNode[] = []
  const combo: FakeCombo = {
    value: '',
    events: [],
    dispatchEvent(event) {
      this.events.push(event.type)
    },
  }
  const body: FakeBody = {
    className: '',
    appendChild(node) {
      if (!hosts.includes(node)) hosts.push(node)
      node.parentNode = body
    },
  }
  return {
    documentElement: { className: '' },
    body,
    get cookie() {
      return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ')
    },
    set cookie(value: string) {
      const text = String(value || '')
      const [pair] = text.split(';')
      const index = pair.indexOf('=')
      if (index < 0) return
      const key = pair.slice(0, index)
      const nextValue = pair.slice(index + 1)
      if (/expires=Thu, 01 Jan 1970/i.test(text)) cookies.delete(key)
      else cookies.set(key, nextValue)
    },
    createElement(tag: string) {
      const node: FakeNode = {
        tagName: String(tag || '').toUpperCase(),
        id: '',
        className: '',
        style: {},
        parentNode: null,
        attributes: {},
        setAttribute(key: string, value: string) {
          node.attributes![key] = String(value)
        },
        remove() {
          const index = hosts.indexOf(node)
          if (index >= 0) hosts.splice(index, 1)
          node.parentNode = null
        },
      }
      return node
    },
    querySelectorAll(selector: string) {
      if (selector === '#business-os-portal-translate-widget-host') {
        return hosts.filter((node) => node.id === 'business-os-portal-translate-widget-host')
      }
      if (selector === '.goog-te-combo') return [combo]
      return []
    },
    __combo: combo,
  }
}

try {
  const testGlobals = globalThis as unknown as { window: Window; document: Document; Event: typeof Event }
  const document = createDocument()
  const window = {
    location: { hostname: 'leangcosmetics.crane-qilin.ts.net', pathname: '/public' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
  }
  class TestEvent {
    type: string

    constructor(type: string) {
      this.type = type
    }
  }
  testGlobals.window = window as unknown as Window
  testGlobals.document = document as unknown as Document
  testGlobals.Event = TestEvent as unknown as typeof Event
  ;(testGlobals.window as unknown as { Event: typeof Event }).Event = testGlobals.Event

  assert.equal(writePortalTranslateTarget('en', 'fr'), 'fr')
  assert.match(document.cookie, /googtrans=%2Fen%2Ffr|googtrans=\/en\/fr/)
  assert.equal(readStoredTranslateTarget('en'), 'fr')
  assert.equal(isPortalTranslateApplied('en', 'fr'), false)
  assert.equal(normalizeTranslateTarget('zh-cn', 'en'), 'zh-CN')
  assert.equal(writePortalTranslateTarget('en', 'zh-cn'), 'zh-CN')
  assert.match(document.cookie, /zh-CN/)
  assert.equal(applyGoogleTranslateSelection('en', 'zh-cn'), true)
  assert.equal(document.__combo.value, 'zh-CN')
  assert.deepEqual(document.__combo.events, ['input', 'change'])

  document.documentElement.className = 'translated-ltr'
  assert.equal(isPortalTranslateApplied('en', 'zh-CN'), true)

  assert.equal(writePortalTranslateTarget('en', 'original'), 'original')
  document.documentElement.className = ''
  assert.equal(readStoredTranslateTarget('en'), 'original')
  assert.equal(isPortalTranslateApplied('en', 'original'), true)

  assert.equal(storePortalTranslatePreference('en'), 'en')
  assert.equal(readStoredTranslateTarget('en'), 'en')
  assert.equal(storePortalTranslatePreference('km'), 'km')
  assert.equal(readStoredTranslateTarget('en'), 'km')

  const firstHost = ensurePortalTranslateWidgetHost()
  const secondHost = ensurePortalTranslateWidgetHost()
  assert.equal(firstHost, secondHost)
  assert.equal(document.querySelectorAll('#business-os-portal-translate-widget-host').length, 1)
  removePortalTranslateWidgetHost()
  assert.equal(document.querySelectorAll('#business-os-portal-translate-widget-host').length, 0)

  console.log('portalTranslateController tests passed')
} finally {
  const testGlobals = globalThis as unknown as { window: Window | undefined; document: Document | undefined; Event: typeof Event | undefined }
  testGlobals.window = originalWindow
  testGlobals.document = originalDocument
  testGlobals.Event = originalEvent
}
