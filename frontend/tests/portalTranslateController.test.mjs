import assert from 'node:assert/strict'
import {
  ensurePortalTranslateWidgetHost,
  applyGoogleTranslateSelection,
  isPortalTranslateApplied,
  normalizeTranslateTarget,
  readStoredTranslateTarget,
  removePortalTranslateWidgetHost,
  writePortalTranslateTarget,
} from '../src/components/catalog/portalTranslateController.mjs'

const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalEvent = globalThis.Event

function createStorage() {
  const data = new Map()
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    removeItem(key) {
      data.delete(key)
    },
  }
}

function createDocument() {
  const cookies = new Map()
  const hosts = []
  const combo = {
    value: '',
    events: [],
    dispatchEvent(event) {
      this.events.push(event.type)
    },
  }
  const body = {
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
    set cookie(value) {
      const text = String(value || '')
      const [pair] = text.split(';')
      const index = pair.indexOf('=')
      if (index < 0) return
      const key = pair.slice(0, index)
      const nextValue = pair.slice(index + 1)
      if (/expires=Thu, 01 Jan 1970/i.test(text)) cookies.delete(key)
      else cookies.set(key, nextValue)
    },
    createElement(tag) {
      return {
        tagName: String(tag || '').toUpperCase(),
        id: '',
        className: '',
        style: {},
        parentNode: null,
        attributes: {},
        setAttribute(key, value) {
          this.attributes[key] = String(value)
        },
        remove() {
          const index = hosts.indexOf(this)
          if (index >= 0) hosts.splice(index, 1)
          this.parentNode = null
        },
      }
    },
    querySelectorAll(selector) {
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
  globalThis.window = {
    location: { hostname: 'leangcosmetics.crane-qilin.ts.net', pathname: '/public' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
  }
  globalThis.document = createDocument()
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type
    }
  }
  globalThis.window.Event = globalThis.Event

  assert.equal(writePortalTranslateTarget('en', 'fr'), 'fr')
  assert.match(globalThis.document.cookie, /googtrans=%2Fen%2Ffr|googtrans=\/en\/fr/)
  assert.equal(readStoredTranslateTarget('en'), 'fr')
  assert.equal(isPortalTranslateApplied('en', 'fr'), false)
  assert.equal(normalizeTranslateTarget('zh-cn', 'en'), 'zh-CN')
  assert.equal(writePortalTranslateTarget('en', 'zh-cn'), 'zh-CN')
  assert.match(globalThis.document.cookie, /zh-CN/)
  assert.equal(applyGoogleTranslateSelection('en', 'zh-cn'), true)
  assert.equal(globalThis.document.__combo.value, 'zh-CN')
  assert.deepEqual(globalThis.document.__combo.events, ['input', 'change'])

  globalThis.document.documentElement.className = 'translated-ltr'
  assert.equal(isPortalTranslateApplied('en', 'zh-CN'), true)

  assert.equal(writePortalTranslateTarget('en', 'original'), 'original')
  globalThis.document.documentElement.className = ''
  assert.equal(readStoredTranslateTarget('en'), 'original')
  assert.equal(isPortalTranslateApplied('en', 'original'), true)

  const firstHost = ensurePortalTranslateWidgetHost()
  const secondHost = ensurePortalTranslateWidgetHost()
  assert.equal(firstHost, secondHost)
  assert.equal(globalThis.document.querySelectorAll('#business-os-portal-translate-widget-host').length, 1)
  removePortalTranslateWidgetHost()
  assert.equal(globalThis.document.querySelectorAll('#business-os-portal-translate-widget-host').length, 0)

  console.log('portalTranslateController tests passed')
} finally {
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  globalThis.Event = originalEvent
}
