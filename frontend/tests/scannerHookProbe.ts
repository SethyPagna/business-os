// A bare component around useBarcodeCamera, mounted by barcodeCameraCleanup.test.ts:
// the hook's whole surface with none of the modal's chrome. It shows `status|error`
// as text and hands the latest hook result to the test on every render.
import React from 'react'
import { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'

export const MESSAGES = {
  scanUnsupported: 'unsupported',
  cameraDocumentBlocked: 'document-blocked',
  cameraPermissionBlocked: 'blocked',
  scanFailed: 'failed',
  scanPromptDismissed: 'dismissed',
}

interface ProbeProps {
  open: boolean
  onDetected: (value: string) => void
  onClose: () => void
  onCamera: (camera: ReturnType<typeof useBarcodeCamera>) => void
}

export default function Probe({ open, onDetected, onClose, onCamera }: ProbeProps) {
  const camera = useBarcodeCamera({ open, messages: MESSAGES, onDetected, onClose })
  onCamera(camera)
  const live = camera.status === 'starting' || camera.status === 'scanning'
  return React.createElement(
    'div',
    null,
    live ? React.createElement('video', { ref: camera.videoRef }) : null,
    React.createElement('span', null, `${camera.status}|${camera.error}`),
  )
}
