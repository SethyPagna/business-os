import { allocateDispositionBasis, quantityDecimal } from './stockDispositionBasis';
export type ValuationSegment = {
    segment_id: string;
    allocation_id: string;
    fate: 'sellable' | 'held' | 'disposed' | 'consumed';
    quantity: string;
    gross4: number;
    coverage4: number;
    loss4: number;
    recovery4: number;
    reason: string;
    consumption_id?: string | null;
    consumed_cost4?: number;
    consumed_recovery4?: number;
};
export function sumValuationQuantity(values: string[]) {
    const scale = Math.max(0, ...values.map(value => quantityDecimal(value, true).split('.')[1]?.length ?? 0));
    const integer = values.reduce((n, value) => { const [whole, tail = ''] = quantityDecimal(value, true).split('.'); return n + BigInt(whole + tail.padEnd(scale, '0')); }, 0n);
    const digits = String(integer).padStart(scale + 1, '0');
    return quantityDecimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits, true);
}
export function splitValuationSegment(segment: ValuationSegment, quantity: unknown, childId: string, fate: ValuationSegment['fate']) {
    const part = allocateDispositionBasis(segment.quantity, segment.gross4, segment.coverage4, quantity);
    const child = { ...segment, segment_id: childId, fate, quantity: part.quantity, gross4: part.gross4, coverage4: part.coverage4, loss4: fate === 'disposed' ? part.net4 : 0, recovery4: 0 };
    const remainder = part.remainingQuantity === '0' ? null : { ...segment, quantity: part.remainingQuantity, gross4: part.remainingGross4, coverage4: part.remainingCoverage4 };
    return { child, remainder };
}
export function applyValuationCoverage(segment: ValuationSegment, amount4: number) {
    if (!Number.isSafeInteger(amount4) || amount4 <= 0 || amount4 > segment.gross4 - segment.coverage4 || (segment.fate === 'sellable' && segment.allocation_id === segment.segment_id))
        throw new RangeError('ineligible_coverage_target');
    return { ...segment, coverage4: segment.coverage4 + amount4, recovery4: segment.recovery4 + (segment.fate === 'disposed' ? amount4 : 0), ...(segment.fate === 'consumed' ? { consumed_recovery4: (segment.consumed_recovery4 ?? 0) + amount4 } : {}) };
}
export function valuationTotals(segments: ValuationSegment[], gross4: number, acquiredQuantity?: string, version = 3) {
    const totals = { sellable_quantity: '0', held_quantity: '0', sellable_net4: 0, held_net4: 0, historical_loss4: 0, recovery4: 0, coverage4: 0 };
    const consumption = { consumed_quantity: '0', consumed_cost4: 0, consumed_recovery4: 0 };
    if (new Set(segments.map(s => s.segment_id)).size !== segments.length || (acquiredQuantity !== undefined && sumValuationQuantity(segments.map(s => s.quantity)) !== quantityDecimal(acquiredQuantity)))
        throw new RangeError('valuation_quantity_conservation_failed');
    if (segments.reduce((total, segment) => total + segment.gross4, 0) !== gross4)
        throw new RangeError('valuation_gross_conservation_failed');
    totals.sellable_quantity = sumValuationQuantity(segments.filter(s => s.fate === 'sellable').map(s => s.quantity));
    totals.held_quantity = sumValuationQuantity(segments.filter(s => s.fate === 'held').map(s => s.quantity));
    consumption.consumed_quantity = sumValuationQuantity(segments.filter(s => s.fate === 'consumed').map(s => s.quantity));
    for (const s of segments) {
        quantityDecimal(s.quantity);
        if ([s.gross4, s.coverage4, s.loss4, s.recovery4].some(n => !Number.isSafeInteger(n) || n < 0) || s.coverage4 > s.gross4 || s.recovery4 > s.loss4)
            throw new RangeError('valuation_state_invalid');
        if (s.fate === 'disposed' ? s.loss4 + s.coverage4 - s.recovery4 !== s.gross4 : s.loss4 !== 0 || s.recovery4 !== 0)
            throw new RangeError('valuation_fate_basis_invalid');
        const cost4 = s.consumed_cost4 ?? 0, recovery4 = s.consumed_recovery4 ?? 0;
        if (![cost4, recovery4].every(n => Number.isSafeInteger(n) && n >= 0) || recovery4 > cost4 || (s.fate === 'consumed' ? version !== 4 || !s.consumption_id || cost4 + s.coverage4 - recovery4 !== s.gross4 : cost4 !== 0 || recovery4 !== 0))
            throw new RangeError('valuation_consumption_basis_invalid');
        if (s.fate === 'sellable')
            totals.sellable_net4 += s.gross4 - s.coverage4;
        if (s.fate === 'held')
            totals.held_net4 += s.gross4 - s.coverage4;
        totals.historical_loss4 += s.loss4;
        totals.recovery4 += s.recovery4;
        totals.coverage4 += s.coverage4;
        consumption.consumed_cost4 += cost4;
        consumption.consumed_recovery4 += recovery4;
    }
    if ([...Object.values(totals), ...Object.values(consumption)].filter(n => typeof n === 'number').some(n => !Number.isSafeInteger(n)) || totals.sellable_net4 + totals.held_net4 + totals.historical_loss4 - totals.recovery4 + totals.coverage4 + consumption.consumed_cost4 - consumption.consumed_recovery4 !== gross4)
        throw new RangeError('valuation_conservation_failed');
    return { ...totals, ...(version === 4 ? consumption : {}) };
}

export function valuationSegmentsV4(segments: ValuationSegment[]) {
    return segments.map(segment => ({ ...segment, consumption_id: segment.consumption_id ?? null, consumed_cost4: segment.consumed_cost4 ?? 0, consumed_recovery4: segment.consumed_recovery4 ?? 0 }));
}

export function planValuationSaleSegments(segments: ValuationSegment[], input: { kind: string; segment_id: string; child_segment_id?: string; quantity: unknown; consumption_id: string }) {
    const next = valuationSegmentsV4(segments);
    const index = next.findIndex(segment => segment.segment_id === input.segment_id);
    if (index < 0) throw new RangeError('valuation_sale_segment_missing');
    const original = next[index];
    const quantity = quantityDecimal(input.quantity);
    if (input.kind === 'consume') {
        if (original.fate !== 'sellable' || original.consumption_id || !input.child_segment_id || next.some(segment => segment.segment_id === input.child_segment_id)) throw new RangeError('valuation_sale_segment_conflict');
        const { child, remainder } = splitValuationSegment(original, quantity, input.child_segment_id, 'consumed');
        child.consumption_id = input.consumption_id;
        child.consumed_cost4 = child.gross4 - child.coverage4;
        child.consumed_recovery4 = 0;
        return [...next.slice(0, index), ...(remainder ? [remainder] : []), child, ...next.slice(index + 1)];
    }
    if (quantity !== original.quantity || original.consumption_id !== input.consumption_id) throw new RangeError('valuation_sale_restoration_conflict');
    if (input.kind === 'restore' && original.fate === 'consumed') next[index] = { ...original, fate: 'sellable', consumed_cost4: 0, consumed_recovery4: 0 };
    else if (input.kind === 'reconsume' && original.fate === 'sellable') next[index] = { ...original, fate: 'consumed', consumed_cost4: original.gross4 - original.coverage4, consumed_recovery4: 0 };
    else throw new RangeError('valuation_sale_restoration_conflict');
    return next;
}
