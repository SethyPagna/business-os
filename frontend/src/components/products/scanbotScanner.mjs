const publicBasePath = (() => {
  const base = String(import.meta.env?.BASE_URL || '/')
  if (!base) return '/'
  return base.endsWith('/') ? base : `${base}/`
})()

const SCANBOT_SCRIPT_PATH = `${publicBasePath}scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`
const SCANBOT_ENGINE_PATH = `${publicBasePath}scanbot-web-sdk/bundle/bin/barcode-scanner/`

let scriptPromise = null
let sdkPromise = null

function getScanbotGlobal() {
  return globalThis?.ScanbotSDK || globalThis?.window?.ScanbotSDK || null
}

export function isCameraBlockedByDocumentPolicy() {
  try {
    const policy = globalThis?.document?.permissionsPolicy || globalThis?.document?.featurePolicy
    if (!policy?.allowsFeature) return false
    return policy.allowsFeature('camera') === false
  } catch (_) {
    return false
  }
}

function normalizeScanbotError(error) {
  const message = String(error?.message || error || '').trim()
  if (/permissions policy|camera is not allowed in this document/i.test(message)) {
    return new Error('Camera access is blocked by this browser view before scanning can start.')
  }
  if (/content security policy|unsafe-eval|webassembly|wasm/i.test(message)) {
    return new Error('Scanner startup was blocked by the current server security policy.')
  }
  if (/enginepath|worker/i.test(message)) {
    return new Error('Scanner assets could not finish loading for this page.')
  }
  return error instanceof Error ? error : new Error(message || 'Scanner could not start.')
}

function loadScanbotScript() {
  if (getScanbotGlobal()) return Promise.resolve(getScanbotGlobal())
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-scanbot-sdk="true"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(getScanbotGlobal()), { once: true })
      existing.addEventListener('error', () => reject(new Error('Unable to load Scanbot scanner assets.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = SCANBOT_SCRIPT_PATH
    script.async = true
    script.dataset.scanbotSdk = 'true'
    script.onload = () => {
      const sdk = getScanbotGlobal()
      if (!sdk) {
        reject(new Error('Scanbot scanner is unavailable after loading its assets.'))
        return
      }
      resolve(sdk)
    }
    script.onerror = () => reject(new Error('Unable to load Scanbot scanner assets.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

async function readCameraPermissionState() {
  try {
    if (!globalThis?.navigator?.permissions?.query) return 'unknown'
    const result = await globalThis.navigator.permissions.query({ name: 'camera' })
    return String(result?.state || 'unknown')
  } catch (_) {
    return 'unknown'
  }
}

export async function getPreferredScannerMode() {
  if (
    typeof window === 'undefined'
    || !globalThis?.navigator?.mediaDevices?.getUserMedia
  ) {
    return { mode: 'fallback', reason: 'unsupported', permissionState: 'unsupported' }
  }

  if (isCameraBlockedByDocumentPolicy()) {
    return { mode: 'fallback', reason: 'document-policy', permissionState: 'blocked' }
  }

  const permissionState = await readCameraPermissionState()
  return {
    mode: 'scanbot',
    reason: permissionState === 'granted'
      ? 'granted'
      : permissionState === 'denied'
        ? 'retry-after-denied'
        : 'permission-prompt',
    permissionState,
  }
}

async function getInitializedScanbot() {
  const ScanbotSDK = await loadScanbotScript().catch((error) => {
    throw normalizeScanbotError(error)
  })
  if (sdkPromise) return sdkPromise
  sdkPromise = ScanbotSDK.initialize({
    enginePath: SCANBOT_ENGINE_PATH,
  }).catch((error) => {
    sdkPromise = null
    throw normalizeScanbotError(error)
  })
  return sdkPromise
}

export async function scanBarcodeWithScanbot({
  allowArOverlay = true,
} = {}) {
  const sdk = await getInitializedScanbot()
  const ScanbotSDK = getScanbotGlobal()
  if (!sdk || !ScanbotSDK?.UI?.Config?.BarcodeScannerScreenConfiguration) {
    throw new Error('Scanbot scanner is not ready yet.')
  }

  const config = new ScanbotSDK.UI.Config.BarcodeScannerScreenConfiguration()
  if (config?.useCase?.arOverlay) {
    config.useCase.arOverlay.visible = Boolean(allowArOverlay)
    config.useCase.arOverlay.automaticSelectionEnabled = false
  }

  const scanResult = await ScanbotSDK.UI.createBarcodeScanner(config)
  const item = Array.isArray(scanResult?.items) ? scanResult.items[0] : null
  const value = String(item?.barcode?.text || '').trim()
  return value || ''
}
