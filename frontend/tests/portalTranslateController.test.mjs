import assert from 'node:assert/strict'
import {
  ensurePortalTranslateWidgetHost,
  isPortalTranslateApplied,
  readStoredTranslateTarget,
  removePortalTranslateWidgetHost,
  writePortalTranslateTarget,
} from '../src/components/catalog/portalTranslateController.mjs'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

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
      if (selector === '.goog-te-combo') return []
      return []
    },
  }
}

try {
  globalThis.window = {
    location: { hostname: 'leangcosmetics.crane-qilin.ts.net', pathname: '/public' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
  }
  globalThis.document = createDocument()

  assert.equal(writePortalTranslateTarget('en', 'fr'), 'fr')
  assert.match(globalThis.document.cookie, /googtrans=%2Fen%2Ffr|googtrans=\/en\/fr/)
  assert.equal(readStoredTranslateTarget('en'), 'fr')
  assert.equal(isPortalTranslateApplied('en', 'fr'), false)

  globalThis.document.documentElement.className = 'translated-ltr'
  assert.equal(isPortalTranslateApplied('en', 'fr'), true)

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
}
