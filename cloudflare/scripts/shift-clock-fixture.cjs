function clockSql(sql, now) {
  const iso = new globalThis.Date(now).toISOString()
  return sql.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[$@:][\w$]+|\bCURRENT_(?:TIMESTAMP|DATE|TIME)\b|\b(?:date|datetime|time|julianday|unixepoch)\s*\(\s*'now'|\bstrftime\s*\(\s*'(?:''|[^'])*'\s*,\s*'now'/gi, token => {
    if (/^CURRENT_TIMESTAMP$/i.test(token)) return `'${iso.slice(0, 19).replace('T', ' ')}'`
    if (/^CURRENT_DATE$/i.test(token)) return `'${iso.slice(0, 10)}'`
    if (/^CURRENT_TIME$/i.test(token)) return `'${iso.slice(11, 19)}'`
    if (/^(?:date|datetime|time|julianday|unixepoch|strftime)\s*\(/i.test(token)) return token.replace(/'now'$/i, `'${iso}'`)
    return token
  })
}

function createClock(offset) {
  const NativeDate = globalThis.Date
  let difference = offset
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.now() + difference])) }
    static now() { return NativeDate.now() + difference }
  }
  return {
    Date: ClockDate,
    offset: () => difference,
    setOffset: value => { difference = value },
    set: iso => { difference = NativeDate.parse(iso) - NativeDate.now() },
  }
}

function clockDatabase(database, clock) {
  return new Proxy(database, {
    get(target, key) {
      if (key === 'prepare') return sql => target.prepare(clockSql(sql, clock.Date.now()))
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function shiftClock() {
  const clock = createClock(globalThis.Date.parse('2026-10-18T05:00:00Z') - globalThis.Date.now())
  const prelude = `const fixtureClock = (${createClock})(${clock.offset()}); globalThis.Date = fixtureClock.Date;`
  const entry = `import worker from './src/index.ts';
    const clockSql = ${clockSql}; const clockDatabase = ${clockDatabase};
    const databases = new WeakMap();
    export default { async fetch(request, env, ctx) {
      if (!databases.has(env.DB)) databases.set(env.DB, clockDatabase(env.DB, fixtureClock));
      const DB = databases.get(env.DB);
      if (new URL(request.url).pathname === '/__fixture_clock') {
        if (request.method === 'POST') fixtureClock.setOffset((await request.json()).offset);
        return Response.json({ now: Date.now(), sql: await DB.prepare("SELECT datetime('now') AS now, date('now', '+7 hours') AS business_date").first() });
      }
      return worker.fetch(request, { ...env, DB }, ctx);
    }};`
  return {
    ...clock, prelude, entry,
    database: db => clockDatabase(db, clock),
    async setWorker(mf, origin, iso) {
      clock.set(iso)
      return (await mf.dispatchFetch(`${origin}/__fixture_clock`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offset: clock.offset() }),
      })).json()
    },
  }
}

module.exports = { shiftClock, clockSql }
