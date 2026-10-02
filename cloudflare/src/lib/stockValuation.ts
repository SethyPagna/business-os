import { getDb, type D1Compat } from './db';
import type { SessionUser } from './auth';
import { currentFundingActor, planStockFunding, stockFundingPhysicalSql } from './stockFunding';
import { ordinaryBusinessBatch } from './businessMaintenanceGuard';
import { exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis';
import { feeRequestDigest, normalizeFeeRequestId } from './feeOperationReceipt';
import { applyValuationCoverage, planValuationSaleSegments, splitValuationSegment, sumValuationQuantity, valuationSegmentsV4, valuationTotals, type ValuationSegment } from './stockValuationMath';
import { assertValuationHistoryCapacity, validateValuationHistory } from './stockValuationHistory';
import { getActionTier, hasAnyPermission } from './permissions';
import { actorSnapshot } from './actorSnapshot';
import { commitStockEpochTransition } from './stockEpochPublication';
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
const segmentsSql = 'SELECT segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason,consumption_id,consumed_cost4,consumed_recovery4 FROM stock_valuation_history_segments WHERE event_id=@event ORDER BY segment_id';
async function readSegments(db: D1Compat, event: string, version: number) {
    const rows = await db.prepare(segmentsSql).all<ValuationSegment>({ event });
    return version === 4 ? rows : rows.map(({ consumption_id, consumed_cost4, consumed_recovery4, ...segment }) => segment);
}
export async function currentValuationSaleActor(db: D1Compat, actor: SessionUser, kind: string) {
    const current = await db.prepare('SELECT u.id,u.username,u.name,u.permissions,u.role_id,u.is_active,u.deleted_at,r.code AS role_code,r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@actor').get<SessionUser & { deleted_at: string | null }>({ actor: actor.id });
    if (!current || current.is_active !== 1 || current.deleted_at || (kind === 'consume' ? !hasAnyPermission(current, ['pos', 'sales']) : getActionTier(current, 'sales', 'status') !== 'full')) return refuse('valuation_sale_permission_denied', 403);
    return current;
}
function parseValuationRequest(input: unknown, allowSale = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return refuse('invalid_request', 400);
    const raw = input as Record<string, unknown>;
    const saleFields = ['consumption_id', 'sale_request_id', 'sale_line_key', 'sale_intent_json', 'operation_id'];
    const allowed = ['kind', 'source_id', 'expected_revision', 'expected_generation', 'client_request_id', 'funding', 'segment_id', 'child_segment_id', 'quantity', 'reason', 'expense_category', 'agreement_id', 'amount_usd', 'targets', 'shares', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at', 'fee_id', ...(allowSale ? saleFields : [])];
    if (Object.keys(raw).some(key => !allowed.includes(key)))
        return refuse('unsupported_valuation_field', 400);
    const kind = identity(raw.kind), sourceId = identity(raw.source_id), request = normalizeFeeRequestId(raw.client_request_id);
    if (!request || !Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0 || !Number.isSafeInteger(raw.expected_generation) || Number(raw.expected_generation) < 0)
        return refuse('invalid_valuation_revision', 400);
    if (!['admit', 'hold', 'dispose', 'repair', 'pending', 'accept', 'refund', 'payment', 'shipping', ...(allowSale ? ['consume', 'restore', 'reconsume'] : [])].includes(kind))
        return refuse('unsupported_valuation_transition', 400);
    const fields: Record<string, string[]> = { admit: ['funding'], hold: ['segment_id', 'child_segment_id', 'quantity', 'reason'], dispose: ['segment_id', 'child_segment_id', 'quantity', 'expense_category'], repair: ['segment_id', 'child_segment_id', 'quantity'], pending: ['agreement_id', 'amount_usd', 'targets', 'proof'], accept: ['agreement_id', 'shares', 'proof'], refund: ['amount_usd', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at'], payment: ['amount_usd', 'proof', 'cash_method', 'cash_reference', 'cash_recorded_at'], shipping: ['amount_usd', 'proof', 'fee_id'] };
    for (const saleKind of ['consume', 'restore', 'reconsume']) fields[saleKind] = ['segment_id', 'quantity', ...(saleKind === 'consume' ? ['child_segment_id'] : []), ...saleFields];
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
function parseValuationMoney(value: unknown) {
    try { return exactMoney4(value); }
    catch { return refuse('unsupported_valuation_money_precision', 400); }
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
    const saved = await db.prepare('SELECT * FROM stock_valuation_history_receipts WHERE request_id=@request').get<{
        actor_id: number;
        request_digest: string;
        request_json: string;
        response_json: string;
        event_id: string;
    }>({ request });
    if (!saved)
        return null;
    await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(JSON.parse(requestJson).kind));
    await checkedHistory(db, JSON.parse(requestJson).source_id);
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
    if (!response || Array.isArray(response) || Object.keys(response).join('|') !== keys.join('|') || JSON.stringify(response) !== saved.response_json || ![3,4].includes(Number(response.valuation_version)) || response.event_id !== saved.event_id)
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
    const event = await db.prepare('SELECT source_id,revision,kind,schema_version FROM stock_valuation_history_events WHERE id=@event').get({ event: saved.event_id });
    const segments = await readSegments(db, saved.event_id, Number(response.valuation_version));
    const funding = response.funding as Funding;
    const source = await db.prepare('SELECT quantity FROM stock_funding_sources WHERE id=@source').get<{
        quantity: string;
    }>({ source: response.source_id });
    const actual = await db.prepare(fundingSql + ' WHERE id=@id AND source_id=@source').get<Funding>({ id: funding?.id, source: response.source_id });
    if (!event || !source || response.valuation_version !== event.schema_version || response.source_id !== event.source_id || response.revision !== event.revision || response.kind !== event.kind || JSON.stringify(actual) !== JSON.stringify(funding) || JSON.stringify(segments) !== JSON.stringify(response.segments) || JSON.stringify(valuationTotals(segments, funding.gross4, source.quantity, Number(response.valuation_version))) !== JSON.stringify(response.totals) || !Number.isSafeInteger(response.pending4) || Number(response.pending4) < 0)
        return refuse('valuation_receipt_corrupt');
    await checkedHistory(db, response.source_id);
    await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(JSON.parse(requestJson).kind));
    return { ...response, replayed: true };
}
export async function checkedHistory(db: D1Compat, source: unknown) {
    try { return await validateValuationHistory(db, identity(source), { parseRequest: input => parseValuationRequest(input, true), parseAmounts: parseAttributedAmounts, planPhysical: planPhysicalSegments }); }
    catch (error) { return refuse(error instanceof Error && error.message === 'valuation_history_limit' ? 'valuation_history_limit' : 'valuation_history_corrupt'); }
}
export async function planStockValuation(env: {
    DB: D1Database;
    IMPORT_DB?: D1Database;
}, actor: SessionUser, input: unknown, saleBinding?: { productId: number; batchId: number; branchId: number; allocationId?: number }) {
    const { raw, kind, sourceId, request, revision, generation } = parseValuationRequest(input, !!saleBinding);
    const db = getDb(env);
    const sale = ['consume', 'restore', 'reconsume'].includes(kind);
    if (saleBinding && !sale) return refuse('valuation_sale_command_required', 400);
    const authorized = sale ? await currentValuationSaleActor(db, actor, kind) : await currentFundingActor(db, actor, ['refund', 'payment', 'shipping'].includes(kind));
    if (kind === 'pending') parseValuationMoney(raw.amount_usd);
    const requestJson = JSON.stringify(raw), digest = await feeRequestDigest(requestJson);
    const history = await checkedHistory(db, sourceId);
    const cached = sale ? null : await replay(db, actor, request, digest, requestJson);
    if (cached)
        return { replay: cached };
    const at = new Date().toISOString(), event = crypto.randomUUID(), token = `${request}:valuation`, params: Record<string, unknown> = { source: sourceId, actor: actor.id, event, revision, nextRevision: kind === 'admit' ? 0 : revision + 1, kind, at, token, request, digest, requestJson };
    const statements: Statement[] = [...history.guards], assertSql = (condition: string) => statements.push({ sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[valuation_assertion_failed]') END`, params });
    const latest = await db.prepare('SELECT id,revision,schema_version FROM stock_valuation_latest WHERE source_id=@source').get<{
        id: string;
        revision: number;
        schema_version: number;
    }>({ source: sourceId });
    if ((kind === 'admit' && (latest || revision !== 0)) || (kind !== 'admit' && (!latest || latest.revision !== revision)))
        return refuse('valuation_revision_conflict');
    const version = sale || latest?.schema_version === 4 ? 4 : 3;
    let segments: ValuationSegment[] = latest ? await readSegments(db, latest.id, latest.schema_version) : [];
    if (version === 4) segments = valuationSegmentsV4(segments);
    let funding = await db.prepare(fundingSql + ' WHERE source_id=@source ORDER BY generation DESC LIMIT 1').get<Funding>({ source: sourceId });
    if (kind !== 'admit' && (!funding || funding.generation !== generation))
        return refuse('funding_generation_conflict');
    let source = await db.prepare('SELECT * FROM stock_funding_sources WHERE id=@source').get<Source>({ source: sourceId });
    if (saleBinding && (!source || source.product_id !== saleBinding.productId || source.batch_id !== saleBinding.batchId || source.branch_id !== saleBinding.branchId)) return refuse('valuation_sale_source_mismatch');
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
            amount4 = parseValuationMoney(raw.amount_usd);
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
            const prior = await db.prepare('SELECT a.amount4,s.allocation_id FROM stock_valuation_history_acceptances a JOIN stock_valuation_history_segments s ON s.event_id=a.event_id AND s.segment_id=a.target_segment_id WHERE a.agreement_id=@agreement').all<{
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
        if (await db.prepare('SELECT s.segment_id FROM stock_valuation_history_segments s JOIN stock_valuation_history_events e ON e.id=s.event_id WHERE e.source_id=@source AND s.segment_id=@child LIMIT 1').get({ source: sourceId, child: childId }))
            return refuse('valuation_segment_identity_reused');
        if (segments.find(segment => segment.segment_id === raw.segment_id)?.consumption_id) return refuse('valuation_sale_segment_dependency');
        segments = planPhysicalSegments(segments, raw, kind);
    }
    if (sale) {
        for (const key of ['consumption_id', 'sale_request_id', 'sale_line_key', 'operation_id']) identity(raw[key]);
        if (typeof raw.sale_intent_json !== 'string' || JSON.stringify(JSON.parse(raw.sale_intent_json)) !== raw.sale_intent_json) return refuse('valuation_sale_intent_invalid', 400);
        if (kind === 'consume' && await db.prepare('SELECT 1 FROM stock_valuation_history_segments s JOIN stock_valuation_history_events e ON e.id=s.event_id WHERE e.source_id=@source AND s.segment_id=@child').get({ source: sourceId, child: identity(raw.child_segment_id) })) return refuse('valuation_segment_identity_reused');
        if (kind !== 'consume' && !await db.prepare('SELECT 1 FROM stock_valuation_sale_links WHERE id=@id AND source_id=@source AND segment_id=@segment AND sale_allocation_id=@allocation AND sale_request_id=@saleRequest AND sale_line_key=@line AND sale_intent_json=@intent').get({ id: raw.consumption_id, source: sourceId, segment: raw.segment_id, allocation: saleBinding!.allocationId, saleRequest: raw.sale_request_id, line: raw.sale_line_key, intent: raw.sale_intent_json })) return refuse('valuation_sale_link_conflict');
        try { segments = planValuationSaleSegments(segments, { kind: kind as 'consume' | 'restore' | 'reconsume', segment_id: identity(raw.segment_id), child_segment_id: kind === 'consume' ? identity(raw.child_segment_id) : undefined, quantity: raw.quantity, consumption_id: identity(raw.consumption_id) }); }
        catch { return refuse('valuation_sale_segment_conflict'); }
    }
    segments.sort((a, b) => a.segment_id.localeCompare(b.segment_id));
    let totals: ReturnType<typeof valuationTotals>;
    try {
        totals = valuationTotals(segments, source.gross4, source.quantity, version);
    }
    catch {
        return refuse('valuation_conservation_failed');
    }
    const before = latest ? await readSegments(db, latest.id, latest.schema_version) : [];
    const previous = latest ? valuationTotals(before, source.gross4, source.quantity, latest.schema_version) : totals;
    const sellableBefore = latest ? previous.sellable_quantity : source.quantity, sellableAfter = totals.sellable_quantity;
    const increased = Number(sellableAfter) >= Number(sellableBefore);
    const deltaQuantity = increased ? subtractQuantity(sellableAfter, [sellableBefore]) : subtractQuantity(sellableBefore, [sellableAfter]);
    const delta = Number(deltaQuantity) * (increased ? 1 : -1);
    Object.assign(params, { batch: source.batch_id, movement: source.movement_id, branch: source.branch_id, product: source.product_id, beforeQty: Number(sellableBefore), afterQty: Number(sellableAfter), delta, generation, sourceJson: source.source_json, loss: totals.historical_loss4 - previous.historical_loss4, recovery: totals.recovery4 - previous.recovery4, category: raw.expense_category === undefined ? null : identity(raw.expense_category), name: authorized.name, fundingAllowed: fundingKind ? 1 : 0 });
    Object.assign(params, { permissions: authorized.permissions, role: authorized.role_id, rolePermissions: authorized.role_permissions, roleCode: authorized.role_code });
    Object.assign(params, { consumedCost: (totals.consumed_cost4 ?? 0) - (previous.consumed_cost4 ?? 0), consumedRecovery: (totals.consumed_recovery4 ?? 0) - (previous.consumed_recovery4 ?? 0) });
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
    const suffix = version === 4 ? '_v4' : '';
    if (version === 3) statements.push({ sql: 'INSERT INTO stock_valuation_context(token,source_id,batch_id,branch_id,remaining_quantity,funding_allowed) VALUES(@token,@source,@batch,@branch,@afterQty,@fundingAllowed)', params });
    if (version === 3 && kind !== 'admit' && plan && !('replay' in plan)) statements.push(...plan.statements);
    if (kind === 'pending')
        statements.push({ sql: 'INSERT INTO stock_valuation_agreements(id,source_id,amount4,targets_json,proof) VALUES(@agreement,@source,@amount,@targets,@proof)', params: { ...params, agreement, amount: amount4, targets: JSON.stringify(targets), proof: identity(raw.proof) } });
    statements.push({ sql: `INSERT INTO stock_valuation_events${suffix}(id,source_id,revision,kind,loss4,recovery4,expense_category,actor_id,occurred_at${version === 4 ? ',consumed_cost4,consumed_recovery4' : ''}) VALUES(@event,@source,@nextRevision,@kind,@loss,@recovery,@category,@actor,@at${version === 4 ? ',@consumedCost,@consumedRecovery' : ''})`, params });
    for (const segment of segments)
        statements.push({ sql: `INSERT INTO stock_valuation_segments${suffix}(event_id,segment_id,allocation_id,fate,quantity,gross4,coverage4,loss4,recovery4,reason${version === 4 ? ',consumption_id,consumed_cost4,consumed_recovery4' : ''}) VALUES(@event,@segment_id,@allocation_id,@fate,@quantity,@gross4,@coverage4,@loss4,@recovery4,@reason${version === 4 ? ',@consumption_id,@consumed_cost4,@consumed_recovery4' : ''})`, params: { event, ...segment } });
    if (sale) {
        Object.assign(params, { consumption: raw.consumption_id, saleRequest: raw.sale_request_id, line: raw.sale_line_key, intent: raw.sale_intent_json, saleSegment: kind === 'consume' ? raw.child_segment_id : raw.segment_id, saleQuantity: quantityDecimal(raw.quantity), releasedBefore: kind === 'reconsume' ? Number(raw.quantity) : 0, releasedAfter: kind === 'restore' ? Number(raw.quantity) : 0 });
        const movementIds = await db.prepare("SELECT m.id FROM inventory_movements m JOIN sales s ON CAST(s.id AS TEXT)=CAST(m.reference_id AS TEXT) WHERE s.client_request_id=@saleRequest AND m.product_id=@product AND m.movement_type IN ('sale','return') ORDER BY m.id").all<{ id: number }>({ saleRequest: raw.sale_request_id, product: source.product_id });
        const captured = segments.find(segment => segment.consumption_id === raw.consumption_id)!;
        const lineCost = kind === 'consume' ? { usd: Math.round(captured.consumed_cost4! / Number(raw.quantity)) / 10000, khr: 0 } : await db.prepare('SELECT COALESCE(i.cost_price_usd,0) AS usd,COALESCE(i.cost_price_khr,0) AS khr FROM sale_items i JOIN stock_valuation_sale_links l ON l.sale_item_id=i.id WHERE l.id=@id').get<{ usd: number; khr: number }>({ id: raw.consumption_id });
        Object.assign(params, { beforeMovementIds: JSON.stringify(movementIds.map(row => row.id)), beforeMovementCount: movementIds.length, movementKind: kind === 'restore' ? 'return' : 'sale', movementQuantity: Number(raw.quantity) * (kind === 'restore' ? 1 : -1), movementUsd: lineCost!.usd, movementKhr: lineCost!.khr, movementName: actorSnapshot(actor) });
        assertSql("(SELECT COUNT(*) FROM inventory_movements m JOIN sales s ON CAST(s.id AS TEXT)=CAST(m.reference_id AS TEXT) WHERE s.client_request_id=@saleRequest AND m.product_id=@product AND m.movement_type IN ('sale','return'))=@beforeMovementCount");
        if (kind === 'consume') statements.push({ sql: `INSERT INTO stock_valuation_sale_links(id,source_id,original_event_id,segment_id,sale_id,sale_item_id,sale_allocation_id,quantity,sale_request_id,sale_line_key,sale_intent_json) SELECT @consumption,@source,@event,@saleSegment,s.id,i.id,a.id,@saleQuantity,@saleRequest,@line,@intent FROM sales s JOIN sale_items i ON i.sale_id=s.id JOIN sale_item_batch_allocations a ON a.sale_item_id=i.id WHERE s.client_request_id=@saleRequest AND json_extract(i.pricing_snapshot_json,'$.line_key')=@line AND i.product_id=@product AND i.batch_id=@batch AND i.branch_id=@branch AND i.quantity=CAST(@saleQuantity AS REAL) AND a.batch_id=@batch AND a.branch_id=@branch AND a.quantity=i.quantity AND a.released_quantity=0 AND s.sale_status<>'cancelled'`, params });
        statements.push({ sql: 'INSERT INTO stock_valuation_sale_operation_context(token,event_id,source_id,kind,segment_id,consumption_id,sale_allocation_id,released_before,released_after,remaining_quantity) SELECT @token,@event,@source,@kind,@saleSegment,@consumption,sale_allocation_id,@releasedBefore,@releasedAfter,@afterQty FROM stock_valuation_sale_links WHERE id=@consumption', params });
    }
    if (version === 4) statements.push({ sql: 'INSERT INTO stock_valuation_context(token,source_id,batch_id,branch_id,remaining_quantity,funding_allowed,operation_id) VALUES(@token,@source,@batch,@branch,@afterQty,@fundingAllowed,@event)', params });
    if (version === 4 && plan && !('replay' in plan)) statements.push(...plan.statements);
    for (const share of shares)
        statements.push({ sql: `INSERT INTO stock_valuation_acceptances${suffix}(event_id,agreement_id,target_segment_id,amount4,funding_event_id) VALUES(@event,@agreement,@segment,@amount,@funding)`, params: { event, agreement, segment: share.segment_id, amount: share.amount4, funding: funding.id } });
    const prefixLength = statements.length;
    if (sale) {
        const movementJson = "json_object('product_id',m.product_id,'branch_id',m.branch_id,'batch_id',m.batch_id,'movement_type',m.movement_type,'quantity',m.quantity,'unit_cost_usd',m.unit_cost_usd,'unit_cost_khr',m.unit_cost_khr,'reference_id',m.reference_id,'user_id',m.user_id,'user_name',m.user_name)";
        statements.push({ sql: `INSERT INTO stock_valuation_sale_movements(event_id,consumption_id,movement_id,movement_json) SELECT @event,@consumption,m.id,${movementJson} FROM inventory_movements m JOIN stock_valuation_sale_links l ON l.id=@consumption AND CAST(l.sale_id AS TEXT)=CAST(m.reference_id AS TEXT) WHERE m.id NOT IN (SELECT value FROM json_each(@beforeMovementIds)) AND m.product_id=@product AND m.batch_id=@batch AND m.branch_id=@branch AND m.movement_type=@movementKind AND m.quantity=@movementQuantity AND m.unit_cost_usd IS @movementUsd AND m.unit_cost_khr IS @movementKhr AND m.user_id=@actor AND m.user_name IS @movementName`, params });
        assertSql(`EXISTS(SELECT 1 FROM stock_valuation_sale_movements v JOIN inventory_movements m ON m.id=v.movement_id WHERE v.event_id=@event AND v.consumption_id=@consumption AND v.movement_json=${movementJson} AND m.product_id=@product AND m.batch_id=@batch AND m.branch_id=@branch AND m.movement_type=@movementKind AND m.quantity=@movementQuantity AND m.unit_cost_usd IS @movementUsd AND m.unit_cost_khr IS @movementKhr AND m.user_id=@actor AND m.user_name IS @movementName) AND (SELECT COUNT(*) FROM inventory_movements m JOIN sales s ON CAST(s.id AS TEXT)=CAST(m.reference_id AS TEXT) WHERE s.client_request_id=@saleRequest AND m.product_id=@product AND m.movement_type IN ('sale','return'))=@beforeMovementCount+1`);
    }
    if (!sale && sellableAfter !== sellableBefore)
        statements.push({ sql: 'UPDATE branch_batch_stock SET quantity=@afterQty WHERE batch_id=@batch AND branch_id=@branch AND quantity=@beforeQty', params }, { sql: 'UPDATE branch_stock SET quantity=@branchAfter WHERE product_id=@product AND branch_id=@branch AND quantity=@branchBefore', params }, { sql: 'UPDATE products SET stock_quantity=@productAfter WHERE id=@product AND stock_quantity=@productBefore', params });
    const agreements = await db.prepare('SELECT a.amount4-(SELECT COALESCE(SUM(x.amount4),0) FROM stock_valuation_history_acceptances x WHERE x.agreement_id=a.id) pending4 FROM stock_valuation_agreements a WHERE a.source_id=@source').all<{
        pending4: number;
    }>({ source: sourceId });
    pending4 = agreements.reduce((n, a) => n + a.pending4, 0) + (kind === 'pending' ? amount4 : 0) - (kind === 'accept' ? amount4 : 0);
    const response = { valuation_version: version, source_id: sourceId, event_id: event, revision: Number(params.nextRevision), kind, funding, segments, totals, pending4 }, responseJson = JSON.stringify(response);
    Object.assign(params, { responseJson, segmentsJson: JSON.stringify(segments), fundingId: funding.id });
    statements.push({ sql: `INSERT INTO stock_valuation_receipts${suffix}(request_id,event_id,actor_id,request_digest,request_json,response_json) VALUES(@request,@event,@actor,@digest,@requestJson,@responseJson)`, params }, { sql: "INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@actor,@name,@kind,'stock_valuation',@event,@responseJson,'stock_valuation_events',@event,@responseJson)", params });
    assertSql(`${actorGuard} AND EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token AND source_id=@source AND remaining_quantity=@afterQty) AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity=@afterQty) AND EXISTS(SELECT 1 FROM stock_valuation_latest WHERE id=@event AND revision=@nextRevision AND loss4=@loss AND recovery4=@recovery AND consumed_cost4=@consumedCost AND consumed_recovery4=@consumedRecovery) AND EXISTS(SELECT 1 FROM stock_valuation_history_receipts WHERE request_id=@request AND event_id=@event AND actor_id=@actor AND response_json=@responseJson AND request_json=@requestJson AND request_digest=@digest) AND EXISTS(SELECT 1 FROM stock_valuation_event_identities WHERE event_id=@event AND source_id=@source AND revision=@nextRevision) AND EXISTS(SELECT 1 FROM stock_valuation_request_identities WHERE request_id=@request AND event_id=@event) AND (SELECT COUNT(*) FROM audit_logs WHERE entity='stock_valuation' AND entity_id=@event AND details=@responseJson)=1 AND EXISTS(SELECT 1 FROM stock_funding_latest WHERE id=@fundingId)`);
    for (const segment of segments)
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_history_segments WHERE event_id=@event AND segment_id=@segment_id AND allocation_id=@allocation_id AND fate=@fate AND quantity=@quantity AND gross4=@gross4 AND coverage4=@coverage4 AND loss4=@loss4 AND recovery4=@recovery4 AND reason=@reason${version === 4 ? ' AND consumption_id IS @consumption_id AND consumed_cost4=@consumed_cost4 AND consumed_recovery4=@consumed_recovery4' : ''}) THEN 1 ELSE json_extract('[1]','$[valuation_segment_missing]') END`, params: { event, ...segment } });
    if (kind === 'pending')
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_agreements WHERE id=@agreement AND source_id=@source AND amount4=@amount AND targets_json=@targets AND proof=@proof) THEN 1 ELSE json_extract('[1]','$[valuation_agreement_missing]') END`, params: { ...params, agreement, amount: amount4, targets: JSON.stringify(targets), proof: identity(raw.proof) } });
    for (const share of shares)
        statements.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_valuation_history_acceptances WHERE event_id=@event AND agreement_id=@agreement AND target_segment_id=@segment AND amount4=@amount AND funding_event_id=@funding) THEN 1 ELSE json_extract('[1]','$[valuation_acceptance_missing]') END`, params: { event, agreement, segment: share.segment_id, amount: share.amount4, funding: funding.id } });
    if (sale) {
        assertSql("EXISTS(SELECT 1 FROM stock_valuation_sale_operation_context x JOIN stock_valuation_sale_links l ON l.id=x.consumption_id JOIN sale_item_batch_allocations a ON a.id=l.sale_allocation_id JOIN sale_items i ON i.id=l.sale_item_id JOIN sales s ON s.id=l.sale_id WHERE x.token=@token AND x.event_id=@event AND x.consumption_id=@consumption AND x.segment_id=@saleSegment AND l.source_id=@source AND l.sale_request_id=@saleRequest AND l.sale_line_key=@line AND l.sale_intent_json=@intent AND a.released_quantity=@releasedAfter AND a.sale_item_id=i.id AND i.sale_id=s.id AND s.sale_status=CASE WHEN @kind='restore' THEN 'cancelled' ELSE s.sale_status END AND (@kind='restore' OR s.sale_status<>'cancelled'))");
        statements.push({ sql: 'DELETE FROM stock_valuation_sale_operation_context WHERE token=@token', params });
    }
    assertSql('EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity=@branchAfter) AND EXISTS(SELECT 1 FROM products WHERE id=@product AND stock_quantity=@productAfter)');
    statements.push({ sql: 'DELETE FROM stock_valuation_context WHERE token=@token', params }, { sql: 'DELETE FROM stock_valuation_guards WHERE token=@token', params });
    assertSql('NOT EXISTS(SELECT 1 FROM stock_valuation_context WHERE token=@token) AND NOT EXISTS(SELECT 1 FROM stock_valuation_guards WHERE token=@token) AND NOT EXISTS(SELECT 1 FROM stock_valuation_sale_operation_context WHERE token=@token)');
    try { assertValuationHistoryCapacity(history, kind, segments.length, shares.length, statements.length); }
    catch { return refuse('valuation_history_limit'); }
    return { statements, prefix: statements.slice(0, prefixLength), finish: statements.slice(prefixLength), response, request, digest, requestJson, cash: ['refund', 'payment', 'shipping'].includes(kind) };
}

export async function commitStockValuation(env: { DB: D1Database; IMPORT_DB?: D1Database }, actor: SessionUser, input: unknown) {
    const typed = await commitStockEpochTransition(env, actor, parseValuationRequest(input).raw);
    if (typed) return typed;
    const plan = await planStockValuation(env, actor, input);
    if ('replay' in plan) return plan.replay;
    const db = getDb(env);
    try {
        await ordinaryBusinessBatch(db, plan.statements);
    }
    catch {
        await currentFundingActor(db, actor, plan.cash);
        const saved = await replay(db, actor, plan.request, plan.digest, plan.requestJson);
        if (saved)
            return saved;
        return refuse('valuation_atomic_conflict');
    }
    await currentFundingActor(db, actor, plan.cash);
    return { ...plan.response, replayed: false };
}
