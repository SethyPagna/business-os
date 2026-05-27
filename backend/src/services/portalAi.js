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
  const tokens = trim(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
  const normalized = []
  for (const token of tokens) {
    const next = token.trim()
    if (next.length >= 2) normalized.push(next)
  }
  return normalized
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
  state.requestTimestamps = keepRecentTimestamps(state.requestTimestamps, currentMs, ONE_MINUTE_MS)
  return state
}

function keepRecentTimestamps(timestamps = [], currentMs = nowMs(), windowMs = ONE_MINUTE_MS) {
  const kept = []
  for (const ts of timestamps) {
    if (currentMs - ts < windowMs) kept.push(ts)
  }
  return kept
}

function pruneVisitorActivity(currentMs = nowMs()) {
  for (const [fingerprint, timestamps] of VISITOR_ACTIVITY.entries()) {
    const kept = keepRecentTimestamps(timestamps, currentMs, ACTIVE_VISITOR_WINDOW_MS)
    if (!kept.length) VISITOR_ACTIVITY.delete(fingerprint)
    else VISITOR_ACTIVITY.set(fingerprint, kept)
  }
}

function registerVisitorActivity(fingerprint, currentMs = nowMs()) {
  const key = trim(fingerprint || 'anonymous')
  const existing = VISITOR_ACTIVITY.get(key) || []
  const next = keepRecentTimestamps(existing, currentMs, ACTIVE_VISITOR_WINDOW_MS)
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
  const timestamps = keepRecentTimestamps(VISITOR_ACTIVITY.get(key) || [], currentMs, ONE_MINUTE_MS)
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
  const queryTerms = buildQueryTermSet([
    question,
    profile.brand,
    profile.skinType,
    profile.concerns,
    profile.goal,
    profile.shoppingFor,
  ])

  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 8
  }

  if (profile.brand && trim(product.brand).toLowerCase() === trim(profile.brand).toLowerCase()) score += 28
  if (profile.shoppingFor && haystack.includes(trim(profile.shoppingFor).toLowerCase())) score += 12
  if (profile.skinType && haystack.includes(trim(profile.skinType).toLowerCase())) score += 6
  if (profile.concerns && haystack.includes(trim(profile.concerns).toLowerCase())) score += 6
  if (profile.goal && haystack.includes(trim(profile.goal).toLowerCase())) score += 6
  if (toNumber(product.stock_quantity) > 0) score += 5
  return score
}

function buildQueryTermSet(values = []) {
  const queryTerms = new Set()
  for (const value of values) {
    const terms = tokenize(value)
    for (const term of terms) queryTerms.add(term)
  }
  return queryTerms
}

function productMatchesPreference(product, preferredBrand, preferredCategory) {
  if (preferredBrand && trim(product.brand).toLowerCase() !== preferredBrand) return false
  if (!preferredCategory) return true
  const fields = [product.category, product.name, product.description]
  for (const value of fields) {
    if (trim(value).toLowerCase().includes(preferredCategory)) return true
  }
  return false
}

function toPromptCandidate(product, score) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand || '',
    category: product.category || '',
    unit: product.unit || '',
    description: product.description || '',
    selling_price_usd: product.selling_price_usd,
    selling_price_khr: product.selling_price_khr,
    stock_quantity: product.stock_quantity,
    image_path: product.image_path || '',
    image_gallery: Array.isArray(product.image_gallery) ? product.image_gallery : [],
    score,
  }
}

function selectCandidateProducts(products, profile = {}, question = '') {
  const preferredBrand = trim(profile.brand).toLowerCase()
  const preferredCategory = trim(profile.shoppingFor).toLowerCase()
  const filtered = []
  for (const product of products) {
    if (productMatchesPreference(product, preferredBrand, preferredCategory)) filtered.push(product)
  }

  const pool = filtered.length ? filtered : products
  const scored = []
  for (const product of pool) {
    scored.push({ product, score: scoreProduct(product, profile, question) })
  }
  scored.sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name)))

  const candidates = []
  const limit = Math.min(scored.length, MAX_PRODUCTS_IN_PROMPT)
  for (let index = 0; index < limit; index += 1) {
    const entry = scored[index]
    candidates.push(toPromptCandidate(entry.product, entry.score))
  }
  return candidates
}

function buildPrompt({ businessName, profile, question, candidates, disclaimer, extraInstructions }) {
  const candidateLines = []
  for (const product of candidates) {
    candidateLines.push(`- [${product.id}] ${product.name} | brand=${product.brand || 'n/a'} | category=${product.category || 'n/a'} | stock=${product.stock_quantity} | price_usd=${product.selling_price_usd} | price_khr=${product.selling_price_khr} | description=${product.description || 'n/a'}`)
  }

  const promptParts = [
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
    candidateLines.length ? candidateLines.join('\n') : '- none',
  ]
  if (extraInstructions) {
    promptParts.splice(9, 0, `Extra merchant instructions: ${extraInstructions}`)
  }
  return promptParts.join('\n')
}

function takeTrimmedStrings(values = [], limit = 4) {
  const items = []
  for (const value of values) {
    const next = trim(value)
    if (!next) continue
    items.push(next)
    if (items.length >= limit) break
  }
  return items
}

function normalizeCitations(citations = []) {
  const items = []
  for (const citation of citations) {
    const item = {
      title: trim(citation?.title),
      source: trim(citation?.source),
      url: trim(citation?.url),
      note: trim(citation?.note),
    }
    if (!item.title && !item.source && !item.url && !item.note) continue
    items.push(item)
    if (items.length >= 4) break
  }
  return items
}

function buildRecommendationPayloads(recommendations = [], candidatesById) {
  const items = []
  for (const item of recommendations) {
    const productId = Number(item?.product_id || 0) || 0
    const product = candidatesById.get(productId)
    if (!product) continue
    items.push({
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
      ingredients_focus: Array.isArray(item?.ingredients_focus) ? takeTrimmedStrings(item.ingredients_focus, 8) : [],
      online_review_summary: trim(item?.online_review_summary),
      citations: Array.isArray(item?.citations) ? normalizeCitations(item.citations) : [],
    })
    if (items.length >= MAX_RECOMMENDATIONS) break
  }
  return items
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
    follow_up_questions: Array.isArray(parsed.follow_up_questions) ? takeTrimmedStrings(parsed.follow_up_questions, 4) : [],
    recommendations: buildRecommendationPayloads(recommendations, candidatesById),
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
  const ordered = []
  const others = []
  for (const row of rows) {
    if (preferredId && row.id === preferredId) preferred.push(row)
    else others.push(row)
  }
  for (const row of preferred) ordered.push(row)
  for (const row of others) ordered.push(row)
  return ordered
}

function chooseProviderForAttempt(providers, currentMs = nowMs()) {
  const candidates = []
  for (const provider of providers) {
    const state = pruneProviderState(provider.id, currentMs)
    const remaining = Math.max(0, getProviderCapacity(provider) - state.requestTimestamps.length)
    if (state.cooldownUntil > currentMs || remaining <= 0) continue
    candidates.push({
      provider,
      state,
      priority: getProviderPriority(provider),
      remaining,
    })
  }
  candidates.sort((left, right) => (
      left.priority - right.priority
      || left.state.activeRequests - right.state.activeRequests
      || left.state.failureCount - right.state.failureCount
      || left.state.lastUsedAt - right.state.lastUsedAt
    ))
  return candidates[0] || null
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

function sumProviderCapacity(providers = []) {
  let total = 0
  for (const provider of providers) {
    total += getProviderCapacity(provider)
  }
  return total
}

function buildProviderUsageItems(providers = [], currentMs = nowMs()) {
  const items = []
  for (const provider of providers) {
    const state = pruneProviderState(provider.id, currentMs)
    items.push({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      model: provider.default_model || '',
      priority: getProviderPriority(provider),
      requestsPerMinute: getProviderCapacity(provider),
      remainingThisMinute: Math.max(0, getProviderCapacity(provider) - state.requestTimestamps.length),
      cooldownUntil: state.cooldownUntil || 0,
      lastFailure: state.lastFailure || '',
    })
  }
  return items
}

function getPortalAiUsageStatus(config, preferredProviderId) {
  const providers = listEnabledChatProviders(preferredProviderId || config?.aiProviderId)
  const activeVisitors = countActiveVisitors()
  const totalCapacity = sumProviderCapacity(providers)
  const safeGlobalPerMinute = Math.max(1, Math.floor(totalCapacity * 0.8))
  const perUserPerMinute = Math.max(1, Math.min(6, Math.floor(safeGlobalPerMinute / Math.max(1, activeVisitors))))

  return {
    activeVisitors,
    safeGlobalPerMinute,
    perUserPerMinute,
    providers: buildProviderUsageItems(providers),
  }
}

function minProviderInputChars(providers = [], fallback = MAX_QUESTION_CHARS) {
  let minChars = fallback
  for (const provider of providers) {
    minChars = Math.min(minChars, getProviderMaxInputChars(provider))
  }
  return minChars
}

function hasAnyProfileValue(profile = {}) {
  for (const value of Object.values(profile)) {
    if (value) return true
  }
  return false
}

function productsById(products = []) {
  const map = new Map()
  for (const product of products) {
    map.set(product.id, product)
  }
  return map
}

function remainingProviders(providers = [], attemptedProviderIds) {
  const remaining = []
  for (const provider of providers) {
    if (!attemptedProviderIds.has(provider.id)) remaining.push(provider)
  }
  return remaining
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
    minProviderInputChars(providers),
  )
  const sanitizedProfile = summarizeProfile(profile)
  const profileCharBudget = Object.values(sanitizedProfile).join(' ').length
  if (profileCharBudget > MAX_PROFILE_TOTAL_CHARS) {
    throw new Error(`Please keep the profile details under ${MAX_PROFILE_TOTAL_CHARS} characters total.`)
  }
  const sanitizedQuestion = sanitizeQuestion(question, maxInputChars)
  if (!sanitizedQuestion && !hasAnyProfileValue(sanitizedProfile)) {
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
  const candidatesById = productsById(candidates)
  const attemptedProviderIds = new Set()

  while (attemptedProviderIds.size < providers.length) {
    const picked = chooseProviderForAttempt(
      remainingProviders(providers, attemptedProviderIds),
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
