/*
 * Copyright 2015 Google Inc. All Rights Reserved.
 * Modifications Copyright 2026 lanpa.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Ported from google/wwgc www/js/CardboardView.js (CardboardView,
 * ScreenParams, getYEyeOffsetMeters, getProjectionMatrixPair,
 * updateBarrelDistortion).
 *
 * Changes from wwgc, to match the current Cardboard SDK
 * (googlevr/cardboard sdk/lens_distortion.cc), which is what apps render with:
 *   - left_eye_field_of_view_angles is read as L, R, B, T (wwgc: L, R, T, B).
 *   - TOP alignment: lens height = height − tray_to_lens − border
 *     (wwgc: height − (tray_to_lens − border)).
 *   - The border is fixed at 3 mm (kDefaultBorderSizeMeters).
 */

import { VerticalAlignment, type DeviceParams } from '../profile/codec';
import { Distortion } from './distortion';

const METERS_PER_INCH = 0.0254;
export const BORDER_METERS = 0.003;

const degToRad = (d: number) => (d * Math.PI) / 180;
const radToDeg = (r: number) => (r * 180) / Math.PI;

/** The drawable screen in landscape: width is the long side. */
export interface Screen {
  widthPx: number;
  heightPx: number;
  ppi: number;
}

export const widthMeters = (s: Screen) => (s.widthPx / s.ppi) * METERS_PER_INCH;
export const heightMeters = (s: Screen) => (s.heightPx / s.ppi) * METERS_PER_INCH;

/** Left-eye half-angles in degrees. left = outer, right = inner (nose side). */
export interface Fov {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

const fovAngles = (d: DeviceParams) => {
  const [left = 0, right = 0, bottom = 0, top = 0] = d.leftEyeFieldOfViewAngles;
  return { left, right, bottom, top };
};

/** Height of the lens centre above the bottom edge of the drawable screen, metres. */
export function lensOffsetYMeters(s: Screen, d: DeviceParams): number {
  switch (d.verticalAlignment) {
    case VerticalAlignment.BOTTOM:
      return d.trayToLensDistance - BORDER_METERS;
    case VerticalAlignment.TOP:
      return heightMeters(s) - d.trayToLensDistance - BORDER_METERS;
    default:
      return heightMeters(s) / 2;
  }
}

/** FOV visible through the lens, capped by the profile's maximum FOV. */
export function leftEyeFov(s: Screen, d: DeviceParams): Fov {
  const distortion = new Distortion(d.distortionCoefficients);
  // The screen-to-lens distance approximates the virtual-eye-to-screen distance.
  const eyeToScreen = d.screenToLensDistance;
  const outerDist = (widthMeters(s) - d.interLensDistance) / 2;
  const innerDist = d.interLensDistance / 2;
  const bottomDist = lensOffsetYMeters(s, d);
  const topDist = heightMeters(s) - bottomDist;
  const angle = (dist: number) => radToDeg(Math.atan(distortion.distort(dist / eyeToScreen)));
  const max = fovAngles(d);
  return {
    left: Math.min(angle(outerDist), max.left),
    right: Math.min(angle(innerDist), max.right),
    bottom: Math.min(angle(bottomDist), max.bottom),
    top: Math.min(angle(topDist), max.top),
  };
}

/** FOV and pixel viewport the left eye would cover with no lens. */
export function leftEyeFovAndViewportNoDistortionCorrection(
  s: Screen,
  d: DeviceParams,
): { fov: Fov; viewport: Viewport } {
  const distortion = new Distortion(d.distortionCoefficients);
  const eyeToScreen = d.screenToLensDistance;
  const halfLensDistance = d.interLensDistance / 2 / eyeToScreen;
  const screenWidth = widthMeters(s) / eyeToScreen;
  const screenHeight = heightMeters(s) / eyeToScreen;
  const xPxPerTanAngle = s.widthPx / screenWidth;
  const yPxPerTanAngle = s.heightPx / screenHeight;

  const eyePosX = screenWidth / 2 - halfLensDistance;
  const eyePosY = lensOffsetYMeters(s, d) / eyeToScreen;

  const max = fovAngles(d);
  const inv = (deg: number) => distortion.distortInverse(Math.tan(degToRad(deg)));
  const outerDist = Math.min(eyePosX, inv(max.left));
  const innerDist = Math.min(halfLensDistance, inv(max.right));
  const bottomDist = Math.min(eyePosY, inv(max.bottom));
  const topDist = Math.min(screenHeight - eyePosY, inv(max.top));

  const fov: Fov = {
    left: radToDeg(Math.atan(outerDist)),
    right: radToDeg(Math.atan(innerDist)),
    bottom: radToDeg(Math.atan(bottomDist)),
    top: radToDeg(Math.atan(topDist)),
  };
  const x = Math.round((eyePosX - outerDist) * xPxPerTanAngle);
  const y = Math.round((eyePosY - bottomDist) * yPxPerTanAngle);
  const viewport: Viewport = {
    x,
    width: Math.round((eyePosX + innerDist) * xPxPerTanAngle) - x,
    y,
    height: Math.round((eyePosY + topDist) * yPxPerTanAngle) - y,
  };
  return { fov, viewport };
}

/**
 * Column-major asymmetric frustum (THREE.Matrix4.makeFrustum layout).
 * `eye` 'right' mirrors the left-eye FOV horizontally.
 */
export function frustum(fov: Fov, near: number, far: number, eye: 'left' | 'right' = 'left'): Float32Array {
  const outer = Math.tan(degToRad(fov.left)) * near;
  const inner = Math.tan(degToRad(fov.right)) * near;
  const bottom = Math.tan(degToRad(fov.bottom)) * near;
  const top = Math.tan(degToRad(fov.top)) * near;
  const [l, r] = eye === 'left' ? [-outer, inner] : [-inner, outer];
  const b = -bottom;
  const t = top;
  return new Float32Array([
    (2 * near) / (r - l), 0, 0, 0,
    0, (2 * near) / (t - b), 0, 0,
    (r + l) / (r - l), (t + b) / (t - b), -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ]);
}

export interface BarrelUniforms {
  distortion: [number, number];
  projectionLeft: [number, number, number, number];
  unprojectionLeft: [number, number, number, number];
}

/**
 * Shader parameters: parts of the projection matrices needed to convert
 * texture coordinates between the distorted and undistorted frustums,
 * adjusted for texture space [0..1] ↔ NDC [-1..1] and the viewport.
 * Line-for-line port of CARDBOARD.updateBarrelDistortion.
 */
export function barrelUniforms(s: Screen, d: DeviceParams, near: number, far: number): BarrelUniforms {
  const [k1 = 0, k2 = 0] = d.distortionCoefficients;
  let e = frustum(leftEyeFov(s, d), near, far);
  const projectionLeft: BarrelUniforms['projectionLeft'] = [
    e[0]! / 2,
    e[5]! / 2,
    (e[8]! - 1) / 2,
    (e[9]! - 1) / 2,
  ];

  const noLens = leftEyeFovAndViewportNoDistortionCorrection(s, d);
  const vp = noLens.viewport;
  e = frustum(noLens.fov, near, far);
  const xScale = vp.width / (s.widthPx / 2);
  const yScale = vp.height / s.heightPx;
  const xTrans = (2 * (vp.x + vp.width / 2)) / (s.widthPx / 2) - 1;
  const yTrans = (2 * (vp.y + vp.height / 2)) / s.heightPx - 1;
  const unprojectionLeft: BarrelUniforms['unprojectionLeft'] = [
    (e[0]! * xScale) / 2,
    (e[5]! * yScale) / 2,
    (e[8]! - 1 - xTrans) / 2,
    (e[9]! - 1 - yTrans) / 2,
  ];

  return { distortion: [k1, k2], projectionLeft, unprojectionLeft };
}
