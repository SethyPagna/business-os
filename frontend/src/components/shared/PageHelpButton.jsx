import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { useApp } from '../../AppContext'
import { getPageHelpContent } from './pageHelpContent'

export default function PageHelpButton({ pageId }) {
  const { settings, t } = useApp()
  const [open, setOpen] = useState(false)
  const language = settings?.language === 'km' ? 'km' : 'en'
  const content = useMemo(() => getPageHelpContent(pageId, language), [pageId, language])
  const buttonText = language === 'km' ? 'ព័ត៌មានទំព័រ' : 'Page Info'
  const closeText = t('close') || 'Close'
  const keyRulesText = language === 'km' ? 'ច្បាប់សំខាន់' : 'Key Rules'
  const connectedFeaturesText = language === 'km' ? 'មុខងារដែលភ្ជាប់' : 'Connected Features'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-[90] flex items-center gap-2 rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-xl transition hover:bg-slate-800 md:bottom-5"
        aria-label={buttonText}
      >
        <Info className="h-4 w-4" />
        <span>{buttonText}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{content.title}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{content.overview}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">
                {closeText}
              </button>
            </div>

            <div className="modal-scroll space-y-5 p-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{keyRulesText}</h3>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {content.rules.map((item) => (
                    <li key={item} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{connectedFeaturesText}</h3>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {content.related.map((item) => (
                    <li key={item} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
