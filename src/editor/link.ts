// The editor's side of the live link: opens (or resumes) the Firebase
// session, shows the pairing QR and the phone's presence, and pushes every
// change. The editor keeps working if any of this fails.

import { describeError } from '../sync/errors';
import type { EditorSession, SessionState } from '../sync/session';
import { drawQr } from './qr';

type LinkState = 'connecting' | 'waiting' | 'phone' | 'error';

export interface LinkElements {
  status: HTMLElement;
  pairQr: HTMLCanvasElement;
  pairLink: HTMLAnchorElement;
}

export class PhoneLink {
  private readonly els: LinkElements;
  private session: EditorSession | null = null;
  private latest: SessionState | null = null;
  private phones = 0;

  constructor(els: LinkElements) {
    this.els = els;
  }

  /** Resolves with the stored state when an existing session was resumed. */
  async start(): Promise<SessionState | null> {
    try {
      const { EditorSession } = await import('../sync/session');
      const requested = new URLSearchParams(location.search).get('s');
      const { session, resumed } = await EditorSession.open(requested, (e) => this.fail(e));
      this.session = session;

      const url = new URL(location.href);
      url.search = `?s=${session.sid}`;
      history.replaceState(null, '', url);

      const viewerUrl = new URL(`view.html?s=${session.sid}`, location.href).href;
      this.els.pairLink.href = viewerUrl;
      this.els.pairLink.textContent = viewerUrl;
      this.els.pairLink.hidden = false;
      this.els.pairQr.hidden = false;
      await drawQr(this.els.pairQr, viewerUrl, 200);

      this.setState('waiting');
      // A write that goes through after an error (e.g. rules fixed meanwhile) clears it.
      session.onWritten = () => {
        if (this.els.status.dataset.state === 'error') this.showPresence();
      };
      session.watchPresence((n) => {
        this.phones = n;
        if (this.els.status.dataset.state !== 'error') this.showPresence();
      });
      if (!resumed && this.latest) session.write(this.latest);
      return resumed;
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
      return null;
    }
  }

  update(state: SessionState): void {
    this.latest = state;
    this.session?.write(state);
  }

  private showPresence(): void {
    this.setState(this.phones > 0 ? 'phone' : 'waiting', this.phones);
  }

  private fail(e: Error): void {
    this.setState('error');
    this.els.status.textContent =
      `Live link unavailable (${describeError(e)}). The editor still works, but the phone won't update.`;
  }

  private setState(state: LinkState, phones = 0): void {
    const text: Record<LinkState, string> = {
      connecting: 'Connecting…',
      waiting: 'Waiting for the phone: scan the QR code below.',
      phone: phones > 1 ? `${phones} phones connected` : 'Phone connected',
      error: '',
    };
    this.els.status.dataset.state = state;
    if (state !== 'error') this.els.status.textContent = text[state];
  }
}
