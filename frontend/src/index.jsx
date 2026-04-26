import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './AppContext'
import './styles/main.css'

// Keep known browser-extension and CSS-injection noise away from React startup.
if (typeof window !== 'undefined') {
  const ignoredRuntimePatterns = [
    'No Listener:',
    'tabs:outgoing',
    'capacitor',
    'plugin_not_implemented',
    'cssRules',
    'insertRule',
  ]
  const isIgnoredRuntimeMessage = (value) => {
    const message = String(value?.message || value || '')
    return ignoredRuntimePatterns.some((pattern) => message.includes(pattern))
  }

  const sheetPrototype = window.CSSStyleSheet?.prototype
  const nativeInsertRule = sheetPrototype?.insertRule
  if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
    const safeInsertRule = function safeInsertRule(rule, index) {
      try {
        return nativeInsertRule.call(this, rule, index)
      } catch (error) {
        if (isIgnoredRuntimeMessage(error)) return -1
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
        if (isIgnoredRuntimeMessage(error)) return []
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
    if (!isIgnoredRuntimeMessage(value)) return false
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
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
