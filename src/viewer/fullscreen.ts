// Fullscreen, landscape lock and screen wake lock. Each step is best effort
// and failures are reported, never thrown: a phone that can't lock
// orientation can still be rotated by hand.
//
// wwgc's screenfull 2.0.0 called requestFullscreen(false), which current
// Chrome rejects, so tapping never entered fullscreen. Always pass an
// options object (e2e/viewer.spec.ts guards this).

export const canFullscreen = () => typeof document.documentElement.requestFullscreen === 'function';

export const isFullscreen = () => document.fullscreenElement !== null && document.fullscreenElement !== undefined;

export async function enterFullscreenLandscape(): Promise<string[]> {
  const problems: string[] = [];
  if (canFullscreen() && !isFullscreen()) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) {
      problems.push(`fullscreen: ${String(e)}`);
    }
  }
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (o: 'landscape') => Promise<void>;
  };
  if (isFullscreen() && orientation?.lock) {
    try {
      await orientation.lock('landscape');
    } catch (e) {
      problems.push(`orientation lock: ${String(e)}`);
    }
  }
  return problems;
}

let wakeLock: WakeLockSentinel | null = null;

/** Keeps the screen on while visible; re-acquired when the page becomes visible again. */
export async function keepScreenOn(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock && document.visibilityState === 'visible') void keepScreenOn();
});
