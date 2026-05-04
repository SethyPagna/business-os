const EXTENSION_ORIGINS = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'ms-browser-extension://',
]

function toText(value) {
  return String(value || '')
}

function includesExtensionOrigin(value) {
  const text = toText(value)
  return EXTENSION_ORIGINS.some((origin) => text.includes(origin))
}

function getPathname(value, baseOrigin = '') {
  const raw = toText(value).trim()
  if (!raw) return ''
  try {
    return new URL(raw, baseOrigin || 'http://business-os.local').pathname
  } catch (_) {
    return raw.replace(/\\/g, '/')
  }
}

export function isFirstPartyBuiltAssetSource(value, baseOrigin = '') {
  const text = toText(value)
  if (!text) return false
  const pathname = getPathname(text, baseOrigin)
  return /\/assets\/[^?#]+\.js$/i.test(pathname)
    || /\/assets\/[^?#]+\.css$/i.test(pathname)
    || /\/theme-bootstrap\.js$/i.test(pathname)
    || /\/scanbot-web-sdk\//i.test(pathname)
}

export function isLikelyInjectedRuntimeSource(value, baseOrigin = '') {
  const text = toText(value)
  if (!text) return false
  if (includesExtensionOrigin(text)) return true
  if (isFirstPartyBuiltAssetSource(text, baseOrigin)) return false
  return /\bVM\d+\s+(vendor|content|inpage)\.js\b/i.test(text)
    || /(^|\s)(vendor|content|components)\.js(?::\d+){0,2}(?=\s|$)/i.test(text)
    || /(^|[\\/])(content|inpage|grammarly-check)\.js(?::\d+){0,2}/i.test(text)
    || /contentFunc\.js/i.test(text)
}

export function isKnownBridgeMessage(value) {
  const message = toText(value)
  return /No Listener:\s*tabs:outgoing\.message\.ready/i.test(message)
    || /tabs:outgoing\.message\.ready/i.test(message)
    || /Receiving end does not exist/i.test(message)
    || /Could not establish connection/i.test(message)
    || /message channel closed before a response was received/i.test(message)
    || /listener indicated an asynchronous response/i.test(message)
    || /plugin_not_implemented/i.test(message)
}

export function isKnownStyleInjectionNoise(value) {
  const message = toText(value)
  return (
    /cssRules/i.test(message)
    && (
      /Cannot read properties of null/i.test(message)
      || /\bnull\b/i.test(message)
      || /Failed to access/i.test(message)
    )
  ) || (
    /insertRule/i.test(message)
    && (
      /\bnull\b/i.test(message)
      || /Failed to access/i.test(message)
      || /Cannot read properties/i.test(message)
    )
  )
}

export function isKnownEvalCspNoise(value) {
  const message = toText(value)
  return /unsafe-eval/i.test(message)
    || /Evaluating a string as JavaScript violates/i.test(message)
    || /Content Security Policy of your site blocks the use of 'eval'/i.test(message)
}

export function shouldSuppressRuntimeError(input = {}) {
  const message = toText(input.message || input.error?.message || input.error || input.reason?.message || input.reason)
  const filename = toText(input.filename || input.source)
  const stack = toText(input.stack || input.error?.stack || input.reason?.stack)
  const baseOrigin = toText(input.baseOrigin)
  const combinedSource = `${filename}\n${stack}`
  const firstParty = isFirstPartyBuiltAssetSource(filename, baseOrigin)
    || isFirstPartyBuiltAssetSource(stack, baseOrigin)
  const injected = isLikelyInjectedRuntimeSource(filename, baseOrigin)
    || isLikelyInjectedRuntimeSource(stack, baseOrigin)
    || isLikelyInjectedRuntimeSource(message, baseOrigin)

  if (isKnownBridgeMessage(message)) return true
  if (isKnownStyleInjectionNoise(message)) return injected && !firstParty
  if (isKnownEvalCspNoise(message)) return injected && !firstParty
  return injected && !firstParty && (
    isKnownBridgeMessage(combinedSource)
    || isKnownStyleInjectionNoise(combinedSource)
    || isKnownEvalCspNoise(combinedSource)
  )
}

export function shouldSuppressSecurityPolicyViolation(input = {}) {
  const directive = toText(input.violatedDirective || input.directive)
  const blockedURI = toText(input.blockedURI)
  const sourceFile = toText(input.sourceFile)
  const sample = toText(input.sample)
  const baseOrigin = toText(input.baseOrigin)
  if (!/script-src/i.test(directive)) return false
  if (isFirstPartyBuiltAssetSource(sourceFile, baseOrigin)) return false
  if (blockedURI === 'eval' && isLikelyInjectedRuntimeSource(sourceFile, baseOrigin)) return true
  if (isKnownEvalCspNoise(sample) && isLikelyInjectedRuntimeSource(sourceFile, baseOrigin)) return true
  if (/tabs:outgoing/i.test(sample)) return true
  return false
}

export function isGuardableStyleSheetError(error, source = '') {
  const message = toText(error?.message || error)
  if (!isKnownStyleInjectionNoise(message)) return false
  if (!source) return true
  return !isFirstPartyBuiltAssetSource(source)
}
