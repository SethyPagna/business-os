import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewApprovalRefusalText } from '../src/api/branchRuleErrors.ts'

// N12: POST /review/:id/approve refuses self-approval and a reviewer without
// Full access to the request's section with two codes. Each must read in the
// user's language (both packs), keep the section placeholder working, and leave
// every other error alone.
const pack = (language: 'en' | 'km') => JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>

for (const language of ['en', 'km'] as const) {
  const strings = pack(language)
  const t = (key: string) => strings[key]
  assert.equal(reviewApprovalRefusalText('review_self_approval', 'fees', t), strings.review_self_approval, `${language} self-approval text`)
  const section = reviewApprovalRefusalText('review_section_full_required', 'fees', t) || ''
  assert.ok(section.length > 0 && !section.includes('{section}'), `${language} placeholder is filled`)
  assert.ok(section.includes(strings.fees || 'fees'), `${language} names the translated section`)
  assert.equal(reviewApprovalRefusalText('write_conflict', 'fees', t), null, 'other codes pass through')
  assert.equal(reviewApprovalRefusalText(undefined, 'fees', t), null)
}
// An untranslated pack still gets a readable sentence, never the bare key.
assert.match(reviewApprovalRefusalText('review_self_approval', 'fees', () => undefined) || '', /own request/)
assert.match(reviewApprovalRefusalText('review_section_full_required', 'products', () => undefined) || '', /Full access to products/)
console.log('PASS review approval refusals localise in EN and KM')
