import { describe, expect, it } from 'vitest';
import { PrimaryButton, VerticalAlignment } from './codec';
import { defaultParams } from './defaults';
import { CENTER_TRAY_TO_LENS, normalize, warnings } from './rules';

describe('normalize', () => {
  it('forces tray_to_lens to 0.035 for CENTER alignment', () => {
    const p = { ...defaultParams(), verticalAlignment: VerticalAlignment.CENTER, trayToLensDistance: 0.02 };
    expect(normalize(p).trayToLensDistance).toBe(CENTER_TRAY_TO_LENS);
  });

  it('keeps tray_to_lens for BOTTOM and TOP', () => {
    const p = { ...defaultParams(), verticalAlignment: VerticalAlignment.TOP, trayToLensDistance: 0.02 };
    expect(normalize(p).trayToLensDistance).toBe(0.02);
  });

  it('sets has_magnet when the primary button is MAGNET', () => {
    const p = { ...defaultParams(), primaryButton: PrimaryButton.MAGNET, hasMagnet: false };
    expect(normalize(p).hasMagnet).toBe(true);
  });

  it('pads FOV to 4 and k to 2, keeping extra coefficients', () => {
    const p = { ...defaultParams(), leftEyeFieldOfViewAngles: [50], distortionCoefficients: [] };
    expect(normalize(p).leftEyeFieldOfViewAngles).toEqual([50, 40, 40, 40]);
    expect(normalize(p).distortionCoefficients).toEqual([0, 0]);
    const q = { ...defaultParams(), distortionCoefficients: [0.1, 0.2, 0.3] };
    expect(normalize(q).distortionCoefficients).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('warnings', () => {
  it('is empty for Cardboard v1', () => {
    expect(warnings(normalize(defaultParams()))).toEqual([]);
  });

  it('flags k1 = k2 = 0', () => {
    const p = normalize({ ...defaultParams(), distortionCoefficients: [0, 0] });
    expect(warnings(p).join()).toMatch(/k1 and k2 are both 0/);
  });

  it('flags out-of-range FOV', () => {
    const p = normalize({ ...defaultParams(), leftEyeFieldOfViewAngles: [40, 0, 40, 95] });
    expect(warnings(p).join()).toMatch(/between 0° and 90°/);
  });
});
