import assert from 'node:assert/strict'
import { resolvePublicAssetUrl } from '../src/utils/publicAssetUrls.ts'
import { canonicalizePersistedMediaPath, buildCacheBustedMediaPath } from '../src/utils/mediaUpload.ts'

const base = 'https://shop.fixture'
for (const raw of ['/uploads/A#shade-1.jpg', '/uploads/literal%20name.jpg', '/uploads/literal%2520name.jpg', '/uploads/100% Pure.jpg', '/uploads/a space.jpg', '/uploads/ក្រែម ខ្មែរ.jpg']) {
  assert.equal(canonicalizePersistedMediaPath(raw), raw, 'stored/deletion reference must remain exact raw identity')
  const rendered = resolvePublicAssetUrl(raw, { publicAssetBaseUrl: base, assetVersion: 'build' })
  const parsed = new URL(rendered)
  assert.equal(parsed.hash, '', 'a raw basename must never become a browser fragment')
  assert.equal(decodeURIComponent(parsed.pathname), raw, 'Worker exactly-once decode must select exact original identity')
  assert.equal(parsed.searchParams.get('v'), 'build')
  const cached = new URL(buildCacheBustedMediaPath(raw, 'upload'), base)
  assert.equal(decodeURIComponent(cached.pathname), raw, 'cache version must not reinterpret raw identity')
  assert.equal(cached.searchParams.get('v'), 'upload')
}
assert.equal(canonicalizePersistedMediaPath('/uploads/logo.png?v=abc#preview'), '/uploads/logo.png')
assert.equal(canonicalizePersistedMediaPath('uploads/logo.png?updated=1'), '/uploads/logo.png')
assert.equal(resolvePublicAssetUrl('/uploads/logo.png?old=1', { publicAssetBaseUrl: base, assetVersion: 'new' }), `${base}/uploads/logo.png?old=1&v=new`)
for (const remote of ['https://cdn.fixture/uploads/name%20a.jpg?token=keep#preview', 'https://cdn.fixture/uploads/literal%2520.jpg?sig=abc']) {
  assert.equal(resolvePublicAssetUrl(remote), remote, 'absolute/signed URL remains untouched')
  assert.equal(canonicalizePersistedMediaPath(remote), remote, 'absolute identity remains untouched')
}
assert.equal(resolvePublicAssetUrl('data:image/png;base64,AA'), 'data:image/png;base64,AA')
assert.equal(resolvePublicAssetUrl('blob:https://fixture/id'), 'blob:https://fixture/id')
console.log('PASS local raw upload identity renders exactly once; versions and absolute URLs preserved')
