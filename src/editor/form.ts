// Binds the profile form to a DeviceParams model.
//
// `params` holds what the user entered. What gets displayed and exported is
// normalize(params): e.g. with CENTER alignment the tray field shows (and the
// QR carries) 35 mm, but the user's own tray value comes back if they switch
// to BOTTOM again.

import { PrimaryButton, VerticalAlignment, type DeviceParams } from '../profile/codec';
import { normalize } from '../profile/rules';
import { formatValue, parseValue, stepValue, type NumKind } from './fields';

interface NumberField {
  kind: NumKind;
  get(p: DeviceParams): number;
  set(p: DeviceParams, v: number): void;
}

const fov = (i: number): NumberField => ({
  kind: 'deg',
  get: (p) => p.leftEyeFieldOfViewAngles[i] ?? 0,
  set: (p, v) => {
    p.leftEyeFieldOfViewAngles[i] = v;
  },
});

const k = (i: number): NumberField => ({
  kind: 'k',
  get: (p) => p.distortionCoefficients[i] ?? 0,
  set: (p, v) => {
    p.distortionCoefficients[i] = v;
  },
});

const NUMBER_FIELDS: Record<string, NumberField> = {
  screenToLens: {
    kind: 'mm',
    get: (p) => p.screenToLensDistance,
    set: (p, v) => (p.screenToLensDistance = v),
  },
  interLens: {
    kind: 'mm',
    get: (p) => p.interLensDistance,
    set: (p, v) => (p.interLensDistance = v),
  },
  trayToLens: {
    kind: 'mm',
    get: (p) => p.trayToLensDistance,
    set: (p, v) => (p.trayToLensDistance = v),
  },
  k1: k(0),
  k2: k(1),
  fovL: fov(0),
  fovR: fov(1),
  fovB: fov(2),
  fovT: fov(3),
};

export class ProfileForm {
  private params: DeviceParams;
  private readonly form: HTMLFormElement;
  private readonly onChange: (exported: DeviceParams) => void;

  constructor(form: HTMLFormElement, initial: DeviceParams, onChange: (exported: DeviceParams) => void) {
    this.form = form;
    this.onChange = onChange;
    this.params = normalize(initial);

    for (const input of this.numberInputs()) {
      input.type = 'text';
      input.inputMode = 'decimal';
      input.spellcheck = false;
      input.addEventListener('keydown', (e) => this.onNumberKey(e, input));
      input.addEventListener('input', () => this.onNumberInput(input));
      input.addEventListener('blur', () => this.refresh());
    }
    this.input('vendor').addEventListener('input', () => {
      this.params.vendor = this.input('vendor').value;
      this.emit();
    });
    this.input('model').addEventListener('input', () => {
      this.params.model = this.input('model').value;
      this.emit();
    });
    this.select('verticalAlignment').addEventListener('change', () => {
      this.params.verticalAlignment = Number(this.select('verticalAlignment').value) as VerticalAlignment;
      this.refresh();
      this.emit();
    });
    this.select('primaryButton').addEventListener('change', () => {
      this.params.primaryButton = Number(this.select('primaryButton').value) as PrimaryButton;
      this.refresh();
      this.emit();
    });
    this.input('hasMagnet').addEventListener('change', () => {
      this.params.hasMagnet = this.input('hasMagnet').checked;
      this.emit();
    });
    // Enter in a field must not submit (and reload) the page.
    form.addEventListener('submit', (e) => e.preventDefault());

    this.refresh();
    this.emit();
  }

  /** Replaces the whole profile (import / reset). */
  load(p: DeviceParams): void {
    this.params = normalize(p);
    this.refresh();
    this.emit();
  }

  /** The profile as exported: normalized. */
  get exported(): DeviceParams {
    return normalize(this.params);
  }

  private input(name: string): HTMLInputElement {
    return this.form.elements.namedItem(name) as HTMLInputElement;
  }

  private select(name: string): HTMLSelectElement {
    return this.form.elements.namedItem(name) as HTMLSelectElement;
  }

  private numberInputs(): HTMLInputElement[] {
    return [...this.form.querySelectorAll<HTMLInputElement>('input[data-num]')];
  }

  private field(input: HTMLInputElement): NumberField {
    const f = NUMBER_FIELDS[input.name];
    if (!f) throw new Error(`no number field ${input.name}`);
    return f;
  }

  private onNumberKey(e: KeyboardEvent, input: HTMLInputElement): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (input.disabled) return;
    e.preventDefault();
    const f = this.field(input);
    f.set(this.params, stepValue(f.kind, f.get(this.params), e.key === 'ArrowUp' ? 1 : -1, e.shiftKey));
    input.value = formatValue(f.kind, f.get(this.params));
    input.removeAttribute('aria-invalid');
    this.emit();
  }

  private onNumberInput(input: HTMLInputElement): void {
    const f = this.field(input);
    const v = parseValue(f.kind, input.value);
    if (v === null) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.removeAttribute('aria-invalid');
    f.set(this.params, v);
    this.emit();
  }

  /** Model → inputs, leaving the field being typed in alone. */
  private refresh(): void {
    const shown = this.exported;
    const active = document.activeElement;
    for (const input of this.numberInputs()) {
      if (input === active && input.getAttribute('aria-invalid') !== 'true' && input.value !== '') {
        continue;
      }
      const f = this.field(input);
      input.value = formatValue(f.kind, f.get(shown));
      input.removeAttribute('aria-invalid');
    }
    if (active !== this.input('vendor')) this.input('vendor').value = shown.vendor;
    if (active !== this.input('model')) this.input('model').value = shown.model;
    this.select('verticalAlignment').value = String(shown.verticalAlignment);
    this.select('primaryButton').value = String(shown.primaryButton);

    const center = shown.verticalAlignment === VerticalAlignment.CENTER;
    this.input('trayToLens').disabled = center;
    this.input('trayToLens').title = center ? 'Fixed at 35 mm for Center alignment (needed by older apps)' : '';

    const magnet = shown.primaryButton === PrimaryButton.MAGNET;
    this.input('hasMagnet').checked = shown.hasMagnet;
    this.input('hasMagnet').disabled = magnet;
    this.input('hasMagnet').title = magnet ? 'Implied by the Magnet button' : '';
  }

  private emit(): void {
    this.onChange(this.exported);
  }
}
