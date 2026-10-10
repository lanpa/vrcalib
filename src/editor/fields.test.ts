import { describe, expect, it } from 'vitest';
import { formatValue, parseValue, stepValue } from './fields';

describe('formatValue', () => {
  it('shows mm to 1 dp from metres, hiding float32 noise', () => {
    expect(formatValue('mm', Math.fround(0.0393))).toBe('39.3');
  });
  it('shows k to 3 dp', () => {
    expect(formatValue('k', Math.fround(0.33583))).toBe('0.336');
    expect(formatValue('k', -0.0001)).toBe('0.000');
  });
  it('shows degrees with 0–1 dp', () => {
    expect(formatValue('deg', 40)).toBe('40');
    expect(formatValue('deg', 40.5)).toBe('40.5');
  });
});

describe('parseValue', () => {
  it('converts mm to metres', () => {
    expect(parseValue('mm', ' 39.3 ')).toBeCloseTo(0.0393, 10);
  });
  it('accepts a decimal comma and signs', () => {
    expect(parseValue('k', '0,25')).toBe(0.25);
    expect(parseValue('k', '-.5')).toBe(-0.5);
  });
  it('rejects non-numbers', () => {
    for (const t of ['', 'abc', '1.2.3', '1e3', '-']) expect(parseValue('k', t)).toBeNull();
  });
});

describe('stepValue', () => {
  it('steps mm by 0.5 (×10 with Shift) and cleans float32 noise', () => {
    expect(stepValue('mm', Math.fround(0.0393), 1, false)).toBe(0.0398);
    expect(stepValue('mm', 0.0393, -1, true)).toBe(0.0343);
  });
  it('steps k by 0.01 without snapping finer digits', () => {
    expect(stepValue('k', Math.fround(0.33583), 1, false)).toBe(0.34583);
    expect(stepValue('k', 0, -1, true)).toBe(-0.1);
  });
  it('steps degrees by 1', () => {
    expect(stepValue('deg', 40, -1, false)).toBe(39);
  });
});
