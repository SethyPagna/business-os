'use strict'

const { db } = require('../database')
const { callChatProvider, parseJsonSafe, providerCanUseWebResearch, getProviderMeta } = require('./aiGateway')

const PROVIDER_RUNTIME = new Map()
const VISITOR_ACTIVITY = new Map()
const ONE_MINUTE_MS = 60 * 1000
const ACTIVE_VISITOR_WINDOW_MS = 5 * ONE_MINUTE_MS
const MAX_QUESTION_CHARS = 700
const MAX_PROFILE_TOTAL_CHARS = 700
const MAX_PRODUCTS_IN_PROMPT = 18
const MAX_RECOMMENDATIONS = 10

function trim(value) {
  return String(value || '').trim()
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function tokenize(value) {
  return trim(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function nowMs() {
  return Date.now()
}

function getProviderPriority(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  return Math.max(1, Number(providerRow?.priority || meta?.defaultPriority || 50) || (meta?.defaultPriority || 50))
}

function getProviderCapacity(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  return Math.max(1, Number(providerRow?.requests_per_minute || meta?.safeRequestsPerMinute || 10) || (meta?.safeRequestsPerMinute || 10))
}

function getProviderMaxInputChars(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  return Math.max(200, Number(providerRow?.max_input_chars || meta?.safeMaxInputChars || 1000) || (meta?.safeMaxInputChars || 1000))
}

function getProviderMaxCompletionTokens(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  return Math.max(128, Number(providerRow?.max_completion_tokens || meta?.safeMaxCompletionTokens || 1200) || (meta?.safeMaxCompletionTokens || 1200))
}

function getProviderTimeoutMs(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  return Math.max(3000, Number(providerRow?.timeout_ms || meta?.safeTimeoutMs || 15000) || (meta?.safeTimeoutMs || 15000))
}

function getProviderCooldownMs(providerRow) {
  const meta = getProviderMeta(providerRow?.provider)
  const seconds = Math.max(5, Number(providerRow?.cooldown_seconds || meta?.safeCooldownSeconds || 20) || (meta?.safeCooldownSeconds || 20))
  return seconds * 1000
}

function getRuntimeState(providerId) {
  const key = Number(providerId || 0) || 0
  if (!PROVIDER_RUNTIME.has(key)) {
    PROVIDER_RUNTIME.set(key, {
      requestTimestamps: [],
      activeRequests: 0,
      lastUsedAt: 0,
      cooldownUntil: 0,
      failureCount: 0,
      lastFailure: '',
    })
  }
  return PROVIDER_RUNTIME.get(key)
}

function pruneProviderState(providerId, currentMs = nowMs()) {
  const state = getRuntimeState(providerId)
  state.requestTimestamps = state.requestTimestamps.filter((ts) => currentMs - ts < ONE_MINUTE_MS)
  return state
}

function pruneVisitorActivity(currentMs = nowMs()) {
  for (const [fingerprint, timestamps] of VISITOR_ACTIVITY.entries()) {
    const kept = timestamps.filter((ts) => currentMs - ts < ACTIVE_VISITOR_WINDOW_MS)
    if (!kept.length) VISITOR_ACTIVITY.delete(fingerprint)
    else VISITOR_ACTIVITY.set(fingerprint, kept)
  }
}

function registerVisitorActivity(fingerprint, currentMs = nowMs()) {
  const key = trim(fingerprint || 'anonymous')
  const existing = VISITOR_ACTIVITY.get(key) || []
  const next = existing.filter((ts) => currentMs - ts < ACTIVE_VISITOR_WINDOW_MS)
  next.push(currentMs)
  VISITOR_ACTIVITY.set(key, next)
  pruneVisitorActivity(currentMs)
  return next
}

function countActiveVisitors(currentMs = nowMs()) {
  pruneVisitorActivity(currentMs)
  return Math.max(1, VISITOR_ACTIVITY.size)
}

function getVisitorMinuteCount(fingerprint, currentMs = nowMs()) {
  const key = trim(fingerprint || 'anonymous')
  const timestamps = (VISITOR_ACTIVITY.get(key) || []).filter((ts) => currentMs - ts < ONE_MINUTE_MS)
  VISITOR_ACTIVITY.set(key, timestamps)
  return timestamps.length
}

function summarizeProfile(profile = {}) {
  return {
    brand: trim(profile.brand).slice(0, 120),
    skinType: trim(profile.skinType).slice(0, 120),
    concerns: trim(profile.concerns).slice(0, 220),
    shoppingFor: trim(profile.shoppingFor).slice(0, 120),
    goal: trim(profile.goal).slice(0, 180),
  }
}

function sanitizeQuestion(question, maxChars) {
  return trim(question).replace(/\s+/g, ' ').slice(0, maxChars)
}

function scoreProduct(product, profile = {}, question = '') {
  const haystack = [
    product.name,
    product.brand,
    product.category,
    product.description,
    product.unit,
  ].join(' ').toLowerCase()

  let score = 0
  const queryTerms = new Set([
    ...tokenize(question),
    ...tokenize(profile.brand),
    ...tokenize(profile.skinType),
    ...tokenize(profile.concerns),
    ...tokenize(profile.goal),
    ...tokenize(profile.shoppingFor),
  ])

  queryTerms.forEach((term) => {
    if (haystack.includes(term)) score += 8
  })

  if (profile.brand && trim(product.brand).toLowerCase() === trim(profile.brand).toLowerCase()) score += 28
  if (profile.shoppingFor && haystack.includes(trim(profile.shoppingFor).toLowerCase())) score += 12
  if (profile.skinType && haystack.includes(trim(profile.skinType).toLowerCase())) score += 6
  if (profile.concerns && haystack.includes(trim(profile.concerns).toLowerCase())) score += 6
  if (profile.goal && haystack.includes(trim(profile.goal).toLowerCase())) score += 6
  if (toNumber(product.stock_quantity) > 0) score += 5
  return score
}

function selectCandidateProducts(products, profile = {}, question = '') {
  const preferredBrand = trim(profile.brand).toLowerCase()
  const preferredCategory = trim(profile.shoppingFor).toLowerCase()
  const filtered = products.filter((product) => {
    if (preferredBrand && trim(product.brand).toLowerCase() !== preferredBrand) return false
    if (preferredCategory && ![product.category, product.name, product.description].some((value) => trim(value).toLowerCase().includes(preferredCategory))) {
      return false
    }
    return true
  })

  const pool = filtered.length ? filtered : products
  return [...pool]
    .map((product) => ({ product, score: scoreProduct(product, profile, question) }))
    .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name)))
    .slice(0, MAX_PRODUCTS_IN_PROMPT)
    .map((entry) => ({
      id: entry.product.id,
      name: entry.product.name,
      brand: entry.product.brand || '',
      category: entry.product.category || '',
      unit: entry.product.unit || '',
      description: entry.product.description || '',
      selling_price_usd: entry.product.selling_price_usd,
      selling_price_khr: entry.product.selling_price_khr,
      stock_quantity: entry.product.stock_quantity,
      image_path: entry.product.image_path || '',
      image_gallery: Array.isArray(entry.product.image_gallery) ? entry.product.image_gallery : [],
      score: entry.score,
    }))
}

function buildPrompt({ businessName, profile, question, candidates, disclaimer, extraInstructions }) {
  const candidateLines = candidates.map((product) => (
    `- [${product.id}] ${product.name} | brand=${product.brand || 'n/a'} | category=${product.category || 'n/a'} | stock=${product.stock_quantity} | price_usd=${product.selling_price_usd} | price_khr=${product.selling_price_khr} | description=${product.description || 'n/a'}`
  )).join('\n')

  return [
    'You are a cosmetic retail assistant for a beauty store.',
    `Store name: ${businessName || 'Leang Cosmetics'}.`,
    'Use only the product catalog provided below for recommendations. Never invent store products.',
    'If a product is not in the catalog, do not recommend it as sold by the store.',
    'Answer concisely but informatively.',
    'When possible, explain why each recommended product fits the customer profile and question.',
    'If you have reliable web evidence, include short citations with title, source, url, and a short note.',
    'If web evidence is unavailable, return an empty citations array for that recommendation instead of fabricating sources.',
    `Include this notice in the response notice field: ${disclaimer}`,
    extraInstructions ? `Extra merchant instructions: ${extraInstructions}` : '',
    'Return valid JSON only with this shape:',
    '{"summary":"","notice":"","contact_note":"","follow_up_questions":[""],"recommendations":[{"product_id":0,"name":"","reason":"","fit_summary":"","how_to_use":"","cautions":"","ingredients_focus":[""],"online_review_summary":"","citations":[{"title":"","source":"","url":"","note":""}]}]}',
    `Customer profile: ${JSON.stringify(profile)}`,
    `Customer question: ${question}`,
    'Catalog candidates:',
    candidateLines || '- none',
  ].filter(Boolean).join('\n')
}

function parseAssistantPayload(text, candidatesById, disclaimer) {
  const fallback = {
    summary: trim(text),
    notice: disclaimer,
    contact_note: 'AI generated, for reference only. For more accurate inquiries, please contact our store.',
    follow_up_questions: [],
    recommendations: [],
  }

  const raw = trim(text)
  if (!raw) return fallback

  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return fallback

  const parsed = parseJsonSafe(raw.slice(jsonStart, jsonEnd + 1), null)
  if (!parsed || typeof parsed !== 'object') return fallback

  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
  return {
    summary: trim(parsed.summary) || fallback.summary,
    notice: trim(parsed.notice) || disclaimer,
    contact_note: trim(parsed.contact_note) || fallback.contact_note,
    follow_up_questions: Array.isArray(parsed.follow_up_questions)
      ? parsed.follow_up_questions.map((entry) => trim(entry)).filter(Boolean).slice(0, 4)
      : [],
    recommendations: recommendations
      .map((item) => {
        const productId = Number(item?.product_id || 0) || 0
        const product = candidatesById.get(productId)
        if (!product) return null
        const citations = Array.isArray(item?.citations)
          ? item.citations.map((citation) => ({
              title: trim(citation?.title),
              source: trim(citation?.source),
              url: trim(citation?.url),
              note: trim(citation?.note),
            })).filter((citation) => citation.title || citation.source || citation.url || citation.note).slice(0, 4)
          : []
        return {
          product_id: product.id,
          name: product.name,
          brand: product.brand || '',
          category: product.category || '',
          image_path: product.image_path || '',
          image_gallery: product.image_gallery || [],
          selling_price_usd: product.selling_price_usd,
          selling_price_khr: product.selling_price_khr,
          stock_quantity: product.stock_quantity,
          reason: trim(item?.reason),
          fit_summary: trim(item?.fit_summary),
          how_to_use: trim(item?.how_to_use),
          cautions: trim(item?.cautions),
          ingredients_focus: Array.isArray(item?.ingredients_focus)
            ? item.ingredients_focus.map((entry) => trim(entry)).filter(Boolean).slice(0, 8)
            : [],
          online_review_summary: trim(item?.online_review_summary),
          citations,
        }
      })
      .filter(Boolean)
      .slice(0, MAX_RECOMMENDATIONS),
  }
}

function listEnabledChatProviders(preferredProviderId) {
  const preferredId = Number(preferredProviderId || 0) || 0
  const rows = db.prepare(`
    SELECT *
    FROM ai_provider_configs
    WHERE enabled = 1
      AND provider_type = 'chat'
    ORDER BY priority ASC, updated_at DESC, id DESC
  `).all()

  const preferred = []
  const others = []
  rows.forEach((row) => {
    if (preferredId && row.id === preferredId) preferred.push(row)
    else others.push(row)
  })
  return [...preferred, ...others]
}

function chooseProviderForAttempt(providers, currentMs = nowMs()) {
  return providers
    .map((provider) => {
      const state = pruneProviderState(provider.id, currentMs)
      return {
        provider,
        state,
        priority: getProviderPriority(provider),
        remaining: Math.max(0, getProviderCapacity(provider) - state.requestTimestamps.length),
      }
    })
    .filter((entry) => entry.state.cooldownUntil <= currentMs)
    .filter((entry) => entry.remaining > 0)
    .sort((left, right) => (
      left.priority - right.priority
      || left.state.activeRequests - right.state.activeRequests
      || left.state.failureCount - right.state.failureCount
      || left.state.lastUsedAt - right.state.lastUsedAt
    ))[0] || null
}

function markProviderStart(providerRow, currentMs = nowMs()) {
  const state = pruneProviderState(providerRow.id, currentMs)
  state.activeRequests += 1
  state.requestTimestamps.push(currentMs)
  state.lastUsedAt = currentMs
  return state
}

function markProviderSuccess(providerRow) {
  const state = getRuntimeState(providerRow.id)
  state.activeRequests = Math.max(0, state.activeRequests - 1)
  state.failureCount = 0
  state.lastFailure = ''
}

function markProviderFailure(providerRow, errorMessage, currentMs = nowMs()) {
  const state = getRuntimeState(providerRow.id)
  state.activeRequests = Math.max(0, state.activeRequests - 1)
  state.failureCount += 1
  state.lastFailure = trim(errorMessage).slice(0, 400)
  state.cooldownUntil = currentMs + getProviderCooldownMs(providerRow) * Math.min(3, state.failureCount)
}

function getPortalAiUsageStatus(config, preferredProviderId) {
  const providers = listEnabledChatProviders(preferredProviderId || config?.aiProviderId)
  const activeVisitors = countActiveVisitors()
  const totalCapacity = providers.reduce((sum, provider) => sum + getProviderCapacity(provider), 0)
  const safeGlobalPerMinute = Math.max(1, Math.floor(totalCapacity * 0.8))
  const perUserPerMinute = Math.max(1, Math.min(6, Math.floor(safeGlobalPerMinute / Math.max(1, activeVisitors))))

  return {
    activeVisitors,
    safeGlobalPerMinute,
    perUserPerMinute,
    providers: providers.map((provider) => {
      const state = pruneProviderState(provider.id)
      return {
        id: provider.id,
        name: provider.name,
        provider: provider.provider,
        model: provider.default_model || '',
        priority: getProviderPriority(provider),
        requestsPerMinute: getProviderCapacity(provider),
        remainingThisMinute: Math.max(0, getProviderCapacity(provider) - state.requestTimestamps.length),
        cooldownUntil: state.cooldownUntil || 0,
        lastFailure: state.lastFailure || '',
      }
    }),
  }
}

async function generatePortalAiResponse({ config, profile, question, products, visitorFingerprint = 'anonymous' }) {
  const providers = listEnabledChatProviders(config.aiProviderId)
  if (!providers.length) {
    throw new Error('Portal AI provider is not configured yet')
  }

  const currentMs = nowMs()
  registerVisitorActivity(visitorFingerprint, currentMs)
  const usage = getPortalAiUsageStatus(config, config.aiProviderId)
  const visitorMinuteCount = getVisitorMinuteCount(visitorFingerprint, currentMs)
  if (visitorMinuteCount > usage.perUserPerMinute) {
    throw new Error(`AI is busy right now. ${usage.activeVisitors} user(s) are using it, so each visitor can send ${usage.perUserPerMinute} search(es) per minute.`)
  }

  const primaryProvider = providers[0]
  const maxInputChars = Math.max(
    200,
    providers.reduce(
      (minChars, provider) => Math.min(minChars, getProviderMaxInputChars(provider)),
      MAX_QUESTION_CHARS,
    ),
  )
  const sanitizedProfile = summarizeProfile(profile)
  const profileCharBudget = Object.values(sanitizedProfile).join(' ').length
  if (profileCharBudget > MAX_PROFILE_TOTAL_CHARS) {
    throw new Error(`Please keep the profile details under ${MAX_PROFILE_TOTAL_CHARS} characters total.`)
  }
  const sanitizedQuestion = sanitizeQuestion(question, maxInputChars)
  if (!sanitizedQuestion && !Object.values(sanitizedProfile).some(Boolean)) {
    throw new Error('Add a question or at least one shopping preference first')
  }

  const candidates = selectCandidateProducts(products, sanitizedProfile, sanitizedQuestion)
  if (!candidates.length) {
    return {
      summary: 'No matching store products were found for this request yet.',
      notice: config.aiDisclaimer,
      contact_note: 'AI generated, for reference only. Please contact our store for more accurate help.',
      follow_up_questions: [],
      recommendations: [],
      provider: primaryProvider,
      promptText: '',
      candidates: [],
      usage,
      failovers: [],
      requestPolicy: {
        questionMaxChars: maxInputChars,
        perUserPerMinute: usage.perUserPerMinute,
        activeVisitors: usage.activeVisitors,
      },
    }
  }

  const promptText = buildPrompt({
    businessName: config.businessName,
    profile: sanitizedProfile,
    question: sanitizedQuestion,
    candidates,
    disclaimer: config.aiDisclaimer,
    extraInstructions: config.aiPrompt,
  })

  const failovers = []
  let lastError = null
  const candidatesById = new Map(candidates.map((product) => [product.id, product]))
  const attemptedProviderIds = new Set()

  while (attemptedProviderIds.size < providers.length) {
    const picked = chooseProviderForAttempt(
      providers.filter((provider) => !attemptedProviderIds.has(provider.id)),
      currentMs,
    )
    if (!picked) break

    const provider = picked.provider
    attemptedProviderIds.add(provider.id)
    markProviderStart(provider, currentMs)

    try {
      const response = await callChatProvider(provider, [
        {
          role: 'system',
          content: 'You help a cosmetics and beauty retail store answer product questions carefully and safely.',
        },
        {
          role: 'user',
          content: promptText,
        },
      ], {
        maxCompletionTokens: getProviderMaxCompletionTokens(provider),
        timeoutMs: getProviderTimeoutMs(provider),
        temperature: 0.35,
        enableWebResearch: providerCanUseWebResearch(provider),
      })

      markProviderSuccess(provider)
      return {
        ...parseAssistantPayload(response.text, candidatesById, config.aiDisclaimer),
        provider,
        promptText,
        candidates,
        usage,
        failovers,
        requestPolicy: {
          questionMaxChars: maxInputChars,
          perUserPerMinute: usage.perUserPerMinute,
          activeVisitors: usage.activeVisitors,
        },
      }
    } catch (error) {
      lastError = error
      failovers.push({
        providerId: provider.id,
        provider: provider.provider,
        name: provider.name,
        model: provider.default_model || '',
        error: trim(error?.message || 'Provider request failed').slice(0, 300),
      })
      markProviderFailure(provider, error?.message || 'Provider request failed', currentMs)
    }
  }

  if (lastError) {
    throw new Error(lastError?.message || 'All AI providers are temporarily unavailable')
  }
  throw new Error('All AI providers are temporarily busy. Please try again in a moment.')
}

module.exports = {
  selectCandidateProducts,
  generatePortalAiResponse,
  getPortalAiUsageStatus,
}
