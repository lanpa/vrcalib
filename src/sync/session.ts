// Live link between the editor (laptop) and the viewer (phone).
//
//   sessions/<sid>             written by the editor on every change
//   presence/<sid>/<phone uid> set by each viewer while connected
//
// The session id is the read capability, so it is 128 random bits.
// Rules: database.rules.json.

import {
  get,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  type Unsubscribe,
} from 'firebase/database';
import { toBase64Url } from '../profile/codec';
import { db, signIn } from './firebase';

export interface SessionState {
  paramsUri: string;
  showLensCenter: boolean;
  /** The phone's lit screen, long side, as measured with a ruler. Null until entered. */
  screenWidthMm: number | null;
}

const SID_PATTERN = /^[A-Za-z0-9_-]{22}$/;


export const isSessionId = (s: string | null): s is string => s !== null && SID_PATTERN.test(s);

/** 128 random bits, base64url: 22 characters. */
export function newSessionId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

interface StoredSession {
  owner: string;
  params_uri: string;
  show_lens_center: boolean;
  screen_width_mm?: number;
}

const fromStored = (s: StoredSession): SessionState => ({
  paramsUri: s.params_uri,
  showLensCenter: s.show_lens_center !== false,
  screenWidthMm: typeof s.screen_width_mm === 'number' ? s.screen_width_mm : null,
});

export class EditorSession {
  readonly sid: string;
  private readonly uid: string;
  private readonly onError: (e: Error) => void;
  /** Called after each write the database accepted. */
  onWritten: () => void = () => {};

  private constructor(sid: string, uid: string, onError: (e: Error) => void) {
    this.sid = sid;
    this.uid = uid;
    this.onError = onError;
  }

  /**
   * Resumes `requested` if this browser owns it (returning its stored state),
   * starts it if it doesn't exist yet, and otherwise starts a new session.
   */
  static async open(
    requested: string | null,
    onError: (e: Error) => void,
  ): Promise<{ session: EditorSession; resumed: SessionState | null }> {
    const { uid } = await signIn();
    if (isSessionId(requested)) {
      const snap = await get(ref(db, `sessions/${requested}`));
      const stored = snap.val() as StoredSession | null;
      if (!stored) return { session: new EditorSession(requested, uid, onError), resumed: null };
      if (stored.owner === uid) {
        return {
          session: new EditorSession(requested, uid, onError),
          resumed: fromStored(stored),
        };
      }
    }
    return { session: new EditorSession(newSessionId(), uid, onError), resumed: null };
  }

  write(state: SessionState): void {
    const value = {
      owner: this.uid,
      params_uri: state.paramsUri,
      show_lens_center: state.showLensCenter,
      // Firebase rejects undefined, so leave the key out until there is a value.
      ...(state.screenWidthMm === null ? {} : { screen_width_mm: state.screenWidthMm }),
      updated: serverTimestamp(),
    };
    set(ref(db, `sessions/${this.sid}`), value).then(
      () => this.onWritten(),
      (e: unknown) => this.onError(e instanceof Error ? e : new Error(String(e))),
    );
  }

  /** Calls back with the number of viewers currently connected. */
  watchPresence(onCount: (phones: number) => void): Unsubscribe {
    return onValue(ref(db, `presence/${this.sid}`), (snap) => onCount(snap.size));
  }
}

/**
 * Viewer side: calls back with each new session state (null while the
 * session doesn't exist), and marks this viewer present while connected.
 */
export async function watchSession(
  sid: string,
  onState: (state: SessionState | null) => void,
  onError: (e: Error) => void,
): Promise<Unsubscribe> {
  const { uid } = await signIn();
  const presence = ref(db, `presence/${sid}/${uid}`);
  let connected = false;
  let sessionExists = false;

  // Presence is only accepted once the session exists (rules), and must be
  // re-set after every reconnect.
  const markPresent = () => {
    if (!connected || !sessionExists) return;
    onDisconnect(presence)
      .remove()
      .then(() => set(presence, true))
      .catch(() => {
        // Presence is a nicety for the editor's status line; ignore failures.
      });
  };

  const offConnected = onValue(ref(db, '.info/connected'), (snap) => {
    connected = snap.val() === true;
    markPresent();
  });
  const offSession = onValue(
    ref(db, `sessions/${sid}`),
    (snap) => {
      const stored = snap.val() as StoredSession | null;
      const existed = sessionExists;
      sessionExists = stored !== null;
      if (sessionExists && !existed) markPresent();
      onState(stored && fromStored(stored));
    },
    (e) => onError(e),
  );

  return () => {
    offConnected();
    offSession();
    void set(presence, null).catch(() => {});
  };
}
