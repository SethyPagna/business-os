import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import type { ComponentType } from 'react'
import '@fontsource/noto-sans-khmer/400.css'
import '@fontsource/noto-sans-khmer/500.css'
import '@fontsource/noto-sans-khmer/600.css'
import { isPublicCatalogPath } from './app/pathRouting.ts'
import './styles/main.css'
import {
  isGuardableStyleSheetError,
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier.ts'
import { installNumberInputWheelGuard } from './runtime/numberInputWheelGuard.ts'

type GuardedInsertRule = CSSStyleSheet['insertRule'] & { __businessOsGuarded?: boolean }
type GuardedGetter = (() => CSSRuleList) & { __businessOsGuarded?: boolean }
const AdminRoot = React.lazy(() => import('./AdminRoot.tsx')) as ComponentType
const PublicCatalogRoot = React.lazy(() => import('./PublicCatalogRoot.tsx')) as ComponentType
const SERVICE_WORKER_REGISTER_IDLE_TIMEOUT_MS = 5000
const SERVICE_WORKER_REGISTER_FALLBACK_DELAY_MS = 1200
const SERVICE_WORKER_UPDATE_POLL_MS = 15 * 60 * 1000
const SERVICE_WORKER_UPDATE_MIN_GAP_MS = 60 * 1000
const FORM_FIELD_ACCESSIBILITY_IDLE_TIMEOUT_MS = 3000
const FORM_FIELD_ACCESSIBILITY_FALLBACK_DELAY_MS = 1200

function scheduleAfterLoadIdle(task: () => void, idleTimeoutMs: number, fallbackDelayMs: number) {
  if (typeof window === 'undefined') return

  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(task, { timeout: idleTimeoutMs })
      return
    }
    window.setTimeout(task, fallbackDelayMs)
  }

  if (document.readyState === 'complete') {
    schedule()
    return
  }

  window.addEventListener('load', schedule, { once: true })
}

// A shop tab stays open all day and never navigates, so the browser only ever
// refetches sw.js at registration time. Without an explicit re-check the new
// worker never reaches 'install', BUSINESS_OS_APP_UPDATE_AVAILABLE is never
// broadcast, and the "Restart now" bar can never appear -- the till keeps
// running a stale bundle across deploys. Re-check on the cheap signals plus a
// slow interval. This only ASKS the browser to look; the service worker still
// decides whether anything actually changed, and nothing here ever reloads the
// page. Restarting stays exclusively the user's choice through
// restartIntoLatestApp(), which guards unfinished work.
function watchForNewAppShell(registration: ServiceWorkerRegistration) {
  if (typeof window === 'undefined') return

  let lastCheckedAt = Date.now()
  let checking = false

  const check = (minGapMs = 0) => {
    if (checking) return
    // An offline till would only burn a failing fetch every tick.
    if (navigator.onLine === false) return
    if (minGapMs > 0 && Date.now() - lastCheckedAt < minGapMs) return
    checking = true
    lastCheckedAt = Date.now()
    Promise.resolve(registration.update?.())
      .catch(() => {})
      .finally(() => { checking = false })
  }

  window.setInterval(() => {
    // A hidden tab can wait until someone looks at it again.
    if (document.visibilityState === 'hidden') return
    check()
  }, SERVICE_WORKER_UPDATE_POLL_MS)

  // Returning to the tab is the moment the bar is worth showing. The minimum
  // gap keeps rapid tab-switching from hammering the network.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    check(SERVICE_WORKER_UPDATE_MIN_GAP_MS)
  })

  // Reconnecting is the other moment a deploy missed while offline becomes
  // reachable.
  window.addEventListener('online', () => { check(SERVICE_WORKER_UPDATE_MIN_GAP_MS) })
}

function registerOfflineAppShell() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      registration.update?.().catch(() => {})
      watchForNewAppShell(registration)
    } catch (_) {}
  }

  scheduleAfterLoadIdle(
    () => { register().catch(() => {}) },
    SERVICE_WORKER_REGISTER_IDLE_TIMEOUT_MS,
    SERVICE_WORKER_REGISTER_FALLBACK_DELAY_MS,
  )
}

function installFormFieldAccessibility() {
  if (typeof document === 'undefined') return

  let generatedFieldCount = 0
  const fieldSelector = 'input, select, textarea'
  const escapeSelectorValue = (value: string) => {
    if (typeof window.CSS?.escape === 'function') return window.CSS.escape(value)
    return String(value).replace(/["\\]/g, '\\$&')
  }

  const wireField = (field: Element) => {
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

  const scan = (root: Document | Element | Node | null) => {
    if (!root) return
    if (root instanceof HTMLElement && root.matches(fieldSelector)) {
      wireField(root)
      return
    }
    if (!(root instanceof Document || root instanceof Element)) return
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

// Armed synchronously, before first paint -- a wheel over a focused number
// input can silently change its value from the moment a user can scroll,
// so this cannot wait for the idle callback `scheduleFormFieldAccessibility`
// below uses for its cosmetic pass.
if (typeof document !== 'undefined') {
  installNumberInputWheelGuard()
}

// Keep known browser-extension and CSS-injection noise away from React startup.
if (typeof window !== 'undefined') {
  const sheetPrototype = window.CSSStyleSheet?.prototype
  const nativeInsertRule = sheetPrototype?.insertRule as GuardedInsertRule | undefined
  if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
    const safeInsertRule = function safeInsertRule(this: CSSStyleSheet, rule: string, index?: number) {
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
  const descriptorGetter = cssRulesDescriptor?.get as GuardedGetter | undefined
  if (descriptorGetter && !descriptorGetter.__businessOsGuarded) {
    const nativeCssRulesGetter = descriptorGetter
    const safeCssRulesGetter = function safeCssRulesGetter(this: CSSStyleSheet) {
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
      enumerable: Boolean(cssRulesDescriptor?.enumerable),
      get: safeCssRulesGetter,
    })
  }

  const stopKnownStartupNoise = (event: Event, value: unknown) => {
    const errorEvent = event as ErrorEvent
    const target = event.target as (EventTarget & { src?: string; href?: string }) | null
    const filename = String(errorEvent.filename || '')
    const source = String(target?.src || target?.href || '')
    const error = value && typeof value === 'object' ? value : null
    const message = String(error && 'message' in error ? error.message : value || '')
    const stack = String(error && 'stack' in error ? error.stack : '')
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

function scheduleFormFieldAccessibility() {
  if (typeof window === 'undefined') return
  scheduleAfterLoadIdle(
    installFormFieldAccessibility,
    FORM_FIELD_ACCESSIBILITY_IDLE_TIMEOUT_MS,
    FORM_FIELD_ACCESSIBILITY_FALLBACK_DELAY_MS,
  )
}

const publicCatalogMode = typeof window !== 'undefined'
  ? isPublicCatalogPath(window.location.pathname)
  : false

function InitialShellFallback({ publicMode }: { publicMode: boolean }) {
  return (
    <div className="business-os-initial-shell" role="status" aria-live="polite">
      <div className="business-os-initial-panel">
        <div className="business-os-initial-spinner" aria-hidden="true" />
        <div className="business-os-initial-brand">
          <h1 className="business-os-initial-title">{publicMode ? 'Leang Beauty' : 'Business OS'}</h1>
          <p className="business-os-initial-copy">
            {publicMode ? 'Opening catalog' : 'Opening workspace'}
          </p>
        </div>
      </div>
    </div>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing root element')
const RootComponent = publicCatalogMode ? PublicCatalogRoot : AdminRoot

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={<InitialShellFallback publicMode={publicCatalogMode} />}>
      <RootComponent />
    </Suspense>
  </React.StrictMode>
)

registerOfflineAppShell()
scheduleFormFieldAccessibility()
