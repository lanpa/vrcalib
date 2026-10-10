// Minimal proto2 wire-format reader/writer: just what DeviceParams needs
// (varint, fixed32 float, length-delimited bytes/strings, packed floats).

export const WireType = {
  VARINT: 0,
  FIXED64: 1,
  LENGTH_DELIMITED: 2,
  FIXED32: 5,
} as const;
export type WireType = (typeof WireType)[keyof typeof WireType];

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export class Writer {
  private bytes: number[] = [];

  private varint(value: number): void {
    // Only non-negative values below 2^32 are needed here (enums, bools, lengths).
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError(`varint out of range: ${value}`);
    }
    while (value > 0x7f) {
      this.bytes.push((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    this.bytes.push(value);
  }

  private tag(field: number, wireType: WireType): void {
    this.varint(field * 8 + wireType);
  }

  private float32Bytes(value: number): number[] {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)];
  }

  uint(field: number, value: number): this {
    this.tag(field, WireType.VARINT);
    this.varint(value);
    return this;
  }

  bool(field: number, value: boolean): this {
    return this.uint(field, value ? 1 : 0);
  }

  float(field: number, value: number): this {
    this.tag(field, WireType.FIXED32);
    this.bytes.push(...this.float32Bytes(value));
    return this;
  }

  string(field: number, value: string): this {
    const encoded = utf8Encoder.encode(value);
    this.tag(field, WireType.LENGTH_DELIMITED);
    this.varint(encoded.length);
    this.bytes.push(...encoded);
    return this;
  }

  packedFloats(field: number, values: readonly number[]): this {
    // proto2 omits empty packed fields entirely.
    if (values.length === 0) return this;
    this.tag(field, WireType.LENGTH_DELIMITED);
    this.varint(values.length * 4);
    for (const v of values) this.bytes.push(...this.float32Bytes(v));
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export interface Field {
  field: number;
  wireType: WireType;
  /** VARINT: the value. Others: unused (0). */
  value: number;
  /** LENGTH_DELIMITED: the payload. FIXED32/FIXED64: the raw bytes. */
  bytes: Uint8Array;
}

export class Reader {
  private pos = 0;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  private varint(): number {
    // Values above 2^53 lose precision; nothing in DeviceParams gets near that.
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new Error('malformed varint');
  }

  private byte(): number {
    if (this.pos >= this.buf.length) throw new Error('unexpected end of message');
    return this.buf[this.pos++]!;
  }

  private take(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error('unexpected end of message');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  next(): Field {
    const key = this.varint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (field === 0) throw new Error('invalid field number 0');
    switch (wireType) {
      case WireType.VARINT:
        return { field, wireType, value: this.varint(), bytes: new Uint8Array() };
      case WireType.FIXED32:
        return { field, wireType, value: 0, bytes: this.take(4) };
      case WireType.FIXED64:
        return { field, wireType, value: 0, bytes: this.take(8) };
      case WireType.LENGTH_DELIMITED:
        return { field, wireType, value: 0, bytes: this.take(this.varint()) };
      default:
        throw new Error(`unsupported wire type ${wireType} (field ${field})`);
    }
  }
}

export function fieldFloat(f: Field): number {
  if (f.wireType !== WireType.FIXED32) throw new Error(`field ${f.field}: expected float`);
  return new DataView(f.bytes.buffer, f.bytes.byteOffset, 4).getFloat32(0, true);
}

/** A repeated float may arrive packed (one length-delimited run) or unpacked (one fixed32 per element). */
export function fieldFloats(f: Field): number[] {
  if (f.wireType === WireType.FIXED32) return [fieldFloat(f)];
  if (f.wireType !== WireType.LENGTH_DELIMITED || f.bytes.length % 4 !== 0) {
    throw new Error(`field ${f.field}: expected packed floats`);
  }
  const view = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.length);
  const out: number[] = [];
  for (let i = 0; i < f.bytes.length; i += 4) out.push(view.getFloat32(i, true));
  return out;
}

export function fieldString(f: Field): string {
  if (f.wireType !== WireType.LENGTH_DELIMITED) throw new Error(`field ${f.field}: expected string`);
  return utf8Decoder.decode(f.bytes);
}

export function fieldUint(f: Field): number {
  if (f.wireType !== WireType.VARINT) throw new Error(`field ${f.field}: expected varint`);
  return f.value;
}
