// About page. Owner ask 2 Nov 2026: the cover photo shows in full and nothing leaves empty space. Public-web overhaul (20 Nov,
// spec section 6): the cover is laid out by its own shape and never letterboxes; the gradient wrapper is gone; details are two
// compact rows; the map is live with no consent click. The geometry itself is proven in a browser (e2e/storefront-about-layout.spec.ts and the
// lane's screenshot run); this pins the structure that makes it true so a later edit cannot quietly bring the bars back.
//
// Run: node tests/portalAboutLayout.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COVER_BANNER_MAX_PX, COVER_WIDE_FROM, coverRatio, coverShape, sameImageFile } from '../src/utils/aboutCoverLayout.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

const tabs = code(read('../src/components/catalog/CatalogSecondaryTabs.tsx'))
const cover = between(tabs, 'function AboutCover(', '\n}\n')
const about = between(tabs, 'function CatalogAboutSection(', '\nfunction CatalogFaqSection(')

let failed = 0
function run(name: string, test: () => void): void {
  try {
    test()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

run('the shape rule: 1.6 and wider is a banner, everything else a two-column hero, nothing before the picture is measured', () => {
  assert.equal(COVER_WIDE_FROM, 1.6)
  assert.equal(coverShape(coverRatio(1254, 1254)), 'tall', 'the live square cover')
  assert.equal(coverShape(coverRatio(1600, 1000)), 'wide', 'exactly 1.6')
  assert.equal(coverShape(coverRatio(1599, 1000)), 'tall')
  assert.equal(coverShape(coverRatio(1920, 600)), 'wide')
  assert.equal(coverShape(coverRatio(600, 1200)), 'tall')
  assert.equal(coverShape(coverRatio(0, 0)), null, 'an image that has not decoded has no shape')
  assert.equal(coverShape(null), null)
  assert.equal(COVER_BANNER_MAX_PX, 520)
})

run('the round logo is hidden when the cover and the logo are one file, whatever the cache-busting query', () => {
  assert.equal(sameImageFile('/uploads/shop.png?v=3', '/uploads/shop.png?v=9'), true)
  assert.equal(sameImageFile('https://cdn.example/a/shop.png', 'https://cdn.example/a/shop.png#x'), true)
  assert.equal(sameImageFile('/uploads/cover.png', '/uploads/logo.png'), false)
  assert.equal(sameImageFile('https://a.example/shop.png', 'https://b.example/shop.png'), false, 'same name on another host is another file')
  assert.equal(sameImageFile('', ''), false, 'two empty values are not a match')
  assert.equal(sameImageFile(undefined, '/uploads/logo.png'), false)
  assert.match(about, /const showRoundLogo = !\(hasCover && sameImageFile\(versionedBusinessLogo, versionedBusinessCover\)\)/)
  assert.match(about, /\{showRoundLogo \? \(/)
})

run('the cover fills a box of its own ratio and never letterboxes: object-cover, no frame colour, no contain', () => {
  assert.match(cover, /<img[\s\S]*className="[^"]*\bobject-cover\b[^"]*"/, 'the picture fills its box')
  assert.doesNotMatch(cover, /object-contain|object-fill|bg-stone-100|bg-slate-100|mx-auto block h-auto/, 'no contain (the source of the grey side bars), no stone frame, no auto-height image')
  assert.match(cover, /shape === 'wide'\s*\?\s*\{ aspectRatio: String\(ratio\), maxHeight: `\$\{COVER_BANNER_MAX_PX\}px` \}/, 'a wide picture is a banner: height from the ratio, capped')
  assert.match(cover, /\{ aspectRatio: String\(ratio\), \['--cover-ratio' as string\]: String\(ratio\) \}/, 'a square or tall picture keeps its own ratio')
  assert.match(cover, /max-w-\[min\(100%,460px,calc\(60\*var\(--app-vh\)\*var\(--cover-ratio\)\)\)\]/, 'its box is never wider than 460 px or taller than 60vh')
  assert.match(cover, /md:w-\[460px\] md:max-w-\[45%\]/, 'the two-column hero keeps the picture in its own column')
  assert.match(about, /twoColumn \? 'md:flex md:items-center md:gap-8 md:p-6' : ''/, 'from md the text sits beside a square or tall picture')
  assert.match(about, /const twoColumn = hasCover && coverShapeNow === 'tall'/)
})

run('the frame holds a 16:9 box until the photo is measured (never a fixed height it can outgrow), then takes its ratio', () => {
  assert.match(cover, /const \[ratio, setRatio\] = useState<number \| null>\(null\)/)
  assert.match(cover, /shape \? '' : 'aspect-video bg-stone-200 dark:bg-neutral-800'/)
  // A fixed minimum height (the old min-h-36 = 144 px) is outgrown by a taller photo, and the whole card under it is pushed down by the
  // difference when the picture decodes: layout shift 0.14-0.17 on a phone against a 0.05 budget.
  assert.doesNotMatch(cover, /min-h-/, 'no fixed minimum height on the cover frame')
  assert.match(cover, /onLoad=\{[^\n]*measure\(event\.currentTarget\)/)
  assert.match(cover, /node\.complete && node\.naturalWidth > 0/, 'a photo already in the browser cache still counts as loaded')
})

run('a photo that fails to load falls back to the gradient banner (no broken-image box)', () => {
  assert.match(cover, /onError=\{onFailed\}/)
  assert.match(about, /const \[failedCover, setFailedCover\] = useState\(''\)/)
  assert.match(about, /failedCover !== versionedBusinessCover/)
  assert.match(about, /hasCover \? \(\s*<AboutCover[\s\S]*?\) : \(\s*<div\s+data-portal-about-hero="true"\s+className="relative h-20 sm:h-28"/, 'banner when there is no (usable) cover')
})

run('the wrapper is gone: flat surfaces on the page, no Contact button in the hero, the name always below the banner', () => {
  assert.doesNotMatch(about, /rounded-\[3\d px\]|rounded-\[28px\]|radial-gradient|from-white to-slate-50/, 'no gradient wrapper, no oversized radius')
  assert.doesNotMatch(about, /bg-white\/90 backdrop-blur-sm/, 'the old translucent plate over the photo is gone')
  assert.match(about, /<section className="space-y-4 py-4 sm:py-5">/)
  assert.match(about, /flex items-start gap-3 pt-4 sm:gap-4/, 'the row holding the name has no negative margin, so the name sits below the banner')
  assert.match(about, /hasCover \? '' : '-mt-11 sm:-mt-14'/, 'only the round logo overlaps the gradient banner edge')
  assert.doesNotMatch(about.slice(0, about.indexOf('function FaqSkeleton')), /PortalContactButton|onOpenContact/, 'the header Contact is the one entry point on About')
  assert.match(tabs, /<PortalContactRows inline entries=\{contactEntries\}/, 'the FAQ shows the chat rows itself, where its Contact button was')
})

run('the story is its own full-width card, before the details row', () => {
  const storyAt = about.indexOf('<OwnerText text={storyText} />')
  const detailsAt = about.indexOf('data-portal-about-details="true"')
  assert.ok(storyAt > -1 && detailsAt > storyAt, 'story first, so a phone reads it before the contacts')
})

run('the details card holds the address row, the chat rows and the account rows as tappable rows with real names', () => {
  const row = between(tabs, 'function AboutAddressRow(', '\n}\n')
  assert.match(row, /portalMapOpenHref\(item\.href, item\.value\)/, 'the address row opens the shop link, else a maps search')
  assert.match(row, /<span className="sr-only">\{item\.label\}: <\/span>/, 'the field name stays for a screen reader only')
  assert.doesNotMatch(row, /uppercase|tracking-/, 'no tiny upper-case caption')
  assert.match(about, /const detailRows = \[\.\.\.contactEntries, \.\.\.portalAccountsNotShown\(accountEntries, contactEntries\)\]/, 'chat rows then account rows, no account twice')
  assert.match(about, /<PortalContactRows inline entries=\{detailRows\}/)
  assert.doesNotMatch(about, /PortalSocialText/, 'the social chips left the About page')
})

run('the details card is right after the story and before the About blocks', () => {
  const storyAt = about.indexOf('<OwnerText text={storyText} />')
  const detailsAt = about.indexOf('data-portal-about-details="true"')
  const blocksAt = about.indexOf('{aboutBlocks.length ? (')
  assert.ok(storyAt > -1 && detailsAt > storyAt && blocksAt > detailsAt, 'story, details card, About blocks')
  assert.equal(about.slice(storyAt, detailsAt).includes('data-portal-about-picture'), false, 'nothing sits between the story and the card')
})

run('the details card sits beside the map on a large screen and stacks on a phone', () => {
  const details = between(about, 'data-portal-about-details="true"', 'data-portal-contact-tray="true"')
  assert.match(details, /hasFacts && hasMap \? 'lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\] lg:items-start' : ''/, 'two columns only when both exist')
  assert.match(about, /data-portal-map-card="true" className=\{`flex flex-col overflow-hidden rounded-2xl \$\{SURFACE\}`\}/)
})

run('the map is live with no consent click: 16:9 wide, 4:3 on a phone, lazy, safe referrer, one Open in Maps button', () => {
  assert.doesNotMatch(tabs, /PortalEmbedConsent|mapFallbackHref|useEffect\(\(\) => \{ setGranted/, 'no click-to-load gate is used by About')
  assert.match(about, /<div className="aspect-\[4\/3\] w-full[^"]*sm:aspect-video[^"]*">\s*<iframe\s+src=\{mapEmbedUrl \|\| ''\}/, '4:3 on a phone, 16:9 from sm, the iframe fills it')
  assert.match(about, /loading="lazy"\s+referrerPolicy=\{PORTAL_MAP_FRAME_REFERRER\}/)
  assert.match(about, /title=\{copy\('portal_a11y_map_title'/, 'the title is kept')
  assert.match(about, /copy\('openInMaps', 'Open in Maps', 'បើកក្នុងផែនទី'\)/, 'one button, icon and the words Open in Maps')
  assert.match(about, /portalMapOpenHref\(addressFact\?\.href, addressText\)/, 'to the shop link, else a maps search for the address')
  assert.doesNotMatch(about, /<PortalEmbed/, 'control: nothing gates the iframe')
  // The sandbox does not gate loading: it keeps the frame from navigating the storefront (as the earlier consent frame did).
  assert.match(about, /sandbox=\{PORTAL_MAP_FRAME_SANDBOX\}/, 'the map frame is sandboxed (the value is pinned below and in the rendered check in portalAboutDetails)')
  assert.doesNotMatch(about, /sandbox="[^"]*allow-top-navigation/, 'the map frame can never navigate the storefront')
})

run('one pair of map-frame attributes, worn by the About frame and the Website Editor preview alike', () => {
  const utils = code(read('../src/components/catalog/portalEditorUtils.ts'))
  const editor = code(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  assert.match(utils, /export const PORTAL_MAP_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'/, 'the one sandbox value')
  assert.match(utils, /export const PORTAL_MAP_FRAME_REFERRER = 'strict-origin-when-cross-origin'/, 'the one referrer value')
  assert.doesNotMatch(utils, /allow-top-navigation/, 'the frame can never navigate the page')
  const frame = between(editor, '<iframe title="portal-map-preview"', '/>')
  assert.match(frame, /sandbox=\{PORTAL_MAP_FRAME_SANDBOX\}/, 'the editor preview is sandboxed')
  assert.match(frame, /referrerPolicy=\{PORTAL_MAP_FRAME_REFERRER\}/, 'the editor preview sends the origin only')
  assert.doesNotMatch(frame, /no-referrer-when-downgrade|allow-top-navigation/, 'neither the full referrer nor top navigation')
  assert.match(editor, /import \{[^}]*PORTAL_MAP_FRAME_REFERRER[^}]*PORTAL_MAP_FRAME_SANDBOX[^}]*\} from '\.\/portalEditorUtils\.ts'/, 'the editor takes the values from the one module')
  assert.match(about, /referrerPolicy=\{PORTAL_MAP_FRAME_REFERRER\}/, 'About wears the same referrer')
  assert.match(about, /sandbox=\{PORTAL_MAP_FRAME_SANDBOX\}/, 'About wears the same sandbox')
})

run('every surface on the About page is solid: no opacity suffix, no blur, no transparent fill, in light or dark', () => {
  const solid = /(?:\b(?:dark:)?(?:hover:)?(?:bg|border|ring|from|via|to|divide|shadow)-[\w[\]#.,()-]+\/\d+|backdrop-blur[\w-]*|bg-transparent|\bopacity-\d+)/g
  assert.deepEqual([between(tabs, 'const BRASS_TEXT', 'function FaqSkeleton(')].flatMap((part) => part.match(solid) || []), [])
})

if (failed) {
  console.error(`\n${failed} About layout check(s) failed`)
  process.exit(1)
}
console.log('\nAll About layout checks passed')
