import { PrimaryButton, VerticalAlignment, type DeviceParams } from './codec';
import { CARDBOARD_V1 } from './defaults';

/** Early SDKs misbehave unless tray_to_lens is exactly this when alignment is CENTER. */
export const CENTER_TRAY_TO_LENS = 0.035;

/**
 * Brings a profile into the shape we export: exactly 4 FOV angles and at
 * least 2 distortion coefficients (padded from Cardboard v1 / zeros; extra
 * coefficients are kept), the CENTER tray quirk, and has_magnet implied by a
 * MAGNET button.
 */
export function normalize(p: DeviceParams): DeviceParams {
  const fov = p.leftEyeFieldOfViewAngles.slice(0, 4);
  while (fov.length < 4) fov.push(CARDBOARD_V1.leftEyeFieldOfViewAngles[fov.length]!);
  const k = [...p.distortionCoefficients];
  while (k.length < 2) k.push(0);
  return {
    ...p,
    leftEyeFieldOfViewAngles: fov,
    distortionCoefficients: k,
    trayToLensDistance:
      p.verticalAlignment === VerticalAlignment.CENTER ? CENTER_TRAY_TO_LENS : p.trayToLensDistance,
    hasMagnet: p.primaryButton === PrimaryButton.MAGNET || p.hasMagnet,
  };
}

/** Human-readable problems with a normalized profile. Empty when it looks sane. */
export function warnings(p: DeviceParams): string[] {
  const out: string[] = [];
  if (!p.vendor.trim() || !p.model.trim()) {
    out.push('Vendor and model should both be set; apps show them, and the pair should be unique.');
  }
  if (!(p.screenToLensDistance > 0)) out.push('Screen-to-lens distance must be positive.');
  if (!(p.interLensDistance > 0)) out.push('Inter-lens distance must be positive.');
  if (p.verticalAlignment !== VerticalAlignment.CENTER && !(p.trayToLensDistance > 0)) {
    out.push('Tray-to-lens distance must be positive.');
  }
  const [k1 = 0, k2 = 0] = p.distortionCoefficients;
  if (k1 === 0 && k2 === 0) {
    out.push('k1 and k2 are both 0. Every curved lens distorts; tune k1 until grid lines are straight.');
  }
  if (p.distortionCoefficients.length > 2) {
    out.push(
      `This profile has ${p.distortionCoefficients.length} distortion coefficients. ` +
        'Only k1 and k2 are editable and previewed; the rest are exported unchanged.',
    );
  }
  if (p.leftEyeFieldOfViewAngles.some((a) => !(a > 0 && a < 90))) {
    out.push('Field-of-view angles must be between 0° and 90°.');
  }
  return out;
}
