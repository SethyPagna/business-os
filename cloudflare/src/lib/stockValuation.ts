import { getDb, type D1Compat } from './db';
import type { SessionUser } from './auth';
import { currentFundingActor, planStockFunding, stockFundingPhysicalSql } from './stockFunding';
import { ordinaryBusinessBatch } from './businessMaintenanceGuard';
import { exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis';
import { feeRequestDigest, normalizeFeeRequestId } from './feeOperationReceipt';
import { applyValuationCoverage, splitValuationSegment, sumValuationQuantity, valuationTotals, type ValuationSegment } from './stockValuationMath';
export class StockValuationError extends Error {
    constructor(public code: string, public statusCode: 400 | 403 | 409 = 409) { super(code); }
}
const refuse = (code: string, status: 400 | 403 | 409 = 409): never => { throw new StockValuationError(code, status); };
const identity = (value: unknown): string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 120 ? value : refuse('invalid_valuation_identity', 400);
type Statement = {
    sql: string;
    params?: Record<string, unknown>;
};
type Source = {
    id: string;
    batch_id: number;
    movement_id: number;
    product_id: number;
    branch_id: number;
    quantity: string;
    gross4: number;
    source_json: string;
};
type Funding = {
    id: string;
    source_id: string;
    generation: number;
    gross4: number;
    paid4: number;
    debt4: number;
    credit4: number;
    asset4: number;
    cash_in4: number;
    cash_out4: number;
    shipping4: number;
};
const fundingSql = 'SELECT id,source_id,generation,gross4,paid4,debt4,credit4,asset4,cash_in4,cash_out4,shipping4 FROM stock_funding_events';
const segmentsSql = 'SELECT segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason FROM stock_valuation_segments WHERE event_id=@event ORDER BY segment_id';
function parseValuationRequest(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return refuse('invalid_request', 400);
    const raw = input as Record<string, unknown>;
    const allowed = ['kind', 'source_id', 'expected_revision', 'expected_generation', 'client_request_id', 'funding', 'segment_id', 'child_segment_id', 'quantity', 'reason', 'expense_category', 'agreement_id', 'amount_usd', 'targets', 'shares', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at', 'fee_id'];
    if (Object.keys(raw).some(key => !allowed.includes(key)))
        return refuse('unsupported_valuation_field', 400);
    const kind = identity(raw.kind), sourceId = identity(raw.source_id), request = normalizeFeeRequestId(raw.client_request_id);
    if (!request || !Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0 || !Number.isSafeInteger(raw.expected_generation) || Number(raw.expected_generation) < 0)
        return refuse('invalid_valuation_revision', 400);
    if (!['admit', 'hold', 'dispose', 'repair', 'pending', 'accept', 'refund', 'payment', 'shipping'].includes(kind))
        return refuse('unsupported_valuation_transition', 400);
    const fields: Record<string, string[]> = { admit: ['funding'], hold: ['segment_id', 'child_segment_id', 'quantity', 'reason'], dispose: ['segment_id', 'child_segment_id', 'quantity', 'expense_category'], repair: ['segment_id', 'child_segment_id', 'quantity'], pending: ['agreement_id', 'amount_usd', 'targets', 'proof'], accept: ['agreement_id', 'shares', 'proof'], refund: ['amount_usd', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at'], payment: ['amount_usd', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at'], shipping: ['amount_usd', 'proof', 'fee_id'] };
    if (Object.keys(raw).some(key => !['kind', 'source_id', 'expected_revision', 'expected_generation', 'client_request_id', ...fields[kind]].includes(key)))
        return refuse('unsupported_valuation_transition_field', 400);
    return { raw, kind, sourceId, request, revision: Number(raw.expected_revision), generation: Number(raw.expected_generation) };
}
function parseAttributedAmounts(value: unknown, key: 'allocation_id' | 'segment_id') {
    if (!Array.isArray(value) || !value.length || value.length > 100)
        return refuse('explicit_attribution_required', 400);
    return value.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join('|') !== [key, 'amount_usd'].sort().join('|'))
            return refuse('invalid_attribution', 400);
        let amount4: number;
        try {
            amount4 = exactMoney4(row.amount_usd);
        }
        catch {
            return refuse('unsupported_valuation_money_precision', 400);
        }
        return { target: identity(row[key]), amount4 };
    });
}
function planPhysicalSegments(segments: ValuationSegment[], raw: Record<string, unknown>, kind: string) {
    const segmentId = identity(raw.segment_id), childId = identity(raw.child_segment_id);
    const index = segments.findIndex(s => s.segment_id === segmentId);
    if (index < 0 || segments.some(s => s.segment_id === childId) || segments[index].fate !== (kind === 'hold' ? 'sellable' : 'held'))
        return refuse('valuation_segment_fate_conflict');
    let split: ReturnType<typeof splitValuationSegment>;
    try {
        split = splitValuationSegment(segments[index], quantityDecimal(raw.quantity), childId, kind === 'hold' ? 'held' : kind === 'repair' ? 'sellable' : 'disposed');
    }
    catch {
        return refuse('valuation_quantity_conflict', 400);
    }
    if (kind === 'hold') {
        split.child.allocation_id = segments[index].allocation_id === 'original' ? childId : segments[index].allocation_id;
        split.child.reason = identity(raw.reason);
    }
    if (kind === 'repair')
        split.child.reason = '';
    return [...segments.slice(0, index), ...(split.remainder ? [split.remainder] : []), split.child, ...segments.slice(index + 1)];
}
function buildFundingRequest(raw:Record<string,unknown>,kind:string,sourceId:string,generation:number,request:string,agreement:string|null) {
  const common={kind,source_id:sourceId,expected_generation:generation,client_request_id:request}
  if(kind==='admit') return {...(raw.funding as Record<string,unknown>),...common}
  const proof={...common,proof:raw.proof}
  if(kind==='pending') return {...proof,claim_id:agreement,amount_usd:raw.amount_usd}
  if(kind==='accept') return {...proof,claim_id:agreement}
  if(kind==='shipping') return {...proof,amount_usd:raw.amount_usd,fee_id:raw.fee_id}
  return {...proof,amount_usd:raw.amount_usd,cash_method:raw.cash_method,cash_reference:raw.cash_reference,cash_recorded_at:raw.cash_recorded_at}
}
async function replay(db: D1Compat, actor: SessionUser, request: string, digest: string, requestJson: string) {
    const saved = await db.prepare('SELECT * FROM stock_valuation_receipts WHERE request_id=@request').get<{
        actor_id: number;
        request_digest: string;
        request_json: string;
        response_json: string;
        event_id: string;
    }>({ request });
    if (!saved)
        return null;
    await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(JSON.parse(requestJson).kind));
    if (saved.actor_id !== actor.id || saved.request_digest !== digest || saved.request_json !== requestJson)
        return refuse('valuation_request_intent_conflict');
    let response: Record<string, unknown>;
    try {
        response = JSON.parse(saved.response_json);
    }
    catch {
        return refuse('valuation_receipt_corrupt');
    }
    const keys = ['valuation_version', 'source_id', 'event_id', 'revision', 'kind', 'funding', 'segments', 'totals', 'pending4'];
    if (!response || Array.isArray(response) || Object.keys(response).join('|') !== keys.join('|') || JSON.stringify(response) !== saved.response_json || response.valuation_version !== 3 || response.event_id !== saved.event_id)
        return refuse('valuation_receipt_corrupt');
    if (typeof response.source_id !== 'string' || typeof response.event_id !== 'string' || typeof response.kind !== 'string' || !Number.isSafeInteger(response.revision) || Number(response.revision) < 0 || !response.funding || typeof response.funding !== 'object' || Array.isArray(response.funding) || !Array.isArray(response.segments) || !response.totals || typeof response.totals !== 'object')
        return refuse('valuation_receipt_corrupt');
    const fundingKeys = ['id', 'source_id', 'generation', 'gross4', 'paid4', 'debt4', 'credit4', 'asset4', 'cash_in4', 'cash_out4', 'shipping4'];
    const fundingShape = response.funding as Record<string, unknown>;
    if (Object.keys(fundingShape).join('|') !== fundingKeys.join('|') || typeof fundingShape.id !== 'string' || fundingShape.source_id !== response.source_id || fundingKeys.slice(2).some(key => !Number.isSafeInteger(fundingShape[key]) || Number(fundingShape[key]) < 0))
        return refuse('valuation_receipt_corrupt');
    const evidence = await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='stock_valuation' AND entity_id=@event AND user_id=@actor AND details=@response AND new_value=@response").get<{
        n: number;
    }>({ event: saved.event_id, actor: actor.id, response: saved.response_json });
    if (evidence?.n !== 1)
        return refuse('valuation_receipt_corrupt');
    const event = await db.prepare('SELECT source_id,revision,kind FROM stock_valuation_events WHERE id=@event').get({ event: saved.event_id });
    const segments = await db.prepare(segmentsSql).all<ValuationSegment>({ event: saved.event_id });
    const funding = response.funding as Funding;
    const source = await db.prepare('SELECT quantity FROM stock_funding_sources WHERE id=@source').get<{
        quantity: string;
    }>({ source: response.source_id });
    const actual = await db.prepare(fundingSql + ' WHERE id=@id AND source_id=@source').get<Funding>({ id: funding?.id, source: response.source_id });
    if (!event || !source || response.source_id !== event.source_id || response.revision !== event.revision || response.kind !== event.kind || JSON.stringify(actual) !== JSON.stringify(funding) || JSON.stringify(segments) !== JSON.stringify(response.segments) || JSON.stringify(valuationTotals(segments, funding.gross4, source.quantity)) !== JSON.stringify(response.totals) || !Number.isSafeInteger(response.pending4) || Number(response.pending4) < 0)
        return refuse('valuation_receipt_corrupt');
    await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(JSON.parse(requestJson).kind));
    return { ...response, replayed: true };
}
export async function commitStockValuation(env: {
    DB: D1Database;
    IMPORT_DB?: D1Database;
}, actor: SessionUser, input: unknown) {
    const { raw, kind, sourceId, request, revision, generation } = parseValuationRequest(input);
    const db = getDb(env);
    const authorized = await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(kind));
    const requestJson = JSON.stringify(raw), digest = await feeRequestDigest(requestJson);
    const cached = await replay(db, actor, request, digest, requestJson);
    if (cached)
        return cached;
    const at = new Date().toISOString(), event = crypto.randomUUID(), token = `${request}:valuation`, params: Record<string, unknown> = { source: sourceId, actor: actor.id, event, revision, nextRevision: kind === 'admit' ? 0 : revision + 1, kind, at, token, request, digest, requestJson };
    const statements: Statement[] = [], assertSql = (condition: string) => statements.push({ sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[valuation_assertion_failed]') END`, params });
    const latest = await db.prepare('SELECT id,revision FROM stock_valuation_latest WHERE source_id=@source').get<{
        id: string;
        revision: number;
    }>({ source: sourceId });
    if ((kind === 'admit' && (latest || revision !== 0)) || (kind !== 'admit' && (!latest || latest.revision !== revision)))
        return refuse('valuation_revision_conflict');
    let segments: ValuationSegment[] = latest ? await db.prepare(segmentsSql).all<ValuationSegment>({ event: latest.id }) : [];
    let funding = await db.prepare(fundingSql + ' WHERE source_id=@source ORDER BY generation DESC LIMIT 1').get<Funding>({ source: sourceId });
    if (kind !== 'admit' && (!funding || funding.generation !== generation))
        return refuse('funding_generation_conflict');
    let source = await db.prepare('SELECT * FROM stock_funding_sources WHERE id=@source').get<Source>({ source: sourceId });
    const fundingKind = ['admit', 'pending', 'accept', 'refund', 'payment', 'shipping'].includes(kind);
    let plan: Awaited<ReturnType<typeof planStockFunding>> | null = null, amount4 = 0, agreement: string | null = null, shares: {
        segment_id: string;
        amount4: number;
    }[] = [], targets: {
        allocation_id: string;
        amount4: number;
    }[] = [], pending4 = 0;
    if (kind === 'pending' || kind === 'accept') {
        agreement = identity(raw.agreement_id);
        if (kind === 'pending') {
            amount4 = exactMoney4(raw.amount_usd);
            targets = parseAttributedAmounts(raw.targets, 'allocation_id').map(row => ({ allocation_id: row.target, amount4: row.amount4 }));
            if (new Set(targets.map(t => t.allocation_id)).size !== targets.length || targets.reduce((n, t) => n + t.amount4, 0) !== amount4 || targets.some(t => t.amount4 <= 0 || t.amount4 > segments.filter(s => s.allocation_id === t.allocation_id && (s.fate !== 'sellable' || s.allocation_id !== s.segment_id)).reduce((n, s) => n + s.gross4 - s.coverage4, 0)))
                return refuse('agreement_targets_exceed_basis');
        }
        else {
            const agreed = await db.prepare('SELECT amount4,targets_json FROM stock_valuation_agreements WHERE id=@agreement AND source_id=@source').get<{
                amount4: number;
                targets_json: string;
            }>({ agreement, source: sourceId });
            if (!agreed || !Array.isArray(raw.shares) || !raw.shares.length || raw.shares.length > 100)
                return refuse('explicit_acceptance_shares_required', 400);
            targets = JSON.parse(agreed.targets_json);
            shares = parseAttributedAmounts(raw.shares, 'segment_id').map(row => ({ segment_id: row.target, amount4: row.amount4 }));
            if (new Set(shares.map(s => s.segment_id)).size !== shares.length)
                return refuse('duplicate_accepted_target', 400);
            const prior = await db.prepare('SELECT a.amount4,s.allocation_id FROM stock_valuation_acceptances a JOIN stock_valuation_segments s ON s.event_id=a.event_id AND s.segment_id=a.target_segment_id WHERE a.agreement_id=@agreement').all<{
                amount4: number;
                allocation_id: string;
            }>({ agreement });
            amount4 = shares.reduce((n, s) => n + s.amount4, 0);
            if (amount4 <= 0 || amount4 + prior.reduce((n, s) => n + s.amount4, 0) > agreed.amount4)
                return refuse('agreement_acceptance_exceeded');
            for (const target of targets) {
                const accepted = shares.filter(share => segments.find(s => s.segment_id === share.segment_id)?.allocation_id === target.allocation_id).reduce((n, s) => n + s.amount4, 0);
                if (accepted + prior.filter(s => s.allocation_id === target.allocation_id).reduce((n, s) => n + s.amount4, 0) > target.amount4)
                    return refuse('agreement_target_acceptance_exceeded');
            }
            for (const share of shares) {
                const index = segments.findIndex(s => s.segment_id === share.segment_id);
                if (index < 0 || !targets.some(t => t.allocation_id === segments[index].allocation_id))
                    return refuse('unagreed_coverage_target');
                try {
                    segments[index] = applyValuationCoverage(segments[index], share.amount4);
                }
                catch {
                    return refuse('ineligible_coverage_target');
                }
            }
        }
    }
    if (fundingKind) {
        const fundingRequest = `valuation-fund-${digest}`;
        const fundingInput=buildFundingRequest(raw,kind,sourceId,generation,fundingRequest,agreement);
        plan = await planStockFunding(env, actor, fundingInput, kind === 'accept' ? { acceptedAmount4: amount4, acceptedClaimId: `${agreement}:${event}` } : {});
        if ('replay' in plan)
            return refuse('valuation_orphan_funding_receipt');
        source = plan.source;
        const r = plan.response;
        funding = { id: r.event_id, source_id: sourceId, generation: r.generation, gross4: r.gross4, paid4: r.paid4, debt4: r.debt4, credit4: r.credit4, asset4: r.asset4, cash_in4: r.cash_in4, cash_out4: r.cash_out4, shipping4: r.shipping4 };
    }
    if (!source || !funding)
        return refuse('valuation_source_missing');
    if (kind === 'admit') {
        if (funding.credit4 !== 0)
            return refuse('valuation_existing_credit_requires_exact_adoption');
        segments = [{ segment_id: 'original', allocation_id: 'original', fate: 'sellable', quantity: source.quantity, gross4: source.gross4, coverage4: 0, loss4: 0, recovery4: 0, reason: '' }];
    }
    else {
        const physical = await db.prepare(stockFundingPhysicalSql).get({ batch: source.batch_id, movement: source.movement_id });
        if (JSON.stringify(physical) !== source.source_json)
            return refuse('valuation_source_preimage_changed');
    }
    if (['hold', 'dispose', 'repair'].includes(kind)) {
        const childId = identity(raw.child_segment_id);
        if (await db.prepare('SELECT s.segment_id FROM stock_valuation_segments s JOIN stock_valuation_events e ON e.id=s.event_id WHERE e.source_id=@source AND s.segment_id=@child LIMIT 1').get({ source: sourceId, child: childId }))
            return refuse('valuation_segment_identity_reused');
        segments = planPhysicalSegments(segments, raw, kind);
    }
    segments.sort((a, b) => a.segment_id.localeCompare(b.segment_id));
    let totals: ReturnType<typeof valuationTotals>;
    try {
        totals = valuationTotals(segments, source.gross4, source.quantity);
    }
    catch {
        return refuse('valuation_conservation_failed');
    }
    const before = latest ? await db.prepare(segmentsSql).all<ValuationSegment>({ event: latest.id }) : [];
    const previous = latest ? valuationTotals(before, source.gross4, source.quantity) : totals;
    const sellableBefore = latest ? previous.sellable_quantity : source.quantity, sellableAfter = totals.sellable_quantity;
    const increased = Number(sellableAfter) >= Number(sellableBefore);
    const deltaQuantity = increased ? subtractQuantity(sellableAfter, [sellableBefore]) : subtractQuantity(sellableBefore, [sellableAfter]);
    const delta = Number(deltaQuantity) * (increased ? 1 : -1);
    Object.assign(params, { batch: source.batch_id, movement: source.movement_id, branch: source.branch_id, product: source.product_id, beforeQty: Number(sellableBefore), afterQty: Number(sellableAfter), delta, generation, sourceJson: source.source_json, loss: totals.historical_loss4 - previous.historical_loss4, recovery: totals.recovery4 - previous.recovery4, category: raw.expense_category === undefined ? null : identity(raw.expense_category), name: authorized.name, fundingAllowed: fundingKind ? 1 : 0 });
    Object.assign(params, { permissions: authorized.permissions, role: authorized.role_id, rolePermissions: authorized.role_permissions, roleCode: authorized.role_code });
    const actorGuard = 'EXISTS(SELECT 1 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor AND u.is_active=1 AND u.deleted_at IS NULL AND u.permissions IS @permissions AND u.role_id IS @role AND r.permissions IS @rolePermissions AND r.code IS @roleCode)';
    assertSql(`${actorGuard} AND ${latest ? 'EXISTS(SELECT 1 FROM stock_valuation_latest WHERE source_id=@source AND revision=@revision)' : 'NOT EXISTS(SELECT 1 FROM stock_valuation_sources WHERE source_id=@source)'} AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQty)`);
    const physicalColumns: Record<string, string> = { product_id: 'pb.variant_product_id', supplier_id: 'pb.supplier_id', branch_id: 'pb.received_branch_id', received_quantity: 'pb.received_quantity', received_cost_usd: 'pb.received_cost_usd', batch_active: 'pb.is_active', movement_id: 'im.id', batch_id: 'im.batch_id', movement_product: 'im.product_id', movement_branch: 'im.branch_id', quantity: 'im.quantity', free_quantity: 'im.free_quantity', total_cost_usd: 'im.total_cost_usd', total_cost_khr: 'im.total_cost_khr', movement_type: 'im.movement_type', reference_id: 'im.reference_id', product_active: 'p.is_active', branch_active: 'b.is_active' };
    assertSql(`EXISTS(SELECT 1 FROM product_batches pb JOIN inventory_movements im ON im.batch_id=pb.id JOIN products p ON p.id=pb.variant_product_id JOIN suppliers supplier ON supplier.id=pb.supplier_id JOIN branches b ON b.id=pb.received_branch_id WHERE pb.id=@batch AND im.id=@movement AND ${Object.entries(physicalColumns).map(([key, column]) => `${column} IS json_extract(@sourceJson,'$.${key}')`).join(' AND ')} AND (SELECT COUNT(*) FROM inventory_movements x WHERE x.batch_id=pb.id AND x.movement_type IN ('add','in'))=1)`);
    const aggregates = await db.prepare('SELECT bs.quantity AS branch_quantity,p.stock_quantity AS product_quantity FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE bs.product_id=@product AND bs.branch_id=@branch').get<{
        branch_quantity: number;
        product_quantity: number;
    }>({ product: source.product_id, branch: source.branch_id });
    if (!aggregates)
        return refuse('valuation_aggregate_missing');
    const applyDelta = (value: number) => Number(increased ? sumValuationQuantity([quantityDecimal(value, true), deltaQuantity]) : subtractQuantity(value, [deltaQuantity]));
    Object.assign(params, { branchBefore: aggregates.branch_quantity, productBefore: aggregates.product_quantity, branchAfter: applyDelta(aggregates.branch_quantity), productAfter: applyDelta(aggregates.product_quantity) });
    assertSql('EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity=@branchBefore) AND EXISTS(SELECT 1 FROM products WHERE id=@product AND stock_quantity=@productBefore)');
    statements.push({ sql: 'INSERT INTO stock_valuation_guards(token,valid) VALUES(@token,1)', params });
    if (kind === 'admit') {
        statements.push(...plan!.statements);
        statements.push({ sql: 'INSERT INTO stock_valuation_sources(source_id,opening_json) VALUES(@source,@sourceJson)', params });
    }
    statements.push({ sql: 'INSERT INTO stock_valuation_context(token,source_id,batch_id,branch_id,remaining_quantity,funding_allowed) VALUES(@token,@source,@batch,@branch,@afterQty,@fundingAllowed)', params });
    if (kind !== 'admit' && plan && !('replay' in plan))
        statements.push(...plan.statements);
    if (kind === 'pending')
        statements.push({ sql: 'INSERT INTO stock_valuation_agreements(id,source_id,amount4,targets_json,proof) VALUES(@agreement,@source,@amount,@targets,@proof)', params: { ...params, agreement, amount: amount4, targets: JSON.stringify(targets), proof: identity(raw.proof) } });
    statements.push({ sql: 'INSERT INTO stock_valuation_events(id,source_id,revision,kind,loss4,recovery4,expense_category,actor_id,occurred_at) VALUES(@event,@source,@nextRevision,@kind,@loss,@recovery,@category,@actor,@at)', params });
    for (const segment of segments)
        statements.push({ sql: 'INSERT INTO stock_valuation_segments(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason) VALUES(@event,@segment_id,@allocation_id,@fate,@quantity,@gross4,@coverage4,@loss4,@recovery4,@reason)', params: { event, ...segment } });
    for (const share of shares)
        statements.push({ sql: 'INSERT INTO stock_valuation_acceptances(event_id,agreement_id,target_segment_id,amount4,funding_event_id) VALUES(@event,@agreement,@segment,@amount,@funding)', params: { event, agreement, segment: share.segment_id, amount: share.amount4, funding: funding.id } });
    if (sellableAfter !== sellableBefore)
        statements.push({ sql: 'UPDATE branch_batch_stock SET quantity=@afterQty WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQty', params }, { sql: 'UPDATE branch_stock SET quantity=@branchAfter WHERE product_id=@product AND branch_id=@branch AND quantity=@branchBefore', params }, { sql: 'UPDATE products SET stock_quantity=@productAfter WHERE id=@product AND stock_quantity=@productBefore', params });
    const agreements = await db.prepare('SELECT a.amount4-(SELECT COALESCE(SUM(x.amount4),0) FROM stock_valuation_acceptances x WHERE x.agreement_id=a.id) pending4 FROM stock_valuation_agreements a WHERE a.source_id=@source').all<{
        pending4: number;
    }>({ source: sourceId });
    pending4 = agreements.reduce((n, a) => n + a.pending4, 0) + (kind === 'pending' ? amount4 : 0) - (kind === 'accept' ? amount4 : 0);
    const response = { valuation_version: 3, source_id: sourceId, event_id: event, revision: Number(params.nextRevision), kind, funding, segments, totals, pending4 }, responseJson = JSON.stringify(response);
    Object.assign(params, { responseJson, segmentsJson: JSON.stringify(segments), fundingId: funding.id });
    statements.push({ sql: 'INSERT INTO stock_valuation_receipts(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(@request,@event,@actor,@digest,@requestJson,@responseJson)', params }, { sql: "INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@kind,'stock_valuation',@event,@responseJson,'stock_valuation_events',@event,@responseJson)", params });
    assertSql(`${actorGuard} AND EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token AND source_id=@source AND remaining_quantity=@afterQty) AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@afterQty) AND EXISTS(SELECT 1 FROM stock_valuation_latest WHERE id=@event AND revision=@nextRevision AND loss4=@loss AND recovery4=@recovery) AND EXISTS(SELECT 1 FROM stock_valuation_receipts WHERE request_id=@request AND event_id=@event AND actor_id=@actor AND response_json=@responseJson AND request_json=@requestJson AND request_digest=@digest) AND (SELECT COUNT(*) FROM audit_logs WHERE entity='stock_valuation' AND entity_id=@event AND details=@responseJson)=1 AND EXISTS(SELECT 1 FROM stock_funding_latest WHERE id=@fundingId)`);
    for (const segment of segments)
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_segments WHERE event_id=@event AND segment_id=@segment_id AND allocation_id=@allocation_id AND fate=@fate AND quantity=@quantity AND gross4=@gross4 AND coverage4=@coverage4 AND loss4=@loss4 AND recovery4=@recovery4 AND reason=@reason) THEN 1 ELSE json_extract('[1]','$[valuation_segment_missing]') END`, params: { event, ...segment } });
    if (kind === 'pending')
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_agreements WHERE id=@agreement AND source_id=@source AND amount4=@amount AND targets_json=@targets AND proof=@proof) THEN 1 ELSE json_extract('[1]','$[valuation_agreement_missing]') END`, params: { ...params, agreement, amount: amount4, targets: JSON.stringify(targets), proof: identity(raw.proof) } });
    for (const share of shares)
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_acceptances WHERE event_id=@event AND agreement_id=@agreement AND target_segment_id=@segment AND amount4=@amount AND funding_event_id=@funding) THEN 1 ELSE json_extract('[1]','$[valuation_acceptance_missing]') END`, params: { event, agreement, segment: share.segment_id, amount: share.amount4, funding: funding.id } });
    assertSql('EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity=@branchAfter) AND EXISTS(SELECT 1 FROM products WHERE id=@product AND stock_quantity=@productAfter)');
    statements.push({ sql: 'DELETE FROM stock_valuation_context WHERE token=@token', params }, { sql: 'DELETE FROM stock_valuation_guards WHERE token=@token', params });
    assertSql('NOT EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token) AND NOT EXISTS(SELECT 1 FROM stock_valuation_guards WHERE token=@token)');
    try {
        await ordinaryBusinessBatch(db, statements);
    }
    catch {
        await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(kind));
        const saved = await replay(db, actor, request, digest, requestJson);
        if (saved)
            return saved;
        return refuse('valuation_atomic_conflict');
    }
    await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(kind));
    return { ...response, replayed: false };
}
