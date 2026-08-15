# Ghost Seat — Remote Player via Photo Hand + Interactive Hand

> **Status:** Approved design **v3**, not yet built. Referenced from [`redesign.md`](redesign.md)
> as idea #59 (P2 tier). v2 incorporated a 3-persona end-to-end review (ghost / physical
> player / audience); **v3 narrows the feature to card delivery only** — the app no longer
> carries the Blind declaration or the promise, and no longer touches the round form. See
> *Scope: card delivery only*.
> **Rules impact:** None, and now structurally so. This feature facilitates *play* and holds
> no score-bearing state whatsoever; the locked scoring, promise, blind, and win rules in
> [`CLAUDE.md`](CLAUDE.md) are enforced entirely by the existing round form, which this
> feature does not modify. Promises still obey §3.1 (4–13) and §4.4 (Blind = 7) because the
> table enters them exactly as it does today.
>
> **Constraints (locked by product decision):** must be **free** (Firebase Spark tier only),
> must run with **no server** (static GitHub Pages, as today), and the ghost's access is
> **valid for one match only**. These rule out Firebase Storage (Blaze-only) and any
> Cloud Function. See *Cost & hosting constraints*.

## Security posture (decided)

The ghost's login is a **generated access code checked in client-side JavaScript**. Firestore
rules stay `allow read, write: if true`, so all match data — including hand photos — is
technically readable by anyone who knows how to query the database directly.

**This is accepted.** Product decision, verbatim: *"we are just friends, no one will go to
dev tools."* The league is an office friend group around a physical table; the threat is a
teammate glancing at a phone, and the code gate stops exactly that. No further security work
is in scope, and none of the design below pretends otherwise.

Two etiquette rules follow from this posture (spec-level, zero build cost):

- **DM the code to the ghost — never post it in the group chat.** The gate only means
  something if the code isn't public.
- **Don't describe the feature to players as "private."** It is casual secrecy.

The upgrade path, if ever wanted: Firebase Anonymous Auth (free, serverless) gives a real
`request.auth.uid` for rules to bind to. Deferred indefinitely.

## What it is

The game stays fully physical — real deck, real deal, real tricks at the table — but **one
to three absent players ("ghosts") play remotely**. Their physical cards are dealt at the
table as usual; the app becomes a secure messenger between each hand and its owner:

1. A **table station** (laptop) photographs each ghost's dealt hand — with the ghost
   firing the shutter remotely, and nobody at the table ever seeing the cards or a preview.
2. The ghost **digitises the photo** into 13 tappable cards (in photo order), then
   **rearranges** their on-screen hand however they like.
3. Each trick, the ghost **taps a card to play it**; the station announces it large
   ("▶ Q♠ — 5th from the left") and a physical player pulls that card **face-down by
   position** and plays it, never seeing the rest of the hand.

**Blind and promise never enter the app.** The ghost calls both by voice like everyone
else, and the physical player types them into the round form at the table — exactly as they
do for a player sitting across from them. See *Scope: card delivery only*.

The app never validates follow-suit and never adjudicates play. The photo is the source of
truth for the hand; the humans at the table keep the play honest — exactly as they do today.

## Scope: card delivery only (decided)

**Ghost Seat delivers cards. It does not carry any score-bearing decision.**

Blind, promise, and actuals are all called by voice and typed at the table by the physical
player. The app's entire job is: get a hand to an absent player, and get their chosen card
back to the table as a physical position.

This was tightened after the v2 design. v2 had the ghost tap **Blind / see my hand** in the
app, which then gated the photo reveal, and had non-blind ghosts submit a 4–13 promise that
pre-filled the round form. Both are removed:

- **The declare gate was standing in for a witness that already exists.** Its purpose was to
  stop a ghost peeking before committing to Blind. But a live voice call is a stated
  operating requirement — the ghost says "blind" out loud *before* their photo lands, and the
  table hears it. That is the same social check a physical player gets from everyone watching
  them not pick their cards up. The app does not need to withhold the photo to make it real.
- **Once Blind is called by voice, the physical player taps the BLIND chip** at the table,
  as they already do for any player. No app involvement, no pre-fill, nothing to keep in
  sync.

What this costs: a forgotten Blind is a ±210-point silent error (+140 vs −70). That risk is
**real but pre-existing and unchanged** — it is exactly the risk the league already carries
for physical players who call blind by voice. Ghost Seat neither adds to it nor is the right
place to fix it. If it ever bites, the fix belongs on the Game Board's BLIND chip, for
everyone.

What this buys: the app never touches the round form, holds no promise state, and cannot
disagree with the table about what was called.

**A live voice/video call between the ghost(s) and the table is a stated operating
requirement, not a nice-to-have.** Turn order, the suit led, and trick results all travel by
voice. The app deliberately does not model whose turn it is.

## Design decisions (settled)

| Question | Decision |
|---|---|
| Digital hand entry vs photo | **Both — photo first, then digitise.** The ghost turns their photo into 13 tappable cards on their own device. |
| How the photo is taken | **Remote shutter.** The table station's camera faces the cards; its screen faces the table; **the camera preview is never rendered anywhere**. The ghost taps 📷 on their own device to fire the shutter and sees the result instantly. **Retake is one tap** — the ghost keeps snapping until the photo is readable. |
| Who handles the ghost's physical cards | A physical player fans them **facing the camera, faces away from themselves**, then keeps them **face-down in photo order**. During play they retrieve by **position** ("5th from the left"), never by looking. |
| Blind ordering | **Not in the app.** The ghost calls Blind by voice before their photo lands, exactly as a physical player calls it before picking their cards up; the live call is the witness. The physical player taps the BLIND chip at the table. No declare screen, no photo gate. |
| Promise | **Not in the app.** Called by voice in bid order, typed at the table. The app holds no promise state and never pre-fills the round form. |
| How the hand is digitised | **Manual tap-entry, in photo order (left → right)**, v1. Entry order = physical order is what makes position-addressable play work. ~40s per deal. OCR: see *Deferred: OCR*. |
| Who can see the photo and hand | **The ghost, via a generated access code.** UI gate only; accepted posture above. Audience sees only what they see today — results. |
| Where the photo lives | **Base64 in its own Firestore doc** (sibling to the round doc, so trick updates never re-download the photo). Firebase Storage is paid; not used. |
| Ghost identity | **`teamId` + `memberIndex`** into the existing `team.members` array. No player registry, no migration. |
| How many ghosts | **1 to 3 seats remote; at least one physical player must remain** (to deal, show hands to the camera, and play cards for the ghosts). |
| Rearranging | **Client-side only, ghost's device.** Drag + sort presets. Display preference, never game state. |
| Playing a card | Tap → confirm → **broadcasts immediately** (no countdown). **Undo last played card** available until the round is submitted at the table. |
| Table-side display | **The station's screen** — status lines and each played card with its position, large. No promises, no Blind status: those are voice calls typed on the round form. |

## The table station

One laptop at the table anchors the feature. It is three things at once:

1. **The camera.** It sits with the camera lens toward the card-showing spot and the screen
   toward the table. The live camera preview is **never mounted in the DOM** — not hidden
   with CSS, simply never rendered — so neither the card-holder nor anyone walking past can
   see a hand on it.
2. **The display.** The screen shows the match's live state: *"Showing Rahul's hand — waiting
   for Rahul to capture…"*, *"Rahul is entering his hand…"*, *"Rahul is ready"*, and each
   played card: **"▶ Q♠ — 5th from the left"**. Status lines mean the table is never staring
   at a frozen screen wondering if the link died. It shows **no promises and no Blind
   status** — those are called aloud and live on the round form, not in the app.
3. **The remote shutter.** The ghost's 📷 tap writes a `captureRequest` to Firestore; the
   station's listener grabs a frame from its `getUserMedia` stream, compresses it
   (see *Photo as base64*), and writes it. The photo appears on the ghost's device as soon
   as it lands, and they tap **Accept** or **Retake**. Retake just fires the shutter again —
   a blurry or cropped photo
   costs one tap, not a walk to the table.

With multiple ghosts the station sequences captures: *"Now show **Priya's** hand"* → Priya
snaps and accepts → *"Now show **Dev's** hand"*. The physical player just follows the screen.

> Station practicalities: keep the laptop plugged in, screen-sleep off, one browser tab.
> If the ghost section is somehow opened on a device with Spectator Pass (`?tv=1`) engaged,
> the ghost section **force-disables** it — spectator mode hides input controls, which would
> break the station and the ghost UI.

## Physical custody — how a card is played without anyone seeing the hand

This was the review's #1 blocker: the person playing the ghost's card must find "Q♠" in a
hand they're not allowed to look at. Solved by **photo order = entry order = physical order**:

1. At capture, the hand is fanned facing the camera. The photo fixes a left-to-right order.
2. The handler squares the fan **without reordering** and keeps the packet face-down.
3. The ghost digitises the cards **in photo order, left to right** — so the app knows the
   physical position of every card.
4. When the ghost plays, the station announces the card **and its current position among the
   remaining cards**: "▶ Q♠ — 5th from the left". The handler re-fans face-down, counts to 5,
   pulls the card, and flips it for the trick.
5. The app recomputes positions as the hand depletes; an undone card is announced with the
   position to slide it back into.

The handler never sees a face except the one card being played — which the whole table sees
anyway. This holds even when one physical player is handling three ghost hands, including
opponents' hands.

## How the ghost opens their dashboard

### The link

Each ghost seat gets a share link:

```
https://<site>/?ghost=<matchId>&seat=<seatKey>
```

plus a **6-character access code**, generated per seat, per match:

- Charset excludes look-alikes → `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- `crypto.getRandomValues`, never `Math.random`.
- Stored plaintext on the match doc (hashing would be theatre under the accepted posture).
- Dead when the match ends.

The admin **DMs** each ghost their link + code (`[Copy link + code]` button per seat).
The dashboard may re-show a code on demand — simpler, and no less secure given the posture.

### The gate

On load:

1. Parse `?ghost=` + `&seat=` — same `parseQuery` helper `spectatorPass.js` uses.
2. Read `matches/{matchId}.ghostSeats[seatKey]`. Absent or `active: false` → fall through to
   the normal app, no error that confirms anything.
3. Code prompt — six characters, autofocus, uppercase-as-you-type.
4. Compare in JS. Match → open the Ghost section; remember in **`localStorage`** (keyed by
   matchId+seat) — WhatsApp's in-app browser resets `sessionStorage` between visits, and the
   ghost will bounce between the chat and the app all match.
5. Local rate-limit: 5 wrong attempts → 60s lock. Friction, not a boundary.

### The section

A fourth section for `showSection()` (`js/app.js:436`), following the `?tv=1` precedent:

- **Not in the nav** — reachable only via a valid link + code.
- **Auto-selected on load**, bypassing the `showSection('teams')` default (`js/app.js:1799`).
- **Persistent for the match** — refresh returns to the same state (URL + localStorage).

## Cost & hosting constraints (locked)

**Free tier only. No server. No new Firebase product.**

| Constraint | Consequence |
|---|---|
| **Firebase Storage is Blaze-only** | ❌ Storage is out. Photos go into Firestore docs as base64. |
| **No server / Cloud Functions** (static GitHub Pages) | ❌ No OCR proxy, no admin SDK, no scheduled cleanup. Browser does everything. |
| **Firestore Spark**: 1 GiB stored, 50k reads + 20k writes/day, ~10 GiB/mo egress | ✅ Ample **provided photos live in their own docs** (below). |
| **Firestore 1 MiB/doc limit** | ⚠️ Photos must be compressed client-side. |

### Photo as base64 — in its own document

The station compresses before writing: canvas at **max 1000 px long edge**,
`toDataURL('image/jpeg', 0.6)` → ~80–150 KB → ~110–200 KB as base64. Retry at q0.45, then
hard-reject > 700 KB ("retake with more light").

**The photo doc is separate from the round doc.** Firestore listeners deliver whole
documents on every change — if the photo sat next to `playedCards`, every open dashboard
would re-download ~200 KB on **every trick**. In its own doc, the photo is fetched once by
one person (its ghost); trick updates ship a few bytes.

Deleting the photo doc deletes the photo — atomic, no bucket, no cleanup job.

## The card model (standard 52-card deck)

**4 suits × 13 ranks = 52 cards.**

| Suit | Symbol | Colour | Code |
|---|---|---|---|
| Spades | ♠ | black | `S` |
| Hearts | ♥ | red | `H` |
| Diamonds | ♦ | red | `D` |
| Clubs | ♣ | black | `C` |

**13 ranks per suit:** `A 2 3 4 5 6 7 8 9 10 J Q K` — the Ace is the "1" (no separate 1
card); J/Q/K are the face cards.

**Card codes** are `<rank><suit>`, two characters, **`T` for ten**: `AS KS QS JS TS 9S …`.
The UI always displays `10`, never `T`.

> Trump/ranking rules and which card beats which are **out of scope** — the table
> adjudicates tricks. The model exists so a card can be identified and transmitted
> unambiguously.

## Seat identity — no player registry needed

Teams store members as plain strings (`js/models/Team.js:5`). No player entity exists, and
none is needed: a ghost seat is **`teamId` + `memberIndex`** (position in `team.members`),
with `memberName` denormalised for display only. No migration, no new collection.

> `memberName` and `capturedBy` are rendered into the live view — **escape them**. The
> codebase has a known XSS gap with interpolated names (redesign.md); these two fields are
> pushed to every open dashboard, so they get escaping now, not when #43 lands.

## Table shape — 4 seats, 2 per team, 1–3 ghosts

Ghost Seat requires **2 teams × 2 members = 4 seats**, 13 cards each. Up to **3** seats may
be remote; **at least one physical player remains** to deal, show hands to the camera, and
play the ghosts' cards.

`CLAUDE.md` §1 (1..N members) is untouched — this is a **feature precondition**: the "mark
seat remote" control appears only when both teams have exactly 2 members, and is
re-validated on submit.

## What the app knows about the deal

52 cards, four hands of 13. **Only ghost hands are photographed** — a physical player's own
cards never enter the system. The app does not model the deal; it models each ghost's hand.

The `exactly 13, no duplicates` check is **per hand**. With multiple ghosts the app *could*
cross-check that two confirmed hands don't claim the same card — cheap and worth doing —
but it can never validate against unphotographed physical hands. A mis-entered card
surfaces the way a misspoken card does at a table: the humans catch it. The undo path
(below) is the repair.

## Round flow

1. **Setup** — mark 1–3 seats remote; DM each ghost their link + code. Ghosts open, enter
   code, land on their section. Voice call running.
2. **Deal** — physical cards to all four seats, 13 each.
3. **Capture** — station prompts *"Show Rahul's hand"*; the physical player fans that hand
   facing the camera; **the ghost fires the shutter** and Accepts or Retakes until the photo
   is readable. Handler squares the fan, keeps it face-down in photo order. Repeat per ghost.
4. **Blind calls (voice, no app)** — any player going blind says so aloud before their cards
   are looked at; for a ghost that is before their photo lands. The physical player taps the
   BLIND chip at the table. A blind ghost still gets the photo — they need it to digitise and
   play — they simply committed before it arrived, on the call, in front of everyone.
5. **Digitise** — ghost enters their 13 cards **in photo order** on the 52-card grid;
   strict 13/no-duplicate lock; "This is my hand".
6. **Arrange** — drag / sort presets; local display state only.
7. **Promise (voice, no app)** — called in bid order as today. Nothing is typed into the
   ghost's device; the table records it on the round form.
8. **Play** — on their turn (by voice), the ghost taps a card → confirm → **instant
   broadcast**: station shows "▶ Q♠ — 5th from the left"; handler pulls by position.
   **Undo last card** stays available (see below).
9. **Round ends** — table enters promises/actuals into the normal round form, exactly as it
   does for an all-physical match; **Ghost Seat contributes nothing to this step**. On
   submit: ghost round docs cleaned up, next deal starts at 3.

## The ghost's screens

One screen changing state: **Capture → Enter → Arrange → Play**, per deal.

### Screen 0 — Capture

```
   Waiting for your hand — the table is dealing…

               [ 📷  Capture ]
```

- Live-updating waiting state until the station's photo lands.
- 📷 fires the remote shutter; the photo appears here and the ghost taps **Accept** or
  **Retake**. Retake re-fires the shutter.
- **No declare step.** Blind is called on the voice call, not here (see *Scope: card
  delivery only*). A ghost going blind says so before this photo arrives, then accepts it
  and digitises as normal — they need the cards to play, they just committed sight-unseen.

### Screen 1 — Enter (~40s, in photo order)

Photo pinned on top (pinch-zoom). Below, the 52-card grid, **one suit row at a time,
large targets** (four 13-column rows don't fit a 360 px phone — the grid is tabbed by suit
or stacked with horizontal scroll; targets ≥ 44 px):

```
   [♠] [♥] [♦] [♣]                 ← suit tabs
   ♥  A  K  Q  J  10  9  8  7  6  5  4  3  2

   Entered (photo order): 11 / 13        [ Undo last ]
   │ 7♠ Q♥ 2♣ A♠ 9♥ J♦ K♣ 4♥ 8♦ A♥ 3♣ │
              [ This is my hand ]  ← disabled until 13
```

- **Enter left to right as they appear in the photo** — entry order is the physical order
  that play-by-position depends on. The tray preserves entry order; a small suit-grouped
  summary shows underneath for eyeballing against the photo.
- Tap toggles; a used card dims and cannot be picked again — duplicates structurally
  impossible.
- Counter to **13/13** unlocks confirm. Nothing writes to Firestore until then.
- Photo unreadable at any point → **Retake** (fires the remote shutter again). A retake
  after confirm invalidates the entered hand — re-enter from the new photo.

### Screen 2 — Arrange

Confirm writes the hand; the screen becomes 13 card objects.

- **Drag to reorder**, or one-tap **sort by suit / sort by rank**. `localStorage` only;
  on-screen order never affects the photo-order positions used for physical retrieval.
- **No promise bar.** Promises are called by voice and typed at the table; the ghost's
  device holds no promise state and nothing gates play but the ghost's own turn, which
  arrives by voice.

### Screen 3 — Play

```
   ♠ A K 7    ♥ Q 9 4    ♦ J 8    ♣ K 3
        ↑ tap → [ Play Q♠? ✔ / ✖ ] → broadcast

   Played:  ♦8  ♣K  ♥Q          [ ↩ Undo last card ]
```

- Tap → one-tap confirm sheet → **broadcasts immediately**. No countdown (review found a
  fixed 5s delay adds ~a minute per round per ghost; product decision: none).
- **Undo last card** — available until the round is submitted at the table. It removes the
  card from `playedCards`, returns it to the hand, and the station announces
  "↩ Q♠ taken back — slide it back 5th from the left". This is the repair path for
  mis-taps, out-of-suit corrections, and digitise typos caught late (undo, **Fix hand**
  re-opens entry for remaining cards, re-play).
- Hand depletes 13 → 0; positions recompute; round ends when the table says so.

> **The app never scores any of this.** Tricks are counted at the table and entered as
> actuals per `CLAUDE.md` §3.2. Ghost Seat delivers cards, not results.

## Hard prerequisites

- **#24 Live match listeners** — the realtime channel for captures and plays.
  `firebaseService.js:99,108` has the collection-listener pattern; the `ghostRounds`
  subcollection listener is new work.
- **A live voice/video call** during play — operating requirement, stated to users.

Build order: **#24 live sync → Ghost Seat.** No dependency on #41 auth, Storage, or a
player registry (all removed by the free/no-server decisions).

## Data model sketch

```
matches/{matchId}
  ghostSeats: {                       // 1–3 entries, keyed by seat
    "<teamId>_<memberIndex>": {
      teamId, memberIndex, memberName,
      accessCode,                     // per seat, per match, plaintext
      active                          // false when match ends
    }
  }

matches/{matchId}/ghostRounds/{roundIndex}_{seatKey}
  captureRequest    // ghost → station: fire the shutter (counter; increments = retake)
  capturedAt, capturedBy
  cards             // 13 codes IN PHOTO ORDER (this order = physical position)
  confirmedAt
  playedCards       // ordered array of played codes — the station reads this
                    // NOTE: no blindDeclared, no promise. Both are voice calls typed at
                    // the table (see "Scope: card delivery only") — the app never stores
                    // a score-bearing decision.

matches/{matchId}/ghostPhotos/{roundIndex}_{seatKey}
  photoData         // 'data:image/jpeg;base64,…' ≤ ~700 KB — its own doc, so trick
                    // updates never re-ship the photo to every listener
```

Display order (Screen 2) is `localStorage` only. Escape all name fields on render.

### Cleanup

- **Round submitted** → delete that round's `ghostRounds` + `ghostPhotos` docs.
- **Match ends/cancelled** → `active: false` on all seats; delete both subcollections.
- **Self-heal:** on any app load, sweep ghost docs belonging to completed/cancelled
  matches — covers the tab that died before its cleanup write. Serverless.

Played-card history dies with the round by design; the audience keeps what it has today —
results. (If a records page ever wants "that legendary blind", the blind flag is on the
round the table submits, which is permanent — and always was the authoritative copy.)

## Rough build estimate

| Piece | Effort |
|---|---|
| Admin: mark 1–3 seats remote (2v2 gate), codes, DM copy | 0.5–1 day |
| Ghost entry: link+seat parse, code gate (localStorage), 4th section | 1 day |
| **Table station: camera stream, remote shutter, compress/write, status display, played-card display with position** | 2–2.5 days |
| Screen 0: waiting states, capture/retake loop | 0.5 day |
| Screen 1: photo viewer + suit-tabbed grid, photo-order entry, 13-lock | 1.5–2 days |
| Screen 2: hand render, drag/sort | 1 day |
| Screen 3: confirm-play, instant broadcast, undo-last (incl. position recompute), fix-hand | 1.5 days |
| Cleanup + self-heal sweep | 0.5 day |
| Multi-ghost sequencing (capture queue, per-seat docs) | 1 day |
| Testing with a real match (incl. a 3-ghost round) | 1–1.5 days |

Roughly **9–11 days** (v2 was 12–14). The **card delivery only** decision removed the
declare gate, the promise bar, and the entire round-form pre-fill — the app no longer
touches the round form at all. Still zero prerequisites beyond #24, still free, still
serverless.

## Deferred: OCR pre-fill

Ruled out for the foreseeable future, not merely deferred: accurate card recognition needs
a vision-model call behind a key-holding proxy, and *no server, stays free* is locked.
Generic in-browser OCR (Tesseract) misreads fanned hands badly enough to be slower than
tap-entry. If circumstances ever change, OCR pre-fills Screen 1 and the ghost confirms —
nothing downstream changes.

## Out of scope (deliberately)

- Follow-suit or legality validation — the table enforces play, as today.
- Turn detection, trick detection, trick winners — voice call + humans.
- Photographing or modelling physical players' hands.
- Audience features beyond today's surface — spectators see results, not cards.
- Persisting on-screen hand order server-side.

## Open questions (decide during build)

- Camera framing without a preview: does the station need a one-time physical alignment
  ritual (tape mark on the table), or a low-res grayscale "is something in frame" hint that
  is useless for reading cards but enough for aiming?
- Undo after the handler already physically played the card: station announces the
  take-back, but define the table etiquette line in the help text.
- Should the station beep on capture-request / play / undo so the table doesn't have to
  watch the screen?
- Exact `roundIndex` agreement between ghost rounds and the table's round form when the
  next deal is captured before the previous round's actuals are entered.
