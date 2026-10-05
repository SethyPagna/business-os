// G38 P0: the storefront FAQ a shop starts with must not promise reward
// points, a points balance or purchase history. Owner, 27 + 30 Sep 2026:
// membership stays visible, the points VALUE reads "coming soon", and
// customers are never shown points or past history. Starter item 3 used to
// say "review purchase history, returns, and current points" (en/km packs)
// and item 4 "Approved submissions can receive reward points". Also no
// "may" hedge (16 Sep public-copy rule) in the AI answer 19.
//
// Checks faqStarterText.ts, the en/km pack copies the Website Editor actually
// shows (pages.portalEditor.starterFaq), and that the storefront can show the
// new text in Khmer. Control: the retired wording must fail the same check.
//
// Run: node tests/faqStarterNoPointsPromise.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { FAQ_STARTER_TEXT, AI_FAQ_STARTER_TEXT } from '../src/components/catalog/faqStarterText.ts'
import { localizePortalFaqText } from '../src/components/catalog/portalContentI18n.ts'

const readPack = (lang: string) => JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as {
  pages: { portalEditor: { starterFaq: Record<string, { question: string; answer: string }> } }
}
const en = readPack('en').pages.portalEditor.starterFaq
const km = readPack('km').pages.portalEditor.starterFaq

const EN_PROMISE = /reward points|can receive|purchase history|current points|points balance|redeem|\bmay\b/i
const KM_PROMISE = /ប្រវត្តិទិញ|ពិន្ទុបច្ចុប្បន្ន|អាចទទួលបានពិន្ទុ|ពិន្ទុរង្វាន់/
const KM_COMING_SOON = 'នឹងមកដល់ឆាប់ៗនេះ'

function assertEnglishClean(where: string, text: string) {
  assert.doesNotMatch(text, EN_PROMISE, `${where} promises points/history or hedges: ${text}`)
  for (const sentence of text.split(/(?<=[.?!])\s+/)) {
    if (/\bpoints?\b/i.test(sentence)) assert.match(sentence, /coming soon/i, `${where}: a sentence about points must say they are coming soon: ${sentence}`)
  }
}
function assertKhmerClean(where: string, text: string) {
  assert.doesNotMatch(text, KM_PROMISE, `${where} promises points/history: ${text}`)
  for (const sentence of text.split('។')) {
    if (sentence.includes('ពិន្ទុ') && !sentence.includes('Share & Reward')) assert.ok(sentence.includes(KM_COMING_SOON), `${where}: a Khmer sentence about points must say coming soon: ${sentence}`)
  }
}

let passed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${(error as Error).message}`) }
}

check('faqStarterText: no item promises points, rewards or history, and none hedges', () => {
  for (const [index, question, answer] of [...FAQ_STARTER_TEXT, ...AI_FAQ_STARTER_TEXT]) assertEnglishClean(`starter ${index}`, `${question} ${answer}`)
})

check('the en/km packs the Website Editor shows carry the same clean text', () => {
  for (const [index, item] of Object.entries(en)) assertEnglishClean(`en.json starterFaq.${index}`, `${item.question} ${item.answer}`)
  for (const [index, item] of Object.entries(km)) assertKhmerClean(`km.json starterFaq.${index}`, `${item.question}។${item.answer}`)
  for (const index of ['3', '4', '19']) {
    const source = [...FAQ_STARTER_TEXT, ...AI_FAQ_STARTER_TEXT].find(([i]) => i === index)
    assert.ok(source, `starter ${index} exists`)
    assert.deepEqual([en[index].question, en[index].answer], [source[1], source[2]], `en.json starterFaq.${index} matches faqStarterText (the pack wins in the editor)`)
  }
})

check('the storefront shows the new starter text in Khmer', () => {
  for (const index of ['3', '4', '19']) {
    const source = [...FAQ_STARTER_TEXT, ...AI_FAQ_STARTER_TEXT].find(([i]) => i === index)!
    for (const text of [source[1], source[2]]) {
      const khmer = String(localizePortalFaqText(text, 'km'))
      assert.notEqual(khmer, text, `no Khmer for: ${text}`)
      assert.match(khmer, /[ក-៿]/)
    }
  }
})

check('control: the retired wording fails the same checks', () => {
  assert.throws(() => assertEnglishClean('old 3', 'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.'))
  assert.throws(() => assertEnglishClean('old 4', 'Approved submissions can receive reward points in your membership account.'))
  assert.throws(() => assertEnglishClean('old 19', 'so it may show a short list'))
  assert.throws(() => assertKhmerClean('old km 4', 'ការដាក់ស្នើដែលអនុម័តអាចទទួលបានពិន្ទុរង្វាន់ក្នុងគណនីសមាជិកភាព'))
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
