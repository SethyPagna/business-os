import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier, isAdminControlUser } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import type { UndoApplierContext, UndoApplierOutcome } from './undoAppliers'

export const CUSTOMER_GENDER_RESTORATION_KIND = 'customer.gender_restore'
export const GENDER_RESTORATION_MAX_BYTES = 192_000
const BEFORE_FIELDS = ['name', 'phone', 'phone_normalized', 'membership_number', 'is_anonymous', 'address', 'updated_at', 'gender'] as const
const GLOBAL_FIELDS = ['id', 'name', 'phone', 'phone_normalized', 'address', 'is_anonymous'] as const
type Before = Record<Exclude<typeof BEFORE_FIELDS[number], 'is_anonymous'>, string | null> & { is_anonymous: number | null }
export type GenderRestoreRow = { id: number; to_gender: 'female' | 'male'; before: Before; match: { kind: 'unique_phone' | 'name_phone' | 'name_address'; key: string } }
export type GenderRestoreManifest = { version: 1; campaign_id: string; chunk_index: number; chunk_digest: string; rows: GenderRestoreRow[] }
export type GenderRestoreApproval = { campaign_id: string; total_count: number; source_sha256: string; chunk_digests: readonly string[] }
// PII-free server approval. Only these exact evidence-backed chunks can run.
export const APPROVED_GENDER_RESTORATION: GenderRestoreApproval = {
  campaign_id: 'customer-gender-source-20260912-v1', total_count: 4162,
  source_sha256: 'a2061f6685bb56f4e00076f7a89030ad5919bb5d80caeee472e8563182e1a63c',
  chunk_digests: [
    'sha256-be63ed8af6c0231475587650858980ab41a3c86b031aec8ba7774480c38cb944',
    'sha256-3d70d600acbfd98daf66fc07438b7daa0287877ce8d42f933bfb6e2a3f49458c',
    'sha256-810350ecfeb321a503201955693701ea9497d134d89cf2db55e3ec7a18b36074',
    'sha256-4be59024d7727f7fd1e43642e52d6570be707a0122d1978c66d39a5d64abf386',
    'sha256-259d119a91dff688f28ce1db09fd3048f3bf15dd5d230848cdb5206da3960df2',
    'sha256-a57c55ba726e4c302e51b164a1c69c8b0c5f92c1a73c03aad47eef66afb560a1',
    'sha256-3d975b8bb1b7d3354b11565d3089b322a4fb7126c1943b8d5a8872df237d0b8a',
    'sha256-dd5c1175364de0676a32b14ad4955f2d021a0066632d291e144234f033ab9c5e',
    'sha256-663af8e6e4576d52142f76c4821035097ba03ffe43218d42762537cac25d0a34',
    'sha256-694973aae34bb53a95f6dc06d95becd4b7356c97edd15f2d0f109d425bc947cf',
    'sha256-78a8d7b81ee0e1465c01cb791b31c639d6ffdb931702fe1fea3d1c63017993ca',
    'sha256-5217b57594f9c6e659d5d3f81ef3a5665fede667229ed9747d21f04dff26e72f',
    'sha256-7cbc621eb815a6f090410e008f140021420d2baca5278677fd4bcf1efb43dc5a',
    'sha256-47f990e8923e6c03a8a6a6103c273e9971f93a98c0843af4c9ffddbfe05a3917',
    'sha256-c95797d8d3c77ca91ca1c1228da73ffdd109785ebaeba059fc1530da4f89089c',
    'sha256-c8506fde21d4687ef434c1d96c59bde7e5a2bd61b1b22f29652060cad0807516',
    'sha256-d20fcb7394697d852c80d6cb091fc8d68f476932f3cf8589da62fb5580420d05',
    'sha256-3281c4505e3dd4f1044091f975e22f60febb90c4cfdedd5a5241171cafe56b01',
    'sha256-1f319b8075da7d16c6f8834e05102bc276d7ce4921ecd927eb27333a789d77a4',
    'sha256-f59d94d8ede1c03eff222579e453f99d1ce727a47421452097eb57a0913e3e71',
    'sha256-99bc635684da0780a539aadac5784018bd18049ea221a2aef5e15aaf4651c33b',
    'sha256-c5a75b2eedbb3d9ad566d8f25f742b33e13050799709ac5bec626ae25352a03e',
    'sha256-78b4f211b91aeba411a16c49e3286d74d97c22bb68c085298bd5cfdad063fa6b',
    'sha256-6ad4a019c75b0aebfc8638b79af2d076f9dde1ca1e433fbca7a13b955751bb4c',
    'sha256-3ca0b2fdb14cb9fe7f90eee0b7e29f67b2ae27a6d299dc7301119ae969f601fa',
    'sha256-641f2f6e0df7c59802f06d983ddd1de2a8fc6582cc62994c6bdba9527c442681',
    'sha256-142faa154377f71d8f19216d5c0a0b159b6da63d9b483cf2e19206253a9bdf74',
    'sha256-17eb353e70069416bee3ba3fa2dc5d9b81bd099a977bed3300335ef6b9410be0',
    'sha256-1e8901d2487e00f3462caa1262588c7c986aded4929e9ccc04bb18a43733c202',
    'sha256-e32d5dfd72d5f568a4c5e368f1e5ef3492868e6c92908b65271462c688818718',
    'sha256-e6e31e5cdaaf3e5c603e35a4e9043e73f9e28939000cbb4dcc529ce617c55f9f',
    'sha256-998fe222d4f4c595fba30a591728473d4db38df437382a8cd24430877de5144c',
    'sha256-6d59bb2475053b624f15f46bf1ad713c9c5d13fcf0449ccae8885da7260f5041',
    'sha256-4da7b7974034f630175362f692a1450ae43e111bab5b9dd8836d8d0ecba5f470',
    'sha256-ff975aa0f9b8dfaa2bb52bb7f5daebfc811886b2722f037ce7de3c269f55aac3',
    'sha256-2bfdd4eb7d3141b62d934fbe7cc26837f4a57069506194f778595402f0e5856c',
    'sha256-0cabc9c7f5ca1b85167663045149224e1fdaefdb6206222dadfa6e19030a9c59',
    'sha256-eca3ebf24124da11836c514e200e8c9400c0d9716e4b922684921acbe5642b29',
    'sha256-2c8238e002ed0652b15cb575e642b4f8a0bfdb1fe5e4f322794dd878e6f8a3b2',
    'sha256-7be0500d3eccd6c2221119691c31a1189927f0e19045f17c41e5d159648c1866',
    'sha256-76f007c5ea74bb398d422ff2fe0f64d2856c5c3b9ca8050e012845be97146651',
    'sha256-34b100dec6989aca1dc94075784973d8c19875d41ff4ca8a2221f606a596a8d2',
    'sha256-7afd0fa689768241a6e6c51fcad57b0de1b20c3772886f0c85332ab5eeb284f7',
    'sha256-970d7fd117efec0ad9b3e76bddaaa27f55cf6cf9766d54c286ed1e9d5088abc5',
    'sha256-3c5e58dd3e1fec7174646d607bb692cae3f139feced8edc8dd42c0f177455c36',
    'sha256-67d8b822ba4440aba1c05763cdb2785139d0422432942784af297efec68541fa',
    'sha256-f36498a3d576a3db9cffb8bb1c503b10c35b7233b9cd9edc32404118fb184636',
    'sha256-bd520b4019ffb6fb17da6ce317fb23e0c863d3bd5d458a8bde07d4cf3b906dc1',
    'sha256-86253cbeb23d5a7f95e4249499596de70e37ec11a8775180f2ad6b02185aca6c',
    'sha256-161e2db2e49028002d3ea304ca9d0e50b9600339387de3dcf62d7c85fab6f523',
    'sha256-d7ebdea1551ba3ae3b4cda86e9ee6a1339c677640a4343bf826204a6c5dcd64e',
    'sha256-6bab862810f6bec2a4e1432a2bd4f8dad035d0fc6a09d4dbd174404703faa6dc',
    'sha256-0366efcee9c99cbf65cb5e9594f18ab06204009415a31e452740012dfa773c70',
    'sha256-f9a4ba78dd2162b5ed33f9adbe56596852fab9d2f9a5e04138c88abc464c37af',
    'sha256-057821cc3ef207841127d724cdc4b5d36168fdfe1c1af497b9166cd0eeb054e4',
    'sha256-a2ed1fbb124a1911974fb11092a36068dc77549794c8848e9a018941ea11d28a',
    'sha256-d29d65d1b443a1b1095f6740cdb414bcce456dd2a93c750f23bbf6b74af38a53',
    'sha256-89db1a2360d5c29608f95c9620f92fb6734213a33bd776fd99a6125f429a90c4',
    'sha256-dcf29b71501c8376323f4bd047e28ef524fbf57156e2f7aee943253d9331f1b1',
    'sha256-9460e07059e2d0e841cb9aeb1321242937d0c3a41a92119f9531e40cc7216f77',
    'sha256-27cb368b7545cd3352316e73553ff259150eb0f342ad3f1dd824d022e466b87e',
    'sha256-d3e5e7f6a30ca2acc7c1d86c6ebef5d750d0cf4935323f0be7fdd01255afb2c7',
    'sha256-6d3d3a2c87768c5884fb6ad90bcf8350454e1fdb9ba715e656ea28e5b3074d5b',
    'sha256-32b3291ecc6997d281000484eaafe0970afbc0f3eb6aa4d485ae5314428921d1',
    'sha256-32635cf3792986dc6045ae07e1a90dd559cf7b8128a37024560cbe6fc23adb16',
    'sha256-0fcb5fb73b158c224db191a14fdbe055d59a5bd3164e1b6ba80255cd695bbcc6',
    'sha256-ee656e5d9be279022973a44011395793adee036b48e43704ffa49ef09e48f537',
    'sha256-5dce64eadc4ee166f8e41307d4f3277eecc3e497755ed2ae8010c011e03b41a5',
    'sha256-bb5629944b0fe04badd4a35d000bf3cba8101938651573f756ea225106ebfb0f',
    'sha256-badc64ddd89245af769fe3daa7f5a6b7c6a1af189480f4de8055911d19db2688',
    'sha256-e91b4ac1e9354a96697f6450b4fe1984a50669f93293f93c8574482b8bfdd167',
    'sha256-9262847c67103fc4e9bbf803c8b903e7b2ed2c0ec5fe967ab29d4f1ac410d834',
    'sha256-3c82a628d143642f5d04a48c26d6eea32136dfcd673822476259a583ff05d9f5',
    'sha256-03f8a04e7785a9d25ba3601004d4b1293ab25cb467592ea6e543693142cfd755',
    'sha256-4543a2cdb359fd2f447f2a2cd9daa6f6bd3ce49b7d283430b11c6b9b1e47bd2c',
    'sha256-010047843244ca9bbe126a41c98ea5ed77ccf8c6e73b9e1fb1ab28a7979c1eee',
    'sha256-51ad09cbb731b0839af594c3a4c98e56c8ed8834d1994bdccfaa3ee9c5b7b2f6',
    'sha256-b15b9100f557507a1d0ab524f383e91e9926172b4fbb89f1d331516cb43f0936',
    'sha256-290af62a9ec88e61a1e448f6a799c184a5e424cd9dcb7ab1ba371a5b6e428a24',
    'sha256-c4efe2acf0e073665b9a724aa79c331974e01a295e94038303bf61224243b321',
    'sha256-fa77c2d33b9b140667e88fb97e5d1c94039808e25d401e6d4846b518fc866342',
    'sha256-9a6fbe7993b0025b006522f690c35ef118ecaff53c15d62dc66d9c3af8b24ff3',
    'sha256-0ee1b85b58476985da9645c37b4fea199df2b7b610e1b23327fab6bc1e81c4d9',
    'sha256-bef4fadafecc227be42c3019461d4989ad184c4affb9779787828cf04f6a7c4a',
  ],
}
type Statement = { sql: string; params: Record<string, unknown> }
type Live = Before & { id: number }
type Stored = { version: 1; operation_id: string; manifest: GenderRestoreManifest; generation: number; history_id?: number; last_direction?: 'undo' | 'redo'; last_expected_generation?: number }
type SnapshotRow = { id: number; kind: string; status: string; payload_json: string; created_by_id: number }
export class GenderRestorationError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message) }
}
function fail(message: string, status = 409): never { throw new GenderRestorationError(message, status) }
export function canRestoreCustomerGender(user: SessionUser | null | undefined): boolean {
  return !!user && Number.isSafeInteger(user.id) && isAdminControlUser(user) && getActionTier(user, 'contacts', 'edit') === 'full'
}
const authorize = (user: SessionUser | null | undefined): SessionUser => canRestoreCustomerGender(user) ? user! : fail('Administrator Contacts edit permission is required.', 403)
const norm = (value: unknown) => String(value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase()
const phone = (value: unknown) => { const s = String(value ?? '').replace(/[^0-9]/g, ''); return s.startsWith('855') ? `0${s.slice(3)}` : s }
const general = (row: Live | GenderRestoreRow['before'], id?: number) => Number(row.is_anonymous || 0) !== 0 || norm(row.name) === 'general' || id === 24969 || id === 22305
function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('Invalid restoration manifest shape.', 400)
}
export function canonicalGenderJson(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v
  return JSON.stringify(sorted(value))
}
export async function genderManifestDigest(value: Omit<GenderRestoreManifest, 'chunk_digest'>): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalGenderJson(value)))
  return `sha256-${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`
}
export async function parseGenderManifest(raw: unknown, approval = APPROVED_GENDER_RESTORATION): Promise<GenderRestoreManifest> {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > GENDER_RESTORATION_MAX_BYTES) fail('Restoration chunk is too large.', 413)
  exactKeys(raw, ['version', 'campaign_id', 'chunk_index', 'chunk_digest', 'rows'])
  if (raw.version !== 1 || raw.campaign_id !== approval.campaign_id || !Number.isSafeInteger(raw.chunk_index) || Number(raw.chunk_index) < 0
    || !Array.isArray(raw.rows) || !raw.rows.length || raw.rows.length > 50 || typeof raw.chunk_digest !== 'string') fail('Unsupported restoration campaign or chunk.', 400)
  const ids = new Set<number>()
  for (const item of raw.rows) {
    exactKeys(item, ['id', 'to_gender', 'before', 'match'])
    if (!Number.isSafeInteger(item.id) || Number(item.id) <= 0 || ids.has(Number(item.id)) || !['female', 'male'].includes(String(item.to_gender))) fail('Invalid restoration row.', 400)
    ids.add(Number(item.id)); exactKeys(item.before, BEFORE_FIELDS); exactKeys(item.match, ['kind', 'key'])
    for (const field of BEFORE_FIELDS) {
      const value = item.before[field]
      if (value !== null && (field === 'is_anonymous' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string')) fail('Invalid captured customer field.', 400)
    }
    if (String(item.before.gender ?? '').trim() || general(item.before as Before, Number(item.id))) fail('Known gender or General profiles cannot be restored.', 400)
    if (!['unique_phone', 'name_phone', 'name_address'].includes(String(item.match.kind)) || typeof item.match.key !== 'string' || !item.match.key.length) fail('Invalid identity evidence.', 400)
  }
  const manifest = raw as unknown as GenderRestoreManifest
  const { chunk_digest, ...body } = manifest
  if (approval.chunk_digests[manifest.chunk_index] !== chunk_digest || await genderManifestDigest(body) !== chunk_digest) fail('This chunk is not in the approved restoration manifest.', 409)
  return manifest
}
function optionRows(row: Live): Record<string, unknown>[] {
  if (!row.address) return []
  try { const value = JSON.parse(row.address); return Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [] } catch { return [] }
}
function phones(row: Live): Set<string> { return new Set([phone(row.phone), phone(row.phone_normalized), ...optionRows(row).map(r => phone(r.phone))].filter(Boolean)) }
function addresses(row: Live): Set<string> { return new Set(optionRows(row).map(r => norm(r.address)).filter(Boolean)) }
const operationId = (manifest: GenderRestoreManifest) => `${manifest.campaign_id}:${manifest.chunk_index}:${manifest.chunk_digest}`
const guard = (predicate: string, params: Record<string, unknown>): Statement => ({ sql: `SELECT CASE WHEN ${predicate} THEN 1 ELSE json_extract('', '$') END AS customer_gender_guard`, params })
async function readLive(db: D1Compat): Promise<Live[]> {
  const rows = await db.prepare(`SELECT id,${BEFORE_FIELDS.join(',')} FROM customers ORDER BY id LIMIT 10001`).all<Live>({})
  if (rows.length > 10000 || new TextEncoder().encode(JSON.stringify(rows)).byteLength > 4_000_000) fail('Customer identity inventory exceeds the safe restoration limit.')
  return rows
}
function globalGuards(live: Live[]): Statement[] {
  const statements = [guard('(SELECT COUNT(*) FROM customers)=@count', { count: live.length })]
  for (let start = 0; start < live.length; start += 500) {
    const rows = live.slice(start, start + 500).map(row => Object.fromEntries(GLOBAL_FIELDS.map(field => [field, row[field]])))
    statements.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@rows) expected WHERE NOT EXISTS(
      SELECT 1 FROM customers c WHERE ${GLOBAL_FIELDS.map(field => `c.${field} IS json_extract(expected.value,'$.${field}')`).join(' AND ')}))`, { rows: JSON.stringify(rows) }))
  }
  return statements
}
function assertIdentity(live: Live[], manifest: GenderRestoreManifest, direction: 'apply' | 'undo' | 'redo'): void {
  const byId = new Map(live.map(r => [r.id, r]))
  for (const row of manifest.rows) {
    const current = byId.get(row.id)
    if (!current || general(current, row.id)) fail('A selected customer is missing or is General.')
    for (const field of BEFORE_FIELDS) {
      const expected = field === 'gender' && direction === 'undo' ? row.to_gender : row.before[field]
      if (current[field] !== expected) fail('A captured customer field changed. No restoration was applied.')
    }
    const matching = live.filter(other => {
      if (row.match.kind !== 'unique_phone' && norm(other.name) !== norm(row.before.name)) return false
      return row.match.kind === 'name_address' ? addresses(other).has(row.match.key) : phones(other).has(row.match.key)
    })
    // Address evidence was globally unique, not merely unique within a name.
    const allAddressMatches = row.match.kind === 'name_address' ? live.filter(other => addresses(other).has(row.match.key)) : matching
    if (matching.length !== 1 || matching[0].id !== row.id || allAddressMatches.length !== 1) fail('The approved identity evidence is no longer unique.')
  }
}
function selectedGuard(manifest: GenderRestoreManifest, direction: 'apply' | 'undo' | 'redo'): Statement {
  const rows = manifest.rows.map(row => ({ id: row.id, ...row.before, gender: direction === 'undo' ? row.to_gender : row.before.gender }))
  return guard(`NOT EXISTS(SELECT 1 FROM json_each(@rows) expected WHERE NOT EXISTS(
    SELECT 1 FROM customers c WHERE c.id=json_extract(expected.value,'$.id')
      AND COALESCE(c.is_anonymous,0)=0 AND lower(trim(c.name))<>'general' AND c.id NOT IN (24969,22305)
      AND ${BEFORE_FIELDS.map(field => `c.${field} IS json_extract(expected.value,'$.${field}')`).join(' AND ')}))`, { rows: JSON.stringify(rows) })
}
function writeGender(manifest: GenderRestoreManifest, direction: 'apply' | 'undo' | 'redo'): Statement {
  return { sql: `UPDATE customers SET gender=(SELECT json_extract(row.value,'$.gender') FROM json_each(@rows) row WHERE json_extract(row.value,'$.id')=customers.id)
    WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@rows))`, params: { rows: JSON.stringify(manifest.rows.map(row => ({ id: row.id, gender: direction === 'undo' ? row.before.gender : row.to_gender }))) } }
}
function auditStatement(user: SessionUser, stored: Stored, action: string): Statement {
  return { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(@user,@name,@action,'customer',@operation,@details)`,
    params: { user: user.id, name: actorSnapshot(user), action, operation: stored.operation_id,
      details: JSON.stringify({ operation_id: stored.operation_id, campaign_id: stored.manifest.campaign_id, chunk_index: stored.manifest.chunk_index, chunk_digest: stored.manifest.chunk_digest, generation: stored.generation, count: stored.manifest.rows.length, ids: stored.manifest.rows.map(r => r.id) }) } }
}
async function findOperation(db: D1Compat, id: string): Promise<SnapshotRow | undefined> {
  const rows = await db.prepare(`SELECT id,kind,status,payload_json,created_by_id FROM undo_snapshots
    WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation LIMIT 2`).all<SnapshotRow>({ kind: CUSTOMER_GENDER_RESTORATION_KIND, operation: id })
  if (rows.length > 1) fail('Duplicate restoration receipts require administrator investigation.')
  return rows[0]
}
function storedReceipt(row: SnapshotRow, user: SessionUser, manifest?: GenderRestoreManifest) {
  if (row.created_by_id !== user.id) fail('Restoration receipt not found.', 404)
  let stored: Stored
  try { stored = JSON.parse(row.payload_json) as Stored } catch { return fail('Restoration receipt is unreadable.') }
  if (stored.version !== 1 || !Number.isSafeInteger(stored.generation) || !stored.history_id || !['applied', 'reversed'].includes(row.status)
    || manifest && canonicalGenderJson(manifest) !== canonicalGenderJson(stored.manifest)) fail('Restoration receipt does not match the approved chunk.')
  return { stored, receipt: { operation_id: stored.operation_id, chunk_index: stored.manifest.chunk_index, count: stored.manifest.rows.length, status: row.status as 'applied' | 'reversed', history_id: stored.history_id, generation: stored.generation } }
}
export async function previewCustomerGenderRestoration(db: D1Compat, userInput: SessionUser | null, raw: unknown, approval = APPROVED_GENDER_RESTORATION) {
  const user = authorize(userInput); const manifest = await parseGenderManifest(raw, approval)
  const existing = await findOperation(db, operationId(manifest))
  if (existing) return { success: true, ...storedReceipt(existing, user, manifest).receipt, replayed: true }
  const live = await readLive(db); assertIdentity(live, manifest, 'apply')
  return { success: true, operation_id: operationId(manifest), chunk_index: manifest.chunk_index, count: manifest.rows.length, status: 'ready' as const, generation: 0, history_id: null, replayed: false }
}
export async function applyCustomerGenderRestoration(db: D1Compat, userInput: SessionUser | null, raw: unknown, approval = APPROVED_GENDER_RESTORATION) {
  const user = authorize(userInput); const manifest = await parseGenderManifest(raw, approval); const id = operationId(manifest)
  const existing = await findOperation(db, id)
  if (existing) return { success: true, ...storedReceipt(existing, user, manifest).receipt, replayed: true }
  const live = await readLive(db); assertIdentity(live, manifest, 'apply')
  const stored: Stored = { version: 1, operation_id: id, manifest, generation: 0 }
  const lookup = `SELECT id FROM undo_snapshots WHERE kind=@kind AND json_extract(payload_json,'$.operation_id')=@operation`
  const params = { kind: CUSTOMER_GENDER_RESTORATION_KIND, operation: id, user: user.id, name: actorSnapshot(user) }
  const statements: Statement[] = [
    guard(`NOT EXISTS(${lookup})`, params), ...globalGuards(live), selectedGuard(manifest, 'apply'),
    { sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name) VALUES(@kind,'applied',@payload,@user,@name)`, params: { ...params, payload: JSON.stringify(stored) } },
    writeGender(manifest, 'apply'),
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
      SELECT 'contacts','customer',@operation,@label,'Undo customer gender restoration','Redo customer gender restoration',1,'undoable',
        json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0),json_object('applier',@kind,'operation_id',@operation,'snapshot_id',id,'generation',0),@user,@name
      FROM undo_snapshots WHERE id=(${lookup})`, params: { ...params, label: `Restore customer gender (${manifest.rows.length} records)` } },
    { sql: `UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.history_id',
        (SELECT id FROM action_history WHERE entity_id=@operation AND json_extract(undo_payload,'$.applier')=@kind)) WHERE id=(${lookup})`, params },
    auditStatement(user, stored, 'customer_gender_restore'),
    selectedGuard(manifest, 'undo'),
    guard(`EXISTS(SELECT 1 FROM undo_snapshots s JOIN action_history h ON h.id=json_extract(s.payload_json,'$.history_id')
      WHERE s.kind=@kind AND json_extract(s.payload_json,'$.operation_id')=@operation AND h.created_by_id=@user AND h.status='undoable')`, params),
  ]
  try { await db.batch(statements) } catch (error) {
    const committed = await findOperation(db, id)
    if (committed) return { success: true, ...storedReceipt(committed, user, manifest).receipt, replayed: true }
    if (/malformed JSON|constraint/i.test(String(error))) fail('Customer identity changed before commit. Nothing was restored.')
    throw error
  }
  const committed = await findOperation(db, id)
  if (!committed) fail('Restoration result is uncertain. Check operation status before retrying.', 503)
  return { success: true, ...storedReceipt(committed, user, manifest).receipt, replayed: false }
}
export async function customerGenderRestorationStatus(db: D1Compat, userInput: SessionUser | null, campaign: string) {
  const user = authorize(userInput)
  if (campaign !== APPROVED_GENDER_RESTORATION.campaign_id) fail('Unsupported restoration campaign.', 400)
  const rows = await db.prepare(`SELECT id,kind,status,payload_json,created_by_id FROM undo_snapshots WHERE kind=@kind
    AND json_extract(payload_json,'$.manifest.campaign_id')=@campaign AND created_by_id=@user ORDER BY id LIMIT 100`)
    .all<SnapshotRow>({ kind: CUSTOMER_GENDER_RESTORATION_KIND, campaign, user: user.id })
  return { success: true, campaign_id: campaign, total_count: APPROVED_GENDER_RESTORATION.total_count, chunk_count: APPROVED_GENDER_RESTORATION.chunk_digests.length,
    receipts: rows.map(row => storedReceipt(row, user).receipt) }
}
export async function replayCustomerGenderRestoration(payload: Record<string, unknown>, ctx: UndoApplierContext): Promise<UndoApplierOutcome> {
  const user = authorize(ctx.user); const db = getDb(ctx.env)
  const snapshot = await findOperation(db, String(payload.operation_id || ''))
  if (!snapshot || snapshot.id !== Number(payload.snapshot_id)) fail('Restoration receipt not found.', 404)
  const { stored } = storedReceipt(snapshot, user)
  if (stored.history_id !== ctx.historyId) fail('Restoration history does not own this operation.')
  await parseGenderManifest(stored.manifest)
  const expectedGeneration = Number(ctx.generation)
  if (typeof ctx.generation !== 'number' || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) fail('An expected restoration generation is required.', 400)
  const complete = (generation: number): UndoApplierOutcome => ({ complete: true, continuation_required: false, processed_children: stored.manifest.rows.length, pending_children: 0, generation })
  if (stored.generation === expectedGeneration + 1 && stored.last_direction === ctx.direction && stored.last_expected_generation === expectedGeneration) return complete(stored.generation)
  if (stored.generation !== expectedGeneration || snapshot.status !== (ctx.direction === 'undo' ? 'applied' : 'reversed')) fail('Restoration generation changed. Refresh action history.')
  const live = await readLive(db); assertIdentity(live, stored.manifest, ctx.direction)
  const next: Stored = { ...stored, generation: expectedGeneration + 1, last_direction: ctx.direction, last_expected_generation: expectedGeneration }
  const fromHistory = ctx.direction === 'undo' ? 'undoable' : 'redoable'; const toHistory = ctx.direction === 'undo' ? 'redoable' : 'undoable'
  const statements: Statement[] = [guard(`EXISTS(SELECT 1 FROM undo_snapshots s JOIN action_history h ON h.id=@history
    WHERE s.id=@snapshot AND s.kind=@kind AND s.payload_json=@old AND s.status=@status AND s.created_by_id=@user
      AND h.created_by_id=@user AND h.status=@historyStatus AND h.reversible=1
      AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.undo_payload,'$.snapshot_id')=s.id)`,
    { history: stored.history_id, snapshot: snapshot.id, kind: CUSTOMER_GENDER_RESTORATION_KIND, old: snapshot.payload_json, status: snapshot.status, user: user.id, historyStatus: fromHistory, operation: stored.operation_id }),
    ...globalGuards(live), selectedGuard(stored.manifest, ctx.direction), writeGender(stored.manifest, ctx.direction),
    { sql: `UPDATE undo_snapshots SET status=@status,payload_json=@payload,updated_at=CURRENT_TIMESTAMP WHERE id=@id`, params: { status: ctx.direction === 'undo' ? 'reversed' : 'applied', payload: JSON.stringify(next), id: snapshot.id } },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
        undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id`, params: { status: toHistory, id: stored.history_id, generation: next.generation } },
    auditStatement(user, next, ctx.direction === 'undo' ? 'customer_gender_restore_undo' : 'customer_gender_restore_redo'),
    selectedGuard(stored.manifest, ctx.direction === 'undo' ? 'redo' : 'undo'),
  ]
  try { await db.batch(statements) } catch (error) {
    const current = await findOperation(db, stored.operation_id)
    if (current) {
      const observed = storedReceipt(current, user).stored
      if (observed.generation === next.generation && observed.last_direction === ctx.direction && observed.last_expected_generation === expectedGeneration) return complete(observed.generation)
    }
    if (/malformed JSON|constraint/i.test(String(error))) fail('Restoration state changed before replay. Nothing was changed.')
    throw error
  }
  return complete(next.generation)
}
export async function notifyCustomerGenderRestoration(env: Env): Promise<void> {
  await bumpVersion(env, 'customers')
  await broadcast(env, 'customers', { action: 'update' })
}
