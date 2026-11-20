// About page. Owner ask 2 Nov 2026: the cover photo shows in full and nothing leaves empty space. Public-web overhaul (20 Nov,
// spec section 6): the cover is laid out by its own shape and never letterboxes; the gradient wrapper is gone; details are two
// compact rows; the map asks consent in one line. The geometry itself is proven in a browser (e2e/storefront-about-layout.spec.ts and the
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
const consent = code(read('../src/components/catalog/legal/PortalEmbedConsent.tsx'))
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

run('the wrapper is gone: flat surfaces on the page, one Contact button in the hero, the logo and name below the photo', () => {
  assert.doesNotMatch(about, /rounded-\[3\d px\]|rounded-\[28px\]|radial-gradient|from-white to-slate-50/, 'no gradient wrapper, no oversized radius')
  assert.doesNotMatch(about, /bg-white\/90 backdrop-blur-sm/, 'the old translucent plate over the photo is gone')
  assert.match(about, /<section className="space-y-4 py-4 sm:py-5">/)
  assert.match(about, /hasCover \|\| !showRoundLogo \? 'pt-4' : '-mt-7 sm:-mt-9'/, 'with a cover the name sits below the photo; the gradient banner keeps the logo overlap')
  assert.match(about, /<PortalContactButton copy=\{copy\} onOpenContact=\{onOpenContact\} \/>/, 'the Contact button uses the page contact callback')
  assert.match(tabs, /copy\('contactButton', 'Contact', 'ទាក់ទង'\)/)
  assert.match(about, /onOpenContact \? <div className="mt-4">/, 'no callback, no button')
})

run('the story is its own full-width card, before the details row', () => {
  const storyAt = about.indexOf('<OwnerText text={storyText} />')
  const detailsAt = about.indexOf('data-portal-about-details="true"')
  assert.ok(storyAt > -1 && detailsAt > storyAt, 'story first, so a phone reads it before the contacts')
})

run('phone and address are compact rows (icon, value, one action icon); no chips, no field-name labels', () => {
  const row = between(tabs, 'function AboutFactRow(', '\n}\n')
  assert.match(row, /derivePhoneCallLink\(item\.value \|\| ''\) \|\| item\.href/, 'the dialer link is rebuilt from the number')
  assert.match(row, /aria-label=\{actionLabel\}\s+title=\{actionLabel\}/, 'the action icon has a tooltip and an accessible name')
  assert.match(row, /<span className="sr-only">\{item\.label\}: <\/span>/, 'the field name stays for a screen reader only')
  assert.doesNotMatch(row, /uppercase|tracking-/, 'no tiny upper-case caption')
  assert.match(about, /item\.key === 'phone' \|\| item\.key === 'address'/, 'only the two rows the spec names')
  assert.doesNotMatch(about, /socialLinks|PortalSocialText/, 'the social chips left the About page')
})

run('phone and address sit beside the map on a large screen and stack below it', () => {
  const details = between(about, 'data-portal-about-details="true"', 'data-portal-contact-tray="true"')
  assert.match(details, /hasFacts && hasMap \? 'lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\] lg:items-stretch' : ''/, 'two columns only when both exist; stretched to one height')
  assert.match(about, /data-portal-map-card="true" className=\{`flex flex-col overflow-hidden rounded-2xl \$\{SURFACE\}`\}/, 'the map card stretches with its row')
})

run('the map keeps its consent gate, in one line, and fills the card it is given', () => {
  assert.match(about, /<PortalEmbedConsent[\s\S]*?className="flex-1"[\s\S]*?src=\{mapEmbedUrl \|\| ''\}/)
  assert.match(consent, /className = ''/)
  assert.match(consent, /items-center/, 'the not-yet-loaded line is centred in the card')
  assert.match(consent, /useEffect\(\(\) => \{ setGranted\(readStoredChoice\(\)\) \}, \[\]\)/, 'consent is still read after mount, default not granted')
  assert.match(consent, /if \(granted\) \{[\s\S]*?<iframe/, 'the iframe renders only once granted')
  assert.match(consent, /copy\('mapConsentLine', 'Google Maps sets its own cookies\.', 'Google Maps កំណត់ខូឃីរបស់ខ្លួន។'\)/, 'one line')
  assert.match(consent, /copy\('mapLoad', 'Load map', 'ផ្ទុកផែនទី'\)/, 'the main action is icon plus one word')
  assert.doesNotMatch(consent, /MAP_CONSENT_(?:BODY|LOAD|LINK)_/, 'the long body, the long button and the text link are gone')
  assert.doesNotMatch(consent, /<p className="max-w-prose/, 'no paragraph')
})

run('every surface on the About page is solid: no opacity suffix, no blur, no transparent fill, in light or dark', () => {
  const solid = /(?:\b(?:dark:)?(?:hover:)?(?:bg|border|ring|from|via|to|divide|shadow)-[\w[\]#.,()-]+\/\d+|backdrop-blur[\w-]*|bg-transparent|\bopacity-\d+)/g
  assert.deepEqual([between(tabs, 'const BRASS_TEXT', 'function FaqContactButton('), consent].flatMap((part) => part.match(solid) || []), [])
})

if (failed) {
  console.error(`\n${failed} About layout check(s) failed`)
  process.exit(1)
}
console.log('\nAll About layout checks passed')
