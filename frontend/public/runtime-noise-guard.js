(function installBusinessOsRuntimeNoiseGuard() {
  if (typeof window === 'undefined') return
  if (window.__businessOsRuntimeNoiseGuard) return
  window.__businessOsRuntimeNoiseGuard = true

  var extensionSourcePattern = /(chrome-extension|moz-extension|safari-extension|ms-browser-extension):\/\//i
  var injectedSourcePattern = /\bVM\d+\s+(vendor|content|components|inpage)\.js\b|(^|\s)(vendor|content|components|inpage|grammarly-check)\.js(?::\d+){0,2}(?=\s|$)/i
  var firstPartyAssetPattern = /\/assets\/[^?#]+\.(js|css)$/i

  function text(value) {
    return String(value || '')
  }

  function sourceFromEvent(event) {
    return [
      text(event && event.filename),
      text(event && event.target && (event.target.src || event.target.href)),
      text(event && event.error && event.error.stack),
      text(event && event.reason && event.reason.stack),
    ].join('\n')
  }

  function isFirstPartyAsset(source) {
    return firstPartyAssetPattern.test(text(source))
  }

  function isInjectedSource(source) {
    var raw = text(source)
    return !isFirstPartyAsset(raw) && (extensionSourcePattern.test(raw) || injectedSourcePattern.test(raw))
  }

  function isKnownNoise(message, source) {
    var rawMessage = text(message)
    var rawSource = text(source)
    if (/tabs:outgoing\.message\.ready|No Listener:\s*tabs:outgoing|Receiving end does not exist|Could not establish connection/i.test(rawMessage)) return true
    if (/cssRules|insertRule/i.test(rawMessage) && /Cannot read properties|Failed to access|\bnull\b/i.test(rawMessage)) {
      return isInjectedSource(rawSource || rawMessage)
    }
    if (/unsafe-eval|Evaluating a string as JavaScript violates|Content Security Policy of your site blocks the use of 'eval'/i.test(rawMessage)) {
      return isInjectedSource(rawSource || rawMessage)
    }
    return false
  }

  function suppress(event, value) {
    var message = text(value && value.message ? value.message : value)
    var source = sourceFromEvent(event)
    if (!isKnownNoise(message, source)) return false
    try { event.preventDefault() } catch (_) {}
    try { event.stopImmediatePropagation() } catch (_) {}
    return true
  }

  window.addEventListener('unhandledrejection', function onUnhandledRejection(event) {
    suppress(event, event && event.reason)
  }, true)

  window.addEventListener('error', function onError(event) {
    suppress(event, (event && event.error) || (event && event.message))
  }, true)

  window.addEventListener('securitypolicyviolation', function onSecurityPolicyViolation(event) {
    var sourceFile = text(event && event.sourceFile)
    var sample = text(event && event.sample)
    var blockedUri = text(event && event.blockedURI)
    if (!(isKnownNoise(sample, sourceFile) || (blockedUri === 'eval' && isInjectedSource(sourceFile)))) return
    try { event.stopImmediatePropagation() } catch (_) {}
  }, true)

  var sheetPrototype = window.CSSStyleSheet && window.CSSStyleSheet.prototype
  if (!sheetPrototype) return

  var nativeInsertRule = sheetPrototype.insertRule
  if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
    sheetPrototype.insertRule = function guardedInsertRule(rule, index) {
      try {
        return nativeInsertRule.call(this, rule, index)
      } catch (error) {
        if (isKnownNoise(error && error.message, 'VM vendor.js')) return -1
        throw error
      }
    }
    sheetPrototype.insertRule.__businessOsGuarded = true
  }

  var descriptor = Object.getOwnPropertyDescriptor(sheetPrototype, 'cssRules')
  if (descriptor && descriptor.get && !descriptor.get.__businessOsGuarded) {
    var nativeCssRulesGetter = descriptor.get
    var guardedCssRulesGetter = function guardedCssRulesGetter() {
      try {
        return nativeCssRulesGetter.call(this) || []
      } catch (error) {
        if (isKnownNoise(error && error.message, 'VM vendor.js')) return []
        throw error
      }
    }
    guardedCssRulesGetter.__businessOsGuarded = true
    Object.defineProperty(sheetPrototype, 'cssRules', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: guardedCssRulesGetter,
    })
  }
}())
