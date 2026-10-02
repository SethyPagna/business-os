import type { SessionUser } from './auth';
import { getDb, type D1Compat } from './db';
import { feeRequestDigest } from './feeOperationReceipt';
import { quantityDecimal } from './stockDispositionBasis';
import { checkedHistory, currentValuationSaleActor, planStockValuation, StockValuationError } from './stockValuation';
import { sumValuationQuantity } from './stockValuationMath';
import { decrementBatchStockStrictStatement } from './productBatches';

type Env = { DB: D1Database; IMPORT_DB?: D1Database };
type Line = { product_id: number; batch_id?: number | null; branch_id?: number | null; quantity: number; client_line_key?: string; damaged_lot_id?: number | null; stock_valuation?: unknown };
type Statement = { sql: string; params: Record<string, unknown> };
type SalePlan = { prefix: Statement[]; finish: Statement[]; costPriceUsd: number };
type ReconsumeOrder = { batchId: number; branchId: number; productId: number; allocationId: number; quantity: number };
const refuse = (code: string): never => { throw new StockValuationError(code); };
const enabled = (env: Env) => (env as Env & { STOCK_VALUATION_EXPERIMENT?: string }).STOCK_VALUATION_EXPERIMENT === 'local-fixture-only';
const statements = (rows: { sql: string; params?: Record<string, unknown> }[]) => rows.map(row => ({ ...row, params: row.params ?? {} }));

export async function assertStockValuationSaleReplay(db: D1Compat, actor: SessionUser, saleId: number, intent?: unknown) {
    const links = await db.prepare('SELECT source_id,sale_intent_json FROM stock_valuation_sale_links WHERE sale_id=@sale').all<{ source_id: string; sale_intent_json: string }>({ sale: saleId });
    if (!links.length) return;
    await currentValuationSaleActor(db, actor, intent === undefined ? 'restore' : 'consume');
    if (intent !== undefined && links.some(link => link.sale_intent_json !== JSON.stringify(intent))) refuse('valuation_sale_intent_conflict');
    for (const source of new Set(links.map(link => link.source_id))) await checkedHistory(db, source);
}

export async function planStockValuationCheckout(env: Env, actor: SessionUser, lines: Line[], intent: unknown, saleRequest: string, deduct: boolean) {
    const selected = lines.filter(line => line.stock_valuation !== undefined);
    const result = new Map<string, SalePlan>();
    if (!selected.length) return result;
    if (!enabled(env)) refuse('stock_valuation_consumption_disabled');
    if (selected.length !== 1 || !deduct || lines.some(line => line !== selected[0] && line.product_id === selected[0].product_id)) refuse('valuation_sale_scope_unsupported');
    const line = selected[0], selection = line.stock_valuation as Record<string, unknown>;
    if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).sort().join('|') !== ['expected_generation', 'expected_revision', 'segment_id', 'source_id'].join('|') || !line.batch_id || !line.branch_id || line.damaged_lot_id || !line.client_line_key) refuse('valuation_sale_selection_invalid');
    const digest = await feeRequestDigest(`${saleRequest}:${line.client_line_key}`), consumption = `sale-${digest}`;
    const plan = await planStockValuation(env, actor, { kind: 'consume', source_id: selection.source_id, expected_revision: selection.expected_revision, expected_generation: selection.expected_generation, client_request_id: `valuation-consume-${digest}`, segment_id: selection.segment_id, child_segment_id: consumption, quantity: quantityDecimal(line.quantity), consumption_id: consumption, sale_request_id: saleRequest, sale_line_key: line.client_line_key, sale_intent_json: JSON.stringify(intent), operation_id: saleRequest }, { productId: line.product_id, batchId: line.batch_id!, branchId: line.branch_id! });
    if ('replay' in plan) return refuse('valuation_sale_orphan_replay');
    const consumed = plan.response.segments.find(segment => segment.consumption_id === consumption)!;
    result.set(line.client_line_key!, { prefix: statements(plan.prefix), finish: statements(plan.finish), costPriceUsd: Math.round(consumed.consumed_cost4! / line.quantity) / 10000 });
    return result;
}

export async function planStockValuationSaleStatus(env: Env, actor: SessionUser, saleId: number, oldStatus: string, newStatus: string, operation: string, skipStock: boolean, returned: Map<number, number>) {
    const db = getDb(env);
    const links = await db.prepare('SELECT l.*,f.product_id,f.batch_id,f.branch_id,e.revision,g.generation FROM stock_valuation_sale_links l JOIN stock_funding_sources f ON f.id=l.source_id JOIN stock_valuation_latest e ON e.source_id=l.source_id JOIN stock_funding_latest g ON g.source_id=l.source_id WHERE l.sale_id=@sale').all<Record<string, any>>({ sale: saleId });
    if (!links.length || (oldStatus === 'cancelled') === (newStatus === 'cancelled')) return { prefix: [] as Statement[], finish: [] as Statement[], reconsumeOrder: undefined as ReconsumeOrder | undefined };
    if (!enabled(env)) refuse('stock_valuation_consumption_disabled');
    if (links.length !== 1 || skipStock || links.some(link => (returned.get(link.sale_item_id) ?? 0) !== 0)) refuse('valuation_sale_scope_unsupported');
    const link = links[0], kind = newStatus === 'cancelled' ? 'restore' : 'reconsume';
    const digest = await feeRequestDigest(`${operation}:${link.id}:${kind}`);
    const plan = await planStockValuation(env, actor, { kind, source_id: link.source_id, expected_revision: link.revision, expected_generation: link.generation, client_request_id: `valuation-status-${digest}`, segment_id: link.segment_id, quantity: link.quantity, consumption_id: link.id, sale_request_id: link.sale_request_id, sale_line_key: link.sale_line_key, sale_intent_json: link.sale_intent_json, operation_id: operation }, { productId: link.product_id, batchId: link.batch_id, branchId: link.branch_id, allocationId: link.sale_allocation_id });
    if ('replay' in plan) return refuse('valuation_sale_orphan_replay');
    return { prefix: statements(plan.prefix), finish: statements(plan.finish), reconsumeOrder: kind === 'reconsume' ? { batchId: link.batch_id, branchId: link.branch_id, productId: link.product_id, allocationId: link.sale_allocation_id, quantity: Number(link.quantity) } as ReconsumeOrder : undefined };
}

export function orderStockValuationReconsume(original: Statement[], order?: ReconsumeOrder) {
    if (!order) return original;
    const expected = decrementBatchStockStrictStatement(order.batchId, order.branchId, order.quantity);
    const matches = original.map((statement, index) => statement.sql === expected.sql && JSON.stringify(statement.params) === JSON.stringify(expected.params) ? index : -1).filter(index => index >= 0);
    if (matches.length !== 1) return refuse('valuation_sale_plan_changed');
    const lotIndex = matches[0], aggregate = original[lotIndex - 2], product = original[lotIndex - 1], allocation = original[lotIndex + 1];
    if (!aggregate || !product || !allocation || aggregate.sql.trim() !== 'INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)\n              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity' || aggregate.params.product_id !== order.productId || aggregate.params.branch_id !== order.branchId || aggregate.params.quantity !== order.quantity || product.params.product_id !== order.productId || product.params.quantity !== order.quantity || allocation.params.id !== order.allocationId || allocation.params.take !== order.quantity) return refuse('valuation_sale_plan_changed');
    const ordered = [...original];
    ordered.splice(lotIndex, 1);
    ordered.splice(lotIndex - 2, 0, original[lotIndex]);
    return ordered;
}

export const stockValuationSaleCostRelation = 'stock_valuation_sale_costs';
export const stockValuationSaleRecoveryRelation = 'stock_valuation_sale_recoveries';
export type StockValuationSaleCost = { managed: true; quantity: string; cost4: number; recovery4: number; net4: number; sourceIds: string[] };
export async function readStockValuationSaleCosts(db: D1Compat, saleItemIds: readonly number[]): Promise<Map<number, StockValuationSaleCost>> {
    const result = new Map<number, StockValuationSaleCost>();
    const ids = [...new Set(saleItemIds)];
    for (let start = 0; start < ids.length; start += 90) {
        const chunk = ids.slice(start, start + 90);
        const rows = await db.prepare(`SELECT l.sale_item_id,l.source_id,l.quantity,s.consumed_cost4,s.consumed_recovery4 FROM stock_valuation_sale_links l LEFT JOIN stock_valuation_latest e ON e.source_id=l.source_id LEFT JOIN stock_valuation_segments_v4 s ON s.event_id=e.id AND s.consumption_id=l.id WHERE l.sale_item_id IN (${chunk.map(() => '?').join(',')})`).all<{ sale_item_id: number; source_id: string; quantity: string; consumed_cost4: number; consumed_recovery4: number }>(chunk);
        for (const row of rows) {
            if (!Number.isSafeInteger(row.consumed_cost4) || !Number.isSafeInteger(row.consumed_recovery4) || row.consumed_cost4 < row.consumed_recovery4 || row.consumed_recovery4 < 0) refuse('valuation_sale_cost_corrupt');
            const current = result.get(row.sale_item_id) ?? { managed: true as const, quantity: '0', cost4: 0, recovery4: 0, net4: 0, sourceIds: [] };
            current.quantity = sumValuationQuantity([current.quantity, row.quantity]);
            current.cost4 += row.consumed_cost4;
            current.recovery4 += row.consumed_recovery4;
            current.net4 = current.cost4 - current.recovery4;
            if (!current.sourceIds.includes(row.source_id)) current.sourceIds.push(row.source_id);
            current.sourceIds.sort();
            result.set(row.sale_item_id, current);
        }
    }
    return result;
}
