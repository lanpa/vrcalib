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
 * The barrel shader is ported from google/wwgc
 * www/js/CardboardBarrelDistortion.js (GLSL ES 1.0 → 3.0). The grid scene
 * shaders are new.
 */

// --- Pass 1: the grid box, rendered once per eye into an offscreen texture.

export const SCENE_VERTEX = /* glsl */ `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
out vec3 vPosition;
flat out vec3 vNormal;
flat out vec3 vColor;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vColor = aColor;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

/** Grid lines every CELL metres, about LINE_PX texture pixels wide at any distance. */
export const SCENE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPosition;
flat in vec3 vNormal;
flat in vec3 vColor;
out vec4 fragColor;
const float CELL = 0.5;
const float LINE_PX = 2.0;
void main() {
  vec3 n = abs(vNormal);
  vec2 c = (n.x > 0.5 ? vPosition.zy : n.y > 0.5 ? vPosition.xz : vPosition.xy) / CELL;
  vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  float line = 1.0 - smoothstep(LINE_PX * 0.5 - 0.5, LINE_PX * 0.5 + 0.5, min(d.x, d.y));
  vec3 base = vColor * 0.3;
  vec3 ink = mix(vColor, vec3(1.0), 0.65);
  fragColor = vec4(mix(base, ink, line), 1.0);
}
`;

// --- Pass 2: barrel pre-distortion of the two eye images onto the screen.

export const BARREL_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const BARREL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 distortion;
uniform vec4 backgroundColor;
uniform vec4 projectionLeft;
uniform vec4 unprojectionLeft;
uniform int showCenter;
uniform vec4 dividerColor;
in vec2 vUV;
out vec4 fragColor;

float poly(float val) {
  // At the exact optical centre, return a huge scale so the sample falls
  // outside the texture and shows as background: the red centre dot.
  return (showCenter == 1 && val < 0.00005)
      ? 10000.0
      : 1.0 + (distortion.x + distortion.y * val) * val;
}

vec2 barrel(vec2 v, vec4 projection, vec4 unprojection) {
  vec2 w = (v + unprojection.zw) / unprojection.xy;
  return projection.xy * (poly(dot(w, w)) * w) - projection.zw;
}

void main() {
  // Right projections are shifted and horizontally mirrored relative to left.
  vec4 projectionRight =
      (projectionLeft + vec4(0.0, 0.0, 1.0, 0.0)) * vec4(1.0, 1.0, -1.0, 1.0);
  vec4 unprojectionRight =
      (unprojectionLeft + vec4(0.0, 0.0, 1.0, 0.0)) * vec4(1.0, 1.0, -1.0, 1.0);

  vec2 a = (vUV.x < 0.5)
      ? barrel(vec2(vUV.x / 0.5, vUV.y), projectionLeft, unprojectionLeft)
      : barrel(vec2((vUV.x - 0.5) / 0.5, vUV.y), projectionRight, unprojectionRight);

  if (dividerColor.w > 0.0 && abs(vUV.x - 0.5) < 0.001) {
    fragColor = dividerColor;
  } else if (a.x < 0.0 || a.x > 1.0 || a.y < 0.0 || a.y > 1.0) {
    fragColor = backgroundColor;
  } else {
    fragColor = texture(tDiffuse, vec2(a.x * 0.5 + (vUV.x < 0.5 ? 0.0 : 0.5), a.y));
  }
}
`;
