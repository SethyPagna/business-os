import X from 'lucide-react/dist/esm/icons/x.js'

export type MinimizedWorkTr = (key: string, fallbackEn: string, fallbackKm: string) => string

export default function MinimizedWorkDismissButton({ onDismiss, tr, large = false }: { onDismiss: () => void; tr: MinimizedWorkTr; large?: boolean }) {
  const hint = tr('minimized_dismiss_hint', 'Dismiss and discard this draft', 'បិទ ហើយបោះបង់សេចក្តីព្រាងនេះ')
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={hint}
      title={hint}
      className={`flex flex-shrink-0 items-center justify-center rounded-full hover:bg-amber-200 dark:hover:bg-amber-800 ${large ? 'h-10 w-10' : 'h-4 w-4'}`}
    >
      <X className={large ? 'h-4 w-4' : 'h-3 w-3'} />
    </button>
  )
}
