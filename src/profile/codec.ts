// DeviceParams (CardboardDevice.proto) <-> bytes <-> cfg URI.
//
// The Cardboard SDK decodes our exported QR, so field numbers, types, units
// and the URI shape must match it. See HANDOFF.md §4.

import {
  Reader,
  Writer,
  fieldFloat,
  fieldFloats,
  fieldString,
  fieldUint,
} from './protobuf';

export const VerticalAlignment = { BOTTOM: 0, CENTER: 1, TOP: 2 } as const;
export type VerticalAlignment = (typeof VerticalAlignment)[keyof typeof VerticalAlignment];

export const PrimaryButton = { NONE: 0, MAGNET: 1, TOUCH: 2, INDIRECT_TOUCH: 3 } as const;
export type PrimaryButton = (typeof PrimaryButton)[keyof typeof PrimaryButton];

/** Lengths in metres, angles in degrees. Values are float32 on the wire. */
export interface DeviceParams {
  vendor: string;
  model: string;
  screenToLensDistance: number;
  interLensDistance: number;
  /** Left eye, order L (outer), R (inner), B, T — as the SDK reads it. */
  leftEyeFieldOfViewAngles: number[];
  verticalAlignment: VerticalAlignment;
  trayToLensDistance: number;
  /** [k1, k2] */
  distortionCoefficients: number[];
  hasMagnet: boolean;
  primaryButton: PrimaryButton;
}

const F = {
  vendor: 1,
  model: 2,
  screenToLensDistance: 3,
  interLensDistance: 4,
  leftEyeFieldOfViewAngles: 5,
  trayToLensDistance: 6,
  distortionCoefficients: 7,
  hasMagnet: 10,
  verticalAlignment: 11,
  primaryButton: 12,
} as const;

/**
 * Fields are written in .proto declaration order (11 sits between 5 and 6),
 * matching Google's encoder so the §4 test vector reproduces byte for byte.
 * Every field is written, including defaults; in particular primary_button
 * must be explicit or it decodes as MAGNET.
 */
export function encodeDeviceParams(p: DeviceParams): Uint8Array {
  return new Writer()
    .string(F.vendor, p.vendor)
    .string(F.model, p.model)
    .float(F.screenToLensDistance, p.screenToLensDistance)
    .float(F.interLensDistance, p.interLensDistance)
    .packedFloats(F.leftEyeFieldOfViewAngles, p.leftEyeFieldOfViewAngles)
    .uint(F.verticalAlignment, p.verticalAlignment)
    .float(F.trayToLensDistance, p.trayToLensDistance)
    .packedFloats(F.distortionCoefficients, p.distortionCoefficients)
    .bool(F.hasMagnet, p.hasMagnet)
    .uint(F.primaryButton, p.primaryButton)
    .finish();
}

function asEnum<T extends number>(values: Record<string, T>, v: number, name: string): T {
  if (!(Object.values(values) as number[]).includes(v)) throw new Error(`unknown ${name} ${v}`);
  return v as T;
}

/** Missing fields take their proto2 defaults (primary_button = MAGNET). Unknown fields are skipped. */
export function decodeDeviceParams(bytes: Uint8Array): DeviceParams {
  const p: DeviceParams = {
    vendor: '',
    model: '',
    screenToLensDistance: 0,
    interLensDistance: 0,
    leftEyeFieldOfViewAngles: [],
    verticalAlignment: VerticalAlignment.BOTTOM,
    trayToLensDistance: 0,
    distortionCoefficients: [],
    hasMagnet: false,
    primaryButton: PrimaryButton.MAGNET,
  };
  const r = new Reader(bytes);
  while (!r.done) {
    const f = r.next();
    switch (f.field) {
      case F.vendor: p.vendor = fieldString(f); break;
      case F.model: p.model = fieldString(f); break;
      case F.screenToLensDistance: p.screenToLensDistance = fieldFloat(f); break;
      case F.interLensDistance: p.interLensDistance = fieldFloat(f); break;
      case F.leftEyeFieldOfViewAngles: p.leftEyeFieldOfViewAngles.push(...fieldFloats(f)); break;
      case F.verticalAlignment:
        p.verticalAlignment = asEnum(VerticalAlignment, fieldUint(f), 'vertical_alignment');
        break;
      case F.trayToLensDistance: p.trayToLensDistance = fieldFloat(f); break;
      case F.distortionCoefficients: p.distortionCoefficients.push(...fieldFloats(f)); break;
      case F.hasMagnet: p.hasMagnet = fieldUint(f) !== 0; break;
      case F.primaryButton:
        p.primaryButton = asEnum(PrimaryButton, fieldUint(f), 'primary_button');
        break;
    }
  }
  return p;
}

/** Standard base64 with + → -, / → _, padding stripped (Android Base64.URL_SAFE | NO_PADDING). */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('invalid base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, [0, 3, 2, 1][s.length % 4]);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Exact prefix Cardboard apps recognise. `http`, not `https`, for older apps. */
export const CFG_URI_PREFIX = 'http://google.com/cardboard/cfg?p=';

export function toCfgUri(p: DeviceParams): string {
  return CFG_URI_PREFIX + toBase64Url(encodeDeviceParams(p));
}

/**
 * Accepts a cfg URI (http or https, with or without scheme) or a bare `p`
 * value, as pasted into the editor's import field. Throws on anything else.
 */
export function parseProfileInput(input: string): DeviceParams {
  const text = input.trim();
  if (!text) throw new Error('empty input');
  if (/^[A-Za-z0-9_-]+$/.test(text)) return decodeDeviceParams(fromBase64Url(text));

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error('not a Cardboard profile URL or p value');
  }
  if (url.hostname !== 'google.com' || url.pathname !== '/cardboard/cfg') {
    throw new Error('not a google.com/cardboard/cfg URL (short links must be opened first)');
  }
  const p = url.searchParams.get('p');
  if (!p) throw new Error('URL has no p parameter');
  return decodeDeviceParams(fromBase64Url(p));
}
