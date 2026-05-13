import {
  KeyRound,
  RefreshCcw,
  Save,
  ShieldCheck,
  TestTube2,
  Trash2,
} from 'lucide-react'

function ProviderStatus({ provider }) {
  const status = provider?.last_status || 'untested'
  if (status === 'ok') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Ready</span>
  }
  if (status === 'error') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">Needs attention</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Untested</span>
}

export default function FilesProvidersTab({
  tr,
  loadingProviders,
  providers,
  loadProviders,
  testingProviderId,
  startEditProvider,
  testProvider,
  removeProvider,
  providerForm,
  providerMeta,
  providerOptions,
  selectedProviderMeta,
  setProviderForm,
  providerText,
  isKhmer,
  startCreateProvider,
  saveProvider,
  savingProvider,
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr] 2xl:grid-cols-[1.3fr,0.7fr]">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{tr('library_ai_providers', 'AI Providers', 'AI Providers')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr('ai_providers_hint', 'Store provider keys securely, keep them masked after save, and test each connection before using it in the portal.', 'រក្សាទុកសោ provider ឲ្យមានសុវត្ថិភាព លាក់វាបន្ទាប់ពីរក្សាទុក ហើយសាកល្បងមុនប្រើក្នុង Customer Portal។')}</p>
          </div>
          <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={loadProviders}>
            <RefreshCcw className="mr-2 inline h-4 w-4" />
            {tr('refresh', 'Refresh', 'ស្រស់ថ្មី')}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loadingProviders ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{tr('loading_providers', 'Loading providers...', 'កំពុងផ្ទុក providers...')}</div> : null}
          {!loadingProviders && !providers.length ? <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{tr('no_ai_providers', 'No AI providers yet.', 'មិនទាន់មាន AI providers ទេ។')}</div> : null}
          {providers.map((provider) => (
            <article key={provider.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{provider.name}</div>
                    <ProviderStatus provider={provider} />
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{provider.provider_label || provider.provider}</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{provider.default_model || 'No default model'}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {provider.account_email || 'No account email'}{provider.project_name ? ` · ${provider.project_name}` : ''}{provider.key_masked ? ` · ${provider.key_masked}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span className="rounded-full bg-white px-2.5 py-1">Priority {provider.priority}</span>
                    <span className="rounded-full bg-white px-2.5 py-1">{provider.requests_per_minute}/min</span>
                    <span className="rounded-full bg-white px-2.5 py-1">{provider.max_input_chars} chars</span>
                    <span className="rounded-full bg-white px-2.5 py-1">{provider.timeout_ms} ms timeout</span>
                  </div>
                  {provider.last_error ? <div className="mt-2 text-xs text-rose-600">{provider.last_error}</div> : null}
                  {provider.notes ? <div className="mt-2 text-sm text-slate-600">{provider.notes}</div> : null}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => startEditProvider(provider)}>
                    Edit
                  </button>
                  <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => testProvider(provider.id)} disabled={testingProviderId === provider.id}>
                    <TestTube2 className="mr-2 inline h-4 w-4" />
                    {testingProviderId === provider.id ? 'Testing...' : 'Test'}
                  </button>
                  <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={() => removeProvider(provider)}>
                    <Trash2 className="mr-2 inline h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{providerForm.id ? 'Edit provider' : 'Add provider'}</h2>
            <p className="mt-1 text-sm text-slate-500">Only the API key is required for a new entry. Everything else helps you keep the accounts organized.</p>
          </div>
          <button type="button" className="btn-secondary shrink-0 whitespace-nowrap text-sm" onClick={startCreateProvider}>New</button>
        </div>

        <div className="mt-4 grid gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Provider</label>
            <select
              id="provider-form-provider"
              name="provider_form_provider"
              className="input mt-1"
              value={providerForm.provider}
              onChange={(event) => setProviderForm((current) => ({
                ...current,
                provider: event.target.value,
                provider_type: providerMeta?.[event.target.value]?.supportedTypes?.[0] || 'chat',
                default_model: providerMeta?.[event.target.value]?.defaultModel || '',
                priority: providerMeta?.[event.target.value]?.defaultPriority || 50,
                requests_per_minute: providerMeta?.[event.target.value]?.safeRequestsPerMinute || 10,
                max_input_chars: providerMeta?.[event.target.value]?.safeMaxInputChars || 1000,
                max_completion_tokens: providerMeta?.[event.target.value]?.safeMaxCompletionTokens || 1200,
                timeout_ms: providerMeta?.[event.target.value]?.safeTimeoutMs || 15000,
                cooldown_seconds: providerMeta?.[event.target.value]?.safeCooldownSeconds || 20,
              }))}
            >
              {providerOptions.map(([key, meta]) => (
                <option key={key} value={key}>{meta.label || key}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="provider-form-name" className="block text-sm font-medium text-slate-700">{providerText.entryName}</label>
              <input id="provider-form-name" name="provider_form_name" className="input mt-1" value={providerForm.name} onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))} placeholder={isKhmer ? 'គណនី Groq សំខាន់' : 'Groq main account'} />
            </div>
            <div>
              <label htmlFor="provider-form-type" className="block text-sm font-medium text-slate-700">{providerText.type}</label>
              <select id="provider-form-type" name="provider_form_type" className="input mt-1" value={providerForm.provider_type} onChange={(event) => setProviderForm((current) => ({ ...current, provider_type: event.target.value }))}>
                {(selectedProviderMeta?.supportedTypes || ['chat']).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="provider-form-email" className="block text-sm font-medium text-slate-700">{providerText.accountEmail}</label>
              <input id="provider-form-email" name="provider_form_email" className="input mt-1" value={providerForm.account_email} onChange={(event) => setProviderForm((current) => ({ ...current, account_email: event.target.value }))} />
            </div>
            <div>
              <label htmlFor="provider-form-project" className="block text-sm font-medium text-slate-700">{providerText.projectWorkspace}</label>
              <input id="provider-form-project" name="provider_form_project" className="input mt-1" value={providerForm.project_name} onChange={(event) => setProviderForm((current) => ({ ...current, project_name: event.target.value }))} />
            </div>
          </div>
          <div>
            <label htmlFor="provider-form-api-key" className="block text-sm font-medium text-slate-700">{providerText.apiKey}</label>
            <input id="provider-form-api-key" name="provider_form_api_key" className="input mt-1" value={providerForm.api_key} onChange={(event) => setProviderForm((current) => ({ ...current, api_key: event.target.value }))} placeholder={providerForm.id ? (isKhmer ? 'ទុកទទេ ដើម្បីរក្សាសោបច្ចុប្បន្ន' : 'Leave blank to keep the current key') : (isKhmer ? 'បិទភ្ជាប់សោ API' : 'Paste API key')} />
            <p className="mt-1 text-xs text-slate-500">{providerText.apiKeyHint}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="provider-form-model" className="block text-sm font-medium text-slate-700">{providerText.defaultModel}</label>
              <input id="provider-form-model" name="provider_form_model" className="input mt-1" value={providerForm.default_model} onChange={(event) => setProviderForm((current) => ({ ...current, default_model: event.target.value }))} placeholder={selectedProviderMeta?.defaultModel || ''} />
            </div>
            <div>
              <label htmlFor="provider-form-endpoint" className="block text-sm font-medium text-slate-700">{providerText.endpointOverride}</label>
              <input id="provider-form-endpoint" name="provider_form_endpoint" className="input mt-1" value={providerForm.endpoint_override} onChange={(event) => setProviderForm((current) => ({ ...current, endpoint_override: event.target.value }))} placeholder={selectedProviderMeta?.defaultEndpoint || ''} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="provider-form-priority" className="block text-sm font-medium text-slate-700">{providerText.priority}</label>
              <input id="provider-form-priority" name="provider_form_priority" className="input mt-1" type="number" min="1" max="999" value={providerForm.priority} onChange={(event) => setProviderForm((current) => ({ ...current, priority: event.target.value }))} />
              <p className="mt-1 text-xs text-slate-500">{providerText.priorityHint}</p>
            </div>
            <div>
              <label htmlFor="provider-form-rpm" className="block text-sm font-medium text-slate-700">{providerText.rpm}</label>
              <input id="provider-form-rpm" name="provider_form_requests_per_minute" className="input mt-1" type="number" min="1" max="120" value={providerForm.requests_per_minute} onChange={(event) => setProviderForm((current) => ({ ...current, requests_per_minute: event.target.value }))} />
            </div>
            <div>
              <label htmlFor="provider-form-max-input" className="block text-sm font-medium text-slate-700">{providerText.maxInput}</label>
              <input id="provider-form-max-input" name="provider_form_max_input_chars" className="input mt-1" type="number" min="200" max="4000" value={providerForm.max_input_chars} onChange={(event) => setProviderForm((current) => ({ ...current, max_input_chars: event.target.value }))} />
            </div>
            <div>
              <label htmlFor="provider-form-max-output" className="block text-sm font-medium text-slate-700">{providerText.maxOutput}</label>
              <input id="provider-form-max-output" name="provider_form_max_completion_tokens" className="input mt-1" type="number" min="128" max="8192" value={providerForm.max_completion_tokens} onChange={(event) => setProviderForm((current) => ({ ...current, max_completion_tokens: event.target.value }))} />
            </div>
            <div>
              <label htmlFor="provider-form-timeout" className="block text-sm font-medium text-slate-700">{providerText.timeout}</label>
              <input id="provider-form-timeout" name="provider_form_timeout_ms" className="input mt-1" type="number" min="3000" max="60000" step="500" value={providerForm.timeout_ms} onChange={(event) => setProviderForm((current) => ({ ...current, timeout_ms: event.target.value }))} />
            </div>
            <div>
              <label htmlFor="provider-form-cooldown" className="block text-sm font-medium text-slate-700">{providerText.cooldown}</label>
              <input id="provider-form-cooldown" name="provider_form_cooldown_seconds" className="input mt-1" type="number" min="5" max="300" value={providerForm.cooldown_seconds} onChange={(event) => setProviderForm((current) => ({ ...current, cooldown_seconds: event.target.value }))} />
            </div>
          </div>
          <div>
            <label htmlFor="provider-form-supported-models" className="block text-sm font-medium text-slate-700">{providerText.supportedModels}</label>
            <textarea id="provider-form-supported-models" name="provider_form_supported_models" className="input mt-1 resize-none" rows={4} value={providerForm.supported_models_text} onChange={(event) => setProviderForm((current) => ({ ...current, supported_models_text: event.target.value }))} placeholder={isKhmer ? 'មួយម៉ូដែលក្នុងមួយបន្ទាត់' : 'One model per line'} />
          </div>
          <div>
            <label htmlFor="provider-form-notes" className="block text-sm font-medium text-slate-700">{providerText.notes}</label>
            <textarea id="provider-form-notes" name="provider_form_notes" className="input mt-1 resize-none" rows={4} value={providerForm.notes} onChange={(event) => setProviderForm((current) => ({ ...current, notes: event.target.value }))} placeholder={isKhmer ? 'គោលបំណង ថវិកាប្រចាំខែ ឬពេលណាគួរប្រើ provider នេះ' : 'Purpose, monthly budget, or when to use this provider'} />
          </div>
          <label htmlFor="provider-form-enabled" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">{providerText.enabled}</span>
            <input id="provider-form-enabled" name="provider_form_enabled" type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm((current) => ({ ...current, enabled: event.target.checked }))} />
          </label>
          <button type="button" className="btn-primary text-sm" onClick={saveProvider} disabled={savingProvider}>
            <Save className="mr-2 inline h-4 w-4" />
            {savingProvider ? providerText.saving : (providerForm.id ? providerText.saveProvider : providerText.addProvider)}
          </button>
        </div>
      </section>
    </div>
  )
}
