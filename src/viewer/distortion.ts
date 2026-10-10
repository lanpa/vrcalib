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
 * Ported from CARDBOARD.DistortionParams in google/wwgc www/js/CardboardView.js.
 */

// Pincushion distortion function which maps from position on real screen to
// virtual screen (i.e. texture) relative to optical center:
//
//    p' = p (1 + K1 r^2 + K2 r^4 + ... + Kn r^(2n))
//
// where r is the distance in tan-angle units from the optical center.

export class Distortion {
  readonly coefficients: readonly number[];

  constructor(coefficients: readonly number[]) {
    this.coefficients = coefficients;
  }

  factor(radius: number): number {
    let result = 1;
    let rFactor = 1;
    const rSquared = radius * radius;
    for (const ki of this.coefficients) {
      rFactor *= rSquared;
      result += ki * rFactor;
    }
    return result;
  }

  distort(radius: number): number {
    return radius * this.factor(radius);
  }

  /** Secant method, as upstream. Capped so pathological k can't hang the page. */
  distortInverse(radius: number): number {
    let r0 = radius / 0.9;
    let r1 = radius * 0.9;
    let dr0 = radius - this.distort(r0);
    for (let i = 0; i < 100 && Math.abs(r1 - r0) > 0.0001; i++) {
      const dr1 = radius - this.distort(r1);
      const r2 = r1 - dr1 * ((r1 - r0) / (dr1 - dr0));
      r0 = r1;
      r1 = r2;
      dr0 = dr1;
    }
    return r1;
  }
}
