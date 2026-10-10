import './viewer.css';
import { parseProfileInput, toCfgUri, type DeviceParams } from '../profile/codec';
import { describeError } from '../sync/errors';
import { defaultParams } from '../profile/defaults';
import { normalize } from '../profile/rules';
import { heightMeters, leftEyeFov, widthMeters, type Screen } from './cardboardView';
import { canFullscreen, enterFullscreenLandscape, isFullscreen, keepScreenOn } from './fullscreen';
import { StereoRenderer } from './scene';
import { initialPpi, isValidPpi, physicalScreenPx, savePpi, trackCanvasSize } from './screen';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const overlay = $('overlay');
const startForm = $<HTMLFormElement>('start-form');
const ppiInput = $<HTMLInputElement>('ppi');
const startButton = $<HTMLButtonElement>('start');
const screenInfo = $('screen-info');
const problemsEl = $('start-problems');
const rotateEl = $('rotate');
const hud = $('hud');

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isIOSChrome = isIOS && /CriOS/.test(ua);
const debug = new URLSearchParams(location.search).has('debug');

// Until the editor's session arrives (or without one), show Cardboard v1.
let device: DeviceParams = normalize(defaultParams());
let showCenter = true;
let ppi = initialPpi();
let started = false;

function unsupported(message: string): void {
  const el = $('unsupported');
  el.textContent = message;
  el.hidden = false;
  startForm.hidden = true;
}

let renderer: StereoRenderer | null = null;
if (isIOS && !isIOSChrome) {
  unsupported('On iPhone, open this page in Chrome. Better still, use an Android phone with Chrome.');
} else {
  try {
    renderer = new StereoRenderer(canvas);
  } catch (e) {
    unsupported(`This browser can't run the viewer (${e instanceof Error ? e.message : String(e)}).`);
  }
}
$('ios-note').hidden = !isIOSChrome;

// --- PPI entry and the screen-size sanity check

function updateScreenInfo(): void {
  const value = Number(ppiInput.value.trim());
  const valid = isValidPpi(value);
  ppiInput.toggleAttribute('aria-invalid', ppiInput.value.trim() !== '' && !valid);
  startButton.disabled = !valid || !renderer;
  if (!valid) {
    screenInfo.textContent = '';
    return;
  }
  const [w, h] = physicalScreenPx();
  const s: Screen = { widthPx: w, heightPx: h, ppi: value };
  const mm = (m: number) => (m * 1000).toFixed(1);
  screenInfo.textContent =
    `Screen ${w} × ${h} px at ${value} PPI = ${mm(widthMeters(s))} × ${mm(heightMeters(s))} mm. ` +
    'If that is far from the phone’s real screen size, the PPI is wrong.';
}

if (ppi) ppiInput.value = String(ppi);
ppiInput.addEventListener('input', () => {
  $('ppi-source').hidden = true;
  updateScreenInfo();
});

/** PPI from the screen width measured with a ruler and entered in the editor. */
function applyMeasuredWidth(mm: number): void {
  const [longPx] = physicalScreenPx();
  const derived = Math.round(((longPx * 25.4) / mm) * 10) / 10;
  if (!isValidPpi(derived) || derived === ppi) return;
  ppi = derived;
  savePpi(derived);
  ppiInput.value = String(derived);
  const source = $('ppi-source');
  source.textContent = `From the editor: ${longPx} px across a measured ${mm.toFixed(1)} mm.`;
  source.hidden = false;
  updateScreenInfo();
  requestRender();
}
updateScreenInfo();

// --- Start: fullscreen + landscape + wake lock, from the user's tap

async function start(): Promise<void> {
  const value = Number(ppiInput.value.trim());
  if (!isValidPpi(value) || !renderer) return;
  ppi = value;
  savePpi(value);
  const problems = await enterFullscreenLandscape();
  await keepScreenOn();
  started = true;
  problemsEl.hidden = problems.length === 0 || isFullscreen();
  problemsEl.textContent = problems.join('; ');
  updateOverlay();
  requestRender();
}

startForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void start();
});

function updateOverlay(): void {
  // With the Fullscreen API, the overlay follows fullscreen state: leaving
  // fullscreen (back gesture) brings it back. iPhone has no element
  // fullscreen, so there the overlay hides once Start is tapped.
  overlay.hidden = canFullscreen() ? isFullscreen() : started;
  rotateEl.hidden = !overlay.hidden || canvas.width >= canvas.height;
}

document.addEventListener('fullscreenchange', () => {
  updateOverlay();
  requestRender();
});

// --- Rendering

let renderPending = false;
function requestRender(): void {
  if (renderPending || !renderer) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    draw();
  });
}

function draw(): void {
  if (!renderer || !ppi || canvas.width === 0 || canvas.height === 0) return;
  const s: Screen = { widthPx: canvas.width, heightPx: canvas.height, ppi };
  renderer.render(s, device, showCenter);
  if (debug) {
    const [pw, ph] = physicalScreenPx();
    const fov = leftEyeFov(s, device);
    hud.hidden = false;
    hud.textContent =
      `canvas ${canvas.width}×${canvas.height}  screen ${pw}×${ph}  ppi ${ppi}  ` +
      `${(widthMeters(s) * 1000).toFixed(1)}×${(heightMeters(s) * 1000).toFixed(1)} mm  ` +
      `fov L${fov.left.toFixed(1)} R${fov.right.toFixed(1)} B${fov.bottom.toFixed(1)} T${fov.top.toFixed(1)}`;
  }
}

trackCanvasSize(canvas, () => {
  updateOverlay();
  requestRender();
});

// A Bluetooth or desktop keyboard can toggle the lens-centre dots.
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' && e.target === document.body) {
    showCenter = !showCenter;
    requestRender();
  }
});

function setDevice(p: DeviceParams): void {
  device = normalize(p);
  requestRender();
}

// --- Live link to the editor (?s=<session id> from the pairing QR)

const linkStatus = $('link-status');
function setLink(state: 'none' | 'connecting' | 'live' | 'missing' | 'error', detail = ''): void {
  linkStatus.dataset.state = state;
  linkStatus.textContent = {
    none: 'Not linked to an editor: showing Cardboard v1. Open the viewer by scanning the QR code in the editor.',
    connecting: 'Connecting to the editor…',
    live: 'Linked to the editor: changes there show up here live.',
    missing: 'Waiting for the editor. If this persists, scan the QR code in the editor again.',
    error: `Can't reach the editor (${detail}). Showing the last profile received.`,
  }[state];
}

const sid = new URLSearchParams(location.search).get('s');
if (!sid) {
  setLink('none');
} else {
  setLink('connecting');
  void import('../sync/session')
    .then(({ isSessionId, watchSession }) => {
      if (!isSessionId(sid)) throw new Error('bad session id in the link');
      return watchSession(
        sid,
        (state) => {
          if (!state) {
            setLink('missing');
            return;
          }
          try {
            showCenter = state.showLensCenter;
            if (state.screenWidthMm !== null) applyMeasuredWidth(state.screenWidthMm);
            setDevice(parseProfileInput(state.paramsUri));
            setLink('live');
          } catch (e) {
            setLink('error', e instanceof Error ? e.message : String(e));
          }
        },
        (e) => setLink('error', describeError(e)),
      );
    })
    .catch((e: unknown) => setLink('error', describeError(e)));
}
(window as unknown as { vrcalib: unknown }).vrcalib = {
  setDevice,
  setShowCenter: (on: boolean) => {
    showCenter = on;
    requestRender();
  },
  /** Current state, for tests. */
  state: () => ({ profile: toCfgUri(device), showCenter, ppi }),
  /** Renders now and returns the RGBA at (x, y) from the bottom-left (tests). */
  probe: (x: number, y: number) => {
    draw();
    return renderer?.readPixel(x, y) ?? null;
  },
};
