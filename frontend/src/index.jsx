import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './AppContext'
import './styles/main.css'
import {
  isGuardableStyleSheetError,
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier.mjs'

function registerOfflineAppShell() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      registration.update?.().catch(() => {})
    } catch (_) {}
  }

  if (document.readyState === 'complete') {
    register().catch(() => {})
  } else {
    window.addEventListener('load', () => {
      register().catch(() => {})
    }, { once: true })
  }
}

function installFormFieldAccessibility() {
  if (typeof document === 'undefined') return

  let generatedFieldCount = 0
  const fieldSelector = 'input, select, textarea'
  const escapeSelectorValue = (value) => {
    if (typeof window.CSS?.escape === 'function') return window.CSS.escape(value)
    return String(value).replace(/["\\]/g, '\\$&')
  }

  const wireField = (field) => {
    if (!(field instanceof HTMLElement)) return
    if (!field.matches(fieldSelector)) return
    if (!field.id) {
      generatedFieldCount += 1
      field.id = `bo-field-${generatedFieldCount}`
    }
    if (!field.getAttribute('name')) {
      field.setAttribute('name', field.id.replace(/-/g, '_'))
    }
    if (field.closest('label')) return
    const existingLabel = document.querySelector(`label[for="${escapeSelectorValue(field.id)}"]`)
    if (existingLabel) return

    const parent = field.parentElement
    if (!parent) return
    const siblingLabel = parent.querySelector('label:not([for])')
    if (!siblingLabel) return
    if (siblingLabel.querySelector(fieldSelector)) return
    siblingLabel.setAttribute('for', field.id)
  }

  const scan = (root) => {
    if (!root) return
    if (root instanceof HTMLElement && root.matches(fieldSelector)) {
      wireField(root)
      return
    }
    if (typeof root.querySelectorAll !== 'function') return
    root.querySelectorAll(fieldSelector).forEach(wireField)
  }

  scan(document)

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        scan(node)
      })
    })
  })

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
    return
  }

  window.addEventListener('DOMContentLoaded', () => {
    if (!document.body) return
    scan(document)
    observer.observe(document.body, { childList: true, subtree: true })
  }, { once: true })
}

// Keep known browser-extension and CSS-injection noise away from React startup.
if (typeof window !== 'undefined') {
  const sheetPrototype = window.CSSStyleSheet?.prototype
  const nativeInsertRule = sheetPrototype?.insertRule
  if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
    const safeInsertRule = function safeInsertRule(rule, index) {
      try {
        return nativeInsertRule.call(this, rule, index)
      } catch (error) {
        if (isGuardableStyleSheetError(error)) return -1
        throw error
      }
    }
    safeInsertRule.__businessOsGuarded = true
    sheetPrototype.insertRule = safeInsertRule
  }

  const cssRulesDescriptor = sheetPrototype
    ? Object.getOwnPropertyDescriptor(sheetPrototype, 'cssRules')
    : null
  if (cssRulesDescriptor?.get && !cssRulesDescriptor.get.__businessOsGuarded) {
    const nativeCssRulesGetter = cssRulesDescriptor.get
    const safeCssRulesGetter = function safeCssRulesGetter() {
      try {
        return nativeCssRulesGetter.call(this) || []
      } catch (error) {
        if (isGuardableStyleSheetError(error)) return []
        throw error
      }
    }
    safeCssRulesGetter.__businessOsGuarded = true
    Object.defineProperty(sheetPrototype, 'cssRules', {
      configurable: true,
      enumerable: cssRulesDescriptor.enumerable,
      get: safeCssRulesGetter,
    })
  }

  const stopKnownStartupNoise = (event, value) => {
    const filename = String(event?.filename || '')
    const source = String(event?.target?.src || event?.target?.href || '')
    const error = value && typeof value === 'object' ? value : null
    const message = String(error?.message || value || '')
    const stack = String(error?.stack || '')
    const baseOrigin = window.location?.origin || ''
    if (!shouldSuppressRuntimeError({ message, error, filename: filename || source, stack, baseOrigin })) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  }

  window.addEventListener('unhandledrejection', (event) => {
    stopKnownStartupNoise(event, event?.reason)
  }, true)

  window.addEventListener('error', (event) => {
    stopKnownStartupNoise(event, event?.error || event?.message)
  }, true)

  window.addEventListener('securitypolicyviolation', (event) => {
    if (!shouldSuppressSecurityPolicyViolation({
      violatedDirective: event?.violatedDirective,
      blockedURI: event?.blockedURI,
      sourceFile: event?.sourceFile,
      sample: event?.sample,
      baseOrigin: window.location?.origin || '',
    })) return
    event.stopImmediatePropagation()
  }, true)
}

registerOfflineAppShell()
installFormFieldAccessibility()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
