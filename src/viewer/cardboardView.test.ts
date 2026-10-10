import { describe, expect, it } from 'vitest';
import { VerticalAlignment } from '../profile/codec';
import { defaultParams } from '../profile/defaults';
import {
  BORDER_METERS,
  barrelUniforms,
  heightMeters,
  leftEyeFov,
  leftEyeFovAndViewportNoDistortionCorrection,
  lensOffsetYMeters,
  widthMeters,
  type Screen,
} from './cardboardView';
import { Distortion } from './distortion';

// The OPPO 10x test phone: 387 PPI (2340 × 1080 assumed).
const OPPO: Screen = { widthPx: 2340, heightPx: 1080, ppi: 387 };

describe('Distortion', () => {
  // Upstream's secant search starts from the distorted radius, so with a
  // strongly negative k2 (curve not monotonic over the range) it can land on
  // the wrong root. Real lenses have k ≥ 0 or close to it.
  it('distortInverse undoes distort for r in [0, 1.5]', () => {
    for (const k of [[0.33583, 0.55349], [0.1, 0.05], [0.25, 0.02], [0, 0]]) {
      const d = new Distortion(k);
      for (let r = 0; r <= 1.5; r += 0.05) {
        expect(d.distortInverse(d.distort(r))).toBeCloseTo(r, 4);
      }
    }
  });

  it('uses every coefficient', () => {
    expect(new Distortion([0.1, 0.2, 0.3]).factor(1)).toBeCloseTo(1.6, 12);
  });
});

describe('screen model', () => {
  it('converts pixels to metres via PPI', () => {
    expect(widthMeters(OPPO) * 1000).toBeCloseTo(153.6, 1);
    expect(heightMeters(OPPO) * 1000).toBeCloseTo(70.9, 1);
  });
});

describe('lensOffsetYMeters (Cardboard SDK formulas)', () => {
  const d = { ...defaultParams(), trayToLensDistance: 0.035 };
  it('BOTTOM: tray − border', () => {
    expect(lensOffsetYMeters(OPPO, d)).toBeCloseTo(0.035 - BORDER_METERS, 12);
  });
  it('TOP: height − tray − border (SDK, not wwgc)', () => {
    const top = { ...d, verticalAlignment: VerticalAlignment.TOP };
    expect(lensOffsetYMeters(OPPO, top)).toBeCloseTo(heightMeters(OPPO) - 0.035 - BORDER_METERS, 12);
  });
  it('CENTER: half the height', () => {
    const center = { ...d, verticalAlignment: VerticalAlignment.CENTER };
    expect(lensOffsetYMeters(OPPO, center)).toBeCloseTo(heightMeters(OPPO) / 2, 12);
  });
});

describe('leftEyeFov', () => {
  it('reads the max FOV as L, R, B, T', () => {
    const d = { ...defaultParams(), leftEyeFieldOfViewAngles: [11, 12, 13, 14] };
    expect(leftEyeFov(OPPO, d)).toEqual({ left: 11, right: 12, bottom: 13, top: 14 });
  });

  it('is limited by the screen edges when the max FOV is wide', () => {
    const d = { ...defaultParams(), leftEyeFieldOfViewAngles: [89, 89, 89, 89] };
    const fov = leftEyeFov(OPPO, d);
    const dist = new Distortion(d.distortionCoefficients);
    const angle = (m: number) => (Math.atan(dist.distort(m / d.screenToLensDistance)) * 180) / Math.PI;
    expect(fov.right).toBeCloseTo(angle(d.interLensDistance / 2), 9);
    expect(fov.bottom).toBeCloseTo(angle(d.trayToLensDistance - BORDER_METERS), 9);
  });
});

describe('no-lens viewport', () => {
  it('stays inside the left half of the screen', () => {
    const { viewport } = leftEyeFovAndViewportNoDistortionCorrection(OPPO, defaultParams());
    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(OPPO.widthPx / 2 + 1);
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(OPPO.heightPx);
  });
});

describe('barrelUniforms', () => {
  it('maps the lens centre on screen to w = 0 in the shader', () => {
    // Shader: w = (v + unprojection.zw) / unprojection.xy, v in [0,1]² over the left half.
    const d = defaultParams();
    const u = barrelUniforms(OPPO, d, 0.1, 100);
    const lensX = (widthMeters(OPPO) / 2 - d.interLensDistance / 2) / (widthMeters(OPPO) / 2);
    const lensY = lensOffsetYMeters(OPPO, d) / heightMeters(OPPO);
    // Viewport rounding to whole pixels allows ~1 px of error.
    expect(Math.abs(lensX + u.unprojectionLeft[2])).toBeLessThan(2 / (OPPO.widthPx / 2));
    expect(Math.abs(lensY + u.unprojectionLeft[3])).toBeLessThan(2 / OPPO.heightPx);
  });
});
