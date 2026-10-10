# Handoff: Cardboard viewer calibrator (GitHub Pages + Firebase)

Starting brief for a new repo. It rebuilds the calibration half of Google's
retired Cardboard "viewer profile generator" (wwgc) as a static site, and
records everything learned while reverse-engineering the original.

## Status (2026-10-10)

Milestones 1–4 are done and live at https://lanpa.github.io/vrcalib/,
verified on the test phone (OPPO 10x, 387 PPI: canvas = screen =
2340×1080 in fullscreen; live sync and presence work). Firebase project
`vrcalib` (RTDB in us-central1) has `database.rules.json` published by hand
in the console. Milestone 5 (polish) is next.

Testing: `npm test` (unit), `npm run test:e2e` (Playwright under the
Firebase emulators; needs Java 21 on PATH). CI runs both before deploying.

## 1. Goal

Let someone with a Cardboard-style viewer **find** its parameters (lens
distortion k1/k2, distances, FOV) by looking through it, then export the
standard viewer-profile QR code that Cardboard apps scan.

- Hosted on **GitHub Pages** (static files only).
- **The live profile lives in a Firebase session**, not in page URLs. An
  earlier plan put it in `?p=` to avoid Firebase; once Firebase is needed for
  the live link anyway, that adds nothing. Resuming uses `?s=<sid>`.
- **The exported QR is self-contained**: it holds the whole profile, does not
  point at this site, and keeps working offline and after this site is gone
  (§4).
- **Two devices**: the phone sits in the viewer showing a test scene; a
  laptop's keyboard edits values; the phone updates live.
- Live link via **the user's own free Firebase project** (Realtime Database
  + anonymous auth), because GitHub Pages cannot relay messages.

Hosted at **`https://lanpa.github.io/vrcalib/`** (project site, repo
`lanpa/vrcalib`).

Platforms: **Android + Chrome first**. On iPhone, only Chrome is supported,
best effort (§8).

Non-goals for v1: Safari or other iPhone browsers, any server we run
ourselves, a public relay (e.g. PeerJS) for users without their own Firebase
project.

## 2. Background: why this exists

| Thing | Status |
|---|---|
| Google wwgc (`wwgc.firebaseapp.com`, source `github.com/google/wwgc`, Apache-2.0) | Still loads, but broken on modern phones (§8). Depends on Google's Firebase project. |
| `github.com/zep6yr/viewerprofilegenerator` (MIT) | Replacement for the **QR-generation** half only: form → protobuf → `?p=` URL → QR PNG. No calibration scene. Reference only: **do not copy its code**; we write the editor and codec from scratch. |

In the original, the phone never received input directly. The flow was:

```
laptop index.html                Firebase RTDB                    phone 3d.html?u=<uid>
anonymous sign-in → uid
QR of 3d.html?u=<uid>  ── scanned once, before the phone goes in the viewer ──▶
save() on every edit ──▶ users/<uid>/params_uri  ── on('value') ──▶ decode → update shader
                         users/<uid>/show_lens_center
                         users/<uid>/update_timestamp
                                                  ◀── users/<uid>/connections/<push> (presence)
```

We keep this shape, with fixes.

## 3. Architecture

```
GitHub Pages (static)                       Firebase project (Spark, no card)
├── index.html   editor (laptop)  ──write──▶ sessions/<sid>      ──▶ view.html
├── view.html    viewer (phone)   ◀─listen──                          (phone)
└── assets                                   presence/<sid>/<uid> ◀── phone
```

- **Editor (`index.html`)**: form, keyboard control, QR of the final profile,
  pairing QR for the phone. Writes the session on every change.
- **Viewer (`view.html`)**: fullscreen stereo grid with barrel pre-distortion.
  Read-only except for presence.
- Both devices sign in **anonymously**. The laptop owns the session; the
  phone can read it if it knows the session id.

### Suggested stack

Vite + TypeScript, no framework (the UI is one form). Libraries:
`qrcode`, `firebase`
(modular SDK: `firebase/app`, `firebase/auth`, `firebase/database`).
The protobuf codec is hand-written (`src/profile/protobuf.ts`, `codec.ts`):
the message is 10 fields, and fields must be written in `.proto` declaration
order (…5, 11, 6, 7, 10, 12) to reproduce Google's bytes.
**Plain WebGL** for the viewer, no three.js. The original used three.js r70,
but the scene is just a gridded box plus a full-screen shader pass; the small
amount of matrix maths lives in `cardboardView.ts`.

### Suggested layout

```
index.html                editor
view.html                 viewer
src/profile/CardboardDevice.proto
src/profile/codec.ts      encode/decode cfg URIs and bare p values
src/profile/defaults.ts
src/viewer/distortion.ts  DistortionParams (distort, distortInverse)
src/viewer/cardboardView.ts  FOV + viewport maths, projection matrices
src/viewer/shader.ts      barrel distortion fragment shader
src/viewer/scene.ts       grid box, stereo render, orientation
src/viewer/screen.ts      PPI / physical screen size
src/viewer/fullscreen.ts
src/sync/firebase.ts
src/editor/form.ts, keys.ts, qr.ts
database.rules.json
firebase.json             (database rules only; hosting stays on GitHub Pages)
.github/workflows/pages.yml
NOTICE                    Apache-2.0 attribution for ported Google code
```

## 4. Profile format (must stay compatible with the Cardboard SDK)

**Why**: the exported QR is read by Google's Cardboard SDK inside every
Cardboard app (or by apps that copied its parser), which we don't control. It
must match the SDK's URL prefix, base64url variant, protobuf field numbers and
types, and semantics (metres, degrees, FOV order, k1/k2 in the same distortion
model). A mismatch is either rejected or, worse, accepted with wrong values.

Byte-identical output to Google's encoder is **not** required: any valid
protobuf encoding of the same message parses the same. Matching the test
vector below byte for byte is still the test to use, because it proves the
schema, float32 handling and base64url are right.

**Offline** (verified in `googlevr/cardboard`,
`sdk/qrcode/android/.../CardboardParamsUtils.java`): the SDK rewrites
`http://` to `https://`, then follows HTTPS redirects only while the URI is
*not* already a Cardboard URI. A URI with host exactly `google.com` and path
`/cardboard/cfg` is decoded locally from `p` (URL-safe base64, no padding), so
our QR works with no network. Old short links (`goo.gl/…`, `g.co/…`) needed a
network to resolve. Host must be `google.com`, not `www.google.com`.

**Proto**: `CardboardDevice.proto` from
`https://raw.githubusercontent.com/google/wwgc/master/www/CardboardDevice.proto`
(proto2, message `DeviceParams`). Fields:

| # | Field | Type | Unit / notes |
|---|---|---|---|
| 1 | vendor | string | |
| 2 | model | string | |
| 3 | screen_to_lens_distance | float | metres |
| 4 | inter_lens_distance | float | metres |
| 5 | left_eye_field_of_view_angles | repeated float, packed | degrees, order **L, R, B, T** (L = outer, R = inner/nose side). wwgc used L, R, T, B, which is a wwgc bug; the proto comment and the current SDK (`lens_distortion.cc`, `CalculateFov`) use L, R, B, T. |
| 11 | vertical_alignment | enum | BOTTOM=0, CENTER=1, TOP=2 (default BOTTOM) |
| 6 | tray_to_lens_distance | float | metres |
| 7 | distortion_coefficients | repeated float, packed | [k1, k2] |
| 10 | has_magnet | bool | |
| 12 | primary_button | enum | NONE=0, MAGNET=1, TOUCH=2, INDIRECT_TOUCH=3 — **proto default is MAGNET** |

**URI**: `http://google.com/cardboard/cfg?p=` + base64url(protobuf bytes), where
base64url = standard base64 with `+→-`, `/→_`, trailing `=` stripped. Decoding
re-pads with `'==='.slice(0, [0,3,2,1][len % 4])`. The scheme is `http://`
exactly; Cardboard apps match this prefix.

**Test vector** (generated with Google's own ProtoBuf.js build from wwgc),
Cardboard v1 profile:

```
input: vendor "Google", model "Cardboard v1", screen_to_lens 0.0393,
       inter_lens 0.0639, fov [40,40,40,40], vertical_alignment BOTTOM,
       tray_to_lens 0.035, k [0.33583, 0.55349], has_magnet false,
       primary_button NONE
p = CgZHb29nbGUSDENhcmRib2FyZCB2MR0J-SA9JQHegj0qEAAAIEIAACBCAAAgQgAAIEJYADUpXA89Ogjp8as-hbENP1AAYAA
```

Gotchas:
- **Always set `primary_button` explicitly.** If it is omitted, it decodes as
  MAGNET (verified).
- Values are float32; `0.0393` decodes as `0.03929999843…`. Round for display
  (mm to 1 dp, k to 3 dp, degrees to 0–1 dp), never re-derive from the
  display string unless the user edited it.
- **Import** (editor, to start from an existing viewer's QR): accept a bare
  `p` value or the full `http://google.com/cardboard/cfg?p=…` and normalise.

## 5. URL design

The profile is **not** carried in page URLs; it lives in the Firebase session.

| Page | Params | Meaning |
|---|---|---|
| `index.html` | `s` | optional: resume an existing session id (written with `history.replaceState` once the session exists, so a reload or bookmark resumes it) |
| `view.html` | `s` | session id to subscribe to (required) |
| | `ppi` | phone screen pixels per inch (phone property, not part of the profile) |

The pairing QR the editor shows encodes
`https://lanpa.github.io/vrcalib/view.html?s=<sid>`. It needs internet (our
site + Firebase), which is fine: it is only used during calibration.

Session id: 128 random bits from `crypto.getRandomValues`, base64url (22
chars). It is the read capability for the session, so do not shorten it.

## 6. Firebase

### Setup (one-time, in the console)
1. Create project → add Web app → copy the config into `src/sync/firebase.ts`
   (the API key is public by design; protection is the rules below).
2. Authentication → enable **Anonymous**. Add `lanpa.github.io` under
   Authorized domains.
3. Realtime Database → create (pick a region) → deploy rules with
   `firebase deploy --only database`.
4. Optional: restrict the API key to HTTP referrer `https://lanpa.github.io/*`
   in Google Cloud console.

### Data
```
sessions/<sid>:            written by the laptop with set() on every change
  owner:            <laptop auth.uid>
  params_uri:       "http://google.com/cardboard/cfg?p=…"
  show_lens_center: true
  screen_width_mm:  153.0   (optional; ruler-measured long side of the phone's
                             lit screen; the viewer derives PPI from it)
  updated:          ServerValue.TIMESTAMP
presence/<sid>/<phone uid>: true   (phone sets it, onDisconnect().remove())
```

### Rules (draft — test in the emulator / Rules Playground before relying on it)
```json
{
  "rules": {
    "sessions": {
      "$sid": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('owner').val() === auth.uid)",
        ".validate": "$sid.length >= 20 && $sid.length <= 40 && newData.hasChildren(['owner', 'params_uri', 'updated'])",
        "owner": { ".validate": "newData.val() === auth.uid" },
        "params_uri": { ".validate": "newData.isString() && newData.val().beginsWith('http://google.com/cardboard/cfg?p=') && newData.val().length <= 1024" },
        "show_lens_center": { ".validate": "newData.isBoolean()" },
        "updated": { ".validate": "newData.val() === now" },
        "$other": { ".validate": false }
      }
    },
    "presence": {
      "$sid": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.isBoolean()"
        }
      }
    }
  }
}
```
There is no `.read` on `sessions/` or `presence/` themselves, so nobody can
list sessions.

### Free-tier (Spark) limits, checked Oct 2026
- RTDB: **100 simultaneous connections**, 1 GB stored, 10 GB/month download,
  1 database per project.
- Anonymous auth: 100 new accounts/hour per IP; 100 M accounts total.
- No card on file → exceeding a limit stops service, never bills.
- Usage per session: 2 connections, ~200 B stored, ~100 B per keypress. The
  only plausible ceiling is ~50 concurrent calibrating users.
- Sessions are never garbage-collected (scheduled cleanup needs Blaze). At
  ~200 B each, not a practical concern.

## 7. Rendering maths (port from wwgc, Apache-2.0)

Upstream files: `www/js/CardboardView.js`, `www/js/CardboardBarrelDistortion.js`,
`www/js/CardboardStereoEffect.js`, `www/js/3d_app.js` in `google/wwgc`.
Keep their copyright headers on ported code and add a `NOTICE`.

**Screen model**
```
width_px  = max(screen.width, screen.height) * devicePixelRatio
height_px = min(screen.width, screen.height) * devicePixelRatio
width_m   = width_px  / ppi * 0.0254
height_m  = height_px / ppi * 0.0254
border_m  = 0.003   (fixed, as in the SDK: kDefaultBorderSizeMeters)
```
Better: once in fullscreen, use the canvas's real backing size so the maths
matches what is actually drawn (see §8 on cutouts).

The border is not configurable: SDK apps always assume 3 mm, so a different
value would make our preview disagree with what apps render.

**Follow the SDK where wwgc differs.** Apps render with the SDK, so the
preview must match the SDK, even where wwgc looks more physically correct.
Reference: `sdk/lens_distortion.cc` in `googlevr/cardboard`.

**Lens centre height above the bottom of the screen**
```
BOTTOM: tray_to_lens − border
TOP:    height_m − tray_to_lens − border    (SDK; wwgc had height_m − (tray_to_lens − border))
CENTER: height_m / 2
```

**Distortion** (r in tan-angle units = screen distance / screen_to_lens):
```
distort(r)  = r · (1 + k1·r² + k2·r⁴)
distortInverse(r): secant method, r0 = r/0.9, r1 = r·0.9, until |r1−r0| ≤ 1e-4
```

**Left-eye FOV visible through the lens (degrees)**, each capped by the
profile's max FOV:
```
eye = screen_to_lens
outer  = atan(distort(((width_m − inter_lens)/2) / eye))   ≤ fov[0] (L)
inner  = atan(distort((inter_lens/2) / eye))               ≤ fov[1] (R)
bottom = atan(distort(lensY / eye))                        ≤ fov[2] (B)
top    = atan(distort((height_m − lensY) / eye))           ≤ fov[3] (T)
```
Right eye is the mirror (swap outer/inner). Projection: asymmetric frustum
`(−tan(outer)·near, tan(inner)·near, −tan(bottom)·near, tan(top)·near)`;
cameras offset ±inter_lens/2.

**Undistorted viewport** (`getLeftEyeFovAndViewportNoDistortionCorrection`):
same quantities computed with `distortInverse(tan(maxFov))`, clamped to the
physical screen, converted to a pixel viewport. Used to build the
`unprojection` uniform.

**Fragment shader core** (per half-screen, right eye mirrored):
```glsl
float poly(float r2) {               // r2 = r²
  return (showCenter == 1 && r2 < 0.00005) ? 10000.0
       : 1.0 + (k.x + k.y * r2) * r2;
}
vec2 barrel(vec2 v, vec4 proj, vec4 unproj) {
  vec2 w = (v + unproj.zw) / unproj.xy;
  return proj.xy * (poly(dot(w, w)) * w) - proj.zw;
}
// sample outside [0,1]² → background colour (red), which shows FOV/geometry mismatch
```
The `10000.0` trick turns the exact optical centre into a **red dot** used to
align lens centres. Keep it; make it toggleable.

**Scene**: the camera inside a 10 m cube, back-faces textured with a
repeating grid, each face tinted differently. Grid lines are the calibration
target: they should look straight with right-angle corners.

Uniform packing from `updateBarrelDistortion` is fiddly (texture [0,1] ↔ NDC
[−1,1] plus the viewport offset). Port it line for line first, refactor after
it visibly matches the original.

## 8. Known bugs in the original: do not repeat them

| Original behaviour | Effect today | Do instead |
|---|---|---|
| screenfull 2.0.0 calls `requestFullscreen(false)` | Chrome rejects with *"TypeError: … not of type 'FullscreenOptions'"*; **tapping never enters fullscreen** (verified in Chromium 148) | `el.requestFullscreen({ navigationUI: 'hide' })`, then `screen.orientation.lock('landscape')`, catching both promises |
| Tap handler attached only after the first `deviceorientation` event with truthy `alpha` | No gyro event → no way to go fullscreen | Attach the tap handler unconditionally |
| Overlay hidden only if `screen` size `===` `innerWidth/innerHeight` | Never true on iPhone Safari or on Android phones with a display cutout → overlay stuck | Use `document.fullscreenElement`; on iOS, show a dismissible hint |
| PPI table of 8 phones (newest: Nexus 6 / iPhone 6 Plus), then `window.prompt`, then 300 | Wrong scale on every modern phone; Chrome blocks `prompt` in fullscreen | `?ppi=` → `localStorage` → an in-page form **before** entering fullscreen; link to a spec lookup |
| `wurfl.io/wurfl.js` for device detection | Generated per request; can't be cached or vendored | Drop it; we ask for PPI instead |
| iOS "wake lock" reloads the page every 30 s (`window.location = window.location`) | Disruptive | `navigator.wakeLock.request('screen')` where available; otherwise tell the user to raise the screen timeout |
| No `DeviceOrientationEvent.requestPermission()` | No head tracking on iOS 13+ | Call it from the "Start" tap on iOS. Head tracking isn't needed for calibration, so treat it as optional |
| `viewport` meta lacks `viewport-fit=cover` | Fullscreen content letterboxed around the cutout → geometry offset | Add `viewport-fit=cover`; draw into the full area |

**iPhone**: v1 supports **Chrome on iPhone only**, best effort; Android +
Chrome is the primary target. Chrome on iOS runs on WebKit, so it has the same
limits as Safari: no element fullscreen, and `DeviceOrientationEvent` needs
`requestPermission()`. The page always loses some height to browser UI and
some width to the safe area, so geometry is approximate. Use `visualViewport`
dimensions and say so in the UI. Detect other iOS browsers (Chrome identifies
as `CriOS` in the user agent) and show a "use Chrome, or better, an Android
phone" message instead of the scene.

## 9. Editor UX

- Fields in this Tab order: vendor, model, screen-to-lens (mm),
  inter-lens (mm), vertical alignment, tray-to-lens (mm), k1, k2, FOV L/R/B/T,
  has magnet, primary button. Display mm; store metres.
- Keyboard while the viewer is on your face: Tab / Shift-Tab between fields;
  ↑/↓ = 0.5 mm, 0.01 for k, 1° for FOV; Shift = ×10. Handle `keydown`
  explicitly rather than relying on `<input type=number>` stepping.
- Speak or beep on change (optional): `speechSynthesis.speak("k1 0.34")`, so
  the user doesn't have to look at the laptop.
- Live distortion curve `1 + k1·x² + k2·x⁴` beside the k fields.
- Warn if k1 = k2 = 0 (no curved lens has zero distortion).
- On CENTER alignment, still write `tray_to_lens_distance = 0.035` (the
  original did this for older apps).
- If primary button = MAGNET, force `has_magnet = true`.
- Output: QR (error correction M, PNG download) of the cfg URI; a "copy link"
  button for the cfg URI.
- Input: an "import" field that takes an existing cfg URI or bare `p` value
  (§4) and loads it into the form.

Defaults: start from Cardboard v1 (the test vector in §4), not zeros. The
original reset to k = 0,0 / FOV 50 / 42 / 60 / 35 mm, which is a worse
starting point.

## 10. Calibration procedure (put this in the UI)

1. Open the editor on a laptop. It shows a pairing QR.
2. Scan it with the phone; enter PPI if asked; tap **Start** (fullscreen +
   landscape). Then put the phone in the viewer.
3. Measure with a ruler and enter screen-to-lens, inter-lens and tray-to-lens
   distances.
4. Fine-tune inter-lens / tray-to-lens until each red centre dot sits in the
   middle of its lens and the two images fuse.
5. Tune k1, then k2, until grid lines are straight to the edges:
   lines bowing outward (pincushion) → raise k1; bowing inward (barrel) →
   lower it. k2 mostly affects the outer edge.
6. Reduce FOV angles only to trim leftover red at the edges.
7. Export the QR from the editor; scan it in the Cardboard app.

## 11. Milestones

1. **Scaffold**: Vite + TS, Pages workflow (Vite `base: '/vrcalib/'`), codec
   + unit tests against the §4 test vector.
2. **Editor without sync**: form → QR export, cfg URI import, written from
   scratch.
3. **Viewer without Firebase**: render the default profile (Cardboard v1);
   fullscreen, PPI, grid, stereo, distortion. Verify against the original by
   rendering the same profile on the same phone side by side. Test phone:
   OPPO 10x, 387 PPI.
4. **Firebase sync**: anonymous auth on both ends, session write/listen,
   presence indicator on the editor ("phone connected"), rules deployed.
5. **Polish**: keyboard steps, speech feedback, Chrome-on-iPhone best effort, an offline
   fallback where a Bluetooth keyboard paired to the phone edits values
   directly in the viewer.

Tests: unit-test the codec, `distort`/`distortInverse` (inverse∘distort ≈ id
for r in [0, 1.5]), and the FOV maths. Use Playwright for the
fullscreen-on-tap path (a regression of the screenfull bug is easy to
reintroduce).

## 12. Licensing

- Ported Google wwgc code: Apache-2.0. Keep the headers on ported files and
  add a `NOTICE` naming Google Inc. (2015) and the upstream repo.
- The new repo can be MIT or Apache-2.0. Say "not an official Google product",
  and don't use Google or Cardboard logos.

## 13. Decisions

- No profile in page URLs (`?p=`). Live state is the Firebase session; the
  exported cfg QR is the only place the encoded profile leaves the app.
- Project site at `lanpa.github.io/vrcalib`: Vite `base: '/vrcalib/'`, pairing
  URL `https://lanpa.github.io/vrcalib/view.html?s=<sid>`.
- Viewer uses plain WebGL, not three.js.
- Android + Chrome first; on iPhone, Chrome only, best effort.
- No public relay (PeerJS or similar). Live sync goes only through the
  Firebase project configured in `src/sync/firebase.ts`.
