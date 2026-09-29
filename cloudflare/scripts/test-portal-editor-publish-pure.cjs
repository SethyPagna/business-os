// AB-W4: the ten Website Editor settings the preview showed but the storefront config never carried. Each one is
// published through its own normalizer, so the shop shows what the editor previews and nothing private or unbounded.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { load } = require('./test-request-body-guard-pure.cjs')

const REPO = path.join(__dirname, '..', '..')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error && error.message).split(/\r?\n/)[0]}`)
  }
}

// workerd splits a Khmer coeng cluster ('ស្' + 'រ') where Node keeps it whole, so every cap below runs under that split.
const HostSegmenter = Intl.Segmenter
Intl.Segmenter = class WorkerdGraphemeSegmenter {
  constructor(locales, options) {
    this.host = new HostSegmenter(locales, options)
  }
  segment(text) {
    const pieces = [...this.host.segment(text)].flatMap(({ segment }) => segment.split(/(?<=្)/))
    let index = 0
    return pieces.map((segment) => {
      const piece = { segment, index, input: text }
      index += segment.length
      return piece
    })
  }
}

const db = openDb(loadAll())
const queries = []
const portal = load('routes/portal.ts', {
  '../lib/db': {
    getDb: () => ({
      prepare: (sql) => {
        queries.push(sql)
        return db.prepare(sql)
      },
      batch: (statements) => db.batch(statements),
    }),
  },
  '../lib/cache': {
    getVersionWithFallback: async () => 'v1',
    cachedJsonResponse: async (_request, _ctx, _version, _ttl, produce) => produce(),
  },
  '../lib/requestBodyGuard': { SMALL_BODY_BYTES: 65536, PORTAL_SCREENSHOT_BODY_BYTES: 1 },
  '../lib/safeLinkUrl': load('lib/safeLinkUrl.ts'),
  '../lib/portalText': load('lib/portalText.ts'),
  '../lib/sqlBinding': load('lib/sqlBinding.ts'),
  '../lib/familyPagination': load('lib/familyPagination.ts'),
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0' },
})
const env = { BUSINESS_OS_PUBLIC_URL: 'https://shop.example', CACHE: { get: async () => null } }
const ctx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }
const publish = (settings) => portal.buildPublicPortalConfig(settings, env)

const SWITCHES = [
  ['customer_portal_show_top_seller_badge', 'showTopSellerBadge', true],
  ['customer_portal_show_top_product_badge', 'showTopProductBadge', true],
  ['customer_portal_show_recommended_badge', 'showRecommendedBadge', true],
  ['customer_portal_show_promotion_badge', 'showPromotionBadge', false],
  ['customer_portal_show_new_arrival_badge', 'showNewArrivalBadge', false],
]
const RETIRED_STOREFRONT_LANGUAGES = ['zh-CN', 'zh-TW', 'vi', 'th', 'ru', 'fr', 'es', 'de', 'ja', 'ko', 'pt', 'it', 'ar', 'hi', 'id', 'ms', 'tr']
const KHMER_STACK = 'ស្ត្រី'
const capFallsInside = (filler, max, character, inside) => filler.repeat(max - inside) + character
const translationsOf = (value) => publish({ customer_portal_translations: typeof value === 'string' ? value : JSON.stringify(value) }).translations

function frontendList(relativePath, constName) {
  const src = fs.readFileSync(path.join(REPO, relativePath), 'utf8')
  const declared = src.indexOf(`const ${constName}`)
  assert.ok(declared > -1, `${constName} not found in ${relativePath}`)
  const start = src.indexOf('= [', declared)
  return src.slice(start, src.indexOf('\n]', start))
}

async function get(url) {
  const res = await portal.default.request(`https://shop.example${url}`, {}, env, ctx)
  const text = await res.text()
  assert.equal(res.status, 200, text)
  return JSON.parse(text)
}

function seedProduct(name, isActive) {
  return db.prepare('INSERT INTO products (name, is_active, stock_quantity) VALUES (@name, @active, 5) RETURNING id').get({ name, active: isActive }).id
}

function storeSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value })
}

async function main() {
  await check('the five badge switches publish real booleans from the stored text, never its truthiness', () => {
    for (const [key, field, fallback] of SWITCHES) {
      assert.equal(publish({ [key]: 'false' })[field], false, `${key} 'false'`)
      assert.equal(publish({ [key]: '0' })[field], false, `${key} '0'`)
      assert.equal(publish({ [key]: 'off' })[field], false, `${key} 'off'`)
      assert.equal(publish({ [key]: 'true' })[field], true, `${key} 'true'`)
      assert.equal(publish({ [key]: ' YES ' })[field], true, `${key} ' YES '`)
      assert.equal(publish({ [key]: '1' })[field], true, `${key} '1'`)
      assert.equal(publish({ [key]: 'maybe' })[field], false, `${key}: a word that is not "on" is off`)
      assert.equal(publish({ [key]: '' })[field], fallback, `${key}: blank keeps the default`)
      assert.equal(publish({ [key]: '   ' })[field], fallback, `${key}: whitespace keeps the default`)
      assert.equal(publish({})[field], fallback, `${key}: never saved`)
    }
  })

  await check('the ranked-badge count is a whole number from 1 to 10, blank or junk publishes 3', () => {
    const rank = (value) => publish({ customer_portal_highlight_rank_limit: value }).highlightRankLimit
    assert.equal(rank('7'), 7)
    assert.equal(rank('0'), 1)
    assert.equal(rank('-4'), 1)
    assert.equal(rank('11'), 10)
    assert.equal(rank('999'), 10)
    assert.equal(rank('4.6'), 5)
    assert.equal(rank('abc'), 3)
    assert.equal(rank(''), 3)
    assert.equal(publish({}).highlightRankLimit, 3)
  })

  await check('recommended products: whole positive ids only, first choice order, no repeats', () => {
    const ids = (value) => publish({ customer_portal_recommended_product_ids: value }).recommendedProductIds
    assert.deepEqual(ids(JSON.stringify([12, 5, 12, '7', ' 9 ', 0, -3, 1.5, '4.2', 'x', null, true, { id: 8 }, [6], 2 ** 53, '1e3'])), [12, 5, 7, 9])
    assert.deepEqual(ids('[3, 1, 2]'), [3, 1, 2], 'kept in the order the owner chose, not sorted')
    assert.deepEqual(ids('{not json'), [])
    assert.deepEqual(ids('{"0": 5}'), [])
    assert.deepEqual(ids('5'), [])
    assert.deepEqual(ids(''), [])
    assert.deepEqual(publish({}).recommendedProductIds, [])
  })

  await check('recommended products: at most 100 distinct ids are published', () => {
    const stored = Array.from({ length: 150 }, (_, index) => index + 1)
    const published = publish({ customer_portal_recommended_product_ids: JSON.stringify([...stored, ...stored]) }).recommendedProductIds
    assert.equal(published.length, 100)
    assert.deepEqual(published, stored.slice(0, 100))
  })

  const publishedLanguage = (value) => {
    const config = publish({ customer_portal_language: value })
    return [config.languageSetting, config.language]
  }

  await check('default language: English or Khmer publishes as stored, anything else is automatic (English)', () => {
    assert.deepEqual(publishedLanguage('km'), ['km', 'km'])
    assert.deepEqual(publishedLanguage(' KM '), ['km', 'km'])
    assert.deepEqual(publishedLanguage('auto'), ['auto', 'en'])
    assert.deepEqual(publishedLanguage('en'), ['en', 'en'])
    assert.deepEqual(publishedLanguage('EN'), ['en', 'en'])
    for (const refused of ['', 'xx', 'zh', 'en-US', 'nl', 'khmer', '<script>', 'zh-cn', 'FR']) {
      assert.deepEqual(publishedLanguage(refused), ['auto', 'en'], JSON.stringify(refused))
    }
    assert.deepEqual([publish({}).languageSetting, publish({}).language], ['auto', 'en'])
  })

  await check('default language: a stored retired storefront language (French, Chinese, ...) publishes as English', () => {
    assert.deepEqual(publishedLanguage('fr'), ['auto', 'en'])
    for (const code of RETIRED_STOREFRONT_LANGUAGES) {
      assert.deepEqual(publishedLanguage(code), ['auto', 'en'], code)
    }
  })

  await check('default language: the Worker accepts exactly the storefront languages (frontend PUBLIC_STOREFRONT_LANGUAGE_OPTIONS)', () => {
    const list = frontendList('frontend/src/components/catalog/portalLanguageOptions.ts', 'PUBLIC_STOREFRONT_LANGUAGE_OPTIONS')
    const codes = [...list.matchAll(/value: '([^']+)'/g)].map((match) => match[1])
    assert.ok(codes.includes('en') && codes.includes('km'), `parsed ${codes.length} codes`)
    for (const code of codes) {
      assert.deepEqual(publishedLanguage(code), [code, code], code)
      assert.deepEqual(publishedLanguage(code.toUpperCase()), [code, code], code.toUpperCase())
    }
    const candidates = [...new Set([...codes, ...RETIRED_STOREFRONT_LANGUAGES])]
    const accepted = candidates.filter((code) => publishedLanguage(code)[0] === code)
    assert.deepEqual(accepted.sort(), [...codes].sort())
  })

  await check('translations: a block for a retired storefront language is never published', () => {
    for (const code of RETIRED_STOREFRONT_LANGUAGES) {
      assert.deepEqual(translationsOf({ [code]: { aboutTitle: `about in ${code}` } }), {}, code)
    }
  })

  await check('translations: an English block that is not an object, or a Khmer block with nothing translatable, publishes none', () => {
    assert.deepEqual(translationsOf({ en: 'not an object', km: {} }), {})
  })

  await check('translations: only storefront languages and translatable text reach the shop', () => {
    const published = translationsOf({
      KM: {
        aboutTitle: '  អំពីយើង  ',
        aiIntro: 'សួស្តី',
        aiPrompt: 'INTERNAL rules',
        aiProviderId: 7,
        businessName: 'Not translatable',
        publicUrl: 'https://evil.example',
        faqTitle: { html: '<b>x</b>' },
        fields: { promotionsTitle: 'ប្រូម៉ូសិន', aiPrompt: 'INTERNAL again', extra: { deep: 'x' } },
        text: { membershipInfoText: 'ពិន្ទុ' },
        linkLabels: { facebook: 'ហ្វេសប៊ុក', tiktok: 'TikTok', fields: { telegram: 'តេឡេក្រាម' } },
        script: '<script>alert(1)</script>',
      },
      En: { promotionsIntro: 'Featured' },
      'zh-cn': { promotionsIntro: '精选' },
      fr: { aboutTitle: 'À propos' },
      zh: { aboutTitle: 'base language' },
      xx: { aboutTitle: 'unknown' },
    })
    assert.deepEqual(published, {
      km: {
        aboutTitle: 'អំពីយើង',
        aiIntro: 'សួស្តី',
        fields: { promotionsTitle: 'ប្រូម៉ូសិន' },
        text: { membershipInfoText: 'ពិន្ទុ' },
        linkLabels: { facebook: 'ហ្វេសប៊ុក', fields: { telegram: 'តេឡេក្រាម' } },
      },
      en: { promotionsIntro: 'Featured' },
    })
    assert.equal(JSON.stringify(publish({ customer_portal_translations: JSON.stringify({ km: { aiPrompt: 'INTERNAL rules' } }) })).includes('INTERNAL'), false)
  })

  await check('translations: every storefront translatable field is published (frontend portalContentI18n.ts)', () => {
    const configFields = [...frontendList('frontend/src/components/catalog/portalContentI18n.ts', 'TRANSLATABLE_CONFIG_FIELDS').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
    const productFields = [...frontendList('frontend/src/components/catalog/portalContentI18n.ts', 'PRODUCT_TRANSLATABLE_FIELDS').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
    assert.ok(configFields.includes('aboutTitle') && productFields.includes('name'), 'parsed both lists')
    const src = fs.readFileSync(path.join(REPO, 'frontend/src/components/catalog/portalContentI18n.ts'), 'utf8')
    const collections = [...src.matchAll(/localizeCollectionItems\(source\.(\w+), langBlock\.\w+, \[([^\]]+)\]\)/g)]
      .map(([, name, fields]) => [name, [...fields.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])])
    collections.push(['faqItems', ['question', 'answer']])
    assert.ok(collections.length >= 3, 'parsed the collection field lists')
    const block = Object.fromEntries(configFields.map((field) => [field, `t-${field}`]))
    for (const [name, fields] of collections) block[name] = [Object.fromEntries(fields.map((field) => [field, `${name}-${field}`]))]
    for (const alias of ['products', 'catalogProducts', 'catalog']) block[alias] = { 12: Object.fromEntries(productFields.map((field) => [field, `${alias}-${field}`])) }
    assert.deepEqual(translationsOf({ km: block }).km, block)
  })

  await check('translations: a collection keeps positions, takes entry ids, and is bounded like its source list', () => {
    const km = translationsOf({
      km: {
        aboutBlocks: [{ title: 'one' }, 'junk', { body: 'three', mediaUrl: 'javascript:alert(1)' }],
        faqItems: { 'faq-1695-0': { question: 'q', answer: 'a', text: { answer: 'a2' } }, 'bad key!': { question: 'x' }, empty: {} },
        promoItems: Array.from({ length: 60 }, (_, index) => ({ title: `p${index}` })),
      },
    }).km
    assert.deepEqual(km.aboutBlocks, [{ title: 'one' }, {}, { body: 'three' }], 'a junk entry keeps its place so later entries still match their block')
    assert.deepEqual(km.faqItems, { 'faq-1695-0': { question: 'q', answer: 'a', text: { answer: 'a2' } } })
    assert.equal(km.promoItems.length, 50)
    const about = translationsOf({ km: { aboutBlocks: Array.from({ length: 40 }, (_, index) => ({ title: `b${index}` })) } }).km.aboutBlocks
    assert.equal(about.length, 30)
    const keyed = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`junk${index}`, 'x']).concat([['about-1', { title: 'kept' }]]))
    assert.deepEqual(translationsOf({ km: { aboutBlocks: keyed } }).km.aboutBlocks, { 'about-1': { title: 'kept' } }, 'junk entries never push a real one out')
    const products = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [String(index + 1), { name: `n${index}` }]))
    assert.equal(Object.keys(translationsOf({ km: { products } }).km.products).length, 500)
  })

  await check('translations: a "__proto__" language or entry key is never published', () => {
    const published = translationsOf('{"__proto__":{"aboutTitle":"p"},"km":{"faqItems":{"__proto__":{"question":"x"},"faq-1":{"question":"q"}}}}')
    assert.deepEqual(published, { km: { faqItems: { 'faq-1': { question: 'q' } } } })
    assert.equal(JSON.stringify(published).includes('__proto__'), false)
  })

  await check('translations: each text is capped at 4000 characters and never ends inside a Khmer character', () => {
    const km = translationsOf({ km: { aboutContent: capFallsInside('ក', 4000, KHMER_STACK, 4), faqItems: [{ answer: 'a'.repeat(4500) }] } }).km
    assert.equal(km.aboutContent, 'ក'.repeat(3996))
    assert.equal(km.faqItems[0].answer, 'a'.repeat(4000))
  })

  await check('translations: malformed, non-object or oversized JSON publishes none', () => {
    assert.deepEqual(translationsOf('{not json'), {})
    assert.deepEqual(translationsOf('[{"km":{"aboutTitle":"x"}}]'), {})
    assert.deepEqual(translationsOf('"km"'), {})
    assert.deepEqual(translationsOf(''), {})
    assert.deepEqual(publish({}).translations, {})
    const padded = (length) => {
      const body = JSON.stringify({ km: { aboutTitle: 'x' } })
      return `${body}${' '.repeat(length - body.length)}`
    }
    assert.deepEqual(translationsOf(padded(131072)), { km: { aboutTitle: 'x' } }, 'at the 128 KiB bound it still publishes')
    assert.deepEqual(translationsOf(padded(131073)), {}, 'one character over the bound publishes none')
  })

  await check('assistant greeting: trimmed plain text, line breaks kept, capped at 500 whole characters', () => {
    const intro = (value) => publish({ customer_portal_ai_intro: value }).aiIntro
    assert.equal(intro('  Hi there  '), 'Hi there')
    assert.equal(intro('Line one\nLine two'), 'Line one\nLine two')
    assert.equal(intro('a'.repeat(600)), 'a'.repeat(500))
    assert.equal(intro(capFallsInside('ក', 500, KHMER_STACK, 2)), 'ក'.repeat(498))
    assert.equal(intro(''), '')
    assert.equal(publish({}).aiIntro, '')
  })

  await check('the public config still never carries the assistant prompt or provider', () => {
    const config = publish({ customer_portal_ai_prompt: 'INTERNAL prompt', customer_portal_ai_provider_id: '7', customer_portal_ai_intro: 'Hello' })
    assert.equal(config.aiIntro, 'Hello')
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'aiPrompt'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'aiProviderId'), false)
  })

  const active = seedProduct('AB-W4 active serum', 1)
  const secondActive = seedProduct('AB-W4 active toner', 1)
  const inactive = seedProduct('AB-W4 retired cream', 0)
  const missing = secondActive + 1000
  storeSetting('customer_portal_recommended_product_ids', JSON.stringify([inactive, secondActive, missing, active, secondActive]))

  await check('GET /config publishes only recommended products that exist and are active, in the chosen order', async () => {
    const config = await get('/config')
    assert.deepEqual(config.recommendedProductIds, [secondActive, active])
  })

  await check('GET /bootstrap publishes the same recommended products as /config', async () => {
    const bootstrap = await get('/bootstrap')
    assert.deepEqual(bootstrap.config.recommendedProductIds, [secondActive, active])
  })

  await check('no recommended products stored: /config reads no products', async () => {
    storeSetting('customer_portal_recommended_product_ids', '[]')
    queries.length = 0
    const config = await get('/config')
    assert.deepEqual(config.recommendedProductIds, [])
    assert.deepEqual(queries.filter((sql) => /FROM products/.test(sql)), [])
  })

  console.log(`\ntest-portal-editor-publish-pure.cjs: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(`FAILED: ${failures.join(' | ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
