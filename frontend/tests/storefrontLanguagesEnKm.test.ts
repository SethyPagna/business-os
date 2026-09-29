// Owner decision, 27 Sep 2026: the public site offers English and Khmer only,
// Khmer by default. Both language pickers (the storefront and the Website
// Editor preview of it) render this one list.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as languageOptions from '../src/components/catalog/portalLanguageOptions.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8')
const failures: string[] = []
const check = (name: string, run: () => void) => {
  try {
    run()
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  }
}

type LanguageOption = { value: string; label: string }
const offeredOptions = (): LanguageOption[] => {
  const list = (languageOptions as Record<string, unknown>).PUBLIC_STOREFRONT_LANGUAGE_OPTIONS
  assert.ok(Array.isArray(list), 'portalLanguageOptions exports PUBLIC_STOREFRONT_LANGUAGE_OPTIONS')
  return list as LanguageOption[]
}

check('the storefront offers exactly English and Khmer', () => {
  const values = offeredOptions().map((option) => option.value)
  assert.deepEqual([...values].sort(), ['en', 'km'])
})

check('Khmer is listed first and is the default', () => {
  assert.equal(offeredOptions()[0]?.value, 'km')
  assert.equal(languageOptions.PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
})

check('each option is labelled in its own script', () => {
  const labels = Object.fromEntries(offeredOptions().map((option) => [option.value, option.label]))
  assert.match(labels.km || '', /ភាសាខ្មែរ/)
  assert.equal(labels.en, 'English')
})

check('a language outside the list normalises to nothing', () => {
  const normalize = (languageOptions as Record<string, unknown>).normalizePortalLanguage as ((value: unknown) => string) | undefined
  assert.equal(typeof normalize, 'function', 'portalLanguageOptions exports normalizePortalLanguage')
  for (const retired of ['fr', 'zh-CN', 'nl', 'ta', 'original', '', null]) {
    assert.equal(normalize!(retired), '', `${String(retired)} is not a storefront language`)
  }
  assert.equal(normalize!('KM'), 'km')
  assert.equal(normalize!(' en '), 'en')
})

const catalogSource = (file: string) => read(`src/components/catalog/${file}`)
const OTHER_LANGUAGE_LISTS = /ALL_PUBLIC_TRANSLATE_OPTIONS|GOOGLE_TRANSLATE_FALLBACK_OPTIONS|FIRST_PARTY_TRANSLATE_LANG_OPTIONS|PUBLIC_STOREFRONT_TRANSLATE_OPTIONS|allPublicTranslateOptions/

check('the shared picker renders the options list itself', () => {
  assert.match(catalogSource('CatalogPreviewSurface.tsx'), /\{PUBLIC_STOREFRONT_LANGUAGE_OPTIONS\.map\(/)
})

for (const file of ['CatalogPreviewSurface.tsx', 'PublicCatalogPage.tsx', 'CatalogPage.tsx']) {
  check(`${file} hands the picker no other language list`, () => {
    assert.doesNotMatch(catalogSource(file), OTHER_LANGUAGE_LISTS)
  })
}

assert.deepEqual(failures, [], `EN/KM storefront languages:\n  ${failures.join('\n  ')}`)
console.log('PASS the storefront and its editor preview offer exactly Khmer (default) and English')
