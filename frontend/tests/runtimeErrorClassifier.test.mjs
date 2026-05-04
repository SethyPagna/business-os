import assert from 'node:assert/strict'
import {
  isFirstPartyBuiltAssetSource,
  isLikelyInjectedRuntimeSource,
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from '../src/runtime/runtimeErrorClassifier.mjs'

assert.equal(isFirstPartyBuiltAssetSource('https://leangcosmetics.crane-qilin.ts.net/assets/vendor.js'), true)
assert.equal(isFirstPartyBuiltAssetSource('/assets/vendor-react.js'), true)
assert.equal(isFirstPartyBuiltAssetSource('VM2289 vendor.js'), false)

assert.equal(isLikelyInjectedRuntimeSource('chrome-extension://abc/content.js'), true)
assert.equal(isLikelyInjectedRuntimeSource('VM2289 vendor.js'), true)
assert.equal(isLikelyInjectedRuntimeSource('vendor.js:80'), true)
assert.equal(isLikelyInjectedRuntimeSource('https://leangcosmetics.crane-qilin.ts.net/assets/vendor.js'), false)

assert.equal(shouldSuppressRuntimeError({
  message: "Cannot read properties of null (reading 'cssRules')",
  filename: 'https://leangcosmetics.crane-qilin.ts.net/assets/vendor.js',
}), false)

assert.equal(shouldSuppressRuntimeError({
  message: "Cannot read properties of null (reading 'cssRules')",
  filename: 'VM2289 vendor.js',
}), true)

assert.equal(shouldSuppressRuntimeError({
  message: "Cannot read properties of null (reading 'cssRules')",
  stack: "TypeError: Cannot read properties of null (reading 'cssRules')\n    at fe (vendor.js:27:48748)\n    at content.js:1:170212",
}), true)

assert.equal(shouldSuppressRuntimeError({
  message: 'Uncaught Error: No Listener: tabs:outgoing.message.ready',
  stack: 'Error: No Listener\n at chrome-extension://abc/content.js:1:1',
}), true)

assert.equal(shouldSuppressRuntimeError({
  message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
  stack: 'Error\n at chrome-extension://abc/content.js:1:1',
}), true)

assert.equal(shouldSuppressRuntimeError({
  message: 'Real first-party crash',
  filename: 'https://leangcosmetics.crane-qilin.ts.net/assets/vendor.js',
}), false)

assert.equal(shouldSuppressSecurityPolicyViolation({
  violatedDirective: 'script-src',
  blockedURI: 'eval',
  sourceFile: 'https://leangcosmetics.crane-qilin.ts.net/assets/vendor.js',
  sample: 'unsafe-eval',
}), false)

assert.equal(shouldSuppressSecurityPolicyViolation({
  violatedDirective: 'script-src',
  blockedURI: 'eval',
  sourceFile: 'VM2289 vendor.js',
  sample: 'unsafe-eval',
}), true)

console.log('runtimeErrorClassifier tests passed')
