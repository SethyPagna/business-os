import {
  Brain,
  ChevronDown,
  ChevronUp,
  History,
  Image as ImageIcon,
  RefreshCcw,
  Sparkles,
} from 'lucide-react'

export default function FilesResponsesTab({
  tr,
  loadResponses,
  loadingResponses,
  responses,
  expandedResponseId,
  setExpandedResponseId,
  formatDateTime,
}) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{tr('library_ai_responses', 'AI Responses', 'ចម្លើយ AI')}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr('ai_responses_hint', 'Saved portal answers stay here so the team can review what was suggested, by which provider, and with what product references.', 'ចម្លើយ Portal ដែលបានរក្សាទុកនឹងនៅទីនេះ ដើម្បីឲ្យក្រុមអាចពិនិត្យបានថា provider មួយណាបានផ្តល់សំណើអ្វី និងយោងផលិតផលណាខ្លះ។')}</p>
        </div>
        <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={loadResponses}>
          <RefreshCcw className="mr-2 inline h-4 w-4" />
          {tr('refresh', 'Refresh', 'ស្រស់ថ្មី')}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {loadingResponses ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{tr('loading_ai_responses', 'Loading AI responses...', 'កំពុងផ្ទុកចម្លើយ AI...')}</div> : null}
        {!loadingResponses && !responses.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{tr('no_ai_responses', 'No AI responses saved yet.', 'មិនទាន់មានចម្លើយ AI ដែលបានរក្សាទុកទេ។')}</div> : null}
        {responses.map((entry) => {
          const expanded = expandedResponseId === entry.id
          return (
            <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 text-left"
                onClick={() => setExpandedResponseId((current) => current === entry.id ? null : entry.id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      <Brain className="h-3.5 w-3.5" />
                      {entry.provider_name || entry.provider || 'AI'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      <Sparkles className="h-3.5 w-3.5" />
                      {entry.model || 'Model'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {entry.surface || 'portal'}
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-900">{entry.question_text || 'No question text'}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-600">{entry.answer_text || 'No saved summary.'}</div>
                  <div className="mt-2 text-xs text-slate-500">{entry.actor_label || entry.actor_user_name || 'Unknown user'} · {formatDateTime(entry.created_at)}</div>
                </div>
                <span className="mt-1 rounded-full bg-white p-2 text-slate-500">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
              </button>

              {expanded ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{tr('profile', 'Profile', 'ប្រវត្តិរូប')}</div>
                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        {Object.entries(entry.profile || {}).filter(([, value]) => value).map(([key, value]) => (
                          <div key={key}><span className="font-medium capitalize text-slate-900">{key}:</span> {String(value)}</div>
                        ))}
                        {!Object.entries(entry.profile || {}).filter(([, value]) => value).length ? <div>{tr('no_profile_fields', 'No profile fields were supplied.', 'មិនមានទិន្នន័យប្រវត្តិរូបត្រូវបានផ្តល់ទេ។')}</div> : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Candidate products</div>
                      <div className="mt-3 space-y-2">
                        {(entry.candidate_products || []).slice(0, 12).map((product) => (
                          <div key={product.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            <div className="font-medium text-slate-900">{product.name}</div>
                            <div className="text-xs text-slate-500">{product.brand || 'No brand'} · {product.category || 'No category'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recommendations</div>
                      <div className="mt-3 space-y-3">
                        {(entry.recommendations || []).map((recommendation, index) => (
                          <div key={`${entry.id}-${recommendation.product_id || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-start gap-3">
                              {recommendation.image_path ? (
                                <img src={recommendation.image_path} alt={recommendation.name} className="h-14 w-14 rounded-2xl object-cover" />
                              ) : (
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400">
                                  <ImageIcon className="h-5 w-5" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">{recommendation.name}</div>
                                <div className="mt-1 text-xs text-slate-500">{recommendation.brand || 'No brand'} · {recommendation.category || 'No category'}</div>
                                {recommendation.reason ? <div className="mt-2 text-sm text-slate-700">{recommendation.reason}</div> : null}
                                {recommendation.fit_summary ? <div className="mt-2 text-sm text-slate-600">{recommendation.fit_summary}</div> : null}
                                {recommendation.how_to_use ? <div className="mt-2 text-xs text-slate-500">Use: {recommendation.how_to_use}</div> : null}
                                {recommendation.cautions ? <div className="mt-1 text-xs text-amber-700">Caution: {recommendation.cautions}</div> : null}
                              </div>
                            </div>
                            {Array.isArray(recommendation.citations) && recommendation.citations.length ? (
                              <div className="mt-3 rounded-xl bg-white px-3 py-2">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Evidence</div>
                                <div className="mt-2 space-y-2">
                                  {recommendation.citations.map((citation, citationIndex) => (
                                    <div key={`${entry.id}-${index}-${citationIndex}`} className="text-xs text-slate-600">
                                      <div className="font-medium text-slate-900">{citation.title || citation.source || citation.url}</div>
                                      <div>{citation.note || citation.source}</div>
                                      {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">{citation.url}</a> : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
