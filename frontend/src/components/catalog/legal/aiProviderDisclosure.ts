// The one source for what the storefront says about the AI provider behind the
// assistant: its name, what it does with a question, and where its own terms
// are. The privacy policy section (LegalPages.tsx) and the assistant's consent
// line and automated note (CatalogSecondaryTabs.tsx) both read it.
//
// The provider is chosen at runtime (D1 ai_provider_configs), so the page asks
// GET /api/portal/ai/status for the ids and renders them here. An id this map
// does not know, or no answer at all, gives the neutral wording: a sentence that
// names a provider we cannot vouch for would be worse than a general one.
//
// Facts read from each provider's own published terms on 20 Oct 2026; the
// source URL of every sentence is the policyUrl beside it. Groq's data-controls
// page refused every automated request, so its sentence states only what its
// public privacy policy says: customer data is governed by its Services
// Agreement and Data Processing Addendum. Replace it with the retention period
// once the owner has read that page.

export type AiProviderRef = { id: string; name?: string }
export type AiDisclosureLanguage = 'en' | 'km'

type ProviderDisclosure = {
  displayName: string
  retention: Record<AiDisclosureLanguage, string>
  policyUrl: string
}

export const AI_PROVIDER_DISCLOSURE: Readonly<Record<string, ProviderDisclosure>> = {
  groq: {
    displayName: 'Groq',
    retention: {
      en: 'Groq is based in the United States and handles API inputs and outputs under its Services Agreement and Data Processing Addendum.',
      km: 'Groq មានមូលដ្ឋាននៅសហរដ្ឋអាមេរិក ហើយគ្រប់គ្រងទិន្នន័យបញ្ចូល និងលទ្ធផលតាម API ក្រោមកិច្ចព្រមព្រៀងសេវា និងឧបសម្ព័ន្ធដំណើរការទិន្នន័យរបស់ខ្លួន។',
    },
    policyUrl: 'https://groq.com/privacy-policy',
  },
  mistral: {
    displayName: 'Mistral AI',
    retention: {
      en: 'Mistral AI keeps API inputs and outputs for 30 rolling days to monitor abuse and hosts them in the European Union by default. Its use of them for training follows the privacy setting of our Mistral account.',
      km: 'Mistral AI រក្សាទុកទិន្នន័យបញ្ចូល និងលទ្ធផលតាម API រយៈពេល ៣០ ថ្ងៃជាបន្តបន្ទាប់ ដើម្បីត្រួតពិនិត្យការប្រើប្រាស់មិនត្រឹមត្រូវ ហើយបង្ហោះវានៅសហភាពអឺរ៉ុបតាមលំនាំដើម។ ការប្រើវាសម្រាប់បង្ហាត់គំរូអាស្រ័យលើការកំណត់ឯកជនភាពនៃគណនី Mistral របស់យើង។',
    },
    policyUrl: 'https://legal.mistral.ai/terms/privacy-policy',
  },
  cerebras: {
    displayName: 'Cerebras',
    retention: {
      en: 'Cerebras does not retain the inputs and outputs of API requests and does not use them to train models. It processes data in the United States and other countries.',
      km: 'Cerebras មិនរក្សាទុកទិន្នន័យបញ្ចូល និងលទ្ធផលនៃសំណើ API ហើយមិនប្រើវាដើម្បីបង្ហាត់គំរូទេ។ វាដំណើរការទិន្នន័យនៅសហរដ្ឋអាមេរិក និងប្រទេសផ្សេងទៀត។',
    },
    policyUrl: 'https://www.cerebras.ai/privacy-policy',
  },
  google: {
    displayName: 'Google AI',
    retention: {
      en: 'Google keeps Gemini API prompts and responses for a limited period to detect abuse. On the paid tier Google does not use them to improve its products; on the free tier it does.',
      km: 'Google រក្សាទុកសំណួរ និងចម្លើយរបស់ Gemini API រយៈពេលកំណត់មួយ ដើម្បីរកឃើញការប្រើប្រាស់មិនត្រឹមត្រូវ។ ក្នុងកម្រិតបង់ប្រាក់ Google មិនប្រើវាដើម្បីកែលម្អផលិតផលរបស់ខ្លួនទេ ប៉ុន្តែក្នុងកម្រិតឥតគិតថ្លៃ Google ប្រើវា។',
    },
    policyUrl: 'https://ai.google.dev/gemini-api/terms',
  },
}

export type AiProviderState =
  | { kind: 'unknown' }
  | { kind: 'off' }
  | { kind: 'named'; providers: ReadonlyArray<{ id: string } & ProviderDisclosure> }

/**
 * Turn the /ai/status answer into what the page may say. A failed or malformed
 * answer is `unknown`; a switched-off assistant, or one with no provider, is
 * `off`; a list holding any id this map lacks is `unknown`, because naming only
 * part of the list would understate where a question can go.
 */
export function aiProviderState(status: unknown): AiProviderState {
  if (!status || typeof status !== 'object') return { kind: 'unknown' }
  const list = (status as { providers?: unknown }).providers
  if (!Array.isArray(list)) return { kind: 'unknown' }
  if (list.length === 0) return { kind: 'off' }
  const providers: Array<{ id: string } & ProviderDisclosure> = []
  for (const entry of list) {
    const id = entry && typeof entry === 'object' ? String((entry as AiProviderRef).id || '') : ''
    const known = Object.prototype.hasOwnProperty.call(AI_PROVIDER_DISCLOSURE, id) ? AI_PROVIDER_DISCLOSURE[id] : null
    if (!known) return { kind: 'unknown' }
    if (!providers.some((item) => item.id === id)) providers.push({ id, ...known })
  }
  return { kind: 'named', providers }
}

const AND: Record<AiDisclosureLanguage, string> = { en: ' and ', km: ' និង ' }

export function aiProviderNames(state: AiProviderState, language: AiDisclosureLanguage): string {
  if (state.kind !== 'named') return ''
  const names = state.providers.map((provider) => provider.displayName)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(language === 'en' ? ', ' : ' ')}${AND[language]}${names[names.length - 1]}`
}

export function aiProviderRetention(state: AiProviderState, language: AiDisclosureLanguage): string {
  if (state.kind !== 'named') return ''
  return state.providers.map((provider) => provider.retention[language]).join(' ')
}

/**
 * Fill `{providerNames}` (" (Groq)") and `{providerRetention}` (" Groq is ...")
 * in the consent line and the automated note. Both vanish for the neutral
 * wording, which then reads as the general sentence it always was.
 */
export function fillAiProviderTemplate(template: string, state: AiProviderState, language: AiDisclosureLanguage): string {
  const names = aiProviderNames(state, language)
  const retention = aiProviderRetention(state, language)
  return template
    .replace('{providerNames}', names ? ` (${names})` : '')
    .replace('{providerRetention}', retention ? ` ${retention}` : '')
}
