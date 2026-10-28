'use strict'
const assert = require('node:assert/strict')
const METER_WORKER_SOURCE = String.raw`

const METER_LIMIT_ERROR = 'loyalty fixture physical D1 attempt limit exceeded';
function createInvocationMeter(real, limit, options = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid fixture D1 limit');
  const stats = { limit, physicalAttempts: 0, delegatedCalls: 0, statementAttempts: 0,
    unknownStatementAttempts: 0, failedAttempts: 0, rejectedAtLimit: 0 };
  const attempts = [], log = [], prepared = new WeakMap();
  let failBatchOnce = options.failBatchOnce === true;
  const note = (sql, result, noMeta = false) => log.push({ sql,
    rows: noMeta ? null : Array.isArray(result?.results) ? result.results.length : 0,
    meta: noMeta ? undefined : result?.meta, metaUnavailable: noMeta });
  async function invoke(method, plans, dispatch, delegatedMethod = method) {
    const arity = plans === null ? null : plans.length;
    const event = { attempt: ++stats.physicalAttempts, method, delegatedMethod,
      statements: arity, delegated: false, outcome: 'pending' };
    attempts.push(event);
    if (arity === null) stats.unknownStatementAttempts++; else stats.statementAttempts += arity;
    try {
      if (event.attempt > limit) {
        stats.rejectedAtLimit++; throw new Error(METER_LIMIT_ERROR);
      }
      if (method === 'batch' && failBatchOnce) {
        failBatchOnce = false; event.injected = 'retryable-batch-before-delegation';
        throw new Error('network timeout loyalty fixture batch');
      }
      event.delegated = true; stats.delegatedCalls++;
      const result = await dispatch();
      event.outcome = 'ok';
      if (method === 'batch') {
        if (Array.isArray(result)) result.forEach((row, index) => note(plans[index]?.sql || '<native statement>', row));
      } else if (method === 'all' || method === 'run' || method === 'first') note(plans[0].sql, result);
      else if (method === 'raw') note(plans[0].sql, undefined, true);
      return result;
    } catch (error) {
      stats.failedAttempts++; event.outcome = event.attempt > limit ? 'limit' : 'error';
      event.error = String(error?.message || error); throw error;
    }
  }
  function statement(inner, sql) {
    const wrapped = new Proxy(inner, { get(target, key) {
      if (key === 'bind') return (...values) => statement(target.bind(...values), sql);
      if (key === 'first') return async (column) => {
        const result = await invoke('first', [{ sql }], () => target.all(), 'all');
        return column ? result.results?.[0]?.[column] ?? null : result.results?.[0] ?? null;
      };
      if (key === 'all' || key === 'run' || key === 'raw') return (...args) =>
        invoke(key, [{ sql }], () => target[key](...args));
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    prepared.set(wrapped, { inner, sql }); return wrapped;
  }
  function database(inner) { return new Proxy(inner, { get(target, key) {
    if (key === 'prepare') return sql => statement(target.prepare(sql), sql);
    if (key === 'batch') return items => {
      const plans = items.map(item => prepared.get(item) || { inner: item, sql: '<native statement>' });
      return invoke('batch', plans, () => target.batch(plans.map(plan => plan.inner)));
    };
    if (key === 'exec') return sql => invoke('exec', null, () => target.exec(sql));
    if (key === 'withSession') return (...args) => database(target.withSession(...args));
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }); }
  return { db: database(real), stats, attempts, log };
}
function collectWaitUntil() {
  const entries = [], errors = []; let cursor = 0;
  return {
    waitUntil(work) {
      const entry = { settled: false };
      entry.promise = Promise.resolve(work).then(
        () => { entry.settled = true; },
        error => { entry.settled = true; errors.push(String(error?.message || error)); });
      entries.push(entry);
    },
    async drain() { while (cursor < entries.length) await entries[cursor++].promise; },
    snapshot() { return { registered: entries.length, drained: cursor,
      settled: entries.filter(entry => entry.settled).length, errors: [...errors] }; },
  };
}
function fixtureAssert(ok, message) { if (!ok) throw new Error('meter probe: ' + message); }
async function meterProbe(env, name) {
  const limit = Number(env.LOYALTY_METER_FREE_LIMIT);
  fixtureAssert(limit === 50, 'Free physical limit must stay50');
  const meter = createInvocationMeter(env.DB, limit, { failBatchOnce: name === 'retry' });
  if (name === 'batch') {
    const results = await meter.db.batch(Array.from({ length: 60 }, () => meter.db.prepare('SELECT 1 AS n')));
    fixtureAssert(results.length === 60 && meter.stats.physicalAttempts === 1
      && meter.stats.statementAttempts === 60 && meter.stats.delegatedCalls === 1, '60statements must use1call');
  } else if (name === 'retry') {
    const db = new D1Compat(meter.db);
    const results = await db.batch(Array.from({ length: 60 }, () => ({ sql: 'SELECT 1 AS n' })));
    fixtureAssert(results.length === 60 && meter.stats.physicalAttempts === 2 && meter.stats.statementAttempts === 120
      && meter.stats.delegatedCalls === 1 && meter.stats.failedAttempts === 1
      && meter.attempts[0].injected === 'retryable-batch-before-delegation'
      && meter.attempts[1].outcome === 'ok', 'failed native-entry attempt and actual D1Compat retry stay counted');
  } else if (name === 'limit') {
    for (let i = 0; i < 50; i++) await meter.db.prepare('SELECT 1 AS n').all();
    fixtureAssert(meter.stats.physicalAttempts === 50 && meter.stats.delegatedCalls === 50, 'first50calls succeed');
    let error;
    try { await meter.db.prepare('SELECT 1 AS n').all(); } catch (caught) { error = caught; }
    fixtureAssert(String(error?.message || error) === METER_LIMIT_ERROR && meter.stats.physicalAttempts === 51
      && meter.stats.delegatedCalls === 50 && meter.stats.rejectedAtLimit === 1
      && meter.stats.failedAttempts === 1 && meter.log.length === 50, '51st rejected before delegation');
  } else if (name === 'methods') {
    const first = await meter.db.prepare('SELECT ? AS n').bind(7).first('n');
    const raw = await meter.db.prepare('SELECT 8 AS n').raw();
    const all = await meter.db.prepare('SELECT 9 AS n').all();
    const run = await meter.db.prepare('SELECT 10 AS n').run();
    await meter.db.exec('SELECT 11 AS n');
    fixtureAssert(first === 7 && raw[0][0] === 8 && all.results[0].n === 9 && run.success === true
      && meter.stats.physicalAttempts === 5 && meter.stats.delegatedCalls === 5
      && meter.stats.statementAttempts === 4 && meter.stats.unknownStatementAttempts === 1
      && meter.attempts[0].method === 'first' && meter.attempts[0].delegatedMethod === 'all'
      && meter.log[1].metaUnavailable === true && meter.log.length === 4
      && meter.attempts[4].method === 'exec' && meter.attempts[4].statements === null,
      'first/all/run/raw/exec count once with real rows and truthful unknown exec arity');
  } else if (name === 'failure') {
    let error;
    try { await meter.db.prepare('SELECT loyalty_meter_missing_column_1019 FROM (SELECT 1 AS n)').all(); }
    catch (caught) { error = caught; }
    fixtureAssert(/no such column: loyalty_meter_missing_column_1019/.test(String(error?.message || error))
      && meter.stats.physicalAttempts === 1 && meter.stats.delegatedCalls === 1
      && meter.stats.statementAttempts === 1 && meter.stats.failedAttempts === 1
      && meter.attempts[0].delegated === true && meter.attempts[0].outcome === 'error'
      && meter.log.length === 0, 'delegated native SQL failure remains spent without invented successful results');
    await meter.db.prepare('SELECT 12 AS n').all();
    fixtureAssert(meter.stats.physicalAttempts === 2 && meter.stats.delegatedCalls === 2
      && meter.stats.failedAttempts === 1 && meter.stats.statementAttempts === 2,
      'a later successful call does not erase the failed native attempt');
  } else if (name === 'nested') {
    const pending = collectWaitUntil();
    let releaseParent, releaseNested, sawNested, nestedWork;
    const parentGate = new Promise(resolve => { releaseParent = resolve; });
    const nestedGate = new Promise(resolve => { releaseNested = resolve; });
    const nestedReady = new Promise(resolve => { sawNested = resolve; });
    const parentWork = (async () => {
      await parentGate; await meter.db.prepare('SELECT 2 AS n').all();
      nestedWork = (async () => { await nestedGate; await meter.db.prepare('SELECT 3 AS n').all(); })();
      pending.waitUntil(nestedWork);
      pending.waitUntil(Promise.reject(new Error('fixture nested background rejection')));
      sawNested();
    })();
    pending.waitUntil(parentWork);
    await meter.db.prepare('SELECT 1 AS n').all();
    fixtureAssert(meter.stats.physicalAttempts === 1, 'foreground boundary before attached work');
    let finished = false;
    const draining = pending.drain().then(() => { finished = true; });
    releaseParent();
    try {
      await Promise.race([nestedReady, parentWork]);
      await new Promise(resolve => setTimeout(resolve, 0));
      fixtureAssert(!finished, 'drain must wait for newly attached gated work');
      const other = createInvocationMeter(env.DB, limit);
      fixtureAssert(other.stats.physicalAttempts === 0, 'fresh overlapping meter starts empty');
      await other.db.prepare('SELECT 4 AS n').all();
      fixtureAssert(other.stats.physicalAttempts === 1 && meter.stats.physicalAttempts === 2,
        'overlapping closures do not mix invocation calls');
      releaseNested(); await draining;
      const tail = pending.snapshot();
      fixtureAssert(meter.stats.physicalAttempts === 3 && meter.log.length === 3 && tail.registered === 3
        && tail.drained === 3 && tail.settled === 3 && tail.errors.length === 1
        && tail.errors[0] === 'fixture nested background rejection' && other.stats.physicalAttempts === 1,
        'late nested call and rejection are drained/accounted in the original invocation');
    } finally { releaseNested(); await nestedWork; await draining; }
  } else throw new Error('unknown meter probe');
  return { name, stats: { ...meter.stats }, attempts: meter.attempts, log: meter.log };
}
`

async function assertMeterProbes(call, tier) {
  for (const name of ['batch', 'retry', 'limit', 'methods', 'failure', 'nested']) {
    const probe = await call({ op: 'meterProbe', name });
    assert.equal(probe.error, undefined, JSON.stringify({ tier, name, probe }));
    assert.equal(probe.name, name);
  }
}
module.exports = { METER_WORKER_SOURCE, assertMeterProbes }
