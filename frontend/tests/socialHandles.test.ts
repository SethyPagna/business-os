import assert from 'node:assert/strict'
import {
  deriveSocialHandle,
  isDefaultSocialLabel,
  normalizeSocialLabel,
  resolveSocialDisplay,
  SOCIAL_DEFAULT_NAMES,
  type SocialPlatform,
} from '../src/utils/socialHandles.ts'
import { buildPortalContactChannels, buildPortalSocialLinks } from '../src/components/catalog/portalSocialLinks.ts'

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const text = (platform: SocialPlatform, href: string) => deriveSocialHandle(platform, href)?.text ?? null
const kind = (platform: SocialPlatform, href: string) => deriveSocialHandle(platform, href)?.kind ?? null

runCase('facebook: first segment is the @username on every host spelling; query, fragment and trailing slash are ignored', () => {
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com']) {
    assert.equal(text('facebook', `https://${host}/LeangCosmetics`), '@LeangCosmetics', host)
  }
  assert.equal(text('facebook', 'https://facebook.com/leang.cosmetics/'), '@leang.cosmetics', 'trailing slash')
  assert.equal(text('facebook', 'https://facebook.com/leang-cosmetics?mibextid=abc#x'), '@leang-cosmetics', '?mibextid and fragment')
  assert.equal(text('facebook', 'facebook.com/leangcosmetics'), '@leangcosmetics', 'schemeless')
  assert.equal(text('facebook', 'https://FACEBOOK.COM/LeangCosmetics'), '@LeangCosmetics', 'uppercase host, case of the handle kept')
  assert.equal(text('facebook', 'https://facebook.com/Leang%2ECosmetics'), '@Leang.Cosmetics', 'percent-encoded dot decodes')
  assert.equal(kind('facebook', 'https://facebook.com/x1'), 'username')
})

runCase('facebook: /pages/<Name>/<id> and /people/<Name>/<id> show the decoded name without @', () => {
  assert.deepEqual(deriveSocialHandle('facebook', 'https://facebook.com/pages/Leang-Cosmetics/123456'), { text: 'Leang Cosmetics', kind: 'name' })
  assert.deepEqual(deriveSocialHandle('facebook', 'https://www.facebook.com/people/Sok-Dara/100012345/'), { text: 'Sok Dara', kind: 'name' })
  assert.equal(text('facebook', 'https://facebook.com/pages/Leang%20Cosmetics/123'), 'Leang Cosmetics', 'percent-encoded space')
  assert.equal(text('facebook', 'https://facebook.com/pages/Leang-Cosmetics'), null, 'no id: not a page link')
  assert.equal(text('facebook', 'https://facebook.com/pages/category/Beauty/Leang-Cosmetics-123'), null, 'category listing')
})

runCase('facebook: links that name no account give no handle', () => {
  for (const href of [
    'https://facebook.com/profile.php?id=1', 'https://facebook.com/PROFILE.PHP?id=100012345',
    'https://facebook.com/share/xyz', 'https://facebook.com/share/1EuXg47WiG/', 'https://facebook.com/groups/somegroup',
    'https://facebook.com/events/123', 'https://facebook.com/watch', 'https://facebook.com/permalink.php?story_fbid=1',
    'https://facebook.com/photo.php?fbid=1', 'https://facebook.com/photos/123', 'https://facebook.com/marketplace',
    'https://facebook.com', 'https://facebook.com/', 'https://facebook.com/100012345', 'https://instagram.com/leang',
    'https://facebook.com/has space', '',
  ]) assert.equal(text('facebook', href), null, href)
})

runCase('messenger: m.me/<user> and a facebook page both give @user; numeric ids and empty give none', () => {
  assert.equal(text('messenger', 'https://m.me/leangcosmetics'), '@leangcosmetics')
  assert.equal(text('messenger', 'https://m.me/leangcosmetics/?ref=abc'), '@leangcosmetics')
  assert.equal(text('messenger', 'https://facebook.com/leangcosmetics'), '@leangcosmetics', 'derived from the page')
  assert.equal(text('messenger', 'https://m.me/100012345'), null)
  assert.equal(text('messenger', 'https://m.me/'), null)
  assert.equal(text('messenger', 'https://facebook.com/profile.php?id=1'), null)
  assert.equal(text('messenger', ''), null)
})

runCase('instagram: instagram.com, instagr.am and ig.me/m/<user>; reserved paths and the bare host give none', () => {
  assert.equal(text('instagram', 'https://instagram.com/leang.cosmetics'), '@leang.cosmetics')
  assert.equal(text('instagram', 'https://www.instagram.com/Leang_Cosmetics/'), '@Leang_Cosmetics')
  assert.equal(text('instagram', 'https://www.instagram.com/leangcosmetics/?igsh=MWl0YnVsd2Zm'), '@leangcosmetics', '?igsh=')
  assert.equal(text('instagram', 'https://instagr.am/leang'), '@leang')
  assert.equal(text('instagram', 'https://ig.me/m/leangcosmetics'), '@leangcosmetics')
  assert.equal(text('instagram', 'https://INSTAGRAM.COM/LeangCosmetics'), '@LeangCosmetics', 'uppercase')
  for (const href of [
    'https://instagram.com/p/ABC123', 'https://instagram.com/reel/ABC', 'https://instagram.com/stories/leang/1',
    'https://instagram.com/explore', 'https://instagram.com/accounts/login', 'https://instagram.com/', 'https://instagram.com',
    'https://instagram.com/' + 'a'.repeat(31), 'https://ig.me/m/', 'https://facebook.com/leang',
  ]) assert.equal(text('instagram', href), null, href)
})

runCase('telegram: t.me/<user> and t.me/s/<user>; ?direct is not shown; invites, joinchat, c/ and empty give none', () => {
  assert.equal(text('telegram', 'https://t.me/Leangcosmetic?direct'), '@Leangcosmetic', '?direct')
  assert.equal(text('telegram', 'https://t.me/Leangcosmetic'), '@Leangcosmetic')
  assert.equal(text('telegram', 'https://telegram.me/leang_shop/'), '@leang_shop')
  assert.equal(text('telegram', 'https://telegram.dog/leang_shop'), '@leang_shop')
  assert.equal(text('telegram', 'https://t.me/s/leang_channel'), '@leang_channel')
  assert.equal(text('telegram', 'https://T.ME/LeangShop'), '@LeangShop', 'uppercase')
  for (const href of [
    'https://t.me/+AbCdEf123', 'https://t.me/joinchat/AAAAAEx', 'https://t.me/c/123456/7', 'https://t.me/', 'https://t.me',
    'https://t.me/abc', 'https://t.me/' + 'a'.repeat(33), 'https://example.com/leang_shop', 'https://t.me/s/',
  ]) assert.equal(text('telegram', href), null, href)
})

runCase('whatsapp: wa.me and api.whatsapp.com/send?phone= show a formatted +number; groups and digit-less links give none', () => {
  assert.deepEqual(deriveSocialHandle('whatsapp', 'https://wa.me/85512345678'), { text: '+855 12 345 678', kind: 'phone' })
  assert.equal(text('whatsapp', 'https://wa.me/85512345678?text=Hello'), '+855 12 345 678')
  assert.equal(text('whatsapp', 'https://api.whatsapp.com/send?phone=85512345678&text=hi'), '+855 12 345 678')
  assert.equal(text('whatsapp', 'https://api.whatsapp.com/send/?phone=%2B85512345678'), '+855 12 345 678', 'percent-encoded +')
  assert.equal(text('whatsapp', 'https://wa.me/15551234567'), '+155 512 345 67', 'other countries are grouped, not truncated')
  for (const href of ['https://wa.me/', 'https://wa.me', 'https://chat.whatsapp.com/AbCdEf', 'https://wa.me/message/XYZ', 'https://api.whatsapp.com/send', 'https://wa.me/123', '']) {
    assert.equal(text('whatsapp', href), null, href)
  }
})

runCase('phone: tel: shows the formatted number with or without spaces, with or without + on 855', () => {
  assert.deepEqual(deriveSocialHandle('phone', 'tel:+85512345678'), { text: '+855 12 345 678', kind: 'phone' })
  assert.equal(text('phone', 'tel:+855 12 345 678'), '+855 12 345 678', 'spaces')
  assert.equal(text('phone', 'tel:+855%2012%20345%20678'), '+855 12 345 678', 'percent-encoded spaces')
  assert.equal(text('phone', 'tel:85512345678'), '+855 12 345 678', '855 without +')
  assert.equal(text('phone', 'tel:012345678'), '012 345 678', 'local number')
  assert.equal(text('phone', '012 345 678'), '012 345 678', 'a bare number')
  assert.equal(text('phone', 'tel:+855 (12) 345-678'), '+855 12 345 678', 'punctuation')
  for (const href of ['tel:12345', 'tel:', 'tel:abc', 'mailto:a@b.com', '']) assert.equal(text('phone', href), null, href)
})

runCase('website: host without www plus a short path; a long path, bare host, invalid or non-http link', () => {
  assert.deepEqual(deriveSocialHandle('website', 'https://www.leangcosmetics.com/'), { text: 'leangcosmetics.com', kind: 'domain' })
  assert.equal(text('website', 'https://leangcosmetics.com'), 'leangcosmetics.com')
  assert.equal(text('website', 'https://www.example.com/shop/'), 'example.com/shop', 'trailing slash')
  assert.equal(text('website', 'https://example.com/shop?utm_source=x#top'), 'example.com/shop', 'query and fragment')
  assert.equal(text('website', 'example.com/shop'), 'example.com/shop', 'schemeless')
  assert.equal(text('website', 'https://example.com/' + 'a'.repeat(30)), 'example.com', 'deep path over 32 characters falls back to the host')
  assert.equal(text('website', 'https://example.com/' + 'a'.repeat(12)), 'example.com/' + 'a'.repeat(12), '24 characters keeps the path')
  assert.equal(text('website', 'https://example.com/' + 'a'.repeat(20)), 'example.com/' + 'a'.repeat(20), 'exactly 32 keeps the path')
  assert.equal(text('website', 'https://example.com/' + 'a'.repeat(21)), 'example.com', '33 falls back')
  for (const href of ['javascript:alert(1)', 'mailto:a@b.com', 'https://localhost', 'not a url', '']) assert.equal(text('website', href), null, href)
})

runCase('tiktok: tiktok.com/@user only', () => {
  assert.equal(text('tiktok', 'https://www.tiktok.com/@leang.cosmetics'), '@leang.cosmetics')
  assert.equal(text('tiktok', 'https://www.tiktok.com/@leang_shop?lang=en'), '@leang_shop')
  assert.equal(text('tiktok', 'https://tiktok.com/%40leang'), '@leang', 'encoded @')
  for (const href of ['https://vm.tiktok.com/ZMabc/', 'https://www.tiktok.com/', 'https://www.tiktok.com/discover', 'https://example.com/@leang']) {
    assert.equal(text('tiktok', href), null, href)
  }
})

const FB = 'https://facebook.com/leangcosmetics'

runCase('discriminating pair: a default-name label is unset (handle shows), a real custom label wins', () => {
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'facebook ', href: FB }).visibleText, '@leangcosmetics', "label 'facebook ' (trailing space, lowercase) is the default")
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Facebook', href: FB }).visibleText, '@leangcosmetics')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Leang Official', href: FB }).visibleText, 'Leang Official')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: '', href: FB }).visibleText, '@leangcosmetics')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: FB }).visibleText, '@leangcosmetics', 'label omitted')
})

runCase('every default name of every platform counts as unset, case-insensitively, and nothing else does', () => {
  for (const [platform, names] of Object.entries(SOCIAL_DEFAULT_NAMES) as Array<[SocialPlatform, readonly string[]]>) {
    for (const name of names) {
      assert.ok(isDefaultSocialLabel(platform, name), `${platform}: ${name}`)
      assert.ok(isDefaultSocialLabel(platform, `  ${name.toUpperCase()}​ `), `${platform}: ${name} upper + ZWSP`)
    }
    assert.ok(!isDefaultSocialLabel(platform, 'Leang Official'), platform)
  }
  assert.ok(!isDefaultSocialLabel('facebook', 'Instagram'), 'another platform name is a real label here')
  assert.ok(isDefaultSocialLabel('website', 'Web') && isDefaultSocialLabel('phone', 'Call') && isDefaultSocialLabel('phone', 'Phone'))
})

runCase('Khmer: a default name is unset, a custom label is kept, ZWSP is stripped and spaces collapse', () => {
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'ហ្វេសប៊ុក', href: FB, language: 'km' }).visibleText, '@leangcosmetics')
  assert.equal(resolveSocialDisplay({ platform: 'instagram', customLabel: 'អ៊ីនស្តាក្រាម', href: 'https://instagram.com/leang', language: 'km' }).visibleText, '@leang')
  assert.equal(resolveSocialDisplay({ platform: 'instagram', customLabel: 'អ៊ីនស្ដាក្រាម', href: 'https://instagram.com/leang', language: 'km' }).visibleText, '@leang', 'second spelling')
  assert.equal(resolveSocialDisplay({ platform: 'website', customLabel: 'គេហទំព័រ', href: 'https://leang.com', language: 'km' }).visibleText, 'leang.com')
  assert.equal(resolveSocialDisplay({ platform: 'phone', customLabel: 'ហៅទូរស័ព្ទ', href: 'tel:012345678', language: 'km' }).visibleText, '012 345 678')
  const custom = resolveSocialDisplay({ platform: 'facebook', customLabel: 'ហាងលាងគ្រឿងសំអាង', href: FB, language: 'km' })
  assert.equal(custom.visibleText, 'ហាងលាងគ្រឿងសំអាង')
  assert.equal(custom.latin, false)
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'ហាង​លាង  ក្រែម', href: FB }).visibleText, 'ហាងលាង ក្រែម', 'ZWSP removed, spaces collapsed')
  assert.equal(normalizeSocialLabel('﻿ Leang​  Official\n'), 'Leang Official')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Face​book', href: FB }).visibleText, '@leangcosmetics', 'ZWSP inside a default name')
})

runCase('fallback: no handle -> the localized platform name (Latin brands stay Latin in Khmer)', () => {
  const profile = 'https://facebook.com/profile.php?id=1'
  assert.deepEqual(resolveSocialDisplay({ platform: 'facebook', href: profile, language: 'km' }), { visibleText: 'Facebook', accessibleName: 'Facebook', latin: true, kind: 'platform' })
  assert.equal(resolveSocialDisplay({ platform: 'website', href: '', language: 'km' }).visibleText, 'គេហទំព័រ')
  assert.equal(resolveSocialDisplay({ platform: 'website', href: '', language: 'km' }).latin, false)
  assert.equal(resolveSocialDisplay({ platform: 'phone', href: 'tel:123', language: 'en' }).visibleText, 'Call')
  assert.equal(resolveSocialDisplay({ platform: 'phone', href: 'tel:123', language: 'km' }).visibleText, 'ហៅទូរស័ព្ទ')
  assert.equal(resolveSocialDisplay({ platform: 'whatsapp', href: 'https://chat.whatsapp.com/x', language: 'km' }).visibleText, 'WhatsApp')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Leang Official', href: profile }).visibleText, 'Leang Official', 'a custom label needs no handle')
})

runCase('accessible name: "<Platform>: <visible>", or the platform alone when the visible text is the platform name', () => {
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: FB }).accessibleName, 'Facebook: @leangcosmetics')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: FB, language: 'km' }).accessibleName, 'Facebook: @leangcosmetics', 'brand stays Latin in Khmer')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Leang Official', href: FB }).accessibleName, 'Facebook: Leang Official')
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: 'https://facebook.com/share/x' }).accessibleName, 'Facebook')
  assert.equal(resolveSocialDisplay({ platform: 'website', href: 'https://leang.com/shop', language: 'km' }).accessibleName, 'គេហទំព័រ: leang.com/shop')
  assert.equal(resolveSocialDisplay({ platform: 'whatsapp', href: 'https://wa.me/85512345678' }).accessibleName, 'WhatsApp: +855 12 345 678')
  assert.equal(resolveSocialDisplay({ platform: 'phone', href: 'tel:012345678' }).accessibleName, 'Call: 012 345 678')
  // A handle that merely contains the brand is still a handle: it must not be swallowed.
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: 'https://facebook.com/facebookshop' }).accessibleName, 'Facebook: @facebookshop')
})

runCase('latin flag: handles, numbers and domains are Latin; a custom label is not; a Khmer page name is not', () => {
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: FB }).latin, true)
  assert.equal(resolveSocialDisplay({ platform: 'phone', href: 'tel:012345678' }).latin, true)
  assert.equal(resolveSocialDisplay({ platform: 'facebook', customLabel: 'Leang Official', href: FB }).latin, false)
  assert.equal(resolveSocialDisplay({ platform: 'facebook', href: 'https://facebook.com/pages/ហាង-លាង/123' }).latin, false)
  assert.deepEqual(['username', 'phone', 'domain', 'name', 'label', 'platform'], [
    resolveSocialDisplay({ platform: 'facebook', href: FB }).kind,
    resolveSocialDisplay({ platform: 'phone', href: 'tel:012345678' }).kind,
    resolveSocialDisplay({ platform: 'website', href: 'https://a.com' }).kind,
    resolveSocialDisplay({ platform: 'facebook', href: 'https://facebook.com/pages/A-B/1' }).kind,
    resolveSocialDisplay({ platform: 'facebook', customLabel: 'X', href: FB }).kind,
    resolveSocialDisplay({ platform: 'facebook', href: '' }).kind,
  ])
})

runCase("builder: today's single-link settings (string links + linkLabels + showX) work unchanged", () => {
  const groups = buildPortalSocialLinks({
    links: { website: 'www.leang.com', facebook: 'facebook.com/leangcosmetics', instagram: 'instagram.com/leang', telegram: '@leangshop' },
    labels: { website: 'Website', facebook: 'Facebook', instagram: 'Leang on IG', telegram: 'Telegram' },
    show: { website: true, facebook: true, instagram: true, telegram: true },
    language: 'en',
  })
  assert.deepEqual(groups.map((g) => g.platform), ['website', 'facebook', 'instagram', 'telegram'])
  assert.deepEqual(groups.map((g) => g.links.length), [1, 1, 1, 1])
  const flat = groups.flatMap((g) => g.links)
  assert.deepEqual(flat.map((l) => l.href), ['https://www.leang.com', 'https://facebook.com/leangcosmetics', 'https://instagram.com/leang', 'https://t.me/leangshop'])
  assert.deepEqual(flat.map((l) => l.visibleText), ['leang.com', '@leangcosmetics', 'Leang on IG', '@leangshop'])
  assert.deepEqual(flat.map((l) => l.accessibleName), ['Website: leang.com', 'Facebook: @leangcosmetics', 'Instagram: Leang on IG', 'Telegram: @leangshop'])
  assert.deepEqual(Object.keys(flat[0]).sort(), ['accessibleName', 'href', 'kind', 'latin', 'platform', 'visibleText'])
})

runCase('builder: hidden platforms and unusable links are dropped; omitting show shows everything', () => {
  const links = { website: 'www.leang.com', facebook: 'not a link', instagram: 'instagram.com/leang', telegram: '' }
  assert.deepEqual(buildPortalSocialLinks({ links, show: { website: true, facebook: true, instagram: false } }).map((g) => g.platform), ['website'])
  assert.deepEqual(buildPortalSocialLinks({ links }).map((g) => g.platform), ['website', 'instagram'])
  assert.deepEqual(buildPortalSocialLinks({}), [])
  assert.deepEqual(buildPortalSocialLinks({ links: { website: 'javascript:alert(1)' } }), [])
})

runCase('builder: several accounts per platform keep their order, de-duplicate identical hrefs, and carry their own labels', () => {
  const groups = buildPortalSocialLinks({
    links: {
      facebook: [
        'facebook.com/leangcosmetics',
        { href: 'https://facebook.com/leang.wholesale', customLabel: 'Wholesale' },
        'https://facebook.com/leangcosmetics',
        { href: 'facebook.com/leangcosmetics', customLabel: 'Duplicate with label' },
        { href: 'https://facebook.com/leang.kh', customLabel: 'facebook' },
        '',
        'nonsense',
      ],
      telegram: [{ href: 'https://t.me/leang_a?direct' }, { href: '@leang_b' }],
    },
    labels: { facebook: 'Ignored: more than one account', telegram: 'Telegram' },
    language: 'en',
  })
  const fb = groups.find((g) => g.platform === 'facebook')!
  assert.deepEqual(fb.links.map((l) => l.href), ['https://facebook.com/leangcosmetics', 'https://facebook.com/leang.wholesale', 'https://facebook.com/leang.kh'])
  assert.deepEqual(fb.links.map((l) => l.visibleText), ['@leangcosmetics', 'Wholesale', '@leang.kh'])
  const tg = groups.find((g) => g.platform === 'telegram')!
  assert.deepEqual(tg.links.map((l) => l.href), ['https://t.me/leang_a?direct', 'https://t.me/leang_b'])
  assert.deepEqual(tg.links.map((l) => l.visibleText), ['@leang_a', '@leang_b'])
})

runCase('builder: the legacy single label applies only to a single account, and an explicit empty customLabel beats it', () => {
  const single = buildPortalSocialLinks({ links: { facebook: [FB] }, labels: { facebook: 'Leang Official' } })
  assert.equal(single[0].links[0].visibleText, 'Leang Official')
  const two = buildPortalSocialLinks({ links: { facebook: [FB, 'facebook.com/leang2'] }, labels: { facebook: 'Leang Official' } })
  assert.deepEqual(two[0].links.map((l) => l.visibleText), ['@leangcosmetics', '@leang2'])
  const explicit = buildPortalSocialLinks({ links: { facebook: { href: FB, customLabel: '' } }, labels: { facebook: 'Leang Official' } })
  assert.equal(explicit[0].links[0].visibleText, '@leangcosmetics')
})

runCase('builder: Khmer language only changes fallback names; handles and brand names stay as they are', () => {
  const groups = buildPortalSocialLinks({ links: { website: 'https://leang.com', facebook: 'https://facebook.com/profile.php?id=1' }, language: 'km' })
  assert.deepEqual(groups.flatMap((g) => g.links.map((l) => l.visibleText)), ['leang.com', 'Facebook'])
  assert.deepEqual(groups.flatMap((g) => g.links.map((l) => l.accessibleName)), ['គេហទំព័រ: leang.com', 'Facebook'])
})

runCase('builder: tiktok is supported (bare @handle or URL) and sits after instagram', () => {
  const groups = buildPortalSocialLinks({ links: { instagram: 'instagram.com/leang', tiktok: '@leang.shop', website: 'leang.com' } })
  assert.deepEqual(groups.map((g) => g.platform), ['website', 'instagram', 'tiktok'])
  assert.equal(groups[2].links[0].href, 'https://www.tiktok.com/@leang.shop')
  assert.equal(groups[2].links[0].visibleText, '@leang.shop')
  assert.equal(groups[2].links[0].accessibleName, 'TikTok: @leang.shop')
})

runCase('contact channels: explicit values first, social-link fallbacks when empty, shown flags respected, channel order fixed', () => {
  const groups = buildPortalContactChannels({
    contactLinks: { whatsapp: '+855 12 345 678', phone: '012 345 678', telegram: '' },
    contactLabels: { whatsapp: 'WhatsApp', phone: '', messenger: 'Messenger' },
    showContact: { messenger: true, telegram: true, whatsapp: true, phone: true, instagram: true },
    links: { facebook: 'facebook.com/leangcosmetics', telegram: '@leangshop', instagram: 'instagram.com/leang' },
    show: { facebook: true, telegram: true, instagram: true },
    language: 'en',
  })
  assert.deepEqual(groups.map((g) => g.platform), ['messenger', 'telegram', 'whatsapp', 'phone', 'instagram'])
  const flat = groups.flatMap((g) => g.links)
  assert.deepEqual(flat.map((l) => l.href), ['https://m.me/leangcosmetics', 'https://t.me/leangshop', 'https://wa.me/85512345678', 'tel:012345678', 'https://ig.me/m/leang'])
  assert.deepEqual(flat.map((l) => l.visibleText), ['@leangcosmetics', '@leangshop', '+855 12 345 678', '012 345 678', '@leang'])
  assert.deepEqual(flat.map((l) => l.accessibleName), ['Messenger: @leangcosmetics', 'Telegram: @leangshop', 'WhatsApp: +855 12 345 678', 'Call: 012 345 678', 'Instagram: @leang'])
})

runCase('contact channels: fallbacks are skipped when the social link is hidden; an explicit value beats the fallback', () => {
  const hidden = buildPortalContactChannels({
    showContact: { messenger: true, telegram: true, instagram: true },
    links: { facebook: 'facebook.com/leangcosmetics', telegram: '@leangshop', instagram: 'instagram.com/leang' },
    show: { facebook: false, telegram: false, instagram: false },
  })
  assert.deepEqual(hidden, [])
  const explicit = buildPortalContactChannels({
    contactLinks: { messenger: 'support.leang', telegram: [{ href: 't.me/leang_sales', customLabel: 'Sales' }, 't.me/leang_support'] },
    showContact: { messenger: true, telegram: true },
    links: { facebook: 'facebook.com/other', telegram: '@other_one' },
    show: { facebook: true, telegram: true },
  })
  assert.deepEqual(explicit[0].links.map((l) => l.href), ['https://m.me/support.leang'])
  assert.deepEqual(explicit[1].links.map((l) => l.href), ['https://t.me/leang_sales', 'https://t.me/leang_support'])
  assert.deepEqual(explicit[1].links.map((l) => l.visibleText), ['Sales', '@leang_support'])
  assert.deepEqual(buildPortalContactChannels({ contactLinks: { whatsapp: 'https://chat.whatsapp.com/AbC' }, showContact: { whatsapp: true } }), [], 'a group link has no number, so deriveWhatsappLink drops it and no button is built')
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS social handles: icon + real handle for every platform, label precedence, accessible names and multi-account builders')
