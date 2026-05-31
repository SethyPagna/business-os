import { readCameraPermissionState, type CameraPermissionState } from './cameraPermission.ts'

type ScanbotMode = {
  mode: 'fallback' | 'scanbot'
  reason: 'unsupported' | 'document-policy' | 'granted' | 'retry-after-denied' | 'permission-prompt'
  permissionState: CameraPermissionState
}

type ScanbotSdk = {
  initialize: (options: { enginePath: string }) => Promise<unknown>
  UI?: {
    Config?: {
      BarcodeScannerScreenConfiguration?: new () => {
        useCase?: {
          arOverlay?: {
            visible?: boolean
            automaticSelectionEnabled?: boolean
          }
        }
      }
    }
    createBarcodeScanner?: (config: unknown) => Promise<{ items?: Array<{ barcode?: { text?: unknown } }> }>
  }
}

type DocumentPolicyLike = {
  allowsFeature?: (feature: string) => boolean
}

type ImportMetaWithEnv = ImportMeta & {
  env?: {
    BASE_URL?: string
  }
}

const importMeta = import.meta as ImportMetaWithEnv
const publicBasePath = (() => {
  const base = String(importMeta.env?.BASE_URL || '/')
  if (!base) return '/'
  return base.endsWith('/') ? base : `${base}/`
})()

const SCANBOT_SCRIPT_PATH = `${publicBasePath}scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js`
const SCANBOT_ENGINE_PATH = `${publicBasePath}scanbot-web-sdk/bundle/bin/barcode-scanner/`

let scriptPromise: Promise<ScanbotSdk | null> | null = null
let sdkPromise: Promise<unknown> | null = null

function getScanbotGlobal(): ScanbotSdk | null {
  const scanbotGlobal = (globalThis as typeof globalThis & { ScanbotSDK?: ScanbotSdk; window?: { ScanbotSDK?: ScanbotSdk } })
  return scanbotGlobal.ScanbotSDK || scanbotGlobal.window?.ScanbotSDK || null
}

export function isCameraBlockedByDocumentPolicy(): boolean {
  try {
    const documentWithPolicy = globalThis.document as Document & {
      permissionsPolicy?: DocumentPolicyLike
      featurePolicy?: DocumentPolicyLike
    }
    const policy = documentWithPolicy?.permissionsPolicy || documentWithPolicy?.featurePolicy
    if (!policy?.allowsFeature) return false
    return policy.allowsFeature('camera') === false
  } catch (_) {
    return false
  }
}

function normalizeScanbotError(error: unknown): Error {
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || '').trim()
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

function loadScanbotScript(): Promise<ScanbotSdk | null> {
  const loadedSdk = getScanbotGlobal()
  if (loadedSdk) return Promise.resolve(loadedSdk)
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

export async function getPreferredScannerMode(): Promise<ScanbotMode> {
  if (
    typeof window === 'undefined'
    || !globalThis.navigator?.mediaDevices?.getUserMedia
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

async function getInitializedScanbot(): Promise<unknown> {
  const ScanbotSDK = await loadScanbotScript().catch((error) => {
    throw normalizeScanbotError(error)
  })
  if (!ScanbotSDK) throw new Error('Scanbot scanner is not ready yet.')
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
}: {
  allowArOverlay?: boolean
} = {}): Promise<string> {
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

  const scanResult = await ScanbotSDK.UI.createBarcodeScanner?.(config)
  const item = Array.isArray(scanResult?.items) ? scanResult.items[0] : null
  const value = String(item?.barcode?.text || '').trim()
  return value || ''
}
