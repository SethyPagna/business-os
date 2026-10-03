const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
const app = h.load('routes/shifts.ts').default
const f = h.fixture()
const get = async (params = {}, suffix = '/') => {
  const response = await app.request(`${suffix}?${new URLSearchParams(params)}`, {}, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
;(async () => {
  try {
    h.setUser({ ...h.USER, role_code: 'admin', permissions: '{"all":true}' })
    const dates = ['2026-09-01T01:59:59Z', '2026-09-01 02:00:00', '2026-09-01T04:00:59.999Z', '2026-09-01 04:01:00']
    for (const [i, timestamp] of dates.entries()) {
      f.raw.prepare("INSERT INTO shift_sessions(id,shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,scope_mode) VALUES(?,?,?,'Hour cashier',1,'Shop','2026-09-01',?,'2026-09-01 08:00:00','per_account')").run([i+1, `H-${i+1}`, i+7, timestamp])
    }
    f.raw.prepare("INSERT INTO shift_sessions(id,shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,scope_mode) VALUES(50,'ROOT-50',20,'Continuation',1,'Shop','2026-09-01','2026-09-01T01:00:00Z','2026-09-01T03:00:00Z','per_account')").run()
    f.raw.prepare("INSERT INTO shift_sessions(id,shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,scope_mode,parent_shift_id,reopen_reason,reopened_by_user_id) VALUES(51,'LAST-51',20,'Continuation',1,'Shop','2026-09-01','2026-09-01T03:30:00Z','per_account',50,'Hour probe',1)").run()
    f.raw.prepare("UPDATE shift_sessions SET closed_at='2026-09-01T06:00:00Z' WHERE id=51").run()
    f.raw.prepare("INSERT INTO fees(fee_type,label,amount_usd,fee_date,branch_id,created_by,created_at) VALUES('other','Outside picker hours, inside shift',17,'2026-09-01',1,20,'2026-09-01T05:00:00Z')").run()
    const day = { from: '2026-09-01', to: '2026-09-01', page: '1', page_size: '2' }
    const narrow = { ...day, openedFrom: '2026-09-01 02:00:00', openedTo: '2026-09-01 04:01:00' }
    assert.equal((await get(day)).body.total, 5)
    const first = await get(narrow)
    assert.equal(first.status, 200)
    assert.equal(first.body.total, 3, 'only latest displayed segment opening determines selection')
    const second = await get({ ...narrow, page: '2' })
    assert.deepEqual([...first.body.shifts,...second.body.shifts].map(r=>r.id).sort(), [2,3,51])
    assert.equal(second.body.has_more, false)
    assert.deepEqual((await get({ ...narrow, page: '99' })).body, second.body)
    const unpaged = await get({ openedFrom: narrow.openedFrom, openedTo: narrow.openedTo })
    assert.deepEqual(unpaged.body.shifts.map(r=>r.id).sort(),[2,3,51])
    assert.equal((await get({ ...narrow, q: 'ROOT-50' })).body.shifts[0].id,51)
    assert.equal((await get({ ...narrow, user_id: '7' })).body.total,0)
    const offset = await get({ ...narrow, openedFrom:'2026-09-01T09:00:00+07:00',openedTo:'2026-09-01T11:01:00+07:00' })
    assert.deepEqual(offset.body,first.body)
    const history = await get({},'/51/history')
    const withHours = await get(narrow,'/51/history')
    assert.equal(history.status,200)
    assert.deepEqual(history.body,withHours.body,'list clocks cannot clip full shift figures or lineage')
    assert.equal(history.body.shift.figures.other_expenses.usd,17,'whole selected shift includes an expense after the picker end hour')
    assert.equal(history.body.shift.reconciliation.expenses.usd,17)
    assert.deepEqual(history.body.segments.map(r=>r.id),[50,51])
    for(const invalid of [
      {openedFrom:narrow.openedFrom},{openedTo:narrow.openedTo},
      {openedFrom:'bad',openedTo:narrow.openedTo},
      {openedFrom:narrow.openedTo,openedTo:narrow.openedFrom},
      {openedFrom:'2026-02-30 02:00:00',openedTo:narrow.openedTo},
    ]) assert.equal((await get(invalid)).status,400,JSON.stringify(invalid))
    h.setUser({ ...h.USER,id:8,role_code:'cashier',permissions:'{"pos":true}' })
    const own = await get(narrow)
    assert.equal(own.body.scope,'own')
    assert.deepEqual(own.body.shifts.map(r=>r.id),[2])
    assert.equal((await get({ ...narrow,user_id:'20' })).body.total,0)
    assert.equal((await get({},'/51/history')).status,404)
    h.setUser({ ...h.USER,permissions:'{}' })
    assert.equal((await get(narrow)).status,403)
    console.log('PASS actual depth100 Shift list: mixed clocks, latest segment, paged/unpaged/count/search, full history and own-scope/denied permissions')
  } finally { f.raw.db.close() }
})().catch(error=>{console.error(error);process.exitCode=1})
