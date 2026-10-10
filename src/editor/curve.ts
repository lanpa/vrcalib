// Live plot of the distortion scale 1 + k1·r² + k2·r⁴ beside the k fields.
// Axes stay fixed while tuning (x always 0–1.2, y at least 0–3) so changes
// to k show up as the curve moving, not the axes rescaling.

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 170;
const PAD = { left: 34, right: 10, top: 10, bottom: 26 };
const R_MAX = 1.2;
const SAMPLES = 120;

const scale = (k1: number, k2: number, r: number) => {
  const r2 = r * r;
  return 1 + (k1 + k2 * r2) * r2;
};

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, name);
  for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, String(v));
  parent?.append(e);
  return e;
}

export class DistortionCurve {
  private readonly svg: SVGSVGElement;
  private k1 = 0;
  private k2 = 0;
  private hoverR: number | null = null;

  constructor(svg: SVGSVGElement, caption: HTMLElement) {
    this.svg = svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    caption.textContent =
      'Scale 1 + k1·r² + k2·r⁴ against r, the distance from the lens centre ' +
      '(tan-angle units, 1 = 45°). A flat line at 1 means no correction.';
    svg.addEventListener('pointermove', (e) => {
      const pt = this.toViewBox(e);
      const r = ((pt.x - PAD.left) / (W - PAD.left - PAD.right)) * R_MAX;
      this.hoverR = Math.min(R_MAX, Math.max(0, r));
      this.draw();
    });
    svg.addEventListener('pointerleave', () => {
      this.hoverR = null;
      this.draw();
    });
  }

  update(k1: number, k2: number): void {
    this.k1 = k1;
    this.k2 = k2;
    this.draw();
  }

  private toViewBox(e: PointerEvent): DOMPoint {
    const ctm = this.svg.getScreenCTM();
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm ? ctm.inverse() : undefined);
  }

  private draw(): void {
    const { k1, k2 } = this;
    const pts = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const r = (i / SAMPLES) * R_MAX;
      return [r, scale(k1, k2, r)] as const;
    });
    const ys = pts.map(([, y]) => y);
    const yMin = Math.min(0, Math.floor(Math.min(...ys) * 2) / 2);
    const yMax = Math.max(3, Math.ceil(Math.max(...ys) * 2) / 2);

    const x = (r: number) => PAD.left + (r / R_MAX) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    this.svg.replaceChildren();
    const grid = el('g', { class: 'grid' }, this.svg);
    const yStep = yMax - yMin > 6 ? 2 : 1;
    for (let v = Math.ceil(yMin); v <= yMax; v += yStep) {
      el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v) }, grid);
      el('text', { x: PAD.left - 6, y: y(v), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, grid)
        .textContent = String(v);
    }
    for (const r of [0, 0.4, 0.8, 1.2]) {
      el('text', { x: x(r), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, grid).textContent =
        r.toFixed(1);
    }
    el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(1), y2: y(1), class: 'reference' }, this.svg);

    const d = pts.map(([r, v], i) => `${i ? 'L' : 'M'}${x(r).toFixed(1)},${y(v).toFixed(1)}`).join('');
    el('path', { d, class: 'line' }, this.svg);

    if (this.hoverR !== null) {
      const r = this.hoverR;
      const v = scale(k1, k2, r);
      el('line', { x1: x(r), x2: x(r), y1: PAD.top, y2: H - PAD.bottom, class: 'crosshair' }, this.svg);
      el('circle', { cx: x(r), cy: y(v), r: 4, class: 'dot' }, this.svg);
      const deg = (Math.atan(r) * 180) / Math.PI;
      const right = x(r) > W / 2;
      el('text', {
        x: right ? x(r) - 8 : x(r) + 8,
        y: PAD.top + 12,
        class: 'readout',
        'text-anchor': right ? 'end' : 'start',
      }, this.svg).textContent = `r ${r.toFixed(2)} (${deg.toFixed(0)}°) → ×${v.toFixed(2)}`;
    }
  }
}
