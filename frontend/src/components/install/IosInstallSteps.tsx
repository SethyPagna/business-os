import AppWindow from 'lucide-react/dist/esm/icons/app-window.js'
import PlusSquare from 'lucide-react/dist/esm/icons/plus-square.js'
import Share from 'lucide-react/dist/esm/icons/share.js'
import Modal from '../shared/Modal.tsx'
import type { InstallPromptTranslate } from '../shared/InstallPromptBand.tsx'

type IosInstallStepsProps = {
  translate: InstallPromptTranslate
  onClose: () => void
}

export default function IosInstallSteps({ translate, onClose }: IosInstallStepsProps) {
  const steps = [
    { Icon: Share, text: translate('ios_install_step_menu', 'In Safari, tap ••• or Share.', 'នៅក្នុង Safari ចុច ••• ឬ ចែករំលែក (Share)។') },
    { Icon: PlusSquare, text: translate('ios_install_step_add', 'Tap Add to Home Screen.', 'ចុច បន្ថែមទៅអេក្រង់ដើម (Add to Home Screen)។') },
    { Icon: AppWindow, text: translate('ios_install_step_web_app', 'Keep Open as Web App on, then tap Add.', 'ទុក បើកជាកម្មវិធីវេប (Open as Web App) ឱ្យនៅបើក រួចចុច បន្ថែម (Add)។') },
  ]

  return (
    <Modal
      title={translate('ios_install_steps_title', 'Install on iPhone or iPad', 'ដំឡើងនៅលើ iPhone ឬ iPad')}
      onClose={onClose}
      size="sm"
      unsavedChanges="read-only"
    >
      <ol className="space-y-2">
        {steps.map(({ Icon, text }, index) => (
          <li key={text} className="flex items-center gap-3 text-sm leading-6 text-gray-900 dark:text-gray-100">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 break-words">{index + 1}. {text}</span>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
