import { describe, expect, it } from 'vitest';
import {
  CFG_URI_PREFIX,
  PrimaryButton,
  VerticalAlignment,
  decodeDeviceParams,
  encodeDeviceParams,
  fromBase64Url,
  parseProfileInput,
  toBase64Url,
  toCfgUri,
  type DeviceParams,
} from './codec';
import { Writer } from './protobuf';
import { defaultParams } from './defaults';

// Generated with Google's own ProtoBuf.js build from wwgc (HANDOFF.md §4).
const V1_P =
  'CgZHb29nbGUSDENhcmRib2FyZCB2MR0J-SA9JQHegj0qEAAAIEIAACBCAAAgQgAAIEJYADUpXA89Ogjp8as-hbENP1AAYAA';

const f32 = (x: number) => Math.fround(x);

describe('test vector', () => {
  it('encodes Cardboard v1 byte for byte', () => {
    expect(toBase64Url(encodeDeviceParams(defaultParams()))).toBe(V1_P);
    expect(toCfgUri(defaultParams())).toBe(CFG_URI_PREFIX + V1_P);
  });

  it('decodes Cardboard v1 to float32 values', () => {
    const p = decodeDeviceParams(fromBase64Url(V1_P));
    expect(p).toEqual({
      vendor: 'Google',
      model: 'Cardboard v1',
      screenToLensDistance: f32(0.0393),
      interLensDistance: f32(0.0639),
      leftEyeFieldOfViewAngles: [40, 40, 40, 40],
      verticalAlignment: VerticalAlignment.BOTTOM,
      trayToLensDistance: f32(0.035),
      distortionCoefficients: [f32(0.33583), f32(0.55349)],
      hasMagnet: false,
      primaryButton: PrimaryButton.NONE,
    } satisfies DeviceParams);
  });
});

describe('round trip', () => {
  it('preserves every field (as float32)', () => {
    const p: DeviceParams = {
      vendor: 'Ünïcode Vendor ✓',
      model: 'X',
      screenToLensDistance: 0.042,
      interLensDistance: 0.06,
      leftEyeFieldOfViewAngles: [50, 45, 55, 60],
      verticalAlignment: VerticalAlignment.TOP,
      trayToLensDistance: 0.031,
      distortionCoefficients: [0.1, -0.02],
      hasMagnet: true,
      primaryButton: PrimaryButton.INDIRECT_TOUCH,
    };
    const q = decodeDeviceParams(encodeDeviceParams(p));
    expect(q).toEqual({
      ...p,
      screenToLensDistance: f32(0.042),
      interLensDistance: f32(0.06),
      trayToLensDistance: f32(0.031),
      distortionCoefficients: [f32(0.1), f32(-0.02)],
    });
  });
});

describe('decoder', () => {
  it('defaults a missing primary_button to MAGNET', () => {
    const bytes = new Writer().string(1, 'v').finish();
    expect(decodeDeviceParams(bytes).primaryButton).toBe(PrimaryButton.MAGNET);
  });

  it('accepts unpacked repeated floats', () => {
    const bytes = new Writer().float(7, 0.25).float(7, 0.5).finish();
    expect(decodeDeviceParams(bytes).distortionCoefficients).toEqual([0.25, 0.5]);
  });

  it('skips unknown fields', () => {
    const bytes = new Writer().uint(99, 7).string(98, 'x').float(97, 1).string(2, 'm').finish();
    expect(decodeDeviceParams(bytes).model).toBe('m');
  });

  it('rejects truncated input', () => {
    const bytes = encodeDeviceParams(defaultParams());
    expect(() => decodeDeviceParams(bytes.subarray(0, bytes.length - 3))).toThrow();
  });

  it('rejects unknown enum values', () => {
    expect(() => decodeDeviceParams(new Writer().uint(12, 9).finish())).toThrow(/primary_button/);
  });
});

describe('base64url', () => {
  it('round-trips every padding length', () => {
    for (let n = 0; n < 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 251) & 0xff);
      const s = toBase64Url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      expect(fromBase64Url(s)).toEqual(bytes);
    }
  });

  it('rejects invalid characters', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
  });
});

describe('parseProfileInput', () => {
  const inputs = [
    V1_P,
    `  ${V1_P}\n`,
    `http://google.com/cardboard/cfg?p=${V1_P}`,
    `https://google.com/cardboard/cfg?p=${V1_P}`,
    `google.com/cardboard/cfg?p=${V1_P}`,
  ];
  for (const input of inputs) {
    it(`accepts ${input.trim().slice(0, 40)}…`, () => {
      expect(parseProfileInput(input).model).toBe('Cardboard v1');
    });
  }

  it('rejects other hosts, including www.google.com (the SDK does too)', () => {
    expect(() => parseProfileInput(`https://www.google.com/cardboard/cfg?p=${V1_P}`)).toThrow();
    expect(() => parseProfileInput(`https://example.com/cardboard/cfg?p=${V1_P}`)).toThrow();
  });

  it('rejects a cfg URL without p', () => {
    expect(() => parseProfileInput('http://google.com/cardboard/cfg')).toThrow(/no p/);
  });
});
