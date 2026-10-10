// Phone screen properties the profile doesn't carry: pixels per inch, and the
// exact drawable size in device pixels.

const PPI_KEY = 'vrcalib.ppi';

export const isValidPpi = (n: number) => Number.isFinite(n) && n >= 100 && n <= 1000;

/** `?ppi=` (remembered for next time), else the remembered value, else null. */
export function initialPpi(search: string = location.search): number | null {
  const fromUrl = Number(new URLSearchParams(search).get('ppi'));
  if (isValidPpi(fromUrl)) {
    savePpi(fromUrl);
    return fromUrl;
  }
  try {
    const stored = Number(localStorage.getItem(PPI_KEY));
    return isValidPpi(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function savePpi(ppi: number): void {
  try {
    localStorage.setItem(PPI_KEY, String(ppi));
  } catch {
    // Private mode etc.: the value just isn't remembered.
  }
}

/** Physical screen size in device pixels, long side first. */
export function physicalScreenPx(): [number, number] {
  const dpr = window.devicePixelRatio || 1;
  const a = Math.round(screen.width * dpr);
  const b = Math.round(screen.height * dpr);
  return [Math.max(a, b), Math.min(a, b)];
}

/**
 * Keeps the canvas backing store at exactly its on-screen size in device
 * pixels, so the geometry maths matches what is drawn.
 */
export function trackCanvasSize(canvas: HTMLCanvasElement, onResize: () => void): void {
  const apply = (w: number, h: number) => {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    onResize();
  };
  const ro = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(entry.contentRect.width * dpr);
    const h = Math.round(entry.contentRect.height * dpr);
    // The device-pixel box is exact where it's right, but emulated DPR
    // (DevTools, Playwright) reports it in CSS pixels; only trust it when it
    // agrees with CSS size × DPR.
    const box = entry.devicePixelContentBoxSize?.[0];
    if (box && Math.abs(box.inlineSize - w) <= 2 && Math.abs(box.blockSize - h) <= 2) {
      apply(box.inlineSize, box.blockSize);
    } else {
      apply(w, h);
    }
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }
}
