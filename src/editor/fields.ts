// Number formatting, parsing and arrow-key stepping for the editor's fields.
// The model keeps full precision (metres, float32 values from imports); only
// the display is rounded.

export type NumKind = 'mm' | 'k' | 'deg';

interface KindSpec {
  unit: string;
  /** Arrow-key step in display units; Shift multiplies by 10. */
  step: number;
  /** Digits shown. */
  decimals: number;
  /** Drop trailing zeros (40.0° → 40°). */
  trim: boolean;
  toDisplay(v: number): number;
  fromDisplay(d: number): number;
}

export const KINDS: Record<NumKind, KindSpec> = {
  mm: {
    unit: 'mm',
    step: 0.5,
    decimals: 1,
    trim: false,
    toDisplay: (m) => m * 1000,
    fromDisplay: (d) => d / 1000,
  },
  k: { unit: '', step: 0.01, decimals: 3, trim: false, toDisplay: (v) => v, fromDisplay: (d) => d },
  deg: { unit: '°', step: 1, decimals: 1, trim: true, toDisplay: (v) => v, fromDisplay: (d) => d },
};

export function formatValue(kind: NumKind, v: number): string {
  const s = KINDS[kind].toDisplay(v).toFixed(KINDS[kind].decimals);
  const out = KINDS[kind].trim ? s.replace(/\.?0+$/, '') : s;
  return out === '-0' || /^-0\.0+$/.test(out) ? out.slice(1) : out;
}

/** Parses what the user typed (display units; `,` accepted as decimal point). null if not a number. */
export function parseValue(kind: NumKind, text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(KINDS[kind].fromDisplay(Number(t)).toPrecision(12));
}

/**
 * One arrow-key step. The result is rounded two digits past the display
 * precision, which removes float32 noise (39.2999984 mm + 0.5 → 39.8 mm)
 * without snapping finer values the user typed or imported.
 */
export function stepValue(kind: NumKind, v: number, direction: 1 | -1, big: boolean): number {
  const spec = KINDS[kind];
  const d = spec.toDisplay(v) + direction * spec.step * (big ? 10 : 1);
  const scale = 10 ** (spec.decimals + 2);
  // toPrecision drops the unit-conversion artefact (39.8 / 1000 = 0.039799999999999995).
  return Number(spec.fromDisplay(Math.round(d * scale) / scale).toPrecision(12));
}
