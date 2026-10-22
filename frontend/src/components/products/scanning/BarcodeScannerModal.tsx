import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import Flashlight from 'lucide-react/dist/esm/icons/flashlight.js'
import FlashlightOff from 'lucide-react/dist/esm/icons/flashlight-off.js'
import ImageIcon from 'lucide-react/dist/esm/icons/image.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import SwitchCamera from 'lucide-react/dist/esm/icons/switch-camera.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import Modal from '../../shared/Modal'
import { cameraResetPlatform, deriveScannerPresentation } from './barcodeScannerState.ts'
import { PhotoScanError, scanBarcodeFromImageFile } from './barcodeImageScanner.ts'
import { SCAN_GUIDE_BOX } from './barcodeFrameDecoder.ts'
import { SCAN_CLOSE_DELAY_MS, signalScanSuccess } from './scanFeedback.ts'
import { useBarcodeCamera } from './useBarcodeCamera.ts'

// The overlay outlines exactly the area the frame grabber decodes.
const GUIDE_STYLE = { width: `${SCAN_GUIDE_BOX.widthPercent}%`, height: `${SCAN_GUIDE_BOX.heightPercent}%` }

// Round, 44 px (a thumb), readable on any picture the camera shows.
const ICON_BUTTON = 'inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white backdrop-blur-sm hover:bg-black/65 disabled:opacity-60'

interface BarcodeScannerModalProps {
  open: boolean
  title: string
  onClose: () => void
  onDetected: (value: string) => void
  t: (key: string) => string
}

export default function BarcodeScannerModal({ open, title, onClose, onDetected, t }: BarcodeScannerModalProps) {
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const isKhmer = /[ក-៿]/.test(t('cancel') || '')
  const tr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])

  const labels = useMemo(() => ({
    scanReady: tr('scan_ready', 'Point the camera at a barcode.', 'ដាក់កាមេរ៉ាទៅលើបាកូដ។'),
    scanUnsupported: tr('scan_unsupported', 'This browser cannot scan with the camera. Type the barcode instead.', 'កម្មវិធីរុករកនេះមិនអាចស្កេនដោយកាមេរ៉ាបានទេ។ សូមវាយបាកូដជំនួសវិញ។'),
    cameraPermissionNeeded: tr('camera_permission_needed', 'Camera access is needed to scan barcodes.', 'ត្រូវការការអនុញ្ញាតកាមេរ៉ាដើម្បីស្កេនបាកូដ។'),
    // Shown only after a start already happened and the stream was released
    // (page backgrounded, the photo picker took over, or the scan sat idle).
    // Opening the scanner never lands here.
    cameraPaused: tr('camera_paused_resume', 'Camera paused. Tap Start camera to resume scanning.', 'កាមេរ៉ាត្រូវបានផ្អាក។ ចុច «ចាប់ផ្តើមកាមេរ៉ា» ដើម្បីបន្តស្កេន។'),
    cameraPermissionBlocked: tr('camera_permission_blocked', 'Camera access is blocked. Allow it in your browser settings, or type the barcode instead.', 'ការអនុញ្ញាតកាមេរ៉ាត្រូវបានបិទ។ សូមអនុញ្ញាតវាក្នុងការកំណត់កម្មវិធីរុករក ឬវាយបាកូដជំនួសវិញ។'),
    cameraDocumentBlocked: tr('camera_document_blocked', 'This browser view does not allow camera access. Open this page in your regular browser to scan, or type the barcode instead.', 'ទិដ្ឋភាពកម្មវិធីរុករកនេះមិនអនុញ្ញាតឱ្យប្រើកាមេរ៉ាទេ។ សូមបើកទំព័រនេះក្នុងកម្មវិធីរុករកធម្មតា ដើម្បីស្កេន ឬវាយបាកូដជំនួសវិញ។'),
    promptDismissed: tr('scan_prompt_dismissed', 'The camera prompt was dismissed. Try again, or type the barcode instead.', 'សំណើសុំកាមេរ៉ាត្រូវបានបិទចោល។ សាកម្តងទៀត ឬវាយបាកូដជំនួសវិញ។'),
    requestCameraAccess: tr('request_camera_access', 'Request camera access', 'ស្នើសុំការអនុញ្ញាតកាមេរ៉ា'),
    startCamera: tr('start_camera', 'Start camera', 'ចាប់ផ្តើមកាមេរ៉ា'),
    tryCameraAgain: tr('try_camera_again', 'Try camera again', 'សាកកាមេរ៉ាម្តងទៀត'),
    requestingCamera: tr('requesting_camera', 'Requesting camera access...', 'កំពុងស្នើសុំការអនុញ្ញាតកាមេរ៉ា...'),
    scanFailed: tr('scan_failed', 'Unable to start camera scanning right now.', 'មិនអាចចាប់ផ្តើមការស្កេនកាមេរ៉ាបានទេនៅពេលនេះ។'),
    scanFromPhoto: tr('scan_from_photo', 'Scan from photo', 'ស្កេនពីរូបថត'),
    scanFromPhotoBusy: tr('scan_from_photo_busy', 'Reading photo...', 'កំពុងអានរូបថត...'),
    scanPhotoFailed: tr('scan_photo_failed', 'We could not read a barcode from that photo. Try another photo or type the barcode instead.', 'យើងមិនអាចអានបាកូដពីរូបថតនោះបានទេ។ សាករូបថតផ្សេង ឬវាយបាកូដជំនួសវិញ។'),
    scanPhotoUnreadable: tr('scan_photo_unreadable', 'That photo could not be opened. Try another photo.', 'មិនអាចបើករូបថតនោះបានទេ។ សាករូបថតផ្សេង។'),
    readOk: tr('scanner_read_ok', 'Barcode read', 'បានអានបាកូដ'),
    switchCamera: tr('scanner_switch_camera', 'Switch camera', 'ប្ដូរកាមេរ៉ា'),
    close: tr('close', 'Close', 'បិទ'),
    torchOn: tr('scanner_torch_on', 'Turn on flashlight', 'បើកភ្លើងពិល'),
    torchOff: tr('scanner_torch_off', 'Turn off flashlight', 'បិទភ្លើងពិល'),
    torchFailed: tr('scanner_torch_failed', 'The flashlight could not be switched.', 'មិនអាចប្ដូរភ្លើងពិលបានទេ។'),
    resetHints: {
      ios: tr('camera_permission_reset_hint_ios', 'On iPhone: Settings › Safari › Camera › Allow, then try again.', 'នៅលើ iPhone៖ ការកំណត់ › Safari › កាមេរ៉ា › អនុញ្ញាត រួចសាកម្តងទៀត។'),
      android: tr('camera_permission_reset_hint_android', 'Tap the lock icon by the address, then Permissions › Camera › Allow.', 'ចុចរូបសោនៅជាប់អាសយដ្ឋាន រួចចូល សិទ្ធិ › កាមេរ៉ា › អនុញ្ញាត។'),
      desktop: tr('camera_permission_reset_hint', 'Use the lock icon in the browser address bar to switch camera access back to Allow, then try again.', 'សូមប្រើរូបសោនៅលើរបារអាសយដ្ឋាន ដើម្បីប្ដូរសិទ្ធិកាមេរ៉ាត្រឡប់ទៅអនុញ្ញាត រួចសាកម្តងទៀត។'),
    },
  }), [tr])

  const {
    videoRef,
    status,
    error,
    permissionState,
    torchAvailable,
    torchOn,
    torchFailed,
    readOk,
    cameraCount,
    mirrored,
    startCamera,
    switchCamera,
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
      scanFailed: labels.scanFailed,
      scanPromptDismissed: labels.promptDismissed,
    },
    onDetected: (value) => {
      signalScanSuccess(shellRef.current)
      onDetected(value)
    },
    onClose,
    closeDelayMs: SCAN_CLOSE_DELAY_MS,
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
      if (!nextValue) throw new PhotoScanError('no-barcode', 'The photo gave an empty barcode.')
      completeDetection(nextValue)
    } catch (scanError) {
      showManualError(scanError instanceof PhotoScanError && scanError.failure === 'unreadable' ? labels.scanPhotoUnreadable : labels.scanPhotoFailed)
    } finally {
      if (event?.target) event.target.value = ''
      setPhotoBusy(false)
    }
  }, [clearError, completeDetection, labels.scanPhotoFailed, labels.scanPhotoUnreadable, showManualError])

  if (!open) return null

  const {
    showCameraAction,
    requestCameraLabel,
    statusMessage,
    emptyStateMessage,
    showResetHint,
    stateKind,
  } = deriveScannerPresentation({
    status,
    permissionState,
    labels: { ...labels, error },
    promptDismissedMessage: labels.promptDismissed,
  })
  const live = status === 'scanning' || status === 'starting'
  // With no camera to retry (this browser has none, or the view forbids it) the photo is the panel's one button.
  const photoIsPanelButton = !live && !showCameraAction
  const photoLabel = photoBusy ? labels.scanFromPhotoBusy : labels.scanFromPhoto
  const PanelIcon = stateKind === 'blocked' ? ShieldAlert : stateKind === 'dismissed' ? AlertCircle : Camera
  const resetHint = showResetHint ? labels.resetHints[cameraResetPlatform(navigator.userAgent || '', navigator.maxTouchPoints || 0)] : ''

  return (
    <Modal title={title} onClose={closeScanner} size="sm" layer="nested" unsavedChanges="read-only" bare>
      <div ref={shellRef} className="scanner-video-shell relative w-full overflow-hidden bg-black text-white">
        {live ? (
          <>
            <video
              ref={videoRef}
              className={`h-full w-full object-cover${mirrored ? ' -scale-x-100' : ''}`}
              aria-label={statusMessage}
              muted
              autoPlay
              playsInline
            />
            {status === 'scanning' ? (
              <div className="pointer-events-none absolute inset-0">
                <div className="scanner-guide absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]" style={GUIDE_STYLE}>
                  <div className="scanner-scan-line absolute inset-x-[6%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_16px_rgba(255,255,255,0.8)]" />
                </div>
                {torchFailed ? (
                  <p role="alert" className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-2 text-center text-xs leading-5 text-amber-200">{labels.torchFailed}</p>
                ) : null}
              </div>
            ) : (
              <Camera className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 motion-safe:animate-pulse text-white/70" />
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 pb-4 pt-14 text-center">
            <PanelIcon className="h-9 w-9 flex-shrink-0" />
            <p className="max-w-sm text-sm leading-6 text-white/85">{emptyStateMessage}</p>
            {showCameraAction ? (
              <button
                type="button"
                className="btn-secondary border-white/25 bg-white text-black hover:bg-white/90"
                onClick={() => startCamera()}
              >
                {requestCameraLabel}
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary border-white/25 bg-white text-black hover:bg-white/90"
                disabled={photoBusy}
                onClick={openPhotoPicker}
              >
                {photoLabel}
              </button>
            )}
            {resetHint ? <p className="max-w-sm text-xs leading-5 text-white/70">{resetHint}</p> : null}
          </div>
        )}

        <button type="button" className={`${ICON_BUTTON} absolute left-3 top-3`} aria-label={labels.close} title={labels.close} onClick={closeScanner}>
          <X className="h-5 w-5" />
        </button>
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          {status === 'scanning' && torchAvailable ? (
            <button
              type="button"
              className={ICON_BUTTON}
              aria-pressed={torchOn}
              aria-label={torchOn ? labels.torchOff : labels.torchOn}
              title={torchOn ? labels.torchOff : labels.torchOn}
              onClick={() => { void toggleTorch() }}
            >
              {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
            </button>
          ) : null}
          {live && cameraCount > 1 ? (
            <button type="button" className={ICON_BUTTON} aria-label={labels.switchCamera} title={labels.switchCamera} onClick={() => { void switchCamera() }}>
              <SwitchCamera className="h-5 w-5" />
            </button>
          ) : null}
          {photoIsPanelButton ? null : (
            <button type="button" className={ICON_BUTTON} disabled={photoBusy} aria-label={photoLabel} title={photoLabel} onClick={openPhotoPicker}>
              {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{readOk ? labels.readOk : ''}</p>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoSelection}
      />
    </Modal>
  )
}
