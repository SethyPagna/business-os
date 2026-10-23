// Lane 6.0.953: what a failed camera start means. The browsers agree on the error NAME and on little
// else, so the classifier reads name + message; every row here is an error a real browser throws.
//
// Run: node tests/cameraFailure.test.ts
import assert from 'node:assert/strict'
import { classifyCameraFailure, type CameraFailure } from '../src/components/products/scanning/cameraFailure.ts'
import { isInAppBrowser } from '../src/components/products/scanning/cameraPolicy.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const classify = (text: string, context: { permissionDenied?: boolean; inAppBrowser?: boolean } = {}): CameraFailure =>
  classifyCameraFailure(text, { permissionDenied: false, inAppBrowser: false, ...context })

runTest('a refusal the browser remembers is a block; one it does not is a dismissed prompt', () => {
  assert.equal(classify('NotAllowedError Permission denied', { permissionDenied: true }), 'blocked', 'the person tapped Block (or it was saved earlier)')
  assert.equal(classify('NotAllowedError Permission dismissed'), 'dismissed', 'the prompt was closed with no answer')
  assert.equal(classify('NotAllowedError Permission denied'), 'dismissed', 'nothing saved: asking again can still work')
  assert.equal(classify('PermissionDeniedError'), 'dismissed', 'the old Chrome name')
  assert.equal(classify('NotAllowedError Permission denied by system'), 'blocked', "the phone's own camera switch for the browser is off: also a block")
})

runTest('a refusal inside an in-app browser is "open it in your browser", never a retry loop', () => {
  assert.equal(classify('NotAllowedError Permission denied', { inAppBrowser: true }), 'document-blocked')
  assert.equal(classify('NotAllowedError Permission denied', { inAppBrowser: true, permissionDenied: true }), 'blocked', 'a saved denial is still a block there')
})

runTest('a view whose policy forbids the camera says so, whatever else is true', () => {
  for (const text of ['NotAllowedError Camera is blocked by this browser view', 'NotAllowedError camera is not allowed in this document', 'NotAllowedError Permissions policy violation: camera is not allowed']) {
    assert.equal(classify(text), 'document-blocked', text)
    assert.equal(classify(text, { permissionDenied: true }), 'document-blocked', `${text} (even with a saved denial)`)
  }
})

runTest('no camera: the error is not a permission one and a retry cannot help', () => {
  assert.equal(classify('NotFoundError Requested device not found'), 'no-camera')
  assert.equal(classify('DevicesNotFoundError'), 'no-camera')
})

runTest('a camera that another app holds', () => {
  assert.equal(classify('NotReadableError Could not start video source'), 'busy', 'Chrome')
  assert.equal(classify('TrackStartError'), 'busy', 'old Chrome, Edge')
  assert.equal(classify('AbortError Starting videoinput failed'), 'busy', 'Firefox')
  assert.equal(classify('NotReadableError Failed to allocate videosource', { permissionDenied: true }), 'busy', 'a busy camera is busy even when a permission is saved')
})

runTest('everything else is the generic failure, and no permission wording leaks into it', () => {
  for (const text of ['The barcode decoder is unavailable.', 'OverconstrainedError', 'TypeError', 'SecurityError insecure context']) {
    assert.equal(classify(text), 'failed', text)
  }
  assert.equal(classify('', { permissionDenied: true }), 'failed', 'a saved denial does not turn an unrelated failure into a block')
})

runTest('in-app browsers: the apps staff open links from', () => {
  const inApp = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 320.0',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 Telegram-Android/10.14',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 musical_ly_33.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.0.0',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 MicroMessenger/8.0',
  ]
  for (const agent of inApp) assert.equal(isInAppBrowser(agent), true, agent)
  const plain = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ]
  for (const agent of plain) assert.equal(isInAppBrowser(agent), false, agent)
})

if (failed > 0) process.exitCode = 1
