import { computeDiff } from './diff.util';
import { LineItem } from '../models/cr.models';

const base: LineItem[] = [
	{ sku: 'SKU-A', description: 'Widget A', quantity: 10, unitPrice: 500 },
	{ sku: 'SKU-B', description: 'Widget B', quantity: 30, unitPrice: 100 },
];

describe('computeDiff', () => {
	it('detects a removed sku', () => {
		expect(computeDiff(base, [base[0]]).find((r) => r.sku === 'SKU-B')?.kind).toBe('removed');
	});

	it('detects an added sku', () => {
		const rows = computeDiff(base, [...base, { sku: 'SKU-C', description: 'C', quantity: 1, unitPrice: 5 }]);
		expect(rows.find((r) => r.sku === 'SKU-C')?.kind).toBe('added');
	});

	it('detects a quantity-only change as changed', () => {
		// SKU-A quantity 10 -> 11 (same unit price) is a real change.
		const rows = computeDiff(base, [{ ...base[0], quantity: 11 }, base[1]]);
		expect(rows.find((r) => r.sku === 'SKU-A')?.kind).toBe('changed');
	});

	it('detects a unit-price-only change as changed', () => {
		const rows = computeDiff(base, [{ ...base[0], unitPrice: 550 }, base[1]]);
		expect(rows.find((r) => r.sku === 'SKU-A')?.kind).toBe('changed');
	});

	it('detects a description-only change as changed', () => {
		// CR-2 in the fixtures is exactly this: same quantity and price, new supplier in the text.
		const rows = computeDiff(base, [{ ...base[0], description: 'Widget A (new supplier)' }, base[1]]);
		expect(rows.find((r) => r.sku === 'SKU-A')?.kind).toBe('changed');
	});

	it('reports an untouched line as unchanged', () => {
		expect(computeDiff(base, [...base]).map((r) => r.kind)).toEqual(['unchanged', 'unchanged']);
	});

	it('treats every line as added when there is no baseline', () => {
		expect(computeDiff([], base).map((r) => r.kind)).toEqual(['added', 'added']);
	});

	it('treats every line as removed when nothing is proposed', () => {
		expect(computeDiff(base, []).map((r) => r.kind)).toEqual(['removed', 'removed']);
	});

	it('keeps baseline order and appends added lines, whatever order the proposal arrives in', () => {
		const rows = computeDiff(base, [base[1], base[0], { sku: 'SKU-C', description: 'C', quantity: 1, unitPrice: 5 }]);
		expect(rows.map((r) => r.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);
	});

	it('carries both sides of a changed row so the template can render before and after', () => {
		const rows = computeDiff(base, [{ ...base[0], quantity: 11 }, base[1]]);
		const changed = rows.find((r) => r.sku === 'SKU-A');
		expect(changed?.baseline?.quantity).toBe(10);
		expect(changed?.proposed?.quantity).toBe(11);
	});
});
