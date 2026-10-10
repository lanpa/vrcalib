import './editor.css';
import { parseProfileInput, toCfgUri, type DeviceParams } from '../profile/codec';
import { defaultParams } from '../profile/defaults';
import { warnings } from '../profile/rules';
import { DistortionCurve } from './curve';
import { ProfileForm } from './form';
import { downloadQrPng, drawQr, qrFilename } from './qr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const qrCanvas = $<HTMLCanvasElement>('qr');
const uriEl = $('cfg-uri');
const warningsEl = $('warnings');
const copyStatus = $('copy-status');
const importInput = $<HTMLInputElement>('import-input');
const importStatus = $('import-status');
const curve = new DistortionCurve(document.getElementById('curve') as unknown as SVGSVGElement, $('curve-caption'));

let current: DeviceParams;
let qrPending = false;

function onChange(p: DeviceParams): void {
  current = p;
  const uri = toCfgUri(p);
  uriEl.textContent = uri;
  curve.update(p.distortionCoefficients[0] ?? 0, p.distortionCoefficients[1] ?? 0);
  warningsEl.replaceChildren(
    ...warnings(p).map((w) => Object.assign(document.createElement('li'), { textContent: w })),
  );
  copyStatus.textContent = '';
  // Coalesce bursts of key repeats into one redraw per frame.
  if (!qrPending) {
    qrPending = true;
    requestAnimationFrame(() => {
      qrPending = false;
      void drawQr(qrCanvas, toCfgUri(current), 240);
    });
  }
}

const form = new ProfileForm($<HTMLFormElement>('profile-form'), defaultParams(), onChange);

function importProfile(): void {
  try {
    const p = parseProfileInput(importInput.value);
    form.load(p);
    importStatus.textContent = `Loaded ${[p.vendor, p.model].filter(Boolean).join(' ') || 'profile'}.`;
    importStatus.dataset.kind = 'ok';
    importInput.value = '';
  } catch (e) {
    importStatus.textContent = e instanceof Error ? `Could not load: ${e.message}.` : 'Could not load.';
    importStatus.dataset.kind = 'error';
  }
}

$('import-button').addEventListener('click', importProfile);
importInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') importProfile();
});
$('reset-button').addEventListener('click', () => {
  form.load(defaultParams());
  importStatus.textContent = 'Reset to Cardboard v1.';
  importStatus.dataset.kind = 'ok';
});

$('download-button').addEventListener('click', () => {
  void downloadQrPng(toCfgUri(current), qrFilename(current.vendor, current.model));
});
$('copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(toCfgUri(current));
    copyStatus.textContent = 'Link copied.';
  } catch {
    copyStatus.textContent = 'Copy failed; select the link below and copy it.';
  }
});
