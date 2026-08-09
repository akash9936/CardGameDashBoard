# Ghost Seat — Remote Player via Photo Hand

> **Status:** Approved design, not yet built. Referenced from [`redesign.md`](redesign.md) as idea #59 (P2 tier).
> **Rules impact:** None. This feature facilitates *play*; it never touches the locked scoring,
> promise, blind, or win rules in [`CLAUDE.md`](CLAUDE.md).

## What it is

The game stays fully physical — real deck, real deal, real tricks at the table — but one
absent player ("the ghost") plays remotely. Their physical cards are dealt at the table as
usual; the app becomes a **secure messenger** between that hand and its owner:

1. The ghost **sees their hand** (secretly — a photo only they can open).
2. The ghost **submits their promise** (4–13, or Blind) from wherever they are.
3. The ghost **picks a card each trick**; it displays on a screen at the table and a
   teammate physically plays it.

The app never parses cards, never validates follow-suit, never adjudicates play. The photo
*is* the hand, and the humans at the table keep the play honest — exactly as they do today.

## Design decisions (settled)

| Question | Decision |
|---|---|
| Digital hand entry vs photo | **Photo.** Near-zero mid-game entry cost; no card-picker data entry for the table. |
| Who captures the hand | **Any player already at the table** shows the ghost's cards to the camera and shoots in-app. Trust is social (office league); the capturer's identity is **logged** for accountability. |
| Who can see the photo | **Only the ghost**, logged in as that player. Enforced by Firebase Storage security rules keyed to their authenticated UID — never by UI politely hiding it. |
| Table-side display | The **live match view** already open at the table shows the ghost's promise and each played card, large ("▶ Q♠"). |

## Round flow

1. **Setup** — when creating/starting the match, mark one player as *remote* for that match.
   They log in as that player from home.
2. **Deal** — cards are dealt physically to all four seats, including the empty one.
3. **Capture** — a table player taps "📷 Capture hand", fans the ghost's 13 cards, shoots.
   The preview hides immediately after upload (nothing lingers on the table phone).
   The app records who captured.
4. **Deliver** — photo lands in Firebase Storage; a Firestore doc references it; Storage
   rules allow read only for the ghost's UID.
5. **Promise** — the ghost reads their hand from the photo and submits 4–13 or **Blind**
   in-app; it appears on the table's live view. (Blind needs no photo until play starts.)
6. **Play** — each trick, the ghost picks a card from a suit-grouped 52-card picker; it
   shows large on the table's live match screen; their teammate physically plays it.
   Picked cards grey out client-side so the ghost can track what's spent.
7. **Next deal** — new photo, repeat. **Photos auto-delete when the round ends.**

## Hard prerequisites

- **Player-level Firebase Auth** — extends redesign.md P0 #41 beyond admin auth. Photo
  secrecy must be a Storage/Firestore *rule*, which requires the ghost to have a real
  authenticated identity. With today's `allow read, write: if true`, any opponent could
  open the photo URL from DevTools.
- **#24 Live match listeners** — the Firestore realtime channel is the delivery mechanism
  for the promise and played-card display at the table.

Build order: **P0 security (with player accounts) → #24 live sync → Ghost Seat.**

## Data model sketch

```
matches/{matchId}
  ghostSeat: { playerId, teamId, active: true }

matches/{matchId}/ghostRounds/{roundIndex}
  handPhotoPath   // Storage path; rules: read == ghost UID only
  capturedBy      // player who photographed (accountability)
  capturedAt
  promise         // 4–13 | 'blind' — written by ghost, readable by all
  playedCards     // ordered array of card codes ('QS', 'TH', …), written by ghost
  deletedAt       // photo cleanup marker
```

Storage rule sketch: `match/{matchId}/hand/{roundIndex}.jpg` → `allow read: if
request.auth.uid == resource.metadata.ghostUid; allow write: if authenticated match player`.

## Rough build estimate

| Piece | Effort |
|---|---|
| Camera capture + upload + auto-hide preview | 1–2 days |
| Storage + Firestore security rules, photo lifecycle/cleanup | 1 day |
| Ghost's screen: photo viewer, promise form, card picker | 2–3 days |
| Table live view: promise + played-card display (on top of #24) | 1 day |
| Testing with a real match | 1 day |

## Out of scope (deliberately)

- Card recognition / OCR of the photo — humans read the photo.
- Follow-suit or legality validation — the table enforces play, as today.
- Full digital mirror of all four hands / trick-by-trick tracking.
- More than one ghost per match (v1 supports exactly one remote seat).

## Open questions (decide during build)

- Does the ghost need a nudge ("your turn") — or does the existing voice/video call
  everyone will naturally have open cover turn-taking?
- Photo retake flow if the capture is blurry — likely just "capture again replaces".
- Should the ghost's *picked-but-not-yet-physically-played* card be cancellable for a few
  seconds (mis-tap protection), like a 5-second undo before it shows at the table?
