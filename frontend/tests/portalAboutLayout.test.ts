// About page, owner ask 2 Nov 2026: the cover photo shows in full, and the story, contacts, socials and map
// are arranged so nothing leaves empty space. The geometry itself is proven in a browser
// (e2e/storefront-about-layout.spec.ts); this pins the structure that makes it true so a later edit
// cannot quietly bring back the crop, the overlay or the old two-column row.
//
// Run: node tests/portalAboutLayout.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

run('the cover is an in-flow image kept whole: contain, auto height, a cap on very wide screens', () => {
  assert.match(cover, /<img[\s\S]*className="[^"]*\bobject-contain\b[^"]*"/, 'the whole picture, never cropped')
  assert.match(cover, /\bh-auto\b/, 'its own proportions')
  assert.match(cover, /\bw-full\b/)
  assert.match(cover, /\bmax-h-\[min\(calc\(72\*var\(--app-vh\)\),680px\)\]/, 'the only cap, for a very wide screen')
  assert.doesNotMatch(cover, /object-cover|object-fill|absolute|inset-0|h-20|h-28|overflow-hidden/, 'no crop, no stretch, no thin strip, no overlay')
})

run('the frame holds a minimum height until the photo is decoded, then lets it set its own height', () => {
  assert.match(cover, /const \[loaded, setLoaded\] = useState\(false\)/)
  assert.match(cover, /loaded \? '' : 'min-h-36 sm:min-h-56'/)
  assert.match(cover, /onLoad=\{[^\n]*setLoaded\(true\)/)
  assert.match(cover, /node\.complete && node\.naturalWidth > 0/, 'a photo already in the browser cache still counts as loaded')
})

run('a photo that fails to load falls back to the gradient banner (no broken-image box)', () => {
  assert.match(cover, /onError=\{onFailed\}/)
  assert.match(about, /const \[failedCover, setFailedCover\] = useState\(''\)/)
  assert.match(about, /failedCover !== versionedBusinessCover/)
  assert.match(about, /hasCover \? \(\s*<AboutCover[\s\S]*?\) : \(\s*<div\s+data-portal-about-hero="true"\s+className="relative h-20 sm:h-28"/, 'banner when there is no (usable) cover')
})

run('the logo and name sit below the photo, never over it', () => {
  assert.match(about, /hasCover \? 'pt-4 sm:pt-5' : '-mt-7 sm:-mt-9'/)
  assert.doesNotMatch(about, /bg-white\/90 backdrop-blur-sm/, 'the old translucent plate over the photo is gone')
})

run('the story is its own full-width card, before the contacts and map row', () => {
  const storyAt = about.indexOf('<OwnerText text={storyText} />')
  const detailsAt = about.indexOf('data-portal-about-details="true"')
  assert.ok(storyAt > -1 && detailsAt > storyAt, 'story first, so a phone reads it before the contacts')
  const beforeDetails = about.slice(0, detailsAt)
  assert.doesNotMatch(beforeDetails.slice(beforeDetails.lastIndexOf('<div className="grid')), /lg:grid-cols/, 'the story is not in a two-column row any more')
})

run('contacts and socials sit beside the map on a large screen and stack below it', () => {
  const details = between(about, 'data-portal-about-details="true"', 'data-portal-contact-tray="true"')
  assert.match(details, /hasContactInfo && hasMap \? 'lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\] lg:items-stretch' : ''/, 'two columns only when both exist; stretched to one height')
  assert.match(about, /data-portal-map-card="true" className="flex flex-col/, 'the map card stretches with its row')
  assert.match(about, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,14rem\),1fr\)\)/, 'the facts take as many columns as the tray is wide')
})

run('the map keeps its consent gate and fills the card it is given', () => {
  assert.match(about, /<PortalEmbedConsent[\s\S]*?className="flex-1"[\s\S]*?src=\{mapEmbedUrl \|\| ''\}/)
  assert.match(consent, /className = ''/)
  assert.match(consent, /justify-center/, 'the not-yet-loaded panel is centred in a tall card, not stuck to its top')
  assert.match(consent, /useEffect\(\(\) => \{ setGranted\(readStoredChoice\(\)\) \}, \[\]\)/, 'consent is still read after mount, default not granted')
  assert.match(consent, /if \(granted\) \{[\s\S]*?<iframe/, 'the iframe renders only once granted')
})

if (failed) {
  console.error(`\n${failed} About layout check(s) failed`)
  process.exit(1)
}
console.log('\nAll About layout checks passed')
