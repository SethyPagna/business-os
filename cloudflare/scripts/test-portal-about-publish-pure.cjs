const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
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

function loadIsolated(rel) {
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}

const portal = require('./harness/load_portal_route.cjs')
const safeLink = loadIsolated('lib/safeLinkUrl.ts')
const env = { BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }
const publish = (settings) => portal.buildPublicPortalConfig(settings, env)

const POSTER = '/uploads/Leang poster-1-abc.webp'
const BLOCKS = [
  { id: 'b1', type: 'text', title: 'Since 2019', body: 'Family shop in Phnom Penh.', mediaUrl: '' },
  { id: 'b2', type: 'image', title: 'Our counter', body: '', mediaUrl: '/uploads/counter-2-def.webp' },
]
// Every value differs from its default, so a builder that publishes defaults fails.
const FIXTURE = {
  business_name: 'Leang Cosmetics',
  customer_portal_about_title: 'Our story',
  customer_portal_about_content: 'We opened in 2019 and still pick every product ourselves.',
  customer_portal_about_blocks: JSON.stringify(BLOCKS),
  customer_portal_address_link: 'https://maps.app.goo.gl/AbC123',
  customer_portal_logo_size: '120',
  customer_portal_logo_fit: 'contain',
  customer_portal_logo_zoom: '150',
  customer_portal_logo_position_x: '20',
  customer_portal_logo_position_y: '80',
  customer_portal_about_image: POSTER,
  customer_portal_about_image_alt: 'Poster: new arrivals this month',
  customer_portal_logo_image: '/uploads/logo-1-aaa.png',
  customer_portal_cover_image: '/uploads/Leang cover 1-2-bbb.webp',
  customer_portal_favicon_image: '/uploads/fav-3-ccc.png',
}

const BAD_ABOUT_IMAGES = [
  'javascript:alert(1)',
  '//evil.example/p.png',
  'https://tracker.example/p.gif',
  'data:image/png;base64,AA',
  '/uploads/../secret',
  '/uploads/%2e%2E/secret',
  '/uploads/..%2Fsecret',
  '/uploads\\..\\secret',
  '/uploads/a\\b.png',
  '/uploads//evil.example/p.png',
  '/uploads/./p.png',
  '/uploads/a\u0000b.png',
  '/uploads/a%00b.png',
  '/uploads/a\tb.png',
  '/uploads/',
  'uploads/p.png',
  '/files/p.png',
  '/uploads/%E0%A4%A.png',
  `/uploads/${'a'.repeat(500)}.png`,
]

async function main() {
  await check('publish matrix: every About / address / logo key follows its stored setting', () => {
    const config = publish(FIXTURE)
    assert.equal(config.aboutTitle, 'Our story')
    assert.equal(config.aboutContent, FIXTURE.customer_portal_about_content)
    assert.deepEqual(config.aboutBlocks, BLOCKS)
    assert.equal(config.addressLink, 'https://maps.app.goo.gl/AbC123')
    assert.equal(config.logoSize, 120)
    assert.equal(config.logoFit, 'contain')
    assert.equal(config.logoZoom, 150)
    assert.equal(config.logoPositionX, 20)
    assert.equal(config.logoPositionY, 80)
    assert.equal(config.aboutImage, POSTER)
    assert.equal(config.aboutImageAlt, 'Poster: new arrivals this month')
  })

  await check('defaults: an untouched shop publishes the look the storefront already shows', () => {
    const config = publish({})
    assert.equal(config.aboutTitle, '', 'empty so the storefront uses its own translated "About"')
    assert.equal(config.aboutContent, '')
    assert.deepEqual(config.aboutBlocks, [])
    assert.equal(config.addressLink, '')
    assert.equal(config.logoSize, 80)
    assert.equal(config.logoFit, 'cover')
    assert.equal(config.logoZoom, 100)
    assert.equal(config.logoPositionX, 50)
    assert.equal(config.logoPositionY, 50)
    assert.equal(config.aboutImage, '')
    assert.equal(config.aboutImageAlt, '')
  })

  await check('AW-2: the stored cover, logo and favicon paths publish unchanged', () => {
    const config = publish(FIXTURE)
    assert.equal(config.businessLogo, FIXTURE.customer_portal_logo_image)
    assert.equal(config.businessCover, FIXTURE.customer_portal_cover_image, 'a cover whose file name has spaces is kept as stored')
    assert.equal(config.businessFavicon, FIXTURE.customer_portal_favicon_image)
    const https = publish({ customer_portal_logo_image: 'https://cdn.example/logo.png' })
    assert.equal(https.businessLogo, 'https://cdn.example/logo.png', 'an https logo is still allowed, like promo card media')
  })

  await check('logo, cover and favicon never publish an unsafe link', () => {
    for (const bad of ['javascript:alert(1)', '//evil.example/p.png', 'data:image/png;base64,AA', ' java\tscript:alert(1)']) {
      const config = publish({ customer_portal_logo_image: bad, customer_portal_cover_image: bad, customer_portal_favicon_image: bad })
      assert.equal(config.businessLogo, '', `logo ${JSON.stringify(bad)}`)
      assert.equal(config.businessCover, '', `cover ${JSON.stringify(bad)}`)
      assert.equal(config.businessFavicon, '', `favicon ${JSON.stringify(bad)}`)
    }
  })

  await check('logo framing is clamped to the editor slider ranges; blank or junk publishes the default', () => {
    const cases = [
      [{ customer_portal_logo_size: '10' }, 'logoSize', 48],
      [{ customer_portal_logo_size: '999' }, 'logoSize', 144],
      [{ customer_portal_logo_size: 'abc' }, 'logoSize', 80],
      [{ customer_portal_logo_size: '' }, 'logoSize', 80],
      [{ customer_portal_logo_size: '  97.6 ' }, 'logoSize', 98],
      [{ customer_portal_logo_fit: 'weird' }, 'logoFit', 'cover'],
      [{ customer_portal_logo_fit: '' }, 'logoFit', 'cover'],
      [{ customer_portal_logo_fit: 'cover' }, 'logoFit', 'cover'],
      [{ customer_portal_logo_zoom: '10' }, 'logoZoom', 80],
      [{ customer_portal_logo_zoom: '999' }, 'logoZoom', 180],
      [{ customer_portal_logo_zoom: '' }, 'logoZoom', 100],
      [{ customer_portal_logo_position_x: '-5' }, 'logoPositionX', 0],
      [{ customer_portal_logo_position_x: '250' }, 'logoPositionX', 100],
      [{ customer_portal_logo_position_x: '' }, 'logoPositionX', 50],
      [{ customer_portal_logo_position_y: '33.6' }, 'logoPositionY', 34],
      [{ customer_portal_logo_position_y: '0' }, 'logoPositionY', 0],
      [{ customer_portal_logo_position_y: 'NaN' }, 'logoPositionY', 50],
    ]
    for (const [settings, field, expected] of cases) {
      assert.equal(publish(settings)[field], expected, `${JSON.stringify(settings)} -> ${field}`)
    }
  })

  await check('AW-3 (publish side): an About picture that is not this site\'s own upload is never published', () => {
    for (const bad of BAD_ABOUT_IMAGES) {
      assert.equal(publish({ customer_portal_about_image: bad }).aboutImage, '', JSON.stringify(bad))
    }
    assert.equal(publish({ customer_portal_about_image: `  ${POSTER}  ` }).aboutImage, POSTER, 'surrounding spaces are trimmed')
    assert.equal(publish({ customer_portal_about_image: '/uploads/_v/w640/poster.webp' }).aboutImage, '/uploads/_v/w640/poster.webp')
    assert.equal(publish({ customer_portal_about_image: '/uploads/My%20Poster.webp' }).aboutImage, '/uploads/My%20Poster.webp')
  })

  await check('normalizePortalUploadPath: the one rule for "this site\'s own upload"', () => {
    assert.equal(typeof safeLink.normalizePortalUploadPath, 'function', 'lib/safeLinkUrl.ts exports normalizePortalUploadPath')
    for (const bad of BAD_ABOUT_IMAGES) assert.equal(safeLink.normalizePortalUploadPath(bad), null, JSON.stringify(bad))
    for (const empty of ['', '   ', null, undefined]) assert.equal(safeLink.normalizePortalUploadPath(empty), null)
    assert.equal(safeLink.normalizePortalUploadPath(POSTER), POSTER)
    assert.equal(safeLink.normalizePortalUploadPath(` ${POSTER}\n`), POSTER)
    assert.equal(safeLink.normalizePortalUploadPath('/uploads/a..b-1-x.webp'), '/uploads/a..b-1-x.webp', 'two dots inside a file name are not a path step')
    assert.equal(safeLink.normalizePortalUploadPath(`/uploads/${'a'.repeat(487)}.png`).length, 500, 'exactly 500 characters is allowed')
  })

  await check('about picture description is trimmed and capped at 200 characters', () => {
    assert.equal(publish({ customer_portal_about_image_alt: '   shelf   ' }).aboutImageAlt, 'shelf')
    const long = 'ក'.repeat(250)
    assert.equal(publish({ customer_portal_about_image_alt: long }).aboutImageAlt, 'ក'.repeat(200))
    const emoji = '\u{1F484}'.repeat(201)
    assert.equal([...publish({ customer_portal_about_image_alt: emoji }).aboutImageAlt].length, 200, 'counted in characters, never splitting one')
  })

  await check('about blocks: media only through the link allowlist, types and sizes bounded', () => {
    const blocks = [
      { id: 'x1', type: 'image', title: 'Script', body: '', mediaUrl: 'javascript:alert(1)' },
      { id: 'x2', type: 'image', title: 'Beacon', body: '', mediaUrl: '//evil.example/p.png' },
      { id: 'x3', type: 'image', title: 'Data', body: '', mediaUrl: 'data:image/png;base64,AA' },
      { id: 'x4', type: 'video', title: 'Film', body: '', mediaUrl: 'https://video.example/v.mp4' },
      { id: 'x5', type: 'image', title: '', body: '', mediaUrl: 'javascript:alert(1)' },
      { id: 'x6', type: 'carousel', title: 'Odd type', body: 'kept as text', mediaUrl: '' },
      { id: 'x7', type: 'text', title: 'T'.repeat(200), body: 'B'.repeat(5000), mediaUrl: '' },
      'not a block',
    ]
    const out = publish({ customer_portal_about_blocks: JSON.stringify(blocks) }).aboutBlocks
    const byId = Object.fromEntries(out.map((b) => [b.id, b]))
    assert.equal(byId.x1.mediaUrl, '')
    assert.equal(byId.x2.mediaUrl, '')
    assert.equal(byId.x3.mediaUrl, '')
    assert.equal(byId.x4.mediaUrl, 'https://video.example/v.mp4')
    assert.equal(byId.x4.type, 'video')
    assert.equal(byId.x5, undefined, 'a block left with nothing to show is dropped')
    assert.equal(byId.x6.type, 'text')
    assert.equal(byId.x7.title.length, 160)
    assert.equal(byId.x7.body.length, 4000)
    assert.equal(out.length, 6)
    for (const block of out) assert.deepEqual(Object.keys(block).sort(), ['body', 'id', 'mediaUrl', 'title', 'type'])
  })

  await check('about blocks: at most 30 shown, blanks never push a real block out, bad JSON is no blocks', () => {
    const blanks = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, type: 'text', title: '', body: '', mediaUrl: '' }))
    const real = Array.from({ length: 31 }, (_, i) => ({ id: `r${i}`, type: 'text', title: `Block ${i}`, body: '', mediaUrl: '' }))
    const out = publish({ customer_portal_about_blocks: JSON.stringify([...blanks, ...real]) }).aboutBlocks
    assert.equal(out.length, 30)
    assert.equal(out[0].id, 'r0')
    assert.deepEqual(publish({ customer_portal_about_blocks: '{not json' }).aboutBlocks, [])
    assert.deepEqual(publish({ customer_portal_about_blocks: '{"a":1}' }).aboutBlocks, [])
  })

  await check('address link: http(s) only, a bare map host is completed the way the editor save does', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/map', 'ftp://files.example/map', 'java\tscript:alert(1)', 'mailto:a@b.example']) {
      assert.equal(publish({ customer_portal_address_link: bad }).addressLink, '', JSON.stringify(bad))
    }
    assert.equal(publish({ customer_portal_address_link: 'maps.app.goo.gl/AbC123' }).addressLink, 'https://maps.app.goo.gl/AbC123')
    assert.equal(publish({ customer_portal_address_link: 'https://www.google.com/maps/place/Leang/' }).addressLink, 'https://www.google.com/maps/place/Leang')
  })

  await check('the public payload never carries the assistant prompt or provider (FX-sec rule kept)', () => {
    const config = publish({ ...FIXTURE, customer_portal_ai_prompt: 'INTERNAL prompt', customer_portal_ai_provider_id: '7' })
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'aiPrompt'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'aiProviderId'), false)
    assert.equal(JSON.stringify(config).includes('INTERNAL prompt'), false)
  })

  // The editor builds its draft from the public config (CatalogPage.tsx buildDraft), so an
  // unpublished editor key comes back as its default and is saved over the stored value.
  const KNOWN_UNPUBLISHED = [
    'customer_portal_title_size',
    'customer_portal_ai_intro',
    'customer_portal_translations',
    'customer_portal_language',
    'customer_portal_show_top_seller_badge',
    'customer_portal_show_top_product_badge',
    'customer_portal_show_recommended_badge',
    'customer_portal_show_promotion_badge',
    'customer_portal_show_new_arrival_badge',
    'customer_portal_highlight_rank_limit',
    'customer_portal_recommended_product_ids',
    'customer_portal_stock_threshold_mode',
    'customer_portal_low_stock_threshold',
    'customer_portal_out_of_stock_threshold',
    'customer_portal_show_point_value',
    // Fixed false: membership history lives in the signed-in account only.
    'customer_portal_show_membership',
  ]
  const MAX_KNOWN_UNPUBLISHED = 16

  function buildDraftEntries() {
    const src = fs.readFileSync(path.join(REPO, 'frontend', 'src', 'components', 'catalog', 'CatalogPage.tsx'), 'utf8').replace(/\r\n/g, '\n')
    const start = src.indexOf('function buildDraft(config: PortalConfig): PortalDraft {')
    assert.ok(start > -1, 'buildDraft not found in CatalogPage.tsx')
    const end = src.indexOf('\n}\n', start)
    const body = src.slice(start, end)
    const entries = []
    for (const match of body.matchAll(/^ {4}([a-z][a-z0-9_]*):\s*(.+)$/gm)) {
      const fields = [...new Set([...match[2].matchAll(/\bconfig\.([A-Za-z]+)/g)].map((m) => m[1]))]
      entries.push({ key: match[1], fields })
    }
    return entries
  }

  const PROBES = [
    'true', 'false', '0', '1', '97', 'khr', 'contain', 'global', '#123456', 'zz-probe',
    'https://probe.example/x', '/uploads/probe.webp', 'https://www.google.com/maps/embed?pb=probe',
    JSON.stringify([{ id: 'f', question: 'q', answer: 'a' }]),
    JSON.stringify([{ id: 'a', type: 'text', title: 't', body: 'b', mediaUrl: '' }]),
    JSON.stringify([{ id: 'p', title: 't', subtitle: '', body: '', mediaUrl: '' }]),
    JSON.stringify({ km: { about: 'x' } }),
    JSON.stringify([5, 6]),
  ]
  function publishedFrom(key, fields) {
    if (!fields.length) return false
    const base = publish({})
    return PROBES.some((value) => {
      const next = publish({ [key]: value })
      return fields.some((field) => JSON.stringify(next[field]) !== JSON.stringify(base[field]))
    })
  }

  await check('ratchet: every editor key read from the public config is published or known-unpublished', () => {
    const entries = buildDraftEntries()
    assert.ok(entries.length >= 100, `parsed ${entries.length} buildDraft keys; the parser lost the object`)
    const missing = entries.filter(({ key, fields }) => !KNOWN_UNPUBLISHED.includes(key) && !publishedFrom(key, fields))
    assert.deepEqual(missing.map((e) => e.key), [], 'editor keys the storefront never receives (the editor resets and re-saves them)')
  })

  await check('ratchet: the known-unpublished list only shrinks', () => {
    assert.ok(KNOWN_UNPUBLISHED.length <= MAX_KNOWN_UNPUBLISHED)
    const entries = new Map(buildDraftEntries().map((e) => [e.key, e.fields]))
    for (const key of KNOWN_UNPUBLISHED) {
      assert.ok(entries.has(key), `${key} is no longer an editor key: remove it from KNOWN_UNPUBLISHED`)
      assert.equal(publishedFrom(key, entries.get(key)), false, `${key} is published now: remove it from KNOWN_UNPUBLISHED`)
    }
  })

  await check('ratchet control: the probe sees a key the Worker really publishes and misses one it does not', () => {
    assert.equal(publishedFrom('customer_portal_business_tagline', ['businessTagline']), true)
    assert.equal(publishedFrom('customer_portal_title_size', ['titleSize']), false)
  })

  const db =openDb(loadAll())
  let sessionUser = null
  const overrides = {
    '../lib/db': { getDb: (e) => e.DB },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
    '../lib/audit': {
      changedFields: () => null,
      auditChangeColumns: () => ({ old_value: null, new_value: null }),
      isSecretShapedAuditKey: () => false,
      audit: async () => {},
    },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': { bumpVersion: async () => {} },
  }
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(SRC, rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  const app = load('routes/settings.ts').default
  const user = (id, grants) => ({ id, username: `u${id}`, permissions: JSON.stringify(grants), role_code: null, role_permissions: null })
  const ABOUT_ONLY = user(41, { portal_about: true })
  const POSTS_ONLY = user(42, { portal_posts: true })
  const CONFIG_ONLY = user(43, { customer_portal: true })
  const SETTINGS_HOLDER = user(44, { settings: true })
  async function save(actor, body) {
    sessionUser = actor
    const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
  const IMAGE = 'customer_portal_about_image'
  const ALT = 'customer_portal_about_image_alt'
  const seed = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value })

  await check('AW-3: a bad About picture is refused with invalid_about_image and nothing in the save lands', async () => {
    seed(IMAGE, '/uploads/before.webp')
    seed('customer_portal_about_title', 'Before')
    for (const bad of BAD_ABOUT_IMAGES) {
      const res = await save(ABOUT_ONLY, { [IMAGE]: bad, customer_portal_about_title: 'After' })
      assert.equal(res.status, 400, `${JSON.stringify(bad)} -> ${res.status} ${JSON.stringify(res.body)}`)
      assert.equal(res.body.code, 'invalid_about_image', JSON.stringify(bad))
      assert.equal(stored(IMAGE), '/uploads/before.webp', `${JSON.stringify(bad)} must not be stored`)
      assert.equal(stored('customer_portal_about_title'), 'Before', 'the save is all or nothing')
    }
  })

  await check('AW-3: an own upload saves (trimmed), and an empty value clears the picture', async () => {
    let res = await save(ABOUT_ONLY, { [IMAGE]: `  ${POSTER}  ` })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(IMAGE), POSTER)
    res = await save(ABOUT_ONLY, { [IMAGE]: '' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(IMAGE), '')
    res = await save(ABOUT_ONLY, { [IMAGE]: null })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(IMAGE), '', 'null clears to empty, never the text "null"')
  })

  await check('the picture description is stored trimmed to 200 characters', async () => {
    const res = await save(ABOUT_ONLY, { [ALT]: `   ${'ក'.repeat(250)}   ` })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(ALT), 'ក'.repeat(200))
    const plain = await save(ABOUT_ONLY, { [ALT]: '  Poster  ' })
    assert.equal(plain.status, 200)
    assert.equal(stored(ALT), 'Poster')
  })

  await check('AW-4: a posts-only or config-only grant gets the bucket 403 for both keys; About-only and full Settings succeed', async () => {
    for (const key of [IMAGE, ALT]) {
      for (const actor of [POSTS_ONLY, CONFIG_ONLY]) {
        const res = await save(actor, { [key]: key === IMAGE ? POSTER : 'x' })
        assert.equal(res.status, 403, `${actor.username} ${key}: ${JSON.stringify(res.body)}`)
        assert.match(res.body.error, /Manage portal About/)
      }
      for (const actor of [ABOUT_ONLY, SETTINGS_HOLDER]) {
        const res = await save(actor, { [key]: key === IMAGE ? POSTER : 'x' })
        assert.equal(res.status, 200, `${actor.username} ${key}: ${JSON.stringify(res.body)}`)
      }
    }
  })

  await check('the permission refusal comes before the value check (a posts-only bad value is a 403)', async () => {
    const res = await save(POSTS_ONLY, { [IMAGE]: 'javascript:alert(1)' })
    assert.equal(res.status, 403)
  })

  await check('settings.ts and portalPermissions.ts file both keys in the About bucket', () => {
    const extract = (src) => {
      const m = src.match(/PORTAL_ABOUT_KEYS\s*=\s*new Set(?:<string>)?\(\[([\s\S]*?)\]\)/)
      assert.ok(m, 'PORTAL_ABOUT_KEYS not found')
      return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    }
    const be = extract(fs.readFileSync(path.join(SRC, 'routes', 'settings.ts'), 'utf8'))
    const fe = extract(fs.readFileSync(path.join(REPO, 'frontend', 'src', 'utils', 'portalPermissions.ts'), 'utf8'))
    for (const key of [IMAGE, ALT]) {
      assert.ok(be.includes(key), `settings.ts PORTAL_ABOUT_KEYS lacks ${key}`)
      assert.ok(fe.includes(key), `portalPermissions.ts PORTAL_ABOUT_KEYS lacks ${key}`)
    }
  })

  console.log(`\ntest-portal-about-publish-pure.cjs: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(`FAILED: ${failures.join(' | ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
