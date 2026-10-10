import { PrimaryButton, VerticalAlignment, type DeviceParams } from './codec';

/** Google Cardboard v1: the starting point for calibration (HANDOFF.md §4 test vector). */
export const CARDBOARD_V1: Readonly<DeviceParams> = Object.freeze({
  vendor: 'Google',
  model: 'Cardboard v1',
  screenToLensDistance: 0.0393,
  interLensDistance: 0.0639,
  leftEyeFieldOfViewAngles: [40, 40, 40, 40],
  verticalAlignment: VerticalAlignment.BOTTOM,
  trayToLensDistance: 0.035,
  distortionCoefficients: [0.33583, 0.55349],
  hasMagnet: false,
  primaryButton: PrimaryButton.NONE,
});

export function defaultParams(): DeviceParams {
  return {
    ...CARDBOARD_V1,
    leftEyeFieldOfViewAngles: [...CARDBOARD_V1.leftEyeFieldOfViewAngles],
    distortionCoefficients: [...CARDBOARD_V1.distortionCoefficients],
  };
}
