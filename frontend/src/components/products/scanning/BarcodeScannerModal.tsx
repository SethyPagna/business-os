import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Flashlight from 'lucide-react/dist/esm/icons/flashlight.js'
import FlashlightOff from 'lucide-react/dist/esm/icons/flashlight-off.js'
import Keyboard from 'lucide-react/dist/esm/icons/keyboard.js'
import ScanLine from 'lucide-react/dist/esm/icons/scan-line.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import Modal from '../../shared/Modal'
import { deriveScannerPresentation } from './barcodeScannerState.ts'
import { scanBarcodeFromImageFile } from './barcodeImageScanner.ts'
import { SCAN_GUIDE_BOX } from './barcodeFrameDecoder.ts'
import { useBarcodeCamera } from './useBarcodeCamera.ts'

// The overlay outlines exactly the area the frame grabber decodes.
const GUIDE_STYLE = { width: `${SCAN_GUIDE_BOX.widthPercent}%`, height: `${SCAN_GUIDE_BOX.heightPercent}%` }

interface BarcodeScannerModalProps {
  open: boolean
  title: string
  onClose: () => void
  onDetected: (value: string) => void
  t: (key: string) => string
  /** Hide the manual-entry text field/panel. Used when this modal is opened
   * from a search bar (ScanSearchButton) -- the search box right behind the
   * modal is already a manual-entry field, so showing a second one here is
   * redundant. ProductForm's usage (the only other caller) leaves this
   * false, since there the scanner modal IS the primary place to type a
   * barcode. */
  hideManualEntry?: boolean
}

interface ScannerLabels {
  scanReady: string
  scanUnsupported: string
  scanPermissionDenied: string
  cameraPermissionNeeded: string
  cameraPaused: string
  cameraPermissionBlocked: string
  cameraPermissionResetHint: string
  requestCameraAccess: string
  startCamera: string
  tryCameraAgain: string
  scanFromPhoto: string
  scanFromPhotoBusy: string
  requestingCamera: string
  scanFailed: string
  scanPhotoFailed: string
  scanFallbackActive: string
  manualEntry: string
  detectedValue: string
  useValue: string
  scanning: string
  cameraDocumentBlocked: string
  torchOn: string
  torchOff: string
  torchFailed: string
}

interface ScannerStateBadge {
  label: string
  className: string
  icon: ReactNode
}

export default function BarcodeScannerModal({
  open,
  title,
  onClose,
  onDetected,
  t,
  hideManualEntry = false,
}: BarcodeScannerModalProps) {
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])

  const labels = useMemo<ScannerLabels>(() => ({
    scanReady: tr('scan_ready', 'Point the camera at a barcode or SKU label.', 'ដាក់កាមេរ៉ាទៅលើបាកូដ ឬស្លាក SKU។'),
    scanUnsupported: tr('scan_unsupported', 'Camera scanning is not supported in this browser. You can still paste or type the value below.', 'ការស្កេនកាមេរ៉ាមិនត្រូវបានគាំទ្រដោយកម្មវិធីរុករកនេះទេ។ អ្នកនៅតែអាចបិទភ្ជាប់ ឬវាយតម្លៃខាងក្រោមបាន។'),
    scanPermissionDenied: tr('scan_permission_denied', 'Camera access was denied. Allow it or enter the code manually.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបដិសេធ។ សូមអនុញ្ញាតវា ឬបញ្ចូលកូដដោយដៃ។'),
    cameraPermissionNeeded: tr('camera_permission_needed', 'Camera access is needed to scan barcodes.', 'ត្រូវការការអនុញ្ញាតកាមេរ៉ាដើម្បីស្កេនបាកូដ។'),
    // Shown only after a start already happened and the stream was released
    // (page backgrounded, or the photo picker took over). Opening the modal
    // never lands here, so this copy no longer tells anyone to "start the
    // camera when you are ready" -- it explains a camera that was paused.
    cameraPaused: tr('camera_paused_resume', 'Camera paused. Tap Start camera to resume scanning.', 'កាមេរ៉ាត្រូវបានផ្អាក។ ចុច «ចាប់ផ្តើមកាមេរ៉ា» ដើម្បីបន្តស្កេន។'),
    cameraPermissionBlocked: hideManualEntry
      ? tr('camera_permission_blocked_no_manual', 'Camera access is blocked. Allow it in your browser settings, then try again.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបិទ។ សូមអនុញ្ញាតវាក្នុងការកំណត់កម្មវិធីរុករក រួចសាកម្តងទៀត។')
      : tr('camera_permission_blocked', 'Camera access is blocked. Allow it in browser settings, or use manual entry below.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបិទ។ សូមអនុញ្ញាតវាក្នុងការកំណត់កម្មវិធីរុករក ឬប្រើការបញ្ចូលដោយដៃខាងក្រោម។'),
    cameraPermissionResetHint: tr('camera_permission_reset_hint', 'Use the lock icon in the browser address bar to switch camera access back to Allow, then try again.', 'សូមប្រើរូបសោនៅលើរបារអាសយដ្ឋាន ដើម្បីប្ដូរសិទ្ធិកាមេរ៉ាត្រឡប់ទៅអនុញ្ញាត រួចសាកម្តងទៀត។'),
    requestCameraAccess: tr('request_camera_access', 'Request camera access', 'ស្នើសុំការអនុញ្ញាតកាមេរ៉ា'),
    startCamera: tr('start_camera', 'Start camera', 'ចាប់ផ្តើមកាមេរ៉ា'),
    tryCameraAgain: tr('try_camera_again', 'Try camera again', 'សាកកាមេរ៉ាម្តងទៀត'),
    scanFromPhoto: tr('scan_from_photo', 'Scan from photo', 'ស្កេនពីរូបថត'),
    scanFromPhotoBusy: tr('scan_from_photo_busy', 'Reading photo...', 'កំពុងអានរូបថត...'),
    requestingCamera: tr('requesting_camera', 'Requesting camera access...', 'កំពុងស្នើសុំការអនុញ្ញាតកាមេរ៉ា...'),
    scanFailed: tr('scan_failed', 'Unable to start camera scanning right now.', 'មិនអាចចាប់ផ្តើមការស្កេនកាមេរ៉ាបានទេនៅពេលនេះ។'),
    scanPhotoFailed: tr('scan_photo_failed', 'We could not read a barcode from that photo. Try another photo or type the code manually.', 'យើងមិនអាចអានបារកូដពីរូបថតនោះបានទេ។ សាករូបថ្មី ឬបញ្ចូលកូដដោយដៃ។'),
    scanFallbackActive: tr('scan_fallback_active', 'Using compatibility scan mode for this browser.', 'កំពុងប្រើរបៀបស្កេនដែលអាចប្រើជាមួយកម្មវិធីរុករកនេះ។'),
    manualEntry: tr('manual_entry', 'Manual entry', 'បញ្ចូលដោយដៃ'),
    detectedValue: tr('detected_value', 'Detected value', 'តម្លៃដែលបានរកឃើញ'),
    useValue: tr('use_value', 'Use value', 'ប្រើតម្លៃនេះ'),
    scanning: tr('scanning', 'Scanning...', 'កំពុងស្កេន...'),
    torchOn: tr('scanner_torch_on', 'Turn on flashlight', 'បើកភ្លើងពិល'),
    torchOff: tr('scanner_torch_off', 'Turn off flashlight', 'បិទភ្លើងពិល'),
    torchFailed: tr('scanner_torch_failed', 'The flashlight could not be switched.', 'មិនអាចប្ដូរភ្លើងពិលបានទេ។'),
    cameraDocumentBlocked: hideManualEntry
      ? tr('camera_document_blocked_no_manual', 'This view does not allow camera access. Open this page in your regular browser to scan.', 'ទិដ្ឋភាពនេះមិនអនុញ្ញាតឱ្យប្រើកាមេរ៉ាទេ។ សូមបើកទំព័រនេះក្នុងកម្មវិធីរុករកធម្មតា ដើម្បីស្កេន។')
      : tr('camera_document_blocked', 'This browser view does not allow camera access. Open this page in your regular phone browser to scan, or use manual entry below.', 'ទិដ្ឋភាពកម្មវិធីរុករកនេះមិនអនុញ្ញាតឱ្យប្រើកាមេរ៉ាទេ។ សូមបើកទំព័រនេះក្នុងកម្មវិធីរុករកធម្មតានៅលើទូរស័ព្ទរបស់អ្នក ដើម្បីស្កេន ឬបញ្ចូលដោយដៃខាងក្រោម។'),
  }), [tr, hideManualEntry])

  const promptDismissedMessage = tr('scan_prompt_dismissed', 'The camera prompt was dismissed. Tap below to try again, or enter the code manually.', 'សំណើសុំកាមេរ៉ាត្រូវបានបិទចោល។ ចុចខាងក្រោមដើម្បីសាកម្ដងទៀត ឬបញ្ចូលកូដដោយដៃ។')

  const {
    videoRef,
    status,
    error,
    permissionState,
    torchAvailable,
    torchOn,
    torchFailed,
    startCamera,
    toggleTorch,
    closeScanner,
    parkCamera,
    completeDetection,
    showManualError,
    clearError,
  } = useBarcodeCamera({
    open,
    messages: {
      scanUnsupported: labels.scanUnsupported,
      cameraDocumentBlocked: labels.cameraDocumentBlocked,
      cameraPermissionBlocked: labels.cameraPermissionBlocked,
      scanPermissionDenied: labels.scanPermissionDenied,
      scanFailed: labels.scanFailed,
      scanFallbackActive: labels.scanFallbackActive,
      scanPromptDismissed: promptDismissedMessage,
    },
    onDetected: (value) => {
      setManualValue(value)
      onDetected(value)
    },
    onClose,
  })

  const openPhotoPicker = useCallback((): void => {
    if (photoBusy) return
    parkCamera()
    photoInputRef.current?.click?.()
  }, [parkCamera, photoBusy])

  const handlePhotoSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event?.target?.files?.[0]
    if (!file) return
    setPhotoBusy(true)
    clearError()
    try {
      const value = await scanBarcodeFromImageFile(file)
      const nextValue = String(value || '').trim()
      if (!nextValue) throw new Error(labels.scanPhotoFailed)
      completeDetection(nextValue)
    } catch (scanError) {
      showManualError(scanError instanceof Error ? scanError.message : labels.scanPhotoFailed)
    } finally {
      if (event?.target) event.target.value = ''
      setPhotoBusy(false)
    }
  }, [clearError, completeDetection, labels.scanPhotoFailed, showManualError])

  if (!open) return null

  const {
    showCameraAction,
    requestCameraLabel,
    emptyStateMessage,
    stateKind,
  } = deriveScannerPresentation({
    status,
    permissionState,
    labels: { ...labels, error },
    promptDismissedMessage,
  })
  const stateBadge: ScannerStateBadge = stateKind === 'scanning'
    ? {
        label: tr('scanner_state_live', 'Live camera', 'កាមេរ៉ាកំពុងដំណើរការ'),
        className: 'border-white/40 bg-white text-black',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      }
    : stateKind === 'starting'
      ? {
          label: tr('scanner_state_starting', 'Requesting camera', 'កំពុងស្នើសុំកាមេរ៉ា'),
          className: 'border-white/30 bg-white/15 text-white',
          icon: <ScanLine className="h-3.5 w-3.5" />,
        }
      : stateKind === 'blocked'
        ? {
            label: tr('scanner_state_blocked', 'Permission blocked', 'សិទ្ធិកាមេរ៉ាត្រូវបានបិទ'),
            className: 'border-white/40 bg-black text-white',
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
          }
        : stateKind === 'dismissed'
          ? {
              label: tr('scanner_state_retry', 'Prompt dismissed', 'សំណើសុំត្រូវបានបិទចោល'),
              className: 'border-white/30 bg-white/10 text-white',
              icon: <AlertCircle className="h-3.5 w-3.5" />,
            }
          : {
              label: tr('scanner_state_manual', 'Manual entry ready', 'ត្រៀមបញ្ចូលដោយដៃ'),
              className: 'border-white/20 bg-white/10 text-white',
              icon: <Keyboard className="h-3.5 w-3.5" />,
            }

  return (
    <Modal title={title} onClose={closeScanner} size="lg" layer="nested" unsavedChanges="read-only">
      <div className="space-y-3">
        {/* Sized off the viewport instead of a fixed 4:3 ratio, and with a
            bigger guide box relative to the frame -- the old fixed ratio
            left a lot of dead black margin around a comparatively small
            scan target, and on a short mobile viewport pushed the modal's
            total height past what fit on screen, forcing a scroll. Also
            down to ONE instruction line while actively scanning: the
            overlay hint here and the black status bar that used to sit
            below the video both said essentially "point the camera at the
            code" at the same time -- the bar is gone now, and the "Live
            camera" badge (redundant with the live video feed itself) only
            shows while still starting up, not once actually scanning. */}
        <div className="overflow-hidden rounded-2xl border border-black bg-black dark:border-white/20">
          <div className={`w-full bg-black ${status === 'scanning' || status === 'starting' ? 'scanner-video-shell' : ''}`}>
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
                  {stateKind !== 'scanning' ? (
                    <div className="absolute inset-x-4 top-4">
                      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm shadow-lg ${stateBadge.className}`}>
                        {stateBadge.icon}
                        <span>{stateBadge.label}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/45 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]" style={GUIDE_STYLE} />
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={GUIDE_STYLE}>
                    <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-[24px] border-l-[3px] border-t-[3px] border-white" />
                    <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-[24px] border-r-[3px] border-t-[3px] border-white" />
                    <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-[24px] border-b-[3px] border-l-[3px] border-white" />
                    <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-[24px] border-b-[3px] border-r-[3px] border-white" />
                    <div className="absolute inset-x-[11%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-white to-transparent opacity-90 shadow-[0_0_16px_rgba(255,255,255,0.8)]" />
                  </div>
                  <div className="absolute inset-x-5 bottom-4 rounded-2xl border border-white/10 bg-slate-950/58 px-3 py-2 text-center text-xs leading-5 text-slate-100 backdrop-blur-sm">
                    {tr('scanner_live_hint', 'Center the barcode inside the frame. We will scan it automatically.', 'ដាក់បារកូដឱ្យស្ថិតនៅកណ្ដាលស៊ុម។ ប្រព័ន្ធនឹងស្កេនដោយស្វ័យប្រវត្តិ។')}
                    {torchFailed ? <span role="alert" className="block text-amber-200">{labels.torchFailed}</span> : null}
                  </div>
                </div>
                {status === 'scanning' && torchAvailable ? (
                  <button
                    type="button"
                    className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white backdrop-blur-sm hover:bg-black/65"
                    aria-pressed={torchOn}
                    aria-label={torchOn ? labels.torchOff : labels.torchOn}
                    title={torchOn ? labels.torchOff : labels.torchOn}
                    onClick={() => { void toggleTorch() }}
                  >
                    {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-6 text-center text-white">
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${stateBadge.className}`}>
                  {stateBadge.icon}
                  <span>{stateBadge.label}</span>
                </div>
                <Camera className="h-9 w-9 text-white" />
                <p className="max-w-sm text-sm leading-6 text-white/80">{emptyStateMessage}</p>
                <div className="flex w-full max-w-xs flex-col items-center gap-2 pt-1">
                  {showCameraAction ? (
                    <button
                      type="button"
                      className="btn-secondary w-full border-white/25 bg-white text-black hover:bg-white/90"
                      disabled={false}
                      onClick={() => startCamera()}
                    >
                      {requestCameraLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary w-full border-white/25 bg-transparent text-white hover:bg-white/10"
                    disabled={photoBusy}
                    onClick={openPhotoPicker}
                  >
                    {photoBusy ? labels.scanFromPhotoBusy : labels.scanFromPhoto}
                  </button>
                  {permissionState === 'denied' ? (
                    <p className="text-xs leading-5 text-white/70">{labels.cameraPermissionResetHint}</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {hideManualEntry ? null : (
        <div className="border-t border-black/10 pt-3 dark:border-white/10">
          <label htmlFor="scanner-manual-value" className="block text-sm font-medium text-black dark:text-white">
            {manualValue ? labels.detectedValue : labels.manualEntry}
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
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
                completeDetection(nextValue)
              }}
            >
              {labels.useValue}
            </button>
          </div>
        </div>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelection}
        />
      </div>
    </Modal>
  )
}
