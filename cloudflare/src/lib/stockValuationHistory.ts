import type { D1Compat } from './db';
import { stockFundingPhysicalSql } from './stockFunding';
import { fundingTransition, type FundingKind, type FundingState } from './stockFundingMath';
import { exactMoney4, quantityDecimal, subtractQuantity } from './stockDispositionBasis';
import { feeRequestDigest, normalizeFeeRequestId } from './feeOperationReceipt';
import { applyValuationCoverage, planValuationSaleSegments, valuationSegmentsV4, valuationTotals, type ValuationSegment } from './stockValuationMath';

type Row = Record<string, any>;
type Statement = { sql: string; params: Record<string, unknown> };
type Request = { raw: Record<string, unknown>; kind: string; sourceId: string; request: string; revision: number; generation: number };
type HistoryRules = {
    parseRequest(input: unknown): Request;
    parseAmounts(input: unknown, key: 'allocation_id' | 'segment_id'): { target: string; amount4: number }[];
    planPhysical(segments: ValuationSegment[], raw: Record<string, unknown>, kind: string): ValuationSegment[];
};
type Agreement = { amount4: number; targets: { allocation_id: string; amount4: number }[]; accepted: Map<string, number> };
const requireHistory = (condition: unknown): void => { if (!condition) throw new Error('valuation_history_corrupt'); };
const maximumHistoryRows = 256;
const maximumHistoryEvents = 32;
const same = (actual: unknown, expected: unknown) => requireHistory(JSON.stringify(actual) === JSON.stringify(expected));
function canonicalJson(value: string): Row {
    const parsed = JSON.parse(value);
    requireHistory(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && JSON.stringify(parsed) === value);
    return parsed;
}
function sameFields(actual: Row | undefined, expected: Row) {
    requireHistory(actual);
    for (const [key, value] of Object.entries(expected)) requireHistory(actual![key] === value);
}
function normalizedText(value: unknown, max = 500): string {
    requireHistory(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max);
    return (value as string).trim();
}
function positiveAmount(value: unknown) {
    const amount = exactMoney4(value);
    requireHistory(amount > 0);
    return amount;
}
function acceptedTotal(agreement: Agreement) {
    return [...agreement.accepted.values()].reduce((sum, amount) => sum + amount, 0);
}
function pendingTotal(agreements: Map<string, Agreement>) {
    return [...agreements.values()].reduce((sum, agreement) => sum + agreement.amount4 - acceptedTotal(agreement), 0);
}
function projectedFunding(event: Row) {
    return { id: event.id, source_id: event.source_id, generation: event.generation, gross4: event.gross4, paid4: event.paid4, debt4: event.debt4, credit4: event.credit4, asset4: event.asset4, cash_in4: event.cash_in4, cash_out4: event.cash_out4, shipping4: event.shipping4 };
}
function assertAudit(rows: Row[], entity: string, event: Row, response: string) {
    const evidence = rows.filter(row => row.entity === entity && row.entity_id === event.id);
    requireHistory(evidence.length === 1);
    sameFields(evidence[0], { user_id: event.actor_id, action: event.kind, entity, entity_id: event.id, details: response, table_name: `${entity}_events`, record_id: event.id, new_value: response });
}
function sourceOpening(source: Row) {
    return { id: source.id, movement_id: source.movement_id, batch_id: source.batch_id, product_id: source.product_id, branch_id: source.branch_id, supplier_id: source.supplier_id, quantity: source.quantity, free_quantity: source.free_quantity, gross4: source.gross4, opening_paid4: source.opening_paid4, opening_debt4: source.opening_debt4, reconciliation_proof: source.reconciliation_proof, invoice_id: source.invoice_id };
}
function validateOpening(source: Row, raw: Record<string, unknown>, actor: number) {
    requireHistory(raw.funding && typeof raw.funding === 'object' && !Array.isArray(raw.funding));
    const opening = raw.funding as Record<string, unknown>;
    const keys = ['movement_id', 'batch_id', 'product_id', 'branch_id', 'supplier_id', 'quantity', 'free_quantity', 'gross_usd', 'opening_paid_usd', 'opening_debt_usd', 'reconciliation_proof', 'invoice_id'];
    requireHistory(Object.keys(opening).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(opening, key)));
    for (const key of keys.slice(0, 5)) requireHistory(Number.isSafeInteger(opening[key]) && Number(opening[key]) > 0 && opening[key] === source[key]);
    requireHistory(opening.invoice_id === source.invoice_id && (source.invoice_id === null || Number.isSafeInteger(source.invoice_id) && source.invoice_id > 0));
    requireHistory(quantityDecimal(opening.quantity) === source.quantity && quantityDecimal(opening.free_quantity, true) === source.free_quantity);
    subtractQuantity(source.quantity, [source.free_quantity]);
    requireHistory(exactMoney4(opening.gross_usd) === source.gross4 && exactMoney4(opening.opening_paid_usd) === source.opening_paid4 && exactMoney4(opening.opening_debt_usd) === source.opening_debt4 && source.opening_paid4 + source.opening_debt4 === source.gross4);
    requireHistory(normalizedText(opening.reconciliation_proof) === source.reconciliation_proof && source.actor_id === actor);
}
function snapshotGuard(table: string, where: string, params: Record<string, unknown>, rows: Row[]): Statement[] {
    const guards: Statement[] = [{ sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${table} WHERE ${where})=@historyCount THEN 1 ELSE json_extract('[1]','$[valuation_history_changed]') END`, params: { ...params, historyCount: rows.length } }];
    for (const row of rows) {
        const values = Object.entries(row);
        guards.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${values.map(([key], index) => `${key} IS @history${index}`).join(' AND ')}) THEN 1 ELSE json_extract('[1]','$[valuation_history_changed]') END`, params: Object.fromEntries(values.map(([, value], index) => [`history${index}`, value])) });
    }
    return guards;
}
async function readHistory(db: D1Compat, source: string) {
    const valuationEvents = 'SELECT id FROM stock_valuation_history_events WHERE source_id=@source';
    const fundingEvents = 'SELECT id FROM stock_funding_events WHERE source_id=@source';
    const agreements = 'SELECT id FROM stock_valuation_agreements WHERE source_id=@source';
    const scopes: Record<string, string> = {
        stock_funding_sources: 'id=@source',
        stock_valuation_sources: 'source_id=@source',
        stock_valuation_events: 'source_id=@source',
        stock_valuation_segments: `event_id IN (${valuationEvents})`,
        stock_valuation_agreements: 'source_id=@source',
        stock_valuation_acceptances: `event_id IN (${valuationEvents}) OR agreement_id IN (${agreements}) OR funding_event_id IN (${fundingEvents})`,
        stock_valuation_receipts: `event_id IN (${valuationEvents}) OR json_extract(request_json,'$.source_id')=@source OR json_extract(response_json,'$.source_id')=@source`,
        stock_funding_events: 'source_id=@source',
        stock_funding_claims: `source_id=@source OR id IN (SELECT claim_id FROM stock_funding_events WHERE source_id=@source AND claim_id IS NOT NULL)`,
        stock_funding_receipts: `event_id IN (${fundingEvents}) OR json_extract(request_json,'$.sourceId')=@source OR json_extract(response_json,'$.source_id')=@source OR request_id IN (SELECT 'valuation-fund-'||request_digest FROM stock_valuation_history_receipts WHERE event_id IN (${valuationEvents}))`,
        stock_valuation_event_identities: 'source_id=@source',
        stock_valuation_request_identities: `event_id IN (${valuationEvents})`,
        stock_valuation_sale_links: 'source_id=@source',
        audit_logs: `(entity='stock_valuation' AND (entity_id IN (${valuationEvents}) OR record_id IN (${valuationEvents}))) OR (entity='stock_funding' AND (entity_id IN (${fundingEvents}) OR record_id IN (${fundingEvents})))`,
    };
    const rows: Record<string, Row[]> = {}, guards: Statement[] = [];
    let count = 0;
    const historyTables: Record<string, string> = { stock_valuation_events: 'stock_valuation_history_events', stock_valuation_segments: 'stock_valuation_history_segments', stock_valuation_receipts: 'stock_valuation_history_receipts', stock_valuation_acceptances: 'stock_valuation_history_acceptances' };
    for (const [table, where] of Object.entries(scopes)) {
        const physicalTable = historyTables[table] ?? table;
        rows[table] = await db.prepare(`SELECT * FROM ${physicalTable} WHERE ${where} LIMIT ${maximumHistoryRows + 1}`).all<Row>({ source });
        count += rows[table].length;
        if (count > maximumHistoryRows) throw new Error('valuation_history_limit');
        guards.push(...snapshotGuard(physicalTable, where, { source }, rows[table]));
    }
    return { rows, guards, rowCount: count };
}
function planAgreement(raw: Record<string, unknown>, segments: ValuationSegment[], rules: HistoryRules): Agreement {
    const amount4 = positiveAmount(raw.amount_usd);
    const targets = rules.parseAmounts(raw.targets, 'allocation_id').map(row => ({ allocation_id: row.target, amount4: row.amount4 }));
    requireHistory(new Set(targets.map(target => target.allocation_id)).size === targets.length && targets.reduce((sum, target) => sum + target.amount4, 0) === amount4);
    for (const target of targets) {
        const available = segments.filter(segment => segment.allocation_id === target.allocation_id && (segment.fate !== 'sellable' || segment.allocation_id !== segment.segment_id)).reduce((sum, segment) => sum + segment.gross4 - segment.coverage4, 0);
        requireHistory(target.amount4 > 0 && target.amount4 <= available);
    }
    return { amount4, targets, accepted: new Map() };
}
function planAcceptance(raw: Record<string, unknown>, agreement: Agreement, segments: ValuationSegment[], rules: HistoryRules) {
    const shares = rules.parseAmounts(raw.shares, 'segment_id').map(row => ({ segment_id: row.target, amount4: row.amount4 }));
    requireHistory(new Set(shares.map(share => share.segment_id)).size === shares.length);
    const amount4 = shares.reduce((sum, share) => sum + share.amount4, 0);
    requireHistory(amount4 > 0 && acceptedTotal(agreement) + amount4 <= agreement.amount4);
    const next = [...segments];
    for (const share of shares) {
        const index = next.findIndex(segment => segment.segment_id === share.segment_id);
        requireHistory(index >= 0);
        const allocation = next[index].allocation_id;
        const target = agreement.targets.find(target => target.allocation_id === allocation);
        const accepted = (agreement.accepted.get(allocation) || 0) + share.amount4;
        requireHistory(target && share.amount4 > 0 && accepted <= target.amount4);
        agreement.accepted.set(allocation, accepted);
        next[index] = applyValuationCoverage(next[index], share.amount4);
    }
    return { shares, amount4, segments: next };
}
async function validateFundingReceipt(event: Row, receipt: Row, intent: Request, source: Row, valuationDigest: string, amount4: number, state: FundingState, audits: Row[]) {
    const { raw, kind, sourceId, generation } = intent;
    const cash = kind === 'refund' || kind === 'payment';
    const proof = normalizedText(kind === 'admit' ? source.reconciliation_proof : raw.proof);
    const claim = kind === 'pending' || kind === 'accept' ? normalizedText(raw.agreement_id, 120) : null;
    const fee = kind === 'shipping' ? raw.fee_id : null;
    const cashMethod = cash ? raw.cash_method : null;
    const cashReference = cash ? normalizedText(raw.cash_reference, 120) : null;
    const cashAt = cash ? normalizedText(raw.cash_recorded_at, 40) : null;
    requireHistory(!cash || cashMethod === 'cash' && new Date(cashAt!).toISOString() === cashAt);
    requireHistory(kind !== 'shipping' || Number.isSafeInteger(fee) && Number(fee) > 0);
    const requestJson = JSON.stringify({ kind, sourceId, generation, opening: kind === 'admit' ? sourceOpening(source) : null, amount4: kind === 'accept' || kind === 'admit' ? 0 : amount4, claim, feeId: fee, proof, cashMethod, cashReference, cashAt });
    const response = { funding_version: 2, source_id: sourceId, event_id: event.id, generation: event.generation, kind, gross4: state.gross4, paid4: state.paid4, debt4: state.debt4, credit4: state.credit4, asset4: state.asset4, cash_in4: state.cashIn4, cash_out4: state.cashOut4, shipping4: state.shipping4, claim_id: event.claim_id, fee_id: fee };
    const responseJson = JSON.stringify(response);
    canonicalJson(receipt.request_json); canonicalJson(receipt.response_json);
    sameFields(receipt, { request_id: `valuation-fund-${valuationDigest}`, actor_id: event.actor_id, event_id: event.id, request_digest: await feeRequestDigest(requestJson), request_json: requestJson, response_json: responseJson });
    sameFields(event, { kind, amount4, fee_id: fee, proof, cash_method: cashMethod, cash_reference: cashReference, cash_recorded_at: cashAt });
    if (cash) requireHistory(event.id === `cash-${await feeRequestDigest(`${cashMethod}:${cashReference}`)}`);
    assertAudit(audits, 'stock_funding', event, responseJson);
}
async function validateHistoryIntent(event: Row, revision: number, sourceId: string, generation: number, rows: Record<string, Row[]>, rules: HistoryRules) {
    requireHistory(event.source_id === sourceId && event.revision === revision && new Date(event.occurred_at).toISOString() === event.occurred_at);
    const receipts = rows.stock_valuation_receipts.filter(receipt => receipt.event_id === event.id);
    requireHistory(receipts.length === 1);
    const receipt = receipts[0];
    const raw = canonicalJson(receipt.request_json);
    const intent = rules.parseRequest(raw);
    const digest = await feeRequestDigest(receipt.request_json);
    requireHistory(intent.sourceId === sourceId && intent.kind === event.kind && intent.request === receipt.request_id && normalizeFeeRequestId(receipt.request_id) === receipt.request_id && intent.revision === (revision === 0 ? 0 : revision - 1) && intent.generation === generation);
    sameFields(receipt, { actor_id: event.actor_id, request_digest: digest });
    canonicalJson(receipt.response_json);
    return { receipt, raw, intent, digest };
}
function planHistoricalAgreement(event: Row, raw: Record<string, unknown>, sourceId: string, segments: ValuationSegment[], agreements: Map<string, Agreement>, rows: Record<string, Row[]>, rules: HistoryRules) {
    if (event.kind === 'pending') {
        const id = normalizedText(raw.agreement_id, 120);
        requireHistory(id === raw.agreement_id && !agreements.has(id) && normalizedText(raw.proof, 120) === raw.proof);
        const agreement = planAgreement(raw, segments, rules);
        const actual = rows.stock_valuation_agreements.filter(row => row.id === id);
        requireHistory(actual.length === 1);
        sameFields(actual[0], { source_id: sourceId, amount4: agreement.amount4, targets_json: JSON.stringify(agreement.targets), proof: raw.proof });
        agreements.set(id, agreement);
        return { amount4: agreement.amount4, claim: id, shares: [] as { segment_id: string; amount4: number }[], segments };
    }
    if (event.kind === 'accept') {
        const id = normalizedText(raw.agreement_id, 120);
        const agreement = agreements.get(id);
        requireHistory(id === raw.agreement_id && agreement);
        return { ...planAcceptance(raw, agreement!, segments, rules), claim: `${id}:${event.id}` };
    }
    const amount4 = ['refund', 'payment', 'shipping'].includes(event.kind) ? positiveAmount(raw.amount_usd) : 0;
    return { amount4, claim: null, shares: [] as { segment_id: string; amount4: number }[], segments };
}
function validateHistorySnapshot(event: Row, raw: Record<string, unknown>, source: Row, rows: Record<string, Row[]>, segments: ValuationSegment[], funding: ReturnType<typeof projectedFunding>, state: FundingState, agreements: Map<string, Agreement>, shares: { segment_id: string; amount4: number }[], previous: ReturnType<typeof valuationTotals> | null, receipt: Row) {
    const acceptedRows = rows.stock_valuation_acceptances.filter(row => row.event_id === event.id);
    requireHistory(acceptedRows.length === shares.length);
    for (const share of shares) {
        const actual = acceptedRows.find(row => row.target_segment_id === share.segment_id);
        sameFields(actual, { event_id: event.id, agreement_id: raw.agreement_id, target_segment_id: share.segment_id, amount4: share.amount4, funding_event_id: funding!.id });
    }
    segments.sort((a, b) => a.segment_id.localeCompare(b.segment_id));
    const actualSegments = rows.stock_valuation_segments.filter(row => row.event_id === event.id).sort((a, b) => a.segment_id.localeCompare(b.segment_id)).map(({ event_id, consumption_id, consumed_cost4, consumed_recovery4, ...segment }) => event.schema_version === 4 ? { ...segment, consumption_id, consumed_cost4, consumed_recovery4 } : segment);
    same(actualSegments, segments);
    const totals = valuationTotals(segments, source.gross4, source.quantity, event.schema_version);
    requireHistory(totals.coverage4 === state.credit4);
    const pending4 = pendingTotal(agreements);
    requireHistory(Number.isSafeInteger(pending4) && pending4 >= 0);
    sameFields(event, { loss4: totals.historical_loss4 - (previous?.historical_loss4 || 0), recovery4: totals.recovery4 - (previous?.recovery4 || 0), expense_category: raw.expense_category ?? null });
    sameFields(event, { consumed_cost4: (totals.consumed_cost4 ?? 0) - (previous?.consumed_cost4 ?? 0), consumed_recovery4: (totals.consumed_recovery4 ?? 0) - (previous?.consumed_recovery4 ?? 0) });
    const responseJson = JSON.stringify({ valuation_version: event.schema_version, source_id: source.id, event_id: event.id, revision: event.revision, kind: event.kind, funding, segments, totals, pending4 });
    requireHistory(responseJson === receipt.response_json);
    assertAudit(rows.audit_logs, 'stock_valuation', event, responseJson);
}
export async function validateValuationHistory(db: D1Compat, sourceId: string, rules: HistoryRules) {
    const { rows, guards, rowCount } = await readHistory(db, sourceId);
    const events = rows.stock_valuation_events.sort((a, b) => a.revision - b.revision);
    if (events.length > maximumHistoryEvents) throw new Error('valuation_history_limit');
    if (!events.length) {
        requireHistory(Object.values(rows).every(list => list.length === 0));
        return { guards, rowCount, eventCount: 0 };
    }
    requireHistory(rows.stock_funding_sources.length === 1 && rows.stock_valuation_sources.length === 1);
    const source = rows.stock_funding_sources[0];
    requireHistory(source.id === sourceId && rows.stock_valuation_sources[0].opening_json === source.source_json);
    canonicalJson(source.source_json);
    const physical = await db.prepare(stockFundingPhysicalSql).get<Row>({ batch: source.batch_id, movement: source.movement_id });
    same(physical, JSON.parse(source.source_json));
    sameFields(physical, { product_id: source.product_id, movement_product: source.product_id, supplier_id: source.supplier_id, branch_id: source.branch_id, movement_branch: source.branch_id, batch_id: source.batch_id, movement_id: source.movement_id, batch_active: 1, product_active: 1, branch_active: 1, receipt_count: 1 });
    requireHistory(['add', 'in'].includes(physical!.movement_type) && quantityDecimal(physical!.quantity) === source.quantity && quantityDecimal(physical!.received_quantity) === source.quantity && quantityDecimal(physical!.free_quantity, true) === source.free_quantity && exactMoney4(physical!.total_cost_usd) === source.gross4 && exactMoney4(physical!.received_cost_usd) === source.gross4 && (physical!.total_cost_khr === null || physical!.total_cost_khr === 0));
    requireHistory(!await db.prepare('SELECT id FROM stock_disposition_sources WHERE movement_id=@movement OR batch_id=@batch').get({ movement: source.movement_id, batch: source.batch_id }));
    requireHistory(rows.stock_valuation_receipts.length === events.length && rows.stock_valuation_segments.length > 0);
    requireHistory(rows.stock_valuation_event_identities.length === events.length && rows.stock_valuation_request_identities.length === events.length);
    for (const event of events) {
        sameFields(rows.stock_valuation_event_identities.find(row => row.event_id === event.id), { source_id: sourceId, revision: event.revision, schema_version: event.schema_version });
        const receipt = rows.stock_valuation_receipts.find(row => row.event_id === event.id);
        sameFields(rows.stock_valuation_request_identities.find(row => row.event_id === event.id), { request_id: receipt?.request_id, schema_version: event.schema_version });
    }
    const fundingEvents = rows.stock_funding_events.sort((a, b) => a.generation - b.generation);
    requireHistory(rows.stock_funding_receipts.length === fundingEvents.length && rows.audit_logs.length === events.length + fundingEvents.length);
    const agreements = new Map<string, Agreement>(), usedClaims = new Set<string>(), usedChildren = new Set(['original']);
    let segments: ValuationSegment[] = [], fundingIndex = 0;
    let state: FundingState = { gross4: source.gross4, paid4: source.opening_paid4, debt4: source.opening_debt4, credit4: 0, asset4: 0, cashIn4: 0, cashOut4: 0, shipping4: 0 };
    let funding: ReturnType<typeof projectedFunding> | undefined;
    for (let revision = 0; revision < events.length; revision++) {
        const event = events[revision];
        const { receipt, raw, intent, digest } = await validateHistoryIntent(event, revision, sourceId, funding?.generation ?? 0, rows, rules);
        const previous = revision ? valuationTotals(segments, source.gross4, source.quantity, events[revision - 1].schema_version) : null;
        if (event.schema_version === 4) segments = valuationSegmentsV4(segments);
        if (revision === 0) {
            requireHistory(event.kind === 'admit'); validateOpening(source, raw, event.actor_id);
            segments = [{ segment_id: 'original', allocation_id: 'original', fate: 'sellable', quantity: source.quantity, gross4: source.gross4, coverage4: 0, loss4: 0, recovery4: 0, reason: '' }];
        } else requireHistory(event.kind !== 'admit');
        if (['hold', 'dispose', 'repair'].includes(event.kind)) {
            requireHistory(typeof raw.child_segment_id === 'string' && !usedChildren.has(raw.child_segment_id));
            usedChildren.add(raw.child_segment_id as string);
            segments = rules.planPhysical(segments, raw, event.kind);
        }
        if (['consume', 'restore', 'reconsume'].includes(event.kind)) {
            requireHistory(event.schema_version === 4);
            const link = rows.stock_valuation_sale_links.find(row => row.id === raw.consumption_id);
            requireHistory(link && link.source_id === sourceId && link.quantity === quantityDecimal(raw.quantity) && link.sale_request_id === raw.sale_request_id && link.sale_line_key === raw.sale_line_key && link.sale_intent_json === raw.sale_intent_json);
            if (event.kind === 'consume') {
                requireHistory(!usedChildren.has(String(raw.child_segment_id)) && link!.original_event_id === event.id && link!.segment_id === raw.child_segment_id);
                usedChildren.add(String(raw.child_segment_id));
            } else requireHistory(link!.segment_id === raw.segment_id);
            segments = planValuationSaleSegments(segments, { kind: event.kind, segment_id: String(raw.segment_id), child_segment_id: raw.child_segment_id as string | undefined, quantity: raw.quantity, consumption_id: String(raw.consumption_id) });
        }
        const { amount4, claim, shares, segments: nextSegments } = planHistoricalAgreement(event, raw, sourceId, segments, agreements, rows, rules);
        segments = nextSegments;
        if (['admit', 'pending', 'accept', 'refund', 'payment', 'shipping'].includes(event.kind)) {
            const financial = fundingEvents[fundingIndex];
            requireHistory(financial && financial.generation === fundingIndex && financial.source_id === sourceId && financial.actor_id === event.actor_id && new Date(financial.occurred_at).toISOString() === financial.occurred_at);
            if (event.kind !== 'admit') state = fundingTransition(state, event.kind as FundingKind, amount4);
            sameFields(financial, { claim_id: claim, gross4: state.gross4, paid4: state.paid4, debt4: state.debt4, credit4: state.credit4, asset4: state.asset4, cash_in4: state.cashIn4, cash_out4: state.cashOut4, shipping4: state.shipping4 });
            const financialReceipts = rows.stock_funding_receipts.filter(row => row.event_id === financial.id);
            requireHistory(financialReceipts.length === 1);
            await validateFundingReceipt(financial, financialReceipts[0], intent, source, digest, amount4, state, rows.audit_logs);
            if (claim) {
                const claims = rows.stock_funding_claims.filter(row => row.id === claim);
                requireHistory(claims.length === 1 && !usedClaims.has(claim));
                sameFields(claims[0], { source_id: sourceId, amount4, proof: normalizedText(raw.proof) });
                usedClaims.add(claim);
            }
            funding = projectedFunding(financial); fundingIndex++;
        }
        requireHistory(funding);
        validateHistorySnapshot(event, raw, source, rows, segments, funding!, state, agreements, shares, previous, receipt);
    }
    requireHistory(fundingIndex === fundingEvents.length && agreements.size === rows.stock_valuation_agreements.length && usedClaims.size === rows.stock_funding_claims.length);
    requireHistory(rows.stock_valuation_acceptances.every(row => events.some(event => event.id === row.event_id && event.kind === 'accept') && agreements.has(row.agreement_id)));
    requireHistory(rows.stock_valuation_sale_links.every(link => events.some(event => event.id === link.original_event_id && event.kind === 'consume')));
    for (const link of rows.stock_valuation_sale_links) {
        const actual = await db.prepare('SELECT a.*,i.product_id,i.quantity AS line_quantity,i.branch_id AS line_branch,i.batch_id AS line_batch,s.client_request_id,s.sale_status,json_extract(i.pricing_snapshot_json,\'$.line_key\') AS line_key FROM sale_item_batch_allocations a JOIN sale_items i ON i.id=a.sale_item_id JOIN sales s ON s.id=i.sale_id WHERE a.id=@allocation AND i.id=@item AND s.id=@sale').get<Row>({ allocation: link.sale_allocation_id, item: link.sale_item_id, sale: link.sale_id });
        requireHistory(actual && actual.product_id === source.product_id && actual.batch_id === source.batch_id && actual.branch_id === source.branch_id && actual.line_branch === source.branch_id && actual.line_batch === source.batch_id && quantityDecimal(actual.quantity) === link.quantity && quantityDecimal(actual.line_quantity) === link.quantity && actual.client_request_id === link.sale_request_id && actual.line_key === link.sale_line_key);
        const current = segments.filter(segment => segment.consumption_id === link.id);
        requireHistory(current.length === 1 && current[0].segment_id === link.segment_id && current[0].quantity === link.quantity && actual!.released_quantity === (current[0].fate === 'consumed' ? 0 : Number(link.quantity)) && (current[0].fate === 'consumed' ? actual!.sale_status !== 'cancelled' : actual!.sale_status === 'cancelled'));
        guards.push(...snapshotGuard('sale_item_batch_allocations', 'id=@allocation', { allocation: link.sale_allocation_id }, [await db.prepare('SELECT * FROM sale_item_batch_allocations WHERE id=@allocation').get<Row>({ allocation: link.sale_allocation_id }) as Row]));
    }
    return { guards, rowCount, eventCount: events.length };
}
export function assertValuationHistoryCapacity(history: { rowCount: number; eventCount: number }, kind: string, segmentCount: number, shareCount: number, statementCount: number) {
    const financial = ['admit', 'pending', 'accept', 'refund', 'payment', 'shipping'].includes(kind);
    const addedRows = 5 + segmentCount + (financial ? 3 : 0) + (kind === 'admit' ? 2 : 0) + (kind === 'pending' ? 2 : 0) + (kind === 'accept' ? 1 + shareCount : 0) + (kind === 'consume' ? 1 : 0);
    if (history.rowCount + addedRows > maximumHistoryRows || history.eventCount + 1 > maximumHistoryEvents || statementCount > 400) throw new Error('valuation_history_limit');
}
