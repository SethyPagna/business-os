'use strict'
// The leak crawl on the switch-back rule: lib/phoneAccess.ts with canSeeFullPhones replaced by holdsFullPhoneGrant, so the masking
// machinery stays covered while every signed-in session reads full numbers (owner, 12 Nov 2026). The assertions are the crawl's own.
process.env.PHONE_RULE = 'grant'
require('./test-phone-leak-crawl-native.cjs')
