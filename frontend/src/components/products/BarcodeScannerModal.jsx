import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ScanLine } from 'lucide-react'
import Modal from '../shared/Modal'

const KNOWN_FORMATS = [
  'aztec',
  'codabar',
  'code_128',
  'code_39',
  'code_93',
  'data_matrix',
  'ean_13',
  'ean_8',
  'itf',
  'pdf417',
  'qr_code',
  'upc_a',
  'upc_e',
]

function stopStream(stream) {
  try {
    stream?.getTracks?.().forEach((track) => track.stop())
  } catch (_) {}
}

async function readCameraPermissionState() {
  try {
    if (!navigator?.permissions?.query) return 'unknown'
    const result = await navigator.permissions.query({ name: 'camera' })
    return String(result?.state || 'unknown')
  } catch (_) {
    return 'unknown'
  }
}

export default function BarcodeScannerModal({
  open,
  title,
  onClose,
  onDetected,
  t,
}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const detectorRef = useRef(null)
  const zxingReaderRef = useRef(null)
  const zxingControlsRef = useRef(null)
  const startTokenRef = useRef(0)
  const lastScanAtRef = useRef(0)
  const [manualValue, setManualValue] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [permissionState, setPermissionState] = useState('unknown')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])

  const labels = useMemo(() => ({
    scanReady: tr('scan_ready', 'Point the camera at a barcode or SKU label.', 'ដាក់កាមេរ៉ាទៅលើបាកូដ ឬស្លាក SKU។'),
    scanUnsupported: tr('scan_unsupported', 'Camera scanning is not supported in this browser. You can still paste or type the value below.', 'ការស្កេនកាមេរ៉ាមិនត្រូវបានគាំទ្រដោយកម្មវិធីរុករកនេះទេ។ អ្នកនៅតែអាចបិទភ្ជាប់ ឬវាយតម្លៃខាងក្រោមបាន។'),
    scanPermissionDenied: tr('scan_permission_denied', 'Camera access was denied. Allow camera access or enter the code manually.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបដិសេធ។ សូមអនុញ្ញាតកាមេរ៉ា ឬបញ្ចូលកូដដោយដៃ។'),
    cameraPermissionNeeded: tr('camera_permission_needed', 'We need camera access to scan barcodes. Tap below and allow camera permission when your browser asks.', 'យើងត្រូវការការអនុញ្ញាតកាមេរ៉ាដើម្បីស្កេនបាកូដ។ ចុចខាងក្រោម ហើយអនុញ្ញាតកាមេរ៉ា នៅពេលកម្មវិធីរុករកស្នើសុំ។'),
    cameraPermissionBlocked: tr('camera_permission_blocked', 'Camera access is blocked in this browser. Allow it in browser settings, then try again or enter the code manually.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបិទនៅក្នុងកម្មវិធីរុករកនេះ។ សូមអនុញ្ញាតវាក្នុងការកំណត់កម្មវិធីរុករក រួចសាកម្តងទៀត ឬបញ្ចូលកូដដោយដៃ។'),
    requestCameraAccess: tr('request_camera_access', 'Request camera access', 'ស្នើសុំការអនុញ្ញាតកាមេរ៉ា'),
    tryCameraAgain: tr('try_camera_again', 'Try camera again', 'សាកកាមេរ៉ាម្តងទៀត'),
    requestingCamera: tr('requesting_camera', 'Requesting camera access...', 'កំពុងស្នើសុំការអនុញ្ញាតកាមេរ៉ា...'),
    scanFailed: tr('scan_failed', 'Unable to start camera scanning right now.', 'មិនអាចចាប់ផ្តើមការស្កេនកាមេរ៉ាបានទេនៅពេលនេះ។'),
    scanFallbackActive: tr('scan_fallback_active', 'Using compatibility scan mode for this browser.', 'កំពុងប្រើរបៀបស្កេនដែលអាចប្រើជាមួយកម្មវិធីរុករកនេះ។'),
    manualEntry: tr('manual_entry', 'Manual entry', 'បញ្ចូលដោយដៃ'),
    detectedValue: tr('detected_value', 'Detected value', 'តម្លៃដែលបានរកឃើញ'),
    useValue: tr('use_value', 'Use value', 'ប្រើតម្លៃនេះ'),
    scanning: tr('scanning', 'Scanning...', 'កំពុងស្កេន...'),
  }), [tr])

  const cleanup = useCallback(() => {
    startTokenRef.current = 0
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    try { zxingControlsRef.current?.stop?.() } catch (_) {}
    zxingControlsRef.current = null
    try { zxingReaderRef.current?.reset?.() } catch (_) {}
    zxingReaderRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    detectorRef.current = null
    const video = videoRef.current
    if (video) {
      try { video.pause() } catch (_) {}
      try { video.srcObject = null } catch (_) {}
    }
  }, [])

  const scanFrame = useCallback(async () => {
    const detector = detectorRef.current
    const video = videoRef.current
    if (!detector || !video) return

    try {
      const now = Date.now()
      if (video.readyState >= 2 && (now - lastScanAtRef.current) > 250) {
        lastScanAtRef.current = now
        const results = await detector.detect(video)
        const raw = String(results?.[0]?.rawValue || '').trim()
        if (raw) {
          setManualValue(raw)
          cleanup()
          onDetected(raw)
          return
        }
      }
    } catch (_) {}

    frameRef.current = requestAnimationFrame(scanFrame)
  }, [cleanup, onDetected])

  const startCamera = useCallback(async ({ preserveManualValue = false } = {}) => {
    const startToken = Date.now()
    cleanup()
    startTokenRef.current = startToken
    setStatus('starting')
    setError('')
    if (!preserveManualValue) setManualValue('')
    lastScanAtRef.current = 0

    if (
      typeof window === 'undefined' ||
      !navigator?.mediaDevices?.getUserMedia
    ) {
      setPermissionState('unsupported')
      setStatus('manual')
      setError(labels.scanUnsupported)
      return
    }

    const nextPermissionState = await readCameraPermissionState()
    setPermissionState(nextPermissionState)

    try {
      const video = videoRef.current
      if (video) video.setAttribute('playsinline', 'true')

      if (typeof window.BarcodeDetector === 'function') {
        const supported = typeof window.BarcodeDetector.getSupportedFormats === 'function'
          ? await window.BarcodeDetector.getSupportedFormats()
          : KNOWN_FORMATS
        if (startTokenRef.current !== startToken) return
        const formats = (supported || []).filter((item) => KNOWN_FORMATS.includes(item))
        detectorRef.current = new window.BarcodeDetector({ formats: formats.length ? formats : KNOWN_FORMATS })

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        if (startTokenRef.current !== startToken) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        setPermissionState('granted')
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        setStatus('scanning')
        frameRef.current = requestAnimationFrame(scanFrame)
        return
      }

      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      if (startTokenRef.current !== startToken) return
      const reader = new BrowserMultiFormatReader()
      zxingReaderRef.current = reader
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result) => {
          const raw = String(result?.getText?.() || '').trim()
          if (!raw) return
          setManualValue(raw)
          cleanup()
          onDetected(raw)
        },
      )
      if (startTokenRef.current !== startToken) {
        try { controls?.stop?.() } catch (_) {}
        return
      }
      zxingControlsRef.current = controls
      setPermissionState('granted')
      setStatus('scanning')
      setError(labels.scanFallbackActive)
    } catch (scanError) {
      const message = String(scanError?.message || '')
      const name = String(scanError?.name || '')
      const denied = /denied|permission|notallowed/i.test(`${name} ${message}`)
      const blocked = denied && nextPermissionState === 'denied'
      setPermissionState(denied ? 'denied' : nextPermissionState)
      setStatus('manual')
      setError(blocked ? labels.cameraPermissionBlocked : (denied ? labels.scanPermissionDenied : labels.scanFailed))
    }
  }, [
    cleanup,
    labels.cameraPermissionBlocked,
    labels.scanFailed,
    labels.scanPermissionDenied,
    labels.scanUnsupported,
    scanFrame,
  ])

  const prepareScanner = useCallback(async () => {
    cleanup()
    setError('')
    setStatus('idle')

    if (
      typeof window === 'undefined' ||
      !navigator?.mediaDevices?.getUserMedia
    ) {
      setPermissionState('unsupported')
      setStatus('manual')
      setError(labels.scanUnsupported)
      return
    }

    const nextPermissionState = await readCameraPermissionState()
    setPermissionState(nextPermissionState)

    if (nextPermissionState === 'granted') {
      startCamera({ preserveManualValue: true })
      return
    }

    setStatus('manual')
  }, [cleanup, labels.scanUnsupported, startCamera])

  useEffect(() => {
    if (!open) return undefined
    prepareScanner()
    return () => {
      cleanup()
      setStatus('idle')
      setError('')
      setPermissionState('unknown')
    }
  }, [cleanup, open, prepareScanner])

  if (!open) return null

  const requestCameraLabel = permissionState === 'denied'
    ? labels.tryCameraAgain
    : labels.requestCameraAccess
  const statusMessage = status === 'scanning'
    ? labels.scanReady
    : (
        error
        || (
          permissionState === 'unsupported'
            ? labels.scanUnsupported
            : permissionState === 'granted'
              ? labels.requestingCamera
              : labels.cameraPermissionNeeded
        )
      )
  const showCameraAction = permissionState !== 'unsupported' && status !== 'scanning'
  const emptyStateMessage = error || (
    permissionState === 'denied'
      ? labels.cameraPermissionBlocked
      : labels.cameraPermissionNeeded
  )

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-slate-700">
          <div className="aspect-[4/3] w-full bg-slate-950">
            {status === 'scanning' || status === 'starting' ? (
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                autoPlay
                playsInline
              />
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-8 text-center text-slate-100">
                <Camera className="h-10 w-10 text-cyan-300" />
                <p className="max-w-md text-sm leading-6 text-slate-200">{emptyStateMessage}</p>
                {showCameraAction ? (
                  <button
                    type="button"
                    className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/15"
                    disabled={status === 'starting'}
                    onClick={() => startCamera({ preserveManualValue: true })}
                  >
                    {status === 'starting' ? labels.requestingCamera : requestCameraLabel}
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div className="border-t border-slate-800 bg-slate-900/95 px-4 py-3 text-sm text-slate-200">
            <div className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-cyan-300" />
              <span>{statusMessage}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
          <label htmlFor="scanner-manual-value" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {manualValue ? labels.detectedValue : labels.manualEntry}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="scanner-manual-value"
              name="scanner_manual_value"
              className="input flex-1"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
            />
            <button
              type="button"
              className="btn-primary min-w-[124px]"
              disabled={!String(manualValue || '').trim()}
              onClick={() => {
                const nextValue = String(manualValue || '').trim()
                if (!nextValue) return
                onDetected(nextValue)
              }}
            >
              {labels.useValue}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
