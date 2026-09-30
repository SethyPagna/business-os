import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { presentWriteError } from '../src/utils/writeErrorPresentation.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const translate = (pack: Record<string, string>) => (key: string) => pack[key] || key

const timeout = presentWriteError({ code: 'request_timeout', outcome: 'unknown', timeoutMs: 12_000 }, translate(en))
assert.equal(timeout.title, en.write_outcome_unknown_title)
assert.equal(timeout.detail, en.write_outcome_unknown_timeout.replace('{seconds}', '12'))
assert.equal(timeout.unknownOutcome, true)
assert.doesNotMatch(timeout.detail, /Request timed out after/)

const timeoutKhmer = presentWriteError({ code: 'request_timeout', outcome: 'unknown', timeoutMs: 12_000 }, translate(km))
assert.equal(timeoutKhmer.detail, km.write_outcome_unknown_timeout.replace('{seconds}', '12'))
assert.match(timeoutKhmer.detail, /[ក-៿]/)
assert.doesNotMatch(timeoutKhmer.detail, /Request timed out after/)

const stale = presentWriteError({ code: 'client_request_id_required' }, translate(en))
assert.equal(stale.detail, en.write_failed_app_out_of_date)
assert.equal(stale.unknownOutcome, false)

const rejectedKhmer = presentWriteError({ code: 'validation_failed' }, translate(km))
assert.equal(rejectedKhmer.detail, km.write_rejected_details)
assert.match(rejectedKhmer.detail, /[ក-៿]/)

const portalLanguage = presentWriteError({ code: 'invalid_portal_language' }, translate(en))
assert.equal(portalLanguage.title, en.write_rejected_title)
assert.equal(portalLanguage.detail, en.write_rejected_portal_language)
assert.match(portalLanguage.detail, /English or Khmer/)
const portalLanguageKhmer = presentWriteError({ code: 'invalid_portal_language' }, translate(km))
assert.equal(portalLanguageKhmer.detail, km.write_rejected_portal_language)
assert.match(portalLanguageKhmer.detail, /[ក-៿]/)
const settingsRouteSource = readFileSync(new URL('../../cloudflare/src/routes/settings.ts', import.meta.url), 'utf8')
assert.match(settingsRouteSource, /code: 'invalid_portal_language'/, 'the Worker still refuses a website language with the code this presenter translates')

for (const inheritedName of ['constructor', '__proto__', 'toString']) {
  assert.equal(presentWriteError({ code: inheritedName }, translate(en)).detail, en.write_rejected_details, inheritedName)
}

const unavailable = presentWriteError({ reason: 'server_unreachable' }, translate(en))
assert.equal(unavailable.detail, en.write_server_unavailable)

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appContextSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
assert.match(appSource, /presentWriteError\(error, t\)/, 'the global banner must use the shared presenter')
assert.match(appContextSource, /presentWriteError\(writeError, t\)/, 'the Settings save error toast must use the shared presenter')

console.log('write error presentation: all cases pass')
