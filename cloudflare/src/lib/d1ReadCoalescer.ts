/**
 * Reads that are issued in the same turn go to D1 as ONE db.batch.
 *
 * Why (Cloudflare Free, 30 Oct 2026): a Worker invocation may make 50 D1 calls and a db.batch() counts as one.
 * The Telegram day summary and the shift overview ask a dozen independent questions at once (the sales kernel's
 * snapshot reads for the day, a comparison day, the top products, the fees, the stock movements, the payments ...)
 * from `Promise.all`s, and every one of them was its own call: 40 for the default message, 111 with every section on.
 * Each question still sits behind its own helper, so none of them is rewritten: this wraps the D1 binding, and the
 * statements the helpers fire in one turn of the event loop are sent together. A helper that has to wait for its own
 * answer before it asks the next question (the kernel's two passes) lands in the next batch, so a message costs the
 * depth of its slowest chain of questions, not the sum of all of them.
 *
 * Rules that keep the answers what they were:
 *   * only reads are coalesced (all/first); run() and raw() go straight through, in the order they are called;
 *   * a lone read is sent as itself, not as a one-statement batch;
 *   * a batch is atomic, so ONE failing read would fail its neighbours (the kernel's removal-loss read is fail-soft on
 *     purpose, and "no such table" probes rely on their own error); when a batch is rejected every read in it is
 *     replayed on its own, so each caller sees exactly the outcome it would have had unbatched;
 *     If every replayed read then succeeds, the batch itself was what D1 refused, and this binding stops batching;
 *   * D1's per-statement bind limit is untouched (each statement keeps its own parameters).
 * Use it for report composition (read only), never around a write path: a write issued between two reads is not
 * ordered against the reads that are still waiting for the turn to end.
 */
/** Statements per batch. D1 accepts far more; this keeps one batch's answer small. */
const MAX_BATCH = 50

type Waiting = { statement: CoalescedStatement; resolve: (result: D1Result) => void; reject: (error: unknown) => void }

class CoalescedStatement {
  constructor(private readonly owner: CoalescingD1, readonly sql: string, readonly values: unknown[]) {}

  bind(...values: unknown[]): CoalescedStatement { return new CoalescedStatement(this.owner, this.sql, values) }
  /** The real statement, for the paths that are not coalesced. */
  real(d1: D1Database): D1PreparedStatement { return d1.prepare(this.sql).bind(...this.values) }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return this.owner.read(this) as Promise<D1Result<T>> }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = ((await this.owner.read(this)).results[0] ?? null) as Record<string, unknown> | null
    return (column == null ? row : (row ? row[column] ?? null : null)) as T | null
  }
  run(): Promise<D1Result> { return this.real(this.owner.d1).run() }
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> { return (this.real(this.owner.d1) as unknown as { raw(o?: unknown): Promise<T[]> }).raw(options) }
}

class CoalescingD1 {
  private queue: Waiting[] = []
  private scheduled = false
  /** Set once a rejected batch turned out to hold only good reads: from then on every read goes out alone. */
  private batching = true
  constructor(readonly d1: D1Database) {}

  prepare(sql: string): CoalescedStatement { return new CoalescedStatement(this, sql, []) }
  exec(query: string) { return this.d1.exec(query) }
  /** Callers that build their own batch (D1Compat.batch) get it forwarded as it is. */
  batch<T = unknown>(statements: Array<CoalescedStatement | D1PreparedStatement>): Promise<D1Result<T>[]> {
    return this.d1.batch<T>(statements.map((statement) => (statement instanceof CoalescedStatement ? statement.real(this.d1) : statement)))
  }

  read(statement: CoalescedStatement): Promise<D1Result> {
    if (!this.batching) return statement.real(this.d1).all()
    return new Promise((resolve, reject) => {
      this.queue.push({ statement, resolve, reject })
      if (this.scheduled) return
      this.scheduled = true
      // A macrotask: every helper that is runnable in this turn has queued its first read by then.
      setTimeout(() => this.flush(), 0)
    })
  }

  private flush(): void {
    const waiting = this.queue.splice(0)
    this.scheduled = false
    for (let from = 0; from < waiting.length; from += MAX_BATCH) void this.send(waiting.slice(from, from + MAX_BATCH))
  }

  private async send(group: Waiting[]): Promise<void> {
    const alone = (waiting: Waiting): Promise<boolean> => waiting.statement.real(this.d1).all().then(
      (result) => { waiting.resolve(result); return true },
      (error) => { waiting.reject(error); return false },
    )
    if (group.length === 1) { await alone(group[0]); return }
    try {
      const results = await this.d1.batch(group.map((waiting) => waiting.statement.real(this.d1)))
      group.forEach((waiting, index) => waiting.resolve(results[index]))
    } catch {
      if ((await Promise.all(group.map(alone))).every(Boolean)) this.batching = false
    }
  }
}

/**
 * A real D1 binding, as opposed to the hand-made compat objects some tests pass in (their statements have get(), a real
 * statement has bind() and first() and no get()). Preparing a statement does no I/O.
 */
const BINDINGS = new WeakMap<object, boolean>()
function isD1Binding(db: unknown): db is D1Database {
  if (!db || typeof db !== 'object') return false
  const known = BINDINGS.get(db)
  if (known !== undefined) return known
  let verdict = false
  try {
    const candidate = db as Partial<Record<'prepare' | 'batch' | 'exec', unknown>>
    if (typeof candidate.prepare === 'function' && typeof candidate.batch === 'function' && typeof candidate.exec === 'function') {
      const statement = (db as D1Database).prepare('SELECT 1') as unknown as Record<string, unknown>
      verdict = typeof statement.bind === 'function' && typeof statement.first === 'function' && typeof statement.get !== 'function'
    }
  } catch { verdict = false }
  BINDINGS.set(db, verdict)
  return verdict
}

/** `env` with its DB binding coalescing reads. Idempotent; anything that is not a D1 binding is returned untouched. */
export function coalesceD1Reads<E extends { DB: D1Database }>(env: E): E {
  if (env.DB instanceof CoalescingD1 || !isD1Binding(env.DB)) return env
  return { ...env, DB: new CoalescingD1(env.DB) as unknown as D1Database }
}
