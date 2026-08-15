# Ghost Seat — Implementation Plan (agent-executable)

> **Audience:** an orchestrating Claude session with no prior context. This file + the two
> docs below are everything you need. Execute autonomously: spawn agents per the
> orchestration playbook (§9), review every wave with an Opus reviewer, fix findings, and
> do not stop until the Definition of Done (§11) is fully green. Ask the user nothing
> unless a locked rule would have to change (it never should).
>
> **Read first, in order:**
> 1. `CLAUDE.md` — LOCKED game rules. Never modify this file or violate any rule in it.
> 2. `ghost-seat.md` — the approved **v3** feature spec. It is the product truth; this file is
>    the engineering breakdown. If they conflict, `ghost-seat.md` wins — flag the conflict
>    in your final report.

---

## 1. Mission

Build Ghost Seat v3 end to end: 1–3 remote players play a physical card match via photo
hands, a table station (laptop) with a remote camera shutter, photo-order card entry,
position-addressed physical play, and instant broadcast with undo-last-card.

**Scope boundary (read this before anything else).** Ghost Seat is **card delivery only**.
It carries no score-bearing decision: **no Blind declaration, no promise, no actuals, no
scoring** ever enters the app. Those are called by voice and typed at the table by a
physical player, exactly as they are for an all-physical match. The app's whole job is to
get a hand to an absent player and get their chosen card back as a physical position.

Consequences you must not "helpfully" undo: there is **no declare screen**, **no photo
gate**, **no promise bar**, **no `blindDeclared`/`promise` field**, and **no round-form
pre-fill**. The Game Board is never modified by this feature. See `ghost-seat.md` →
*Scope: card delivery only* for the reasoning (short version: the live voice call is
already the witness that the declare gate was imitating).

**Hard constraints (locked):**
- Free tier only: Firestore Spark. **No Firebase Storage, no Cloud Functions, no server.**
- Static site (GitHub Pages). Firebase SDK **8.6.1 compat** syntax (`firebase.firestore()`,
  `db.collection(...)`) — matching `js/services/firebaseService.js`. Do not upgrade the SDK.
- No new npm runtime dependencies. Vanilla JS components, same style as
  `js/components/spectatorPass.js` (IIFE module, pure `logic` object exposed for tests).
- Firestore rules stay `allow read, write: if true` — do NOT touch `firestore.rules`.
- Security posture is "UI gate only, friends league" — accepted product decision. Do not
  add auth. Do add the etiquette strings the spec requires (DM the code, etc.).
- Never modify `CLAUDE.md`, scoring code semantics, or `js/models/Match.js` score logic.

**Codebase anchors (verified against current source):**
| Anchor | Location |
|---|---|
| Section switching | `showSection()` at `js/app.js:436`; default `showSection('teams')` at `js/app.js:1799` |
| Sections in DOM | `index.html:44,58,69` (`teamsSection`, `matchesSection`, `statsSection`) |
| URL-flag → view precedent | `js/components/spectatorPass.js` (`?tv=1`, `logic.initialEnabled`, `parseQuery`) |
| Firestore layer | `js/services/firebaseService.js` (collection listeners at :99 `subscribeToTeams`, :108 `subscribeToMatches`) |
| Raw Firestore handle | `firebaseService.db` is a public property (`firebaseService.js:3`, `firebase.firestore()`). Subcollections, `runTransaction`, `FieldValue`, `batch()` all work on it — **use it directly, do not add methods to `firebaseService`** |
| Round submission | `matchService.addRound(matchId, t1P, t1A, t2P, t2A, t1S, t2S, options)` at `js/services/matchService.js:103`; **`options.team1Blind` / `options.team2Blind` already exist** (:113–117, blind forces promise 7) |
| **Round form UI (LIVE)** | **`js/components/gameBoard.js`** — promise chips + BLIND chip, `state[side] = {promise, blind, actual}`; `redraw()` writes hidden inputs `team{1,2}{Promise,Actual,Blind}${matchId}` at :226–228. Mounted at `js/app.js:792` (`GameBoard.renderInline`), wired at `js/app.js:811-814` (`GameBoard.wire`). Submit handler `submitRound()` at `js/app.js:1423`, reads those hidden inputs at :1452 |
| ~~Round form UI (dead modal)~~ | **Deleted.** `showMatchRoundModal()` was 155 unreachable lines at `js/app.js:279-433` (`#roundForm`, `#team1Promise`, plus on-screen text advertising the superseded `-100..200` cap). Removed before this plan was executed — the Game Board is now the **only** round form in the codebase. If you find a `#roundForm` or a bare `#team1Promise` anywhere, it is not ours |
| Teams model | `js/models/Team.js` — `members` is an array of plain strings (no player entities) |
| Tests | Jest, `npm test`, `tests/*.test.js`, node environment — **pure-logic tests only** (no DOM) |
| Styles | `css/styles.css` (single file — append a clearly-marked Ghost Seat block) |

---

## 2. Architecture overview

New files:

```
js/utils/cards.js              WP1  pure card model: codes, deck, display, sort, POSITION MATH
js/services/ghostService.js    WP2  all Firestore I/O for ghost seats/rounds/photos + listeners
js/components/ghostGate.js     WP3  ?ghost= parsing, code gate, section routing glue
js/components/ghostStation.js  WP4  table station: camera, remote shutter, status+play display
js/components/ghostSeatView.js WP5-7 ghost's 4-state screen (Capture→Enter→Arrange→Play)
tests/ghost-cards.test.js      WP1
tests/ghost-service-logic.test.js WP2
tests/ghost-gate.test.js       WP3
tests/ghost-station-logic.test.js WP4
tests/ghost-seat-logic.test.js WP5-7 (entry reducer, undo, positions)
tests/ghost-cleanup.test.js    WP8  (roundIndex mapping, cleanup targeting)
```

Modified files:

```
index.html      add <section id="ghostSection">, <section id="ghostStationSection">, script tags
js/app.js       route ?ghost= / ?station= on init; extend showSection(); admin seat setup
                (NOT the round form — this feature never touches it)
css/styles.css  append Ghost Seat styles (mobile-first for seat view, large type for station)
```

**Every component follows the `spectatorPass.js` pattern:** an IIFE exposing
`{ logic, init, ... }` where `logic` is pure, DOM-free, and unit-tested. Jest runs in node —
DOM code is untestable here, so all decisions live in `logic`.

---

## 3. Data model (create exactly this)

```
matches/{matchId}                      (existing doc — add one field)
  ghostSeats: {
    "<teamId>_<memberIndex>": {        // seatKey; 1–3 entries
      teamId: string,
      memberIndex: 0 | 1,
      memberName: string,              // display only — ALWAYS escaped on render
      accessCode: string,              // 6 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789
      active: boolean
    }
  }

matches/{matchId}/ghostRounds/{roundIndex}_{seatKey}
  captureRequest: number               // ghost increments → station snaps; increment again = retake
  capturedRequest: number              // the captureRequest value the delivered photo answered;
                                       // pairs with captureRequest to make a retake OBSERVABLE
                                       // (capturedRequest < captureRequest ⇒ station owes a frame,
                                       // seat re-queues). Written by writePhoto on every photo.
  capturedAt: timestamp | null
  capturedBy: string                   // self-reported handler name — escaped on render
  cards: string[] | null               // 13 codes IN PHOTO ORDER (left→right) — physical positions
  confirmedAt: timestamp | null
  // NO blindDeclared, NO promise, NO promiseAt — Blind and promise are voice calls typed
  // at the table. Do not add them back; the app stores no score-bearing decision.
  playedCards: string[]                // append/pop; station renders last entry + position

matches/{matchId}/ghostPhotos/{roundIndex}_{seatKey}
  photoData: string                    // 'data:image/jpeg;base64,…' ≤ 700_000 chars — OWN DOC
                                       // so trick updates never re-ship the photo to listeners
```

Card codes: `<rank><suit>`, 2 chars, `T` = ten. Ranks `A K Q J T 9 8 7 6 5 4 3 2`,
suits `S H D C`. UI always displays `10`, never `T`. Display order of the ghost's on-screen
hand is **localStorage only** (`cg.ghost.<matchId>.<seatKey>.order`), never Firestore.
Code-gate pass is **localStorage** (`cg.ghost.<matchId>.<seatKey>.unlocked`) — WhatsApp's
in-app browser resets sessionStorage.

---

## 4. Work packages

Each WP lists: goal → files → behavior → acceptance criteria (AC). An agent implementing a
WP must also write its listed tests and leave `npm test` green.

### WP1 — `js/utils/cards.js` (pure, no dependencies, no DOM, no Firestore)

The foundation everything imports. Functions (all pure):

- `DECK` — all 52 codes; `SUITS`, `RANKS` in canonical order.
- `isValidCode(code)`, `suitOf(code)`, `rankOf(code)`, `display(code)` → `{rank:'10',suit:'♥',color:'red'}`.
- `validateHand(cards)` → `{ok, errors[]}`: exactly 13, all valid, no duplicates.
- `sortBySuit(cards)`, `sortByRank(cards)` — return new arrays.
- `remainingHand(cardsPhotoOrder, playedCards)` — photo-order minus played, order preserved.
- **`positionOf(card, cardsPhotoOrder, playedCards)`** → 1-based position of `card` among
  the *remaining* cards in photo order. This drives "▶ Q♠ — 5th from the left".
  Example: photo order `[AS,KH,QS,2C,9D]`, played `[KH]` → `positionOf('QS',…)` = 2.
- `reinsertPosition(card, cardsPhotoOrder, playedCards)` — position to slide an undone card
  back into (its `positionOf` after removing it from played).
- `generateAccessCode(randomBytes)` — takes an injected 6-byte array (caller uses
  `crypto.getRandomValues`), maps onto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars, modulo
  bias acceptable at this stakes level). Pure so it's testable.

AC: `tests/ghost-cards.test.js` covers every function; duplicates/12-card/14-card hands
rejected; position math verified across a full simulated 13-trick round including an undo.

### WP2 — `js/services/ghostService.js` (all Firestore I/O; DOM-free)

Compat-SDK service, constructor takes `firebaseService` like `matchService`:

```js
class GhostService {
    constructor(firebaseService) {
        this.db = firebaseService.db;   // firebaseService.js:3 — raw firebase.firestore()
    }
}
```

**Do not add anything to `firebaseService.js`.** Its own methods only cover the flat
`teams`/`matches` collections, but `.db` is the unwrapped Firestore handle — subcollections,
`runTransaction`, `firebase.firestore.FieldValue`, and `batch()` all work directly on it.
Bypass the wrapper; don't widen it. Methods:

- `seatKey(teamId, memberIndex)`; `roundDocId(roundIndex, seatKey)`.
- `createGhostSeats(matchId, seats[])` — writes `ghostSeats` map; generates codes
  (via WP1 `generateAccessCode` + `crypto.getRandomValues`).
- `getGhostSeat(matchId, seatKey)`; `deactivateSeats(matchId)`.
- `requestCapture(matchId, roundIndex, seatKey)` — transaction-increment `captureRequest`
  (creates the round doc if missing).
- `writePhoto(matchId, roundIndex, seatKey, dataUrl, capturedBy, capturedRequest)` — writes
  photo doc + `capturedAt/capturedBy/capturedRequest` on round doc. The station must pass the
  `captureRequest` value it actually grabbed the frame for; that is what makes a retake
  observable. Two sequential writes (never a transaction — that is the coupling the two-doc
  design forbids): on rejection the photo may be stored with the marker missing, so the caller
  retries with the same arguments and surfaces a visible failure — no silent `catch` (§8).
- `confirmHand(...)` (writes `cards`, `confirmedAt`).
  **No `declareBlind`, no `submitPromise`** — the app stores no Blind flag and no promise.
- `clearHand(matchId, roundIndex, seatKey)` — the retake-after-confirm path: writes
  `{cards: null, confirmedAt: null}` (merge). `confirmHand` cannot do this (it only accepts a
  full 13). **Refuses while `playedCards` is non-empty** rather than zeroing real play history:
  a ghost who has already played this round is in a physically ambiguous state, so the message
  tells them to undo those cards first.
- `playCard(...)` — arrayUnion-style append (compat: read-modify-write in a transaction);
  reject codes not in `remainingHand`.
- `undoLastCard(...)` — transactional pop of last `playedCards` entry.
- `subscribeToGhostRound(matchId, roundIndex, seatKey, cb)` and
  `subscribeToSeatRounds(matchId, seatKey, cb)` (collection query on doc-id prefix is not
  possible — store `roundIndex` and `seatKey` as fields too and query
  `.where('seatKey','==',…)`).
- `getPhoto(matchId, roundIndex, seatKey)` — one-shot fetch (never a listener — photos are
  fetched once on demand; the round listener must NOT include photo data).
- `cleanupRound(matchId, roundIndex)` — delete all seats' round+photo docs for that index.
- `cleanupMatch(matchId)` — deactivate seats + delete both subcollections (batched, 500/batch).
- `sweepOrphans(allMatches)` — for completed/cancelled matches with `ghostSeats`, run
  `cleanupMatch`. Called once on app load (self-heal).

Pure decision logic (can-play checks, batch chunking) lives in an
exported `logic` object → `tests/ghost-service-logic.test.js` with a mocked `db`.

AC: photo doc and round doc verifiably separate; `playCard` of an already-played or
un-held card rejects; undo on empty `playedCards` rejects; sweep only touches
completed/cancelled matches that have `ghostSeats`.

### WP3 — `js/components/ghostGate.js` + routing glue in `js/app.js` + `index.html` shells

- Parse `?ghost=<matchId>&seat=<seatKey>` and `?station=<matchId>` (station mode gets its
  own flag) using a `parseQuery` copied to `cards.js`-style util or reused pattern from
  `spectatorPass.js`.
- Gate logic (pure, in `logic`): `initialState({search, storage})` →
  `'none' | 'prompt' | 'unlocked' | 'fallthrough'`; `attempt(code, actual, attempts, now)`
  → handles 5-attempt/60s lockout; storage key names as §3.
- Code prompt UI: single input, 6 chars, uppercase-as-you-type, no hint on wrong code.
  Absent/inactive seat → **silent fall-through** to the normal app (no error).
- `index.html`: add `<section id="ghostSection" class="dashboard-section">` and
  `<section id="ghostStationSection" class="dashboard-section">` (empty shells; views render
  into them), plus script tags for all new files **ordered after** `firebaseService.js`.
- `js/app.js`: extend `showSection()` to handle `'ghost'` and `'ghostStation'` (keep the
  existing hard-coded toggle style — add two lines per pattern, do not refactor the
  function); on init, before the default `showSection('teams')` at :1799, route:
  valid ghost gate → `showSection('ghost')`; `?station=` → `showSection('ghostStation')`.
- **Neither new section appears in any nav.** Ghost + station sections force-disable
  Spectator Pass. **Do NOT call `SpectatorPass.set(false)`** — `set()` calls `persist()`
  (`spectatorPass.js:86-89`), which would permanently clear the user's saved TV preference
  rather than suppressing it for one view. Strip the class directly instead:

  ```js
  document.body.classList.remove('spectator-pass');   // BODY_CLASS, spectatorPass.js:17
  ```

- **Swallow the bare-`s` key inside the ghost view.** `spectatorPass.init()` binds a global
  `keydown` where a plain `s` toggles spectator mode, skipped only for `input`/`textarea`/
  `select` (`spectatorPass.js:110-120`). The ghost's Enter screen is a grid of `<button>`
  card targets, so a stray `s` mid-hand would re-enable spectator mode and hide input
  controls. One guard on the ghost container, no change to `spectatorPass.js`:

  ```js
  ghostEl.addEventListener('keydown', e => { if (e.key === 's') e.stopPropagation(); });
  ```

AC: `tests/ghost-gate.test.js` — URL/storage matrix, lockout timing (inject `now`),
fall-through cases. Manual: `?ghost=bogus` lands on normal app with zero console errors.

### WP4 — `js/components/ghostStation.js` (the laptop at the table)

- **Camera:** `getUserMedia({video: {facingMode:'environment', width:{ideal:1920}}})` on
  station entry (one permission prompt). **The stream is NEVER attached to a visible
  element** — frames are grabbed via an offscreen `<video>` (not in DOM) + `<canvas>`:
  draw → downscale to ≤1000px long edge → `toDataURL('image/jpeg', 0.6)`; if result
  > 700_000 chars retry at 0.45; still over → write a `captureError` status the ghost sees
  as "retake with more light".
- **Shutter listener:** subscribe to the active round docs of all seats; on
  `captureRequest` increment → grab frame → `ghostService.writePhoto`. Debounce 1s.
- **Status display (large type, station CSS):** per seat, derived from round doc state:
  `waiting-deal → show <name>'s hand → captured (ghost reviewing) → entering hand →
  ready → playing`. **No promise and no Blind status is ever displayed** — the station
  has no such data, by design. There is no blind-flash ceremony driven by the app; the
  table reacts to the voice call as it always has.
- **Play display:** on `playedCards` append: `▶ Q♠ — 5th from the left` (position via WP1
  `positionOf` using that seat's `cards`); on pop: `↩ Q♠ taken back — slide it back Nth
  from the left` (via `reinsertPosition`). Optional beep (`AudioContext`, no asset files) on
  capture-request / play / undo.
- **Capture sequencing (multi-ghost):** one seat "showing" at a time; station advances
  automatically: seats that lack `capturedAt` for the current round queue in seat-key
  order. **The prompt names the player** — spec wording, verbatim shape:
  `Now show **Priya's** hand` (and, while waiting, `Showing Rahul's hand — waiting for
  Rahul to capture…`). The name is `memberName`, **escaped**. A bare "next seat" prompt
  does not satisfy this — the physical player is following the screen and needs the name.
  All state derived from Firestore — a station refresh loses nothing.
- Station never renders `photoData` and never subscribes to `ghostPhotos` **after setup**.
- **Aiming (decision — resolves the spec's open question):** a one-time **Station Setup**
  screen shows the live camera preview ONLY while the match has zero captures (no cards
  dealt yet, nothing secret exists). The admin aligns the camera on an empty table spot,
  clicks "Station ready", and the preview unmounts permanently for the match — from then on
  the no-preview rule is absolute. Setup screen also carries the practicalities strings
  from the spec: "keep the laptop plugged in, disable screen sleep, keep this tab open"
  and the voice-call line: "Keep a voice/video call running with your ghost player(s) —
  turn order travels by voice."
- Station help text includes the undo-etiquette line: "If a taken-back card was already
  played to the trick, the table rewinds that trick by hand — same as any misplay today."

Pure logic (`statusFor(roundDoc)`, capture queue ordering, display-string builders incl.
position phrases) → `tests/ghost-station-logic.test.js`.

AC: photo pipeline produces ≤700KB data URLs from a synthetic large canvas (test the pure
resize-math helper); **the capture prompt for a queued seat contains that seat's
`memberName`** (assert the built string, not just the queue order); status strings escape
`memberName`/`capturedBy` (test with
`<img onerror>` payloads); undo shows reinsert position.

### WP5 — Ghost view part 1: Capture loop (`js/components/ghostSeatView.js`)

State machine (pure reducer in `logic`, DOM renders from state):

```
WAITING_CAPTURE → PHOTO_REVIEW → ENTER
                  (Accept/Retake)
```

**There is no DECLARE state and no photo gate.** Blind is called on the voice call before
the photo lands (`ghost-seat.md` → *Scope: card delivery only*); the app neither records it
nor withholds anything pending it. The photo renders as soon as it arrives.

- `WAITING_CAPTURE`: "Waiting for your hand — the table is dealing…"; **📷 Capture**
  button → `requestCapture`. Live-updates when `capturedAt` lands.
- `PHOTO_REVIEW`: Accept → `ENTER`; Retake → `requestCapture` again → back to
  `WAITING_CAPTURE`.
- Photo fetched via `getPhoto` once `capturedAt` lands — one read, pinch-zoomable
  (CSS `touch-action` + transform, no library).

AC (`tests/ghost-seat-logic.test.js`): retake resets ENTER progress and (if confirmed)
clears `cards` via service call; the reducer has no state that references Blind or a
promise (a grep of `ghostSeatView.js` for `blind` and `promise` returns nothing).

### WP6 — Ghost view part 2: Enter screen (photo-order 52-grid)

- Layout per spec Screen 1: photo pinned top; **suit-tabbed** grid (one 13-card row
  visible at a time, targets ≥44px); entry tray preserving **entry order = photo order**
  (left→right instruction displayed prominently); suit-grouped summary underneath;
  `n/13` counter; `[Undo last]`; `[This is my hand]` disabled until exactly 13.
- Reducer: `toggle(code)` (tap in grid or tray), `undoLast()`, `confirm()`. Used card =
  dimmed + untappable in grid (structural duplicate prevention). Nothing writes to
  Firestore before confirm; confirm → `ghostService.confirmHand`.
- **Required cross-check** (spec: "cheap and worth doing"): on confirm, if another ghost
  seat already confirmed this round with overlapping cards, **warn** ("Priya's hand also
  claims Q♠ — one of you mis-entered; check your photos") but do not block — the photo is
  the truth, the humans resolve it. Test the overlap detection (pure).

AC: reducer tests — toggle/untoggle, 13-lock, order preservation, undo-last, confirm
payload equals entry order; a 12- or 14-card confirm is unreachable.

### WP7 — Ghost view part 3: Arrange + Play

- **Arrange:** render 13 cards; one-tap sort-by-suit / sort-by-rank (WP1); drag-to-reorder
  via Pointer Events (long-press 300ms lift; no library). Order → localStorage key (§3).
  Display order NEVER sent to service; position announcements always use photo order.
- **No promise bar.** Nothing gates play but the ghost's turn, which arrives by voice.
  The device holds no promise state.
- **Play:** tap card → inline confirm (`Play Q♠? ✔ ✖`) → `playCard` → card moves to played
  strip. **No countdown.** `[↩ Undo last card]` always visible while `playedCards` is
  non-empty → `undoLastCard` (service pops; UI returns card to hand; localStorage order
  unaffected — remaining-hand render = display order filtered by `remainingHand`).
- **Fix hand** (repair path): button in a kebab menu → confirmation → re-opens ENTER with
  current entries editable (only while ≥1 card unplayed); re-confirm rewrites `cards`.
  Played cards are not editable — undo them first.
- Round-end handling: when the round docs are cleaned up mid-listen (table submitted the
  round), the view returns to `WAITING_CAPTURE` for the next `roundIndex` — never a blank
  or error state.

AC: play-of-unheld-card unreachable from UI state; undo returns exact card; reducer
round-reset test.

### WP8 — Cleanup wiring only (in `js/app.js`)

> **There is no round-form pre-fill.** The v2 plan had one; the *card delivery only*
> decision removed it. **This feature does not modify `js/components/gameBoard.js` and does
> not touch the round form in any way.** If you find yourself editing the Game Board, stop —
> you are out of scope. Blind and promise are typed at the table, unassisted, exactly as for
> an all-physical match.

What remains here is lifecycle plumbing:

- After a successful `addRound`: `ghostService.cleanupRound(matchId, submittedRoundIndex)`.
  On match completion/cancellation (where `status` flips in `matchService` — `:192`
  completed, `:212` cancelled): `cleanupMatch`. On app init: `sweepOrphans`.
- `roundIndex` agreement: the ghost flow's `roundIndex` = `match.rounds.length` at capture
  time; cleanup deletes the docs for the index just submitted. `rounds` and `currentRound`
  are written in one atomic update (`matchService.js:186-187`), so they cannot drift apart
  — `rounds.length` is a safe index. Test this mapping in `tests/ghost-cleanup.test.js`
  (pure mapping helper).
  **Accepted residual risk (product decision, friends' league):** if the table captures deal
  N+1 before submitting round N, deal N+1's docs exist while round N is being submitted.
  Cleanup deletes by explicit index, so it removes only round N's docs and leaves N+1 alone.
  No guard UI. Do not build a reconciliation mechanism.

AC: cleanup called exactly once per submitted round and deletes only that index's docs;
**non-ghost matches are completely unaffected — zero behaviour change when `ghostSeats` is
absent**; `git diff` for this WP touches no round-form code.

### WP9 — Admin: mark seats remote (in `js/app.js`, match-creation/start flow)

- **Anchor (exact):** the `#addMatchForm` modal in `js/app.js:190-275`. Both member lists
  are already fetched there by `updateTeamMembers()` (`:221-233`), which is where the
  "exactly 2 members" test can read `team.members.length` without an extra query. The
  submit handler is at `:250`, calling `createMatch` then `startMatch` at `:268-269` —
  create the seats after `startMatch` resolves, before `closeModal()`.
- When **both teams have exactly 2 members**, show "Ghost seats" controls — up to 3 of the
  4 member slots toggleable to remote. ≥1 must stay physical (enforced in UI and in
  `createGhostSeats`).
- On confirm: `createGhostSeats`; render per-seat rows: name, code, `[Copy link + code]`
  (copies `https://<origin><path>?ghost=<matchId>&seat=<seatKey>` + code text), and a
  "📺 Open table station" link (`?station=<matchId>`).
- Show **both** spec etiquette lines verbatim (`ghost-seat.md:27-30`) — the second one is
  as required as the first:
  1. "DM each player their own code — don't post codes in the group."
  2. "This is casual secrecy, not privacy — don't describe it to players as 'private'."
- Codes re-viewable from the match detail view while the match is in progress.
- 2v2 revalidated at generation time; member rename mid-match doesn't break seats
  (identity is `memberIndex`).

AC: gate logic (2v2 check, ≤3 ghosts, ≥1 physical) pure + tested; non-2v2 teams never see
the controls.

---

## 5. CSS (`css/styles.css`, appended block `/* ===== Ghost Seat ===== */`)

- Seat view: mobile-first (≤390px), card targets ≥44px, suit tabs, sticky photo header
  with pinch-zoom container, bottom-fixed primary action.
- Station view: desktop/laptop, huge type (played card ≥120px tall), high contrast,
  distinct blind flash animation, status list per seat.
- Reuse existing CSS custom properties/tokens found in `styles.css` — match the current
  dark theme; no new fonts, no external assets.

---

## 6. index.html script order (append before `js/app.js`)

```html
<script src="js/utils/cards.js"></script>
<script src="js/services/ghostService.js"></script>
<script src="js/components/ghostGate.js"></script>
<script src="js/components/ghostStation.js"></script>
<script src="js/components/ghostSeatView.js"></script>
```

All modules attach to `window` (IIFE pattern, same as existing components — no ES modules;
the site has no bundler).

---

## 7. Testing & validation gates

1. **Unit (blocking):** `npm test` — all existing tests stay green + the 6 new test files
   pass. New pure logic aims for ≥90% branch coverage of `logic` objects (do not chase the
   global coverage config; it is not enforced by `npm test`).
2. **Static checks (blocking):** no new globals beyond the 5 modules; every render of
   `memberName`/`capturedBy` goes through an escape helper (grep for `innerHTML` in new
   code and verify each interpolation).
   - **Reuse `escapeHtml(s)` at `js/app.js:1101`** — it is the stricter of the two existing
     helpers (it escapes `'` as well as `& < > "`; `gameBoard.js:18`'s `escape()` omits the
     apostrophe). Do **not** write a third one. New IIFE modules that cannot see it at load
     order may keep a local copy with the **same five replacements**, in which case say so
     in a comment naming `js/app.js:1101` as the source of truth.
   - **Scope note — pre-existing gap, deliberately out of scope:** `team.members` is
     interpolated unescaped today at `js/app.js:228, 646, 929, 936, 1534`. That is
     redesign.md #43's job, not this feature's. Ghost Seat escapes at its **own** boundary
     (`memberName`/`capturedBy` on every station and seat render) and does not fix, and does
     not widen, those five call sites. Do not "helpfully" refactor them — it would put WP
     agents into a file another wave owns.
3. **Smoke (blocking, scripted):** `node -e` require each new pure module (they must not
   touch `window`/`document` at import time in their logic paths) — guards the Jest node
   environment and accidental DOM coupling.
4. **E2E (manual checklist, best-effort if a browser tool is available; otherwise emit the
   checklist in the final report):**
   - Two windows: `?station=` + `?ghost=`; fake `getUserMedia` via
     `--use-fake-device-for-media-stream` if launching Chrome, else stub.
   - Full round: capture → retake → enter 13 → arrange → 13 plays incl. one undo → table
     submits the round form **by hand, unassisted** → cleanup verified (docs gone) → next
     round starts clean.
   - **Negative check:** with a ghost match in progress, the Game Board behaves exactly as
     it does for an all-physical match — nothing pre-filled, nothing marked, no new chips.
   - **A 3-ghost round** (spec test requirement): capture queue sequences all three seats;
     one physical handler; two ghosts on one team both play from their own devices.
   - `?ghost=` with wrong code ×5 → 60s lockout. Stale link after match end → fall-through.

---

## 8. Non-negotiable engineering rules

- **File ownership per WP** (§9 waves) — two agents never edit the same file in the same
  wave. `js/app.js` and `index.html` are only touched in WP3, WP8, WP9 (sequenced).
  **`js/components/gameBoard.js` is never touched by this feature** — no WP owns it.
- Match existing code style: 4-space indent, IIFE components, compat Firebase API,
  comment density like `spectatorPass.js`.
- No refactors of existing code beyond the minimal seams listed. Resist cleanup urges.
- Every Firestore write path handles offline/failure with the existing notification
  pattern (`showNotification` in `app.js`) or a state the UI shows — no silent drops.
- Commit per wave on the current branch (`dev`), message style matching `git log` --
  imperative, one-line, no attribution beyond the standard trailer.

---

## 9. Orchestration playbook (for the executing session)

Run phases sequentially; agents within a phase in parallel. After EVERY phase, run the
review gate before starting the next.

| Phase | Agents (parallel) | Notes |
|---|---|---|
| **P0** | 1 agent: WP1 | Everything imports it. Small — do it first, review hard. |
| **P1** | 3 agents: WP2, WP4-logic-only, WP5/6/7-logic-only | Pure logic + service can proceed against WP1; no DOM yet, no shared files. |
| **P2** | 2 agents: WP3 (owns `app.js`+`index.html` this wave), WP4-DOM | Gate/routing/shells + station rendering. |
| **P3** | 2 agents: WP5+6-DOM, WP7-DOM | Both render inside `ghostSection` — split by sub-tree, or run sequentially if conflicts appear. |
| **P4** | 2 agents: WP8 (owns `app.js`), WP9 waits → then WP9 (owns `app.js`) | Sequenced — both touch `app.js`. |
| **P5** | 1 agent: CSS polish + §7.3 smoke + full `npm test` | |
| **P6** | Review+fix loop until clean | See below. |

**Review gate (every phase):** spawn a reviewer agent **on the Opus model** with:
the diff of the phase, `ghost-seat.md`, `CLAUDE.md`, and this file's relevant WP sections.
Instruct it to verify: (1) spec conformance item by item, (2) locked-rule safety, (3) the
WP's ACs literally, (4) XSS escaping, (5) no Storage/no-server/no-SDK-upgrade constraint
violations, (6) test adequacy. Findings come back as BLOCKER/MAJOR/MINOR; fix all
BLOCKER+MAJOR before the next phase (spawn fixer agents), MINOR may batch to P6.

**P6 final loop:** alternate implement-fix and Opus review until a full review pass returns
zero BLOCKER/MAJOR and §7 gates 1–3 are green. Then produce the final report: what was
built, test results verbatim, the §7.4 E2E checklist status, and any deviations from
`ghost-seat.md` (there should be none).

**Do not stop** for questions the docs already answer. The only legitimate stop: a change
that would require modifying `CLAUDE.md` (per its Change Control Protocol) — report and
halt that path only.

---

## 10. Known risks (pre-answered so agents don't re-litigate)

- **Doc-ID prefix queries don't exist in Firestore** → round docs carry `roundIndex` and
  `seatKey` as fields; query by field (WP2).
- **Compat SDK has no `arrayUnion` pop** → `playedCards` mutations are transactions.
- **Station refresh mid-round** → all station state derives from Firestore; nothing is
  station-local except the camera stream.
- **Ghost phone locks mid-play** → writes are awaited before UI transitions; on reconnect
  the listener resyncs from `playedCards` (no client-side timer exists anymore — v2
  removed the 5s countdown, so there is no in-limbo state).
- **Jest is node-env** → any test importing a DOM-touching path is a bug in the split, not
  a reason to add jsdom.
- **`?tv=1` collision** → ghost/station sections strip the `spectator-pass` body class on
  entry (WP3/WP4).
- **Coverage thresholds in `jest.config.js`** apply only to `test:coverage`, which is not
  a gate — do not let it block, do not delete the config.

## 11. Definition of Done

- [ ] All WPs implemented per ACs; all six new test files exist and pass
      (`ghost-cards`, `ghost-service-logic`, `ghost-gate`, `ghost-station-logic`,
      `ghost-seat-logic`, `ghost-cleanup`).
- [ ] `npm test` fully green (existing + new).
- [ ] §7.2 escaping audit and §7.3 smoke pass.
- [ ] **Card delivery only, verified by grep:** no `blindDeclared`, `promise`,
      `submitPromise`, `declareBlind`, or pre-fill anywhere in the new code;
      `git diff` touches neither `js/components/gameBoard.js` nor any round-form path.
- [ ] **Spectator Pass:** ghost/station strip the body class directly; `SpectatorPass.set()`
      is never called (it persists), and a stray `s` keypress in the ghost view does nothing.
- [ ] **Spec items with no natural home** all shipped: multi-ghost card cross-check warning,
      station capture prompt naming the player, and **both** etiquette lines.
- [ ] Full-match flow demonstrated (or checklist emitted) per §7.4.
- [ ] `ghost-seat.md` conformance review (Opus) returns zero BLOCKER/MAJOR.
- [ ] `CLAUDE.md` untouched; `firestore.rules` untouched; no new runtime dependencies;
      Firebase SDK still 8.6.1.
- [ ] Work committed on `dev` in per-phase commits; final summary report produced.
