interface BusinessOsThemeSettings {
  theme?: unknown
}

interface GuardedFunction extends Function {
  __businessOsGuarded?: boolean
}

type AppTheme = 'light' | 'dark'

(function bootstrapBusinessOsShell() {
  const root = document.documentElement
  let theme: AppTheme = 'light'
  const extensionOrigins = [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension://',
    'ms-browser-extension://',
  ]

  function text(value: unknown): string {
    return String(value || '')
  }

  function normalizeTheme(value: unknown, fallback: AppTheme): AppTheme {
    const normalized = text(value).trim().toLowerCase()
    return normalized === 'dark' ? 'dark' : fallback
  }

  function readJsonObject(value: string): BusinessOsThemeSettings | null {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as BusinessOsThemeSettings : null
    } catch (_) {
      return null
    }
  }

  function isKnownBridgeNoise(message: unknown): boolean {
    const raw = text(message)
    return raw.indexOf('No Listener: tabs:outgoing.message.ready') !== -1
      || raw.indexOf('tabs:outgoing.message.ready') !== -1
      || raw.indexOf('Receiving end does not exist') !== -1
      || raw.indexOf('Could not establish connection') !== -1
      || raw.indexOf('plugin_not_implemented') !== -1
  }

  function isKnownEvalNoise(message: unknown): boolean {
    const raw = text(message)
    return raw.indexOf('Evaluating a string as JavaScript violates the following Content Security Policy directive') !== -1
      || raw.indexOf("'unsafe-eval' is not an allowed source of script") !== -1
  }

  function isKnownStyleNoise(message: unknown): boolean {
    const raw = text(message)
    return (
      (raw.indexOf('cssRules') !== -1 && (
        raw.indexOf('null') !== -1
        || raw.indexOf('Cannot read properties of null') !== -1
        || raw.indexOf('Failed to access') !== -1
      ))
      || (raw.indexOf('insertRule') !== -1 && (
        raw.indexOf('null') !== -1
        || raw.indexOf('Cannot read properties') !== -1
        || raw.indexOf('Failed to access') !== -1
      ))
    )
  }

  function isStaleModuleGraphError(message: unknown): boolean {
    const raw = text(message)
    return raw.indexOf('does not provide an export named') !== -1
      || raw.indexOf('Failed to fetch dynamically imported module') !== -1
      || raw.indexOf('Importing a module script failed') !== -1
  }

  function requestStaleModuleReload(): boolean {
    try {
      const key = 'business-os:stale-module-reload-at'
      const now = Date.now()
      const last = Number(sessionStorage.getItem(key) || 0)
      if (last && now - last < 10000) return false
      sessionStorage.setItem(key, String(now))
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('bos_reload', String(now))
      window.location.replace(nextUrl.toString())
      return true
    } catch (_) {
      window.location.reload()
      return true
    }
  }

  function isFirstPartyBuiltAssetSource(value: unknown): boolean {
    const raw = text(value).replace(/\\/g, '/')
    return /\/assets\/[^?#]+\.js/i.test(raw)
      || /\/assets\/[^?#]+\.css/i.test(raw)
      || /\/theme-bootstrap\.js/i.test(raw)
      || /\/scanbot-web-sdk\//i.test(raw)
  }

  function hasInjectedBundleSource(value: unknown): boolean {
    const raw = text(value)
    if (!raw) return false
    if (extensionOrigins.some((origin) => raw.indexOf(origin) !== -1)) return true
    if (isFirstPartyBuiltAssetSource(raw)) return false
    return /\bVM\d+\s+(vendor|content|inpage)\.js\b/i.test(raw)
      || /(^|[\\/])(content|inpage|grammarly-check)\.js(?::\d+)?/i.test(raw)
      || /contentFunc\.js/i.test(raw)
  }

  function isGuardableSheetError(error: unknown): boolean {
    return isKnownStyleNoise((error as Error | null)?.message || error)
  }

  function shouldSuppressRuntimeError(message: unknown, fileName: unknown, stack: unknown): boolean {
    if (isKnownBridgeNoise(message)) return true
    const source = `${text(fileName)}\n${text(stack)}`
    const injected = hasInjectedBundleSource(source) || hasInjectedBundleSource(message)
    const firstParty = isFirstPartyBuiltAssetSource(source)
    if (firstParty) return false
    if (isKnownStyleNoise(message) || isKnownEvalNoise(message)) return injected
    return injected && (isKnownStyleNoise(source) || isKnownEvalNoise(source) || isKnownBridgeNoise(source))
  }

  function installStyleSheetGuards(): void {
    if (!window.CSSStyleSheet || !window.CSSStyleSheet.prototype) return
    const proto = window.CSSStyleSheet.prototype
    const nativeInsertRule = proto.insertRule as GuardedFunction

    if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
      const safeInsertRule = function safeInsertRule(this: CSSStyleSheet, rule: string, index?: number) {
        try {
          return nativeInsertRule.call(this, rule, index)
        } catch (error) {
          if (isGuardableSheetError(error)) return -1
          throw error
        }
      } as GuardedFunction
      safeInsertRule.__businessOsGuarded = true
      proto.insertRule = safeInsertRule as CSSStyleSheet['insertRule']
    }

    const cssRulesDescriptor = Object.getOwnPropertyDescriptor(proto, 'cssRules')
    const nativeCssRulesGetter = cssRulesDescriptor?.get as GuardedFunction | undefined
    if (cssRulesDescriptor && nativeCssRulesGetter && !nativeCssRulesGetter.__businessOsGuarded) {
      const safeCssRulesGetter = function safeCssRulesGetter(this: CSSStyleSheet) {
        try {
          return nativeCssRulesGetter.call(this) || []
        } catch (error) {
          if (isGuardableSheetError(error)) return []
          throw error
        }
      } as GuardedFunction
      safeCssRulesGetter.__businessOsGuarded = true
      Object.defineProperty(proto, 'cssRules', {
        configurable: true,
        enumerable: cssRulesDescriptor.enumerable,
        get: safeCssRulesGetter,
      })
    }
  }

  try {
    const parsedDevice = readJsonObject(localStorage.getItem('businessos_device_settings') || '')
    if (parsedDevice) theme = normalizeTheme(parsedDevice.theme, theme)

    if (theme === 'light') {
      theme = normalizeTheme(localStorage.getItem('businessos_theme') || '', theme)
    }

    if (theme === 'light') {
      const parsedLegacy = readJsonObject(localStorage.getItem('businessos_settings') || '')
      if (parsedLegacy) theme = normalizeTheme(parsedLegacy.theme, theme)
    }
  } catch (_) {}

  installStyleSheetGuards()

  if (theme === 'dark') {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }

  window.addEventListener('unhandledrejection', function onUnhandledRejection(event) {
    const reason = event.reason as Error | string | null
    const message = reason && typeof reason === 'object' && 'message' in reason ? reason.message : text(reason)
    const stack = reason && typeof reason === 'object' && 'stack' in reason ? reason.stack : ''
    if (!shouldSuppressRuntimeError(message, '', stack)) return
    event.preventDefault()
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
  }, true)

  window.addEventListener('error', function onError(event) {
    const message = text(event.message || event.error?.message)
    const fileName = text(event.filename)
    const stack = text(event.error?.stack)
    if (isStaleModuleGraphError(message) && isFirstPartyBuiltAssetSource(fileName || stack)) {
      if (requestStaleModuleReload()) {
        event.preventDefault()
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
        return
      }
    }
    if (!shouldSuppressRuntimeError(message, fileName, stack)) return
    event.preventDefault()
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
  }, true)

  window.addEventListener('securitypolicyviolation', function onSecurityPolicyViolation(event) {
    const directive = text(event.violatedDirective)
    const blockedURI = text(event.blockedURI)
    const sourceFile = text(event.sourceFile)
    const sample = text(event.sample)
    const isKnownNoise = (
      directive.indexOf('script-src') !== -1
      && !isFirstPartyBuiltAssetSource(sourceFile)
      && (
        (blockedURI === 'eval' && hasInjectedBundleSource(sourceFile))
        || (sample.indexOf('unsafe-eval') !== -1 && hasInjectedBundleSource(sourceFile))
        || sample.indexOf('tabs:outgoing') !== -1
        || hasInjectedBundleSource(sourceFile)
      )
    )
    if (!isKnownNoise) return
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
  }, true)
})()
