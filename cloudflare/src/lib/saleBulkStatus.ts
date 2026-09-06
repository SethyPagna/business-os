import { getDb, type D1Compat } from './db';
import type { Env } from '../index';
import type { SessionUser } from './auth';
import { getActionTier, isAdminControlUser } from './permissions';
import { D1_MAX_BOUND_PARAMS } from './sqlBinding';
import { VALID_SALE_STATUSES } from './salesStatus';
import { allocateReturnedQuantities, guardSaleStatusTransition, heldQuantity, normalizeCancelReason, planSaleStockTransition, type TransitionItem, type StockStatement } from './saleTransitions';
import { bumpVersion } from './cache';
import { broadcast } from '../durable-objects/broadcastHub';
import { actorSnapshot } from './actorSnapshot';
export const BULK_STATUS_KIND = 'sale.status.bulk';
export const BULK_STATUS_LIMIT = 25;
export const BULK_STATUS_MOVEMENT_LIMIT = 256;
type Row = Record<string, unknown>;
type Item = TransitionItem & {
    sale_id: number;
    damaged_lot_id: number | null;
};
type Allocation = Row & {
    id: number;
    sale_item_id: number;
    batch_id: number;
    quantity: number;
    released_quantity: number;
    released_at: string | null;
};
type StockDelta = {
    product: number;
    branch: number;
    quantity: number;
    batch: number | null;
    lot: number | null;
    name: string | null;
    costUsd: number;
    costKhr: number;
    sale: number;
};
type BatchDelta = {
    batch: number;
    branch: number;
    product: number;
    quantity: number;
};
type Member = {
    id: number;
    receipt: string;
    before: Row;
    after: Row;
    changed: boolean;
    skipped: boolean;
    items: Item[];
    returned: [
        number,
        number
    ][];
    stock: StockDelta[];
    batches: BatchDelta[];
    allocations: {
        before: Allocation;
        after: Allocation;
    }[];
    fee: Row | null;
    createdFee: Row | null;
};
type Snapshot = {
    version: 1;
    operationId: string;
    members: Member[];
};
export type BulkStatusRequest = {
    client_request_id: string;
    items: {
        id: number;
        expected_status: string;
        expected_updated_at: string | null;
        cancel?: {
            reason: string;
            note?: string;
            fee_usd?: number;
            fee_khr?: number;
            fee_note?: string;
        };
    }[];
    source_status?: string;
    target_status: string;
    notes?: string;
    cancel_reason?: string;
    cancel_note?: string;
    skip_stock?: boolean;
};
export class SaleBulkError extends Error {
    constructor(message: string, readonly statusCode: 400 | 403 | 409 = 409) { super(message); }
}
const fields = ['sale_status', 'notes', 'cancel_reason', 'cancel_note', 'cancelled_at', 'cancelled_by_name', 'status_before_cancel', 'cancel_fee_id'] as const;
// reference_id is polymorphic: use a conservative read guard, never revision
// triggers that would write to an unrelated sale with the same numeric id.
export function saleMovementFingerprint(idSql: string) {
    // Read at most one sentinel past the cap, including inside commit/replay
    // guards. NULL means overflow, never a fingerprint of a truncated history.
    // The NOT NULL member column also rolls back a transition whose appended
    // movements cross this bound, keeping its saved precondition usable.
    return `(SELECT CASE WHEN COUNT(*)>${BULK_STATUS_MOVEMENT_LIMIT} THEN NULL ELSE json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr)) END FROM (SELECT id,product_id,branch_id,batch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr FROM inventory_movements WHERE reference_id=${idSql} AND movement_type IN ('sale','return','damage_in','damage_out') ORDER BY id LIMIT ${BULK_STATUS_MOVEMENT_LIMIT + 1}))`;
}
function fail(message: string): never { throw new SaleBulkError(message); }
function permission(user: SessionUser) { if (getActionTier(user, 'sales', 'status') !== 'full')
    throw new SaleBulkError('No permission to change sale status.', 403); }
export function bulkAssertion(predicate: string, params: Row = {}): StockStatement {
    return { sql: `INSERT INTO sale_bulk_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params };
}
export function saleRevisionGuard(id: number, revision: number): StockStatement {
    return bulkAssertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore') AND EXISTS(SELECT 1 FROM sales WHERE id=@id) AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0)=@revision", { id, revision });
}
function parseRequest(raw: Row): BulkStatusRequest {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new SaleBulkError('A bulk status object is required.', 400);
    const allowed = ['client_request_id', 'items', 'source_status', 'target_status', 'notes', 'cancel_reason', 'cancel_note', 'skip_stock'];
    if (Object.keys(raw).some(k => !allowed.includes(k)))
        throw new SaleBulkError('Unsupported bulk status field; payment and lost fees are per-sale actions.', 400);
    if (typeof raw.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw.client_request_id))
        throw new SaleBulkError('A stable request id is required.', 400);
    if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > BULK_STATUS_LIMIT)
        throw new SaleBulkError(`Select between 1 and ${BULK_STATUS_LIMIT} sales.`, 400);
    const ids = new Set<number>();
    for (const item of raw.items) {
        if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['id', 'expected_status', 'expected_updated_at', 'cancel'].includes(k)) || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id) || !VALID_SALE_STATUSES.includes(item.expected_status) || !(typeof item.expected_updated_at === 'string' || item.expected_updated_at === null))
            throw new SaleBulkError('Unique sale ids and expected states are required.', 400);
        if (item.cancel !== undefined) {
            if (!item.cancel || typeof item.cancel !== 'object' || Array.isArray(item.cancel)
                || Object.keys(item.cancel).some(k => !['reason', 'note', 'fee_usd', 'fee_khr', 'fee_note'].includes(k)))
                throw new SaleBulkError('Invalid per-sale cancellation details.', 400);
            if (!normalizeCancelReason(item.cancel.reason)
                || (item.cancel.reason === 'other' && !String(item.cancel.note || '').trim()))
                throw new SaleBulkError('Choose a cancellation reason and supply a note for Other.', 400);
            for (const key of ['note', 'fee_note'])
                if (item.cancel[key] !== undefined && (typeof item.cancel[key] !== 'string' || String(item.cancel[key]).length > 1000))
                    throw new SaleBulkError('Invalid per-sale cancellation note.', 400);
            for (const key of ['fee_usd', 'fee_khr'])
                if (item.cancel[key] !== undefined && (!Number.isFinite(Number(item.cancel[key])) || Number(item.cancel[key]) < 0))
                    throw new SaleBulkError('Invalid per-sale cancellation fee.', 400);
        }
        ids.add(item.id);
    }
    if (raw.source_status !== undefined && !VALID_SALE_STATUSES.includes(String(raw.source_status)))
        throw new SaleBulkError('Invalid source sale status.', 400);
    if (!VALID_SALE_STATUSES.includes(String(raw.target_status)))
        throw new SaleBulkError('Invalid sale status.', 400);
    if (raw.skip_stock !== undefined && typeof raw.skip_stock !== 'boolean')
        throw new SaleBulkError('skip_stock must be boolean.', 400);
    for (const key of ['notes', 'cancel_reason', 'cancel_note'])
        if (raw[key] !== undefined && (typeof raw[key] !== 'string' || String(raw[key]).length > 1000))
            throw new SaleBulkError('Invalid notes.', 400);
    const hasSharedCancel = raw.cancel_reason !== undefined || raw.cancel_note !== undefined;
    if (raw.target_status === 'cancelled' && hasSharedCancel && (!normalizeCancelReason(raw.cancel_reason) || (raw.cancel_reason === 'other' && !String(raw.cancel_note || '').trim())))
        throw new SaleBulkError('Choose a cancellation reason and supply a note for Other.', 400);
    // Fixed key order and sorted ids make semantically identical retries identical.
    return {
        client_request_id: raw.client_request_id,
        items: raw.items.map(i => ({
            id: i.id,
            expected_status: i.expected_status,
            expected_updated_at: i.expected_updated_at,
            ...(i.cancel ? { cancel: {
                reason: String(i.cancel.reason),
                ...(i.cancel.note !== undefined ? { note: String(i.cancel.note) } : {}),
                ...(i.cancel.fee_usd !== undefined ? { fee_usd: Number(i.cancel.fee_usd) } : {}),
                ...(i.cancel.fee_khr !== undefined ? { fee_khr: Number(i.cancel.fee_khr) } : {}),
                ...(i.cancel.fee_note !== undefined ? { fee_note: String(i.cancel.fee_note) } : {}),
            } } : {}),
        })).sort((a, b) => a.id - b.id),
        ...(raw.source_status !== undefined ? { source_status: String(raw.source_status) } : {}),
        target_status: String(raw.target_status),
        ...(raw.notes !== undefined ? { notes: raw.notes as string } : {}),
        ...(raw.cancel_reason !== undefined ? { cancel_reason: raw.cancel_reason as string } : {}),
        ...(raw.cancel_note !== undefined ? { cancel_note: raw.cancel_note as string } : {}),
        skip_stock: raw.skip_stock === true,
    };
}
async function rowsIn<T>(db: D1Compat, ids: number[], sql: (marks: string) => string): Promise<T[]> {
    // sql-bound-params: bounded by construction -- both the 25-ID ceiling and
    // D1's parameter ceiling are enforced below before constructing placeholders.
    if (!ids.length) return [];
    // Every caller uses <=25 sale ids (or linked fee ids), including the
    // allocation query's join. Never split a global LIMIT into per-chunk caps.
    if (ids.length > BULK_STATUS_LIMIT || ids.length > D1_MAX_BOUND_PARAMS)
        throw new SaleBulkError('Selection exceeds the single-query bound.', 400);
    return db.prepare(sql(ids.map(() => '?').join(','))).all<T>(ids);
}
function scalar(row: Row): Row { return Object.fromEntries(fields.map(k => [k, row[k] ?? null])); }
function bounded(statements: StockStatement[], snapshot: Snapshot) {
    if (statements.length > 500 || new TextEncoder().encode(JSON.stringify(snapshot)).length > 512000)
        throw new SaleBulkError('Selection is too large for one atomic action. Select fewer sales.', 400);
}
function stockStatements(member: Member, sign: number, user: SessionUser, stamp: string): StockStatement[] {
    const out: StockStatement[] = [];
    for (const move of member.stock) {
        const q = move.quantity * sign;
        const p = { product: move.product, branch: move.branch, q, lot: move.lot, stamp };
        if (move.lot) {
            out.push(bulkAssertion('EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lot AND product_id=@product AND branch_id IS @branch AND quantity_remaining+@q BETWEEN 0 AND quantity)', p));
            out.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining+@q, updated_at=@stamp WHERE id=@lot', params: p });
        }
        else {
            out.push(bulkAssertion('EXISTS(SELECT 1 FROM products WHERE id=@product AND stock_quantity+@q>=0) AND EXISTS(SELECT 1 FROM branches WHERE id=@branch) AND (@q>=0 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity+@q>=0))', p));
            out.push({ sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(@product,@branch,@q) ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=quantity+@q', params: p });
            // The INSERT value must itself satisfy CHECK on an existing row too.
            if (q < 0)
                out[out.length - 1] = { sql: 'UPDATE branch_stock SET quantity=quantity+@q WHERE product_id=@product AND branch_id=@branch', params: p };
            out.push({ sql: 'UPDATE products SET stock_quantity=stock_quantity+@q, updated_at=@stamp WHERE id=@product', params: p });
        }
        out.push({ sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reason,reference_id,user_id,user_name,batch_id) VALUES(@product,@name,@branch,@type,@q,@usd,@khr,@reason,@sale,@uid,@uname,@batch)`, params: { ...p, name: move.name, type: move.lot ? (q > 0 ? 'damage_in' : 'damage_out') : (q > 0 ? 'return' : 'sale'), usd: move.costUsd, khr: move.costKhr, reason: `${sign < 0 ? 'Undo' : 'Apply'} grouped sale status`, sale: member.id, uid: user.id, uname: actorSnapshot(user), batch: move.batch } });
    }
    for (const move of member.batches) {
        const p = { ...move, q: move.quantity * sign, stamp };
        out.push(bulkAssertion('EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product) AND (@q>=0 OR EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity+@q>=0))', p));
        out.push({ sql: p.q < 0 ? 'UPDATE branch_batch_stock SET quantity=quantity+@q, updated_at=@stamp WHERE batch_id=@batch AND branch_id=@branch' : 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(@batch,@branch,@q) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+@q,updated_at=@stamp', params: p });
    }
    for (const a of member.allocations) {
        const target = sign < 0 ? a.before : a.after;
        out.push({ sql: 'UPDATE sale_item_batch_allocations SET released_quantity=@quantity,released_at=@released WHERE id=@id', params: { id: target.id, quantity: target.released_quantity, released: target.released_at } });
    }
    return out;
}
function memberStatements(member: Member, sign: number, user: SessionUser, stamp: string): StockStatement[] {
    if (!member.changed)
        return [];
    const target = sign < 0 ? member.before : member.after;
    const out = stockStatements(member, sign, user, stamp);
    if (member.createdFee) {
        if (sign > 0) {
            out.push(bulkAssertion('NOT EXISTS(SELECT 1 FROM fees WHERE id=@id)', { id: member.createdFee.id }));
            const keys = Object.keys(member.createdFee);
            out.push({ sql: `INSERT INTO fees(${keys.join(',')}) VALUES(${keys.map(k => `@${k}`).join(',')})`, params: member.createdFee });
        }
        else {
            out.push(bulkAssertion(`EXISTS(SELECT 1 FROM fees WHERE id=@id AND sale_id=@sale AND fee_type=@type AND COALESCE(label,'')=@label AND amount_usd=@usd AND amount_khr=@khr AND fee_date=@date AND COALESCE(branch_id,0)=COALESCE(@branch,0) AND COALESCE(delivery_contact_id,0)=COALESCE(@contact,0) AND COALESCE(notes,'')=@notes AND COALESCE(created_by,0)=COALESCE(@actor,0) AND COALESCE(created_by_name,'')=@actor_name AND created_at=@created_at AND updated_at=@updated_at)`, {
                id: member.createdFee.id, sale: member.id, type: member.createdFee.fee_type, label: member.createdFee.label,
                usd: member.createdFee.amount_usd, khr: member.createdFee.amount_khr, date: member.createdFee.fee_date,
                branch: member.createdFee.branch_id, contact: member.createdFee.delivery_contact_id, notes: member.createdFee.notes,
                actor: member.createdFee.created_by, actor_name: member.createdFee.created_by_name,
                created_at: member.createdFee.created_at, updated_at: member.createdFee.updated_at,
            }));
            out.push({ sql: 'DELETE FROM fees WHERE id=@id AND sale_id=@sale', params: { id: member.createdFee.id, sale: member.id } });
        }
    }
    if (member.fee) {
        if (sign > 0)
            out.push({ sql: 'DELETE FROM fees WHERE id=@id', params: { id: member.fee.id } });
        else {
            // Only server-captured fee columns; identifiers are validated and the
            // target table is fixed. Generic history APIs cannot create this snapshot.
            const keys = Object.keys(member.fee);
            if (keys.some(k => !/^[a-z_]+$/.test(k)))
                fail('Invalid saved fee.');
            out.push({ sql: `INSERT INTO fees(${keys.join(',')}) VALUES(${keys.map(k => `@${k}`).join(',')})`, params: member.fee });
        }
    }
    out.push({ sql: `UPDATE sales SET ${fields.map(k => `${k}=@${k}`).join(',')}, updated_at=@stamp${member.skipped ? ', stock_skipped=1, stock_skipped_at=COALESCE(stock_skipped_at,@stamp), stock_skipped_by_name=COALESCE(stock_skipped_by_name,@actor)' : ''} WHERE id=@id`, params: { ...target, id: member.id, stamp, actor: actorSnapshot(user) } });
    return out;
}
function auditStatement(user: SessionUser, operationId: string, direction: string, count: number): StockStatement {
    return { sql: 'INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value) VALUES(@uid,@name,@action,\'sale\',@id,@details,\'sales\',@id,@details)', params: { uid: user.id, name: actorSnapshot(user), action: direction, id: operationId, details: JSON.stringify({ kind: BULK_STATUS_KIND, count }) } };
}
export async function notifyBulkStatus(env: Env) {
    await Promise.allSettled([bumpVersion(env, 'sales'), bumpVersion(env, 'products'), ...(['sales', 'products', 'inventory', 'returns', 'fees'] as const).map(channel => broadcast(env, channel, { action: 'update' }))]);
}
export async function applySaleBulkStatus(env: Env, user: SessionUser, raw: Row) {
    permission(user);
    const request = parseRequest(raw);
    if (request.skip_stock && !isAdminControlUser(user))
        throw new SaleBulkError('Administrator access required to skip stock.', 403);
    const db = getDb(env), canonical = JSON.stringify(request);
    const previous = await db.prepare('SELECT * FROM sale_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id });
    if (previous) {
        if (previous.request_json !== canonical)
            fail('Request id was already used with different data.');
        return JSON.parse(String(previous.receipt_json));
    }
    const ids = request.items.map(i => i.id);
    const sales = await rowsIn<Row>(db, ids, m => `SELECT s.id,s.receipt_number,s.branch_id,s.sale_status,s.updated_at,s.stock_skipped,s.notes,s.cancel_reason,s.cancel_note,s.cancelled_at,s.cancelled_by_name,s.status_before_cancel,s.cancel_fee_id,COALESCE(v.revision,0) AS write_revision,${saleMovementFingerprint('s.id')} AS movement_fingerprint FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id IN (${m})`);
    const sourceMatchedIds: number[] = [];
    for (const expected of request.items) {
        const sale = sales.find(s => s.id === expected.id);
        if (!sale)
            fail(`Sale ${expected.id} was not found.`);
        const sourceMatched = request.source_status === undefined || String(sale.sale_status || 'completed') === request.source_status;
        if (!sourceMatched)
            continue;
        if ((sale.sale_status || 'completed') !== expected.expected_status || (sale.updated_at ?? null) !== expected.expected_updated_at)
            fail(`Sale ${expected.id} changed. Refresh before retrying.`);
        if (sale.movement_fingerprint === null)
            throw new SaleBulkError(`A selected sale exceeds ${BULK_STATUS_MOVEMENT_LIMIT} stock movements and cannot join a bulk action.`, 400);
        sourceMatchedIds.push(expected.id);
    }
    const items = await rowsIn<Item>(db, sourceMatchedIds, m => `SELECT * FROM sale_items WHERE sale_id IN (${m}) ORDER BY id LIMIT 151`);
    if (items.length > 150)
        throw new SaleBulkError('Select fewer sale lines (maximum 150).', 400);
    const allocations = await rowsIn<Allocation>(db, sourceMatchedIds, m => `SELECT a.* FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id WHERE si.sale_id IN (${m}) ORDER BY a.id LIMIT 301`);
    if (allocations.length > 300)
        throw new SaleBulkError('Select fewer batch allocations (maximum 300).', 400);
    const returns = await rowsIn<{
        sale_id: number;
        sale_item_id: number | null;
        product_id: number | null;
        quantity: number;
    }>(db, sourceMatchedIds, m => `SELECT r.sale_id,ri.sale_item_id,ri.product_id,ri.quantity FROM returns r JOIN return_items ri ON ri.return_id=r.id WHERE r.sale_id IN (${m}) AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer' ORDER BY ri.id LIMIT 301`);
    // Bound raw return rows before aggregation; even millions of rows sharing
    // one group must not be materialized or aggregated for this request.
    if (returns.length > 300)
        throw new SaleBulkError('Select fewer return records (maximum 300).', 400);
    const fees = await rowsIn<Row>(db, sales.filter(s => sourceMatchedIds.includes(Number(s.id))).map(s => Number(s.cancel_fee_id)).filter(Boolean), m => `SELECT * FROM fees WHERE id IN (${m})`);
    const stamp = new Date().toISOString(), operationId = crypto.randomUUID(), members: Member[] = [], guards: StockStatement[] = [];
    for (const expected of request.items) {
        const sale = sales.find(s => s.id === expected.id);
        if (!sale)
            fail(`Sale ${expected.id} was not found.`);
        const old = String(sale.sale_status || 'completed');
        const sourceMatched = request.source_status === undefined || old === request.source_status;
        const changed = sourceMatched && old !== request.target_status;
        if (sourceMatched) {
            guards.push(saleRevisionGuard(expected.id, Number(sale.write_revision)));
            guards.push(bulkAssertion(`${saleMovementFingerprint('@id')}=@fingerprint`, { id: expected.id, fingerprint: sale.movement_fingerprint }));
        }
        const guard = guardSaleStatusTransition(old, request.target_status, String(sale.status_before_cancel || '') || null);
        if (changed && !guard.ok)
            throw new SaleBulkError(guard.error || 'Invalid transition.', 400);
        const before = scalar(sale), after: Row = changed ? { ...before, sale_status: request.target_status } : { ...before };
        if (changed && request.notes !== undefined)
            after.notes = request.notes;
        const itemCancel = expected.cancel;
        const cancelReason = itemCancel?.reason || request.cancel_reason;
        const cancelNote = itemCancel?.note || request.cancel_note;
        if (request.target_status === 'cancelled' && changed) {
            if (!normalizeCancelReason(cancelReason) || (cancelReason === 'other' && !String(cancelNote || '').trim()))
                throw new SaleBulkError(`Sale ${expected.id} needs its cancellation answers.`, 400);
            Object.assign(after, { cancel_reason: cancelReason, cancel_note: String(cancelNote || '').trim() || null, cancelled_at: stamp, cancelled_by_name: actorSnapshot(user), status_before_cancel: old });
        }
        else if (old === 'cancelled' && changed)
            Object.assign(after, { cancel_reason: null, cancel_note: null, cancelled_at: null, cancelled_by_name: null, status_before_cancel: null, cancel_fee_id: null });
        const own = items.filter(i => i.sale_id === expected.id), itemReturned = new Map<number, number>(), productReturned = new Map<number, number>();
        for (const r of returns.filter(r => r.sale_id === expected.id)) {
            const map = r.sale_item_id ? itemReturned : productReturned;
            const key = Number(r.sale_item_id || r.product_id);
            map.set(key, (map.get(key) || 0) + r.quantity);
        }
        const returned = allocateReturnedQuantities(own, itemReturned, productReturned);
        for (const item of own) {
            item.allocations = allocations.filter(a => a.sale_item_id === item.id);
            if (allocations.some(a => a.sale_item_id === item.id && a.branch_id != null && Number(a.branch_id) !== item.branch_id))
                fail('Sale allocation belongs to a different branch.');
        }
        const skipped = (changed && !!request.skip_stock) || Number(sale.stock_skipped) === 1;
        const member: Member = { id: expected.id, receipt: String(sale.receipt_number || expected.id), before, after, changed, skipped, items: own, returned: [...returned], stock: [], batches: [], allocations: [], fee: null, createdFee: null };
        if (changed && request.target_status === 'cancelled' && itemCancel && (Number(itemCancel.fee_usd) > 0 || Number(itemCancel.fee_khr) > 0)) {
            const random = crypto.getRandomValues(new Uint32Array(2));
            // Explicit negative ids do not advance fees' AUTOINCREMENT
            // sequence. The 52-bit random space plus the in-batch NOT EXISTS
            // guard makes a collision an atomic refusal, never an overwrite.
            const feeId = -Math.max(1, random[0] * 0x100000 + (random[1] & 0xfffff));
            member.createdFee = {
                id: feeId,
                fee_type: 'expense',
                label: `Cancelled sale ${member.receipt} -- lost fee`,
                amount_usd: Math.round(Math.max(0, Number(itemCancel.fee_usd) || 0) * 100) / 100,
                amount_khr: Math.max(0, Math.round(Number(itemCancel.fee_khr) || 0)),
                fee_date: stamp.slice(0, 10),
                sale_id: expected.id,
                branch_id: sale.branch_id ?? null,
                delivery_contact_id: null,
                notes: String(itemCancel.fee_note || '').trim() || `Fee lost to cancellation (${cancelReason})`,
                created_by: user.id,
                created_by_name: actorSnapshot(user),
                created_at: stamp,
                updated_at: stamp,
            };
            after.cancel_fee_id = feeId;
        }
        if (changed && old === 'cancelled' && sale.cancel_fee_id) {
            member.fee = fees.find(f => f.id === sale.cancel_fee_id) || null;
            if (!member.fee)
                fail('Linked cancellation fee is missing.');
        }
        const plan = planSaleStockTransition({ saleId: expected.id, oldStatus: old, newStatus: request.target_status, items: own.filter(i => !i.damaged_lot_id), returnedByItem: returned, reason: 'Grouped sale status', userId: user.id, userName: actorSnapshot(user), skipStock: skipped });
        // The existing transition kernel decides every regular movement and batch delta.
        // Persist typed deltas, never executable SQL, for an exact inverse after reload.
        for (const statement of plan.statements) {
            const p = statement.params;
            if (statement.sql.startsWith('INSERT INTO inventory_movements'))
                member.stock.push({ product: Number(p.product_id), branch: Number(p.branch_id), quantity: Number(p.quantity), batch: p.batch_id ? Number(p.batch_id) : null, lot: null, name: p.product_name as string | null, costUsd: Number(p.unit_cost_usd), costKhr: Number(p.unit_cost_khr), sale: expected.id });
            if (statement.sql.startsWith('UPDATE branch_batch_stock') || statement.sql.startsWith('INSERT INTO branch_batch_stock')) {
                const item = own.find(i => i.batch_id === p.batchId || i.allocations?.some(a => a.batch_id === p.batchId))!;
                member.batches.push({ batch: Number(p.batchId), branch: Number(p.branchId), product: Number(item.product_id), quantity: Number(p.quantity) * (statement.sql.startsWith('UPDATE') ? -1 : 1) });
            }
            if (statement.sql.includes('UPDATE sale_item_batch_allocations') && p.id) {
                const a = allocations.find(a => a.id === p.id)!, next = { ...a };
                next.released_quantity += Number(p.give || 0) - Number(p.take || 0);
                next.released_at = next.released_quantity <= 0 ? null : next.released_quantity >= next.quantity ? stamp : a.released_at;
                member.allocations.push({ before: { ...a }, after: next });
            }
        }
        if (changed && !skipped)
            for (const item of own) {
                const delta = heldQuantity(old, item.quantity, returned.get(item.id) || 0) - heldQuantity(request.target_status, item.quantity, returned.get(item.id) || 0);
                if (!delta)
                    continue;
                if (!item.product_id || !item.branch_id)
                    fail('A stock-moving line has no product or branch.');
                if (item.damaged_lot_id)
                    member.stock.push({ product: item.product_id, branch: item.branch_id, quantity: delta, batch: null, lot: item.damaged_lot_id, name: item.product_name, costUsd: 0, costKhr: 0, sale: expected.id });
                else if (item.allocations?.length) {
                    const capacity = item.allocations.reduce((n, a) => n + (delta > 0 ? a.quantity - a.released_quantity : a.released_quantity), 0);
                    if (capacity < Math.abs(delta) || item.allocations.some(a => a.released_quantity < 0 || a.released_quantity > a.quantity))
                        fail('Sale batch allocations cannot cover the transition.');
                }
            }
        // Do not create an undoable action already at the fingerprint ceiling:
        // reserve room for its forward movements AND its first full undo.
        if (JSON.parse(String(sale.movement_fingerprint)).length + 2 * member.stock.length > BULK_STATUS_MOVEMENT_LIMIT)
            throw new SaleBulkError('This sale has too much stock history for a bulk action and its undo.', 400);
        members.push(member);
    }
    const snapshot: Snapshot = { version: 1, operationId, members };
    const changedIds = members.filter(m => m.changed).map(m => m.id), unchangedIds = members.filter(m => !m.changed).map(m => m.id);
    const receipt = { operationId, changedIds, unchangedIds, changedCount: changedIds.length, unchangedCount: unchangedIds.length, currentReplayGeneration: 0, items: members.map(m => ({ id: m.id, receipt_number: m.receipt, before: m.before.sale_status, after: m.after.sale_status, changed: m.changed, reason: m.changed ? 'changed' : (request.source_status !== undefined && m.before.sale_status !== request.source_status ? 'source_mismatch' : 'already_target'), stock_skipped: m.skipped })) };
    const statements: StockStatement[] = [...guards, { sql: 'INSERT INTO sale_bulk_operations(id,actor_id,request_id,request_json,receipt_json) VALUES(@id,@actor,@request,@canonical,@receipt)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical, receipt: JSON.stringify(receipt) } }];
    for (const m of members)
        statements.push(...memberStatements(m, 1, user, stamp));
    statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: BULK_STATUS_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: actorSnapshot(user) } });
    statements.push({ sql: 'UPDATE sale_bulk_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } });
    const historyStatementIndex = statements.length;
    statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name) SELECT 'global','sale',id,@label,@reversible,@status,json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'changed_count',@changed,'unchanged_count',@unchanged,'target_status',@target),json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'changed_count',@changed,'unchanged_count',@unchanged,'target_status',@target),@actor,@name FROM sale_bulk_operations WHERE id=@id`, params: { id: operationId, label: `${changedIds.length} sales → ${request.target_status}; ${unchangedIds.length} unchanged`, reversible: changedIds.length ? 1 : 0, status: changedIds.length ? 'undoable' : 'recorded', kind: BULK_STATUS_KIND, actor: user.id, name: actorSnapshot(user), changed: changedIds.length, unchanged: unchangedIds.length, target: request.target_status } });
    statements.push({ sql: "UPDATE sale_bulk_operations SET history_id=last_insert_rowid(),receipt_json=json_set(receipt_json,'$.actionHistoryId',last_insert_rowid()) WHERE id=@id", params: { id: operationId } });
    for (const m of members.filter(member => member.changed))
        statements.push({ sql: `INSERT INTO sale_bulk_members(operation_id,sale_id,revision,movement_fingerprint) VALUES(@op,@id,COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0),${saleMovementFingerprint('@id')})`, params: { op: operationId, id: m.id } });
    statements.push(auditStatement(user, operationId, 'sale_status_bulk', changedIds.length), { sql: 'DELETE FROM sale_bulk_guards', params: {} });
    bounded(statements, snapshot);
    try {
        const results = await db.batch(statements);
        return { ...receipt, actionHistoryId: Number(results[historyStatementIndex].meta.last_row_id) };
    }
    catch (error) {
        const retry = await db.prepare('SELECT request_json,receipt_json FROM sale_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id });
        if (retry?.request_json === canonical)
            return JSON.parse(String(retry.receipt_json));
        if (/constraint/i.test(String(error)))
            fail('Sale or stock changed. The entire group was rejected; refresh before retrying.');
        throw error;
    }
}
export async function replaySaleBulkStatus(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row) {
    permission(user);
    if (!Number.isSafeInteger(generation) || Number(generation) < 0)
        fail('Refresh history before replaying this group.');
    const db = getDb(env);
    const op = await db.prepare('SELECT o.*,s.payload_json,s.kind,s.status snapshot_status FROM sale_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.history_id=?').get<Row>([historyId]);
    if (!op || op.kind !== BULK_STATUS_KIND || op.id !== payload.operation_id || op.snapshot_id !== payload.snapshot_id || op.generation !== generation)
        fail('This group has changed or its snapshot does not match.');
    const snapshot = JSON.parse(String(op.payload_json)) as Snapshot;
    if (snapshot.version !== 1 || snapshot.operationId !== op.id || snapshot.members.length > BULK_STATUS_LIMIT)
        fail('Unsupported bulk snapshot.');
    const sign = direction === 'undo' ? -1 : 1, expected = direction === 'undo' ? 'undoable' : 'redoable', next = direction === 'undo' ? 'redoable' : 'undoable', stamp = new Date().toISOString();
    const statements: StockStatement[] = [bulkAssertion("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore') AND EXISTS(SELECT 1 FROM sale_bulk_operations o JOIN action_history h ON h.id=o.history_id JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@op AND o.generation=@generation AND h.id=@history AND h.status=@expected AND s.kind=@kind AND s.status=@snap AND s.payload_json=@payload)", { op: op.id, generation, history: historyId, expected, kind: BULK_STATUS_KIND, snap: direction === 'undo' ? 'applied' : 'reversed', payload: op.payload_json })];
    for (const m of snapshot.members.filter(member => member.changed))
        statements.push(bulkAssertion(`EXISTS(SELECT 1 FROM sales s JOIN sale_bulk_members m ON m.sale_id=s.id WHERE m.operation_id=@op AND s.id=@id AND m.revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=s.id),0) AND m.movement_fingerprint=${saleMovementFingerprint('s.id')})`, { op: op.id, id: m.id }));
    for (const m of snapshot.members)
        statements.push(...memberStatements(m, sign, user, stamp));
    for (const m of snapshot.members.filter(member => member.changed))
        statements.push({ sql: `UPDATE sale_bulk_members SET revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0),movement_fingerprint=${saleMovementFingerprint('@id')} WHERE operation_id=@op AND sale_id=@id`, params: { op: op.id, id: m.id } });
    statements.push({ sql: 'UPDATE sale_bulk_operations SET generation=generation+1 WHERE id=@op', params: { op: op.id } });
    statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=@stamp WHERE id=@id', params: { id: op.snapshot_id, status: direction === 'undo' ? 'reversed' : 'applied', stamp } });
    statements.push({ sql: "UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id", params: { id: historyId, status: next, stamp, generation: Number(generation) + 1 } });
    statements.push(auditStatement(user, String(op.id), `action_${direction}`, snapshot.members.filter(m => m.changed).length), { sql: 'DELETE FROM sale_bulk_guards', params: {} });
    bounded(statements, snapshot);
    try {
        await db.batch(statements);
    }
    catch (error) {
        if (/constraint/i.test(String(error)))
            fail('A sale, its stock, or this replay changed. Nothing in the group was applied.');
        throw error;
    }
}
