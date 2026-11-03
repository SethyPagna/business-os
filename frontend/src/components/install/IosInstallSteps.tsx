import type { ReactNode } from 'react'
import Modal from '../shared/Modal.tsx'
import type { InstallPromptTranslate } from '../shared/InstallPromptBand.tsx'

type IosInstallStepsProps = {
  translate: InstallPromptTranslate
  onClose: () => void
}

// Drawn after the controls iOS Safari shows, so the step can be matched by sight rather than by name.
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const ShareGlyph = () => (
  <Glyph>
    <path d="M12 15V3" />
    <path d="m8 7 4-4 4 4" />
    <path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
  </Glyph>
)

const MoreGlyph = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <circle cx="8" cy="12" r="0.7" fill="currentColor" />
    <circle cx="12" cy="12" r="0.7" fill="currentColor" />
    <circle cx="16" cy="12" r="0.7" fill="currentColor" />
  </Glyph>
)

const AddToHomeScreenGlyph = () => (
  <Glyph>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M12 8.5v7" />
    <path d="M8.5 12h7" />
  </Glyph>
)

const GLYPH_TILE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'

export default function IosInstallSteps({ translate, onClose }: IosInstallStepsProps) {
  const steps: Array<{ drawn: ReactNode; text: string }> = [
    {
      drawn: (
        <>
          <span className={GLYPH_TILE}><ShareGlyph /></span>
          <span className={GLYPH_TILE}><MoreGlyph /></span>
        </>
      ),
      text: translate('ios_install_step_menu', 'Tap Share. If you only see •••, tap it, then Share.', 'ចុច ចែករំលែក (Share)។ បើឃើញតែ ••• ចុចវា រួចចុច ចែករំលែក។'),
    },
    {
      drawn: <span className={GLYPH_TILE}><AddToHomeScreenGlyph /></span>,
      text: translate('ios_install_step_add', 'Tap Add to Home Screen.', 'ចុច បន្ថែមទៅអេក្រង់ដើម (Add to Home Screen)។'),
    },
    {
      drawn: (
        <span className="flex h-9 items-center rounded-full bg-blue-700 px-3.5 text-sm font-semibold text-white dark:bg-blue-600">
          {translate('ios_install_chip_add', 'Add', 'បន្ថែម')}
        </span>
      ),
      text: translate('ios_install_step_web_app', 'Keep Open as Web App on, then tap Add.', 'ទុក Open as Web App ឱ្យបើក រួចចុច បន្ថែម (Add)។'),
    },
  ]

  return (
    <Modal
      title={translate('ios_install_steps_title', 'Install on iPhone or iPad', 'ដំឡើងនៅលើ iPhone ឬ iPad')}
      onClose={onClose}
      size="sm"
      unsavedChanges="read-only"
    >
      <ol className="space-y-3">
        {steps.map(({ drawn, text }, index) => (
          <li key={text} className="flex items-center gap-3 text-sm leading-5 text-gray-900 dark:text-gray-100">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-100 dark:text-gray-900">{index + 1}</span>
            <span className="flex w-[5.25rem] shrink-0 items-center gap-1">{drawn}</span>
            <span className="min-w-0 break-words">{text}</span>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
