(function bootstrapBusinessOsShell() {
  var root = document.documentElement
  var theme = 'light'
  var extensionOrigins = [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension://',
    'ms-browser-extension://'
  ]

  function isInjectedRuntimeNoise(message) {
    var text = String(message || '')
    return (
      text.indexOf('No Listener: tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('Receiving end does not exist') !== -1 ||
      text.indexOf("Evaluating a string as JavaScript violates the following Content Security Policy directive") !== -1 ||
      text.indexOf("'unsafe-eval' is not an allowed source of script") !== -1 ||
      (text.indexOf('cssRules') !== -1 && text.indexOf('null') !== -1)
    )
  }

  function hasInjectedBundleSource(value) {
    var text = String(value || '')
    if (!text) return false
    if (extensionOrigins.some(function(origin) { return text.indexOf(origin) !== -1 })) return true
    return /(^|[\\/])(vendor|content|inpage)\.js(?::\d+)?$/i.test(text)
      || /content\.js/i.test(text)
      || /tabs:outgoing\.message\.ready/i.test(text)
  }

  function isGuardableSheetError(error) {
    var message = String((error && error.message) || error || '')
    return (
      isInjectedRuntimeNoise(message) ||
      (
        message.indexOf('cssRules') !== -1 &&
        (
          message.indexOf('null') !== -1 ||
          message.indexOf('Cannot read properties of null') !== -1
        )
      ) ||
      (
        message.indexOf('insertRule') !== -1 &&
        (
          message.indexOf('null') !== -1 ||
          message.indexOf('Failed to access') !== -1
        )
      )
    )
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
    if (!isInjectedRuntimeNoise(message) && !hasInjectedBundleSource(stack)) return
    e.preventDefault()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)

  window.addEventListener('error', function(e) {
    var message = String((e && e.message) || (e && e.error && e.error.message) || '')
    var fileName = String((e && e.filename) || '')
    var stack = String((e && e.error && e.error.stack) || '')
    if (
      !isInjectedRuntimeNoise(message) &&
      !hasInjectedBundleSource(fileName) &&
      !hasInjectedBundleSource(stack)
    ) return
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
      (
        blockedURI === 'eval' ||
        sample.indexOf('unsafe-eval') !== -1 ||
        sample.indexOf('tabs:outgoing') !== -1 ||
        hasInjectedBundleSource(sourceFile)
      )
    )
    if (!isKnownNoise) return
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)
})()
