import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, Keyboard, ScanLine, ShieldAlert } from 'lucide-react'
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

async function watchCameraPermission(onChange) {
  try {
    if (!navigator?.permissions?.query) return () => {}
    const result = await navigator.permissions.query({ name: 'camera' })
    const handleChange = () => onChange?.(String(result?.state || 'unknown'))
    handleChange()
    result.addEventListener?.('change', handleChange)
    return () => result.removeEventListener?.('change', handleChange)
  } catch (_) {
    return () => {}
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
  const permissionCleanupRef = useRef(() => {})
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
    cameraPermissionResetHint: tr('camera_permission_reset_hint', 'Open the camera permission from the lock icon in your browser address bar, switch it back to Allow, then try again.', 'សូមបើកសិទ្ធិកាមេរ៉ាតាមរូបសោនៅលើរបារអាសយដ្ឋាន ប្ដូរទៅអនុញ្ញាត រួចសាកម្តងទៀត។'),
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
      const dismissed = denied && !blocked
      setPermissionState(blocked ? 'denied' : nextPermissionState)
      setStatus(blocked ? 'blocked' : (dismissed ? 'dismissed' : 'manual'))
      setError(
        blocked
          ? labels.cameraPermissionBlocked
          : dismissed
            ? tr('scan_prompt_dismissed', 'The camera prompt was dismissed. Tap below to try again, or enter the code manually.', 'សំណើសុំកាមេរ៉ាត្រូវបានបិទចោល។ ចុចខាងក្រោមដើម្បីសាកម្ដងទៀត ឬបញ្ចូលកូដដោយដៃ។')
            : (denied ? labels.scanPermissionDenied : labels.scanFailed),
      )
    }
  }, [
    cleanup,
    labels.cameraPermissionBlocked,
    labels.scanFailed,
    labels.scanPermissionDenied,
    labels.scanUnsupported,
    scanFrame,
    tr,
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

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    void watchCameraPermission((nextState) => {
      if (cancelled) return
      setPermissionState(nextState)
      if (nextState === 'granted' && status !== 'scanning' && status !== 'starting') {
        startCamera({ preserveManualValue: true })
      }
      if (nextState === 'denied' && status === 'scanning') {
        cleanup()
        setStatus('blocked')
        setError(labels.cameraPermissionBlocked)
      }
    }).then((dispose) => {
      if (cancelled) {
        dispose?.()
        return
      }
      permissionCleanupRef.current = dispose || (() => {})
    })
    return () => {
      cancelled = true
      permissionCleanupRef.current?.()
      permissionCleanupRef.current = () => {}
    }
  }, [cleanup, labels.cameraPermissionBlocked, open, startCamera, status])

  if (!open) return null

  const requestCameraLabel = permissionState === 'denied' || status === 'dismissed'
    ? labels.tryCameraAgain
    : labels.requestCameraAccess
  const statusMessage = status === 'scanning'
    ? labels.scanReady
    : status === 'starting'
      ? labels.requestingCamera
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
    permissionState === 'denied' || status === 'blocked'
      ? labels.cameraPermissionBlocked
      : status === 'dismissed'
        ? tr('scan_prompt_dismissed', 'The camera prompt was dismissed. Tap below to try again, or enter the code manually.', 'សំណើសុំកាមេរ៉ាត្រូវបានបិទចោល។ ចុចខាងក្រោមដើម្បីសាកម្ដងទៀត ឬបញ្ចូលកូដដោយដៃ។')
      : labels.cameraPermissionNeeded
  )

  const stateBadge = status === 'scanning'
    ? {
        label: tr('scanner_state_live', 'Live camera', 'កាមេរ៉ាកំពុងដំណើរការ'),
        className: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      }
    : status === 'starting'
      ? {
          label: tr('scanner_state_starting', 'Requesting camera', 'កំពុងស្នើសុំកាមេរ៉ា'),
          className: 'border-cyan-400/30 bg-cyan-500/15 text-cyan-100',
          icon: <ScanLine className="h-3.5 w-3.5" />,
        }
      : permissionState === 'denied' || status === 'blocked'
        ? {
            label: tr('scanner_state_blocked', 'Permission blocked', 'សិទ្ធិកាមេរ៉ាត្រូវបានបិទ'),
            className: 'border-red-400/30 bg-red-500/15 text-red-100',
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
          }
        : status === 'dismissed'
          ? {
              label: tr('scanner_state_retry', 'Prompt dismissed', 'សំណើសុំត្រូវបានបិទចោល'),
              className: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
              icon: <AlertCircle className="h-3.5 w-3.5" />,
            }
          : {
              label: tr('scanner_state_manual', 'Manual entry ready', 'ត្រៀមបញ្ចូលដោយដៃ'),
              className: 'border-slate-300/20 bg-slate-700/40 text-slate-100',
              icon: <Keyboard className="h-3.5 w-3.5" />,
            }

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-slate-700">
          <div className="aspect-[4/3] w-full bg-slate-950">
            {status === 'scanning' || status === 'starting' ? (
              <div className="relative h-full w-full overflow-hidden">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  muted
                  autoPlay
                  playsInline
                />
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-4 top-4">
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm shadow-lg ${stateBadge.className}`}>
                      {stateBadge.icon}
                      <span>{stateBadge.label}</span>
                    </div>
                  </div>
                  <div className="absolute left-1/2 top-1/2 h-[58%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-cyan-300/45 shadow-[0_0_0_999px_rgba(2,6,23,0.42)]" />
                  <div className="absolute left-1/2 top-1/2 h-[58%] w-[72%] -translate-x-1/2 -translate-y-1/2">
                    <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-[24px] border-l-[3px] border-t-[3px] border-cyan-300" />
                    <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-[24px] border-r-[3px] border-t-[3px] border-cyan-300" />
                    <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-[24px] border-b-[3px] border-l-[3px] border-cyan-300" />
                    <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-[24px] border-b-[3px] border-r-[3px] border-cyan-300" />
                    <div className="absolute inset-x-[11%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-cyan-300 to-transparent opacity-90 shadow-[0_0_16px_rgba(34,211,238,0.9)]" />
                  </div>
                  <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/10 bg-slate-950/58 px-3 py-2 text-center text-xs leading-5 text-slate-100 backdrop-blur-sm">
                    {tr('scanner_live_hint', 'Center the barcode inside the frame. We will scan it automatically.', 'ដាក់បារកូដឱ្យស្ថិតនៅកណ្ដាលស៊ុម។ ប្រព័ន្ធនឹងស្កេនដោយស្វ័យប្រវត្តិ។')}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-8 text-center text-slate-100">
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${stateBadge.className}`}>
                  {stateBadge.icon}
                  <span>{stateBadge.label}</span>
                </div>
                <Camera className="h-10 w-10 text-cyan-300" />
                <div className="space-y-1">
                  <p className="text-base font-semibold text-white">
                    {tr('scanner_ready_title', 'Ready to scan a barcode', 'ត្រៀមស្កេនបារកូដ')}
                  </p>
                  <p className="max-w-md text-sm leading-6 text-slate-200">{emptyStateMessage}</p>
                </div>
                <div className="grid w-full max-w-md gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-left text-xs text-slate-200 sm:grid-cols-3">
                  <div>
                    <div className="font-semibold text-white">{tr('scanner_step_tap', '1. Tap start', '១. ចុចចាប់ផ្តើម')}</div>
                    <div className="mt-1 text-slate-300">{tr('scanner_step_tap_detail', 'Open the live camera only when you want to scan.', 'បើកកាមេរ៉ាពេលដែលអ្នកចង់ស្កេន។')}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-white">{tr('scanner_step_allow', '2. Allow camera', '២. អនុញ្ញាតកាមេរ៉ា')}</div>
                    <div className="mt-1 text-slate-300">{tr('scanner_step_allow_detail', 'Approve the browser prompt when it appears.', 'អនុម័តសំណើរបស់កម្មវិធីរុករក នៅពេលវាលេចឡើង។')}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-white">{tr('scanner_step_manual', '3. Or type manually', '៣. ឬបញ្ចូលដោយដៃ')}</div>
                    <div className="mt-1 text-slate-300">{tr('scanner_step_manual_detail', 'Manual entry stays available the whole time.', 'ការបញ្ចូលដោយដៃអាចប្រើបានជានិច្ច។')}</div>
                  </div>
                </div>
                <div className="flex w-full max-w-md flex-col items-center gap-2">
                  {showCameraAction ? (
                    <button
                      type="button"
                      className="btn-secondary w-full border-white/20 bg-white/10 text-white hover:bg-white/15"
                      disabled={status === 'starting'}
                      onClick={() => startCamera({ preserveManualValue: true })}
                    >
                      {status === 'starting' ? labels.requestingCamera : requestCameraLabel}
                    </button>
                  ) : null}
                  {permissionState === 'denied' ? (
                    <p className="text-xs leading-5 text-slate-300">{labels.cameraPermissionResetHint}</p>
                  ) : null}
                </div>
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
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <label htmlFor="scanner-manual-value" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                {manualValue ? labels.detectedValue : labels.manualEntry}
              </label>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {tr('scanner_manual_subtitle', 'Paste or type the barcode / SKU if the camera is unavailable or you want to confirm the value yourself.', 'បិទភ្ជាប់ ឬវាយបារកូដ / SKU ប្រសិនបើមិនអាចប្រើកាមេរ៉ា ឬអ្នកចង់បញ្ជាក់តម្លៃដោយខ្លួនឯង។')}
              </p>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Keyboard className="h-3.5 w-3.5" />
              {tr('manual_entry', 'Manual entry', 'បញ្ចូលដោយដៃ')}
            </span>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="scanner-manual-value"
              name="scanner_manual_value"
              className="input flex-1"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              autoComplete="off"
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
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {tr('manual_entry_hint', 'Manual entry stays available if the camera is unavailable.', 'ការបញ្ចូលដោយដៃនៅតែអាចប្រើបាន ប្រសិនបើកាមេរ៉ាមិនអាចប្រើបាន។')}
          </p>
        </div>
      </div>
    </Modal>
  )
}
