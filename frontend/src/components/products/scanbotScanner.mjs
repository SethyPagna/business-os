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
  const ScanbotSDK = await loadScanbotScript()
  if (sdkPromise) return sdkPromise
  sdkPromise = ScanbotSDK.initialize({
    enginePath: SCANBOT_ENGINE_PATH,
  }).catch((error) => {
    sdkPromise = null
    throw error
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
