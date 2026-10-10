// database.rules.json, exercised over the emulators' REST APIs.
// Runs under `npm run test:e2e` (firebase emulators:exec).

import { expect, test } from '@playwright/test';

const DB = 'http://127.0.0.1:9000';
const NS = 'vrcalib-default-rtdb';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const V1 =
  'http://google.com/cardboard/cfg?p=CgZHb29nbGUSDENhcmRib2FyZCB2MR0J-SA9JQHegj0qEAAAIEIAACBCAAAgQgAAIEJYADUpXA89Ogjp8as-hbENP1AAYAA';

interface User {
  uid: string;
  token: string;
}

async function anonymousUser(): Promise<User> {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = (await res.json()) as { localId: string; idToken: string };
  return { uid: body.localId, token: body.idToken };
}

async function req(method: string, path: string, user: User | null, body?: unknown): Promise<number> {
  const auth = user ? `&auth=${user.token}` : '';
  const res = await fetch(`${DB}/${path}.json?ns=${NS}${auth}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}

// The REST API answers 401 "Permission denied" for every refused write,
// whether .write or .validate refused it.
const DENIED = 401;

let n = 0;
/** A fresh 22-character session id per test. */
const sid = () => `rulesTest${String(Date.now()).slice(-9)}${String(n++).padStart(4, '0')}`;

const session = (owner: User, extra: Record<string, unknown> = {}) => ({
  owner: owner.uid,
  params_uri: V1,
  show_lens_center: true,
  updated: { '.sv': 'timestamp' },
  ...extra,
});

test.describe('sessions', () => {
  test('owner can create and update; others can read but not write', async () => {
    const [a, b] = [await anonymousUser(), await anonymousUser()];
    const s = sid();
    expect(s).toHaveLength(22);
    expect(await req('PUT', `sessions/${s}`, a, session(a))).toBe(200);
    expect(await req('PUT', `sessions/${s}`, a, session(a, { show_lens_center: false }))).toBe(200);
    expect(await req('GET', `sessions/${s}`, b)).toBe(200);
    expect(await req('PUT', `sessions/${s}`, b, session(b))).toBe(DENIED);
    expect(await req('DELETE', `sessions/${s}`, b)).toBe(DENIED);
  });

  test('signed-out users can do nothing', async () => {
    const a = await anonymousUser();
    const s = sid();
    expect(await req('PUT', `sessions/${s}`, a, session(a))).toBe(200);
    expect(await req('GET', `sessions/${s}`, null)).toBe(DENIED);
    expect(await req('PUT', `sessions/${sid()}`, null, session(a))).toBe(DENIED);
  });

  test('nobody can list sessions or presence', async () => {
    const a = await anonymousUser();
    expect(await req('GET', 'sessions', a)).toBe(DENIED);
    expect(await req('GET', 'presence', a)).toBe(DENIED);
  });

  test('rejects malformed sessions', async () => {
    const a = await anonymousUser();
    const b = await anonymousUser();
    const bad: Record<string, unknown>[] = [
      session(a, { owner: b.uid }),
      session(a, { params_uri: 'https://example.com/?p=x' }),
      session(a, { params_uri: V1 + 'x'.repeat(1024) }),
      session(a, { show_lens_center: 'yes' }),
      session(a, { updated: 12345 }),
      session(a, { extra: 1 }),
      session(a, { screen_width_mm: 10 }),
      session(a, { screen_width_mm: 'wide' }),
      { owner: a.uid, params_uri: V1, updated: { '.sv': 'timestamp' } },
    ];
    // Control: the well-formed version is accepted, with or without a screen width.
    expect(await req('PUT', `sessions/${sid()}`, a, session(a))).toBe(200);
    expect(await req('PUT', `sessions/${sid()}`, a, session(a, { screen_width_mm: 153 }))).toBe(200);
    for (const body of bad) expect(await req('PUT', `sessions/${sid()}`, a, body)).toBe(DENIED);
    for (const id of ['short', 'x'.repeat(23), 'x'.repeat(21) + '!']) {
      expect(await req('PUT', `sessions/${id}`, a, session(a))).toBe(DENIED);
    }
  });
});

test.describe('presence', () => {
  test('a user may mark only themselves present, only on an existing session', async () => {
    const [a, phone] = [await anonymousUser(), await anonymousUser()];
    const s = sid();
    expect(await req('PUT', `presence/${s}/${phone.uid}`, phone, true)).toBe(DENIED);
    expect(await req('PUT', `sessions/${s}`, a, session(a))).toBe(200);
    expect(await req('PUT', `presence/${s}/${phone.uid}`, phone, true)).toBe(200);
    expect(await req('PUT', `presence/${s}/${a.uid}`, phone, true)).toBe(DENIED);
    expect(await req('PUT', `presence/${s}/${phone.uid}`, phone, 'here')).toBe(DENIED);
    expect(await req('GET', `presence/${s}`, a)).toBe(200);
    expect(await req('DELETE', `presence/${s}/${phone.uid}`, phone)).toBe(200);
  });
});
