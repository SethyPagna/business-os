(function bootstrapBusinessOsShell() {
  var root = document.documentElement
  var theme = 'light'
  var extensionOrigins = [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension://',
    'ms-browser-extension://'
  ]

  function isKnownBridgeNoise(message) {
    var text = String(message || '')
    return (
      text.indexOf('No Listener: tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('Receiving end does not exist') !== -1 ||
      text.indexOf('Could not establish connection') !== -1 ||
      text.indexOf('plugin_not_implemented') !== -1
    )
  }

  function isKnownEvalNoise(message) {
    var text = String(message || '')
    return (
      text.indexOf("Evaluating a string as JavaScript violates the following Content Security Policy directive") !== -1 ||
      text.indexOf("'unsafe-eval' is not an allowed source of script") !== -1
    )
  }

  function isKnownStyleNoise(message) {
    var text = String(message || '')
    return (
      (text.indexOf('cssRules') !== -1 && (
        text.indexOf('null') !== -1 ||
        text.indexOf('Cannot read properties of null') !== -1 ||
        text.indexOf('Failed to access') !== -1
      )) ||
      (text.indexOf('insertRule') !== -1 && (
        text.indexOf('null') !== -1 ||
        text.indexOf('Cannot read properties') !== -1 ||
        text.indexOf('Failed to access') !== -1
      ))
    )
  }

  function isStaleModuleGraphError(message) {
    var text = String(message || '')
    return text.indexOf('does not provide an export named') !== -1 ||
      text.indexOf('Failed to fetch dynamically imported module') !== -1 ||
      text.indexOf('Importing a module script failed') !== -1
  }

  function requestStaleModuleReload() {
    try {
      var key = 'business-os:stale-module-reload-at'
      var now = Date.now()
      var last = Number(sessionStorage.getItem(key) || 0)
      if (last && now - last < 10000) return false
      sessionStorage.setItem(key, String(now))
      var nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('bos_reload', String(now))
      window.location.replace(nextUrl.toString())
      return true
    } catch (_) {
      window.location.reload()
      return true
    }
  }

  function isFirstPartyBuiltAssetSource(value) {
    var text = String(value || '').replace(/\\/g, '/')
    return /\/assets\/[^?#]+\.js/i.test(text) ||
      /\/assets\/[^?#]+\.css/i.test(text) ||
      /\/theme-bootstrap\.js/i.test(text) ||
      /\/scanbot-web-sdk\//i.test(text)
  }

  function hasInjectedBundleSource(value) {
    var text = String(value || '')
    if (!text) return false
    if (extensionOrigins.some(function(origin) { return text.indexOf(origin) !== -1 })) return true
    if (isFirstPartyBuiltAssetSource(text)) return false
    return /\bVM\d+\s+(vendor|content|inpage)\.js\b/i.test(text)
      || /(^|[\\/])(content|inpage|grammarly-check)\.js(?::\d+)?/i.test(text)
      || /contentFunc\.js/i.test(text)
  }

  function isGuardableSheetError(error) {
    var message = String((error && error.message) || error || '')
    return isKnownStyleNoise(message)
  }

  function shouldSuppressRuntimeError(message, fileName, stack) {
    if (isKnownBridgeNoise(message)) return true
    var source = String(fileName || '') + '\n' + String(stack || '')
    var injected = hasInjectedBundleSource(source) || hasInjectedBundleSource(message)
    var firstParty = isFirstPartyBuiltAssetSource(source)
    if (firstParty) return false
    if (isKnownStyleNoise(message) || isKnownEvalNoise(message)) return injected
    return injected && (isKnownStyleNoise(source) || isKnownEvalNoise(source) || isKnownBridgeNoise(source))
  }

  function installStyleSheetGuards() {
    if (!window.CSSStyleSheet || !window.CSSStyleSheet.prototype) return
    var proto = window.CSSStyleSheet.prototype
    var nativeInsertRule = proto.insertRule

    if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
      var safeInsertRule = function(rule, index) {
        try {
          return nativeInsertRule.call(this, rule, index)
        } catch (error) {
          if (isGuardableSheetError(error)) return -1
          throw error
        }
      }
      safeInsertRule.__businessOsGuarded = true
      proto.insertRule = safeInsertRule
    }

    var cssRulesDescriptor = Object.getOwnPropertyDescriptor(proto, 'cssRules')
    if (cssRulesDescriptor && typeof cssRulesDescriptor.get === 'function' && !cssRulesDescriptor.get.__businessOsGuarded) {
      var nativeCssRulesGetter = cssRulesDescriptor.get
      var safeCssRulesGetter = function() {
        try {
          return nativeCssRulesGetter.call(this) || []
        } catch (error) {
          if (isGuardableSheetError(error)) return []
          throw error
        }
      }
      safeCssRulesGetter.__businessOsGuarded = true
      Object.defineProperty(proto, 'cssRules', {
        configurable: true,
        enumerable: cssRulesDescriptor.enumerable,
        get: safeCssRulesGetter
      })
    }
  }

  try {
    var rawDevice = localStorage.getItem('businessos_device_settings') || ''
    if (rawDevice) {
      var parsedDevice = JSON.parse(rawDevice)
      if (parsedDevice && typeof parsedDevice.theme === 'string') {
        theme = parsedDevice.theme.trim().toLowerCase() || theme
      }
    }

    if (theme === 'light') {
      var legacyTheme = String(localStorage.getItem('businessos_theme') || '').trim().toLowerCase()
      if (legacyTheme) theme = legacyTheme
    }

    if (theme === 'light') {
      var legacySettings = localStorage.getItem('businessos_settings') || ''
      if (legacySettings) {
        var parsedLegacy = JSON.parse(legacySettings)
        if (parsedLegacy && typeof parsedLegacy.theme === 'string') {
          theme = parsedLegacy.theme.trim().toLowerCase() || theme
        }
      }
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

  window.addEventListener('unhandledrejection', function(e) {
    var message = e && e.reason && e.reason.message ? e.reason.message : String((e && e.reason) || '')
    var stack = String((e && e.reason && e.reason.stack) || '')
    if (!shouldSuppressRuntimeError(message, '', stack)) return
    e.preventDefault()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)

  window.addEventListener('error', function(e) {
    var message = String((e && e.message) || (e && e.error && e.error.message) || '')
    var fileName = String((e && e.filename) || '')
    var stack = String((e && e.error && e.error.stack) || '')
    if (isStaleModuleGraphError(message) && isFirstPartyBuiltAssetSource(fileName || stack)) {
      if (requestStaleModuleReload()) {
        e.preventDefault()
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
        return
      }
    }
    if (!shouldSuppressRuntimeError(message, fileName, stack)) return
    e.preventDefault()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)

  window.addEventListener('securitypolicyviolation', function(e) {
    var directive = String((e && e.violatedDirective) || '')
    var blockedURI = String((e && e.blockedURI) || '')
    var sourceFile = String((e && e.sourceFile) || '')
    var sample = String((e && e.sample) || '')
    var isKnownNoise = (
      directive.indexOf('script-src') !== -1 &&
      !isFirstPartyBuiltAssetSource(sourceFile) &&
      (
        (blockedURI === 'eval' && hasInjectedBundleSource(sourceFile)) ||
        (sample.indexOf('unsafe-eval') !== -1 && hasInjectedBundleSource(sourceFile)) ||
        sample.indexOf('tabs:outgoing') !== -1 ||
        hasInjectedBundleSource(sourceFile)
      )
    )
    if (!isKnownNoise) return
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)
})()
