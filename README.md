# Card Game Dashboard

A web-based dashboard for tracking a card game where two teams compete to reach **500 points** through rounds of promise-and-actual gameplay. Built with vanilla JavaScript on the frontend and Firebase Firestore on the backend.

> **Game rules are locked.** See [`CLAUDE.md`](./CLAUDE.md) for the authoritative rules (teams, rounds, scoring, blind, win condition). Any rule change must follow the change-control protocol in that file.

---

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Backend:** Firebase Firestore + Firebase Authentication
- **3D Graphics:** Spline 3D viewer
- **Testing:** Jest 30
- **Hosting:** Firebase Hosting / GitHub Pages

There is **no build step** — the app runs directly from `index.html` against the bundled `js/` modules.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 (for Jest + Firebase CLI) |
| npm | ≥ 9 |
| Firebase CLI (optional, for deploy) | latest — `npm i -g firebase-tools` |
| A modern browser | Chrome / Firefox / Safari / Edge |

---

## Installation

```bash
# 1. Clone the repo
git clone <repo-url>
cd CardGame

# 2. Install dependencies (Firebase SDK + Jest)
npm install
```

---

## Configuration

The app reads two environment variables from a local `.env` file. Copy the example and fill in your values:

```bash
cp env.example .env
```

Edit `.env`:

```
# Firebase Web API key — Firebase Console → Project Settings → General → Your apps
FIREBASE_API_KEY=your_firebase_api_key_here

# Admin auth key required for creating teams, starting matches, adding rounds
AUTH_KEY=your_authentication_key_here
```

**Firebase project setup (one-time):**

1. Create a Firebase project at <https://console.firebase.google.com>.
2. Enable **Cloud Firestore** (Native mode).
3. Add a **Web App** in Project Settings → copy the API key into `FIREBASE_API_KEY`.
4. Update `.firebaserc` with your Firebase project ID.
5. Deploy security rules: `firebase deploy --only firestore:rules`.

> **Security:** `.env` is gitignored. Do **not** commit credentials. Only the API key lives in env; the rest of the Firebase config is in `js/utils/firebaseConfig.js`.

---

## Running the Project

The app is static — serve the repo root over HTTP (do **not** open `index.html` via `file://`, Firebase SDK won't initialize correctly).

### Option 1 — Firebase Hosting (recommended for parity with prod)

```bash
firebase serve --only hosting
# → http://localhost:5000
```

### Option 2 — Any static server

```bash
# Python
python3 -m http.server 8000
# → http://localhost:8000

# Node
npx serve .
```

Open the printed URL in your browser. Use the `AUTH_KEY` from your `.env` to unlock administrative actions (creating teams, starting matches, adding rounds).

---

## Season Records & Facts

The Stats page carries a **Season Records** board — records, rivalries, streaks and oddities computed from every round ever played. Unlike the live commentary, this pack is **static**: generated ahead of time and committed as data, so every visitor sees it instantly with no API key and no network call.

| Command | Purpose |
|---|---|
| `npm run season-facts` | Regenerate `js/data/seasonFacts.js` from the newest `db-dump/` backup |
| `npm run season-facts:preview` | Print the facts without writing the file |
| `npm run season-facts:live` | Pull a fresh Firestore dump first, then regenerate |

Add `--roast=1|2|3` to set how sharp the Hinglish tails are (1 friendly, 2 normal banter — the default, 3 savage).

**Run it after a batch of new matches** — the pack only changes when new play is recorded.

### How it works

1. `js/utils/seasonDigest.js` aggregates the whole archive into a grouped JSON digest — per-team profiles, promise-band economics, blind economy, rivalries, streaks, records.
2. `scripts/season-facts.js` hands that digest to Groq, which phrases each aggregate as one punchy sentence.
3. **Every generated line is verified number-by-number against the digest before it is written.** A line containing a figure the digest never computed is dropped and the deterministic fallback ships instead (`verifyLine`). The model is a wordsmith, never a calculator — the same contract the live commentary uses.

### Table Personalities & the Tilt Meter

Below the records board, each team gets a **player card**: an archetype, four trait bars, and a tilt meter. Every label is earned from the archive — `personalities()` and `tilt()` in `js/utils/seasonDigest.js` — and the evidence sits under each card so nothing is asserted without its number.

| Archetype | Earned by |
|---|---|
| **Bhagwan ka banda** 😇 | ≥90% promises kept |
| **Ganit ka master** 🎯 | Above-average discipline *and* ≥85% blinds landed |
| **Blind ka aashiq** 🕶️ | ≥40 blinds called, under 70% landing |
| **Garam dimaag** 🤬 | Tilt index ≥40 |
| **Jugaadu** 🎲 | Bids above average, keeps below average |
| **Bharosemand** 🧱 | Above-average discipline, ≤1 over-extension |
| **Darr ka mara** 🐢 | Bids below average |

Thresholds are relative to the league, not hard-coded, so archetypes stay meaningful as the season grows.

**Tilt** is the most interesting number in the archive. After a **negative** round the table calls blind **65%** of the time; after a positive one, just **21%**. `tiltIndex` is that gap per team — 0 is ice-cold, 100 means every bad round is answered with a blind. Only consecutive rounds *within one match* count, so a reaction is genuinely a reaction.

Both the absolute rates are a lower bound (legacy rounds have no stored `blind` flag — see `claude/commentary-style.md` §5.4), but both sides are depressed by the same bias, which is why the **gap** is the honest number and the one displayed.

Teams with too little data are skipped rather than guessed at: under 25 rounds gets no archetype, and too few bad rounds leaves the tilt meter off the card entirely.

### The Hinglish tail

Every fact is written in English and lands on a Hindi phrase — the register of the actual card table:

> `Alegeus stars trailed Gaurav/Akash by 337 points (July 2025) and still won it 522 to 361 in 8 rounds.` **`dead samjha tha, zinda nikla.`**

Phrases live in `js/data/comedyLibrary.js` — the same library the live spoken commentary uses — grouped by **intent** (`collapse`, `greedy_read`, `one_hand_short`, `domination`, `blind_paid_off`, `blind_backfired`, `comeback`, `bids_collide`, `quiet_round`, …). Each slot in the generator declares which intent its fact wants; the library supplies the wording.

**Tails are re-picked on every page load.** The facts are records and never change; the joke at the end does. Same numbers, new ending, every reload — plus a 🎲 button to reroll without reloading. A **usage ledger** guarantees no phrase repeats within a single render (28 facts → 28 distinct tails); when an intent's pool runs dry it resets only that intent.

The generator still bakes a tail into the pack. That is the fallback for when `comedyLibrary.js` has not loaded, so the board never renders bare — and it uses a seeded RNG, so regenerating unchanged data produces an identical file.

Readers can dial sharpness themselves: `SeasonFactsBoard.setRoastIntensity(1|2|3)` persists to `localStorage`.

**The tail is appended after number-verification, never before.** A comedy phrase must not be able to smuggle a number past `verifyLine`; a test asserts no phrase contains a digit other than the rule constants 140/70.

Per `CLAUDE.md` §0, phrases roast the **play** — the bid, the blind, the collapse — never the person. Tests enforce that boundary.

The board shows 8 cards and reveals the rest via **"Aur dikhao"**.

### Groq keys

The generator reads `GROQ_API_KEY` from your environment or `.env` (gitignored — **never commit a key**; GitHub's secret scanning will reject the push, and a key in a public repo is a key anyone can spend). Get a free one at <https://console.groq.com/keys>.

Without a key the pack still generates, with plainly-worded facts. When a key is missing or its quota runs out, the script says so and offers a choice:

```
  ────────────────────────────────────────────────────────────
   ⚠️  The shared Groq key is used up.
  ────────────────────────────────────────────────────────────
  Reason: the free-tier daily token budget is spent.

    • Paste your own Groq key (free at https://console.groq.com/keys)
    • Press Enter to cancel and keep the plain wording

  Groq key (or Enter to cancel):
```

Cancelling is a first-class outcome — the facts are already computed and correct, and a key only changes the wording. A working key can be saved to `.env` so you are not asked again. Non-interactive runs (CI, piped stdin) skip the prompt entirely.

The free tier is capped at 100k tokens/day, so it will run dry. Requests are sent in small batches with a tight `max_tokens`, so the generator keeps working right down to the last few hundred tokens of quota. AI-phrased cards get a green edge and an `AI ✨` badge; deterministic ones do not.

### What gets excluded

Two filters keep the records honest:

- **Seed/test teams.** `Coke` and `Sprite` were the placeholder teams used while building the app. They only ever played each other, and their fabricated scores would otherwise own several records outright. They are dropped by name (case-insensitively, so re-seeding under new ids still works) via `DEFAULT_EXCLUDED` in `js/utils/seasonDigest.js`. To exclude others, add their names there — or pass `{ excludeTeams: [...] }` to `SeasonDigest.build()`. The digest reports what it dropped in `generatedFrom.excludedTeams` / `excludedMatches`, so the filtering is auditable.
- **Legacy non-conformant scores.** ~29 round-sides carry hand-typed scores the locked rules in `CLAUDE.md` §4 cannot produce (a +160, a doubled −140 blind). They still count in totals and averages — history is history — but no *record* may be held by an arithmetic slip.

---

## Running Tests

The test suite uses **Jest** and lives in `tests/`. Test files cover team creation, match state transitions, promise/actual validation, the scoring system, win conditions, and statistics.

| Command | Purpose |
|---|---|
| `npm test` | Run the full Jest suite once |
| `npm run test:watch` | Re-run tests on file changes |
| `npm run test:coverage` | Run with a coverage report (HTML output in `coverage/`) |

### Running a specific test file

```bash
npx jest tests/scoring-system.test.js
```

### Running tests matching a name

```bash
npx jest -t "promise hand"
```

### Coverage thresholds

Configured in `jest.config.js` — global minimum **80%** for branches, functions, lines, and statements. Failing this threshold fails the test run.

---

## Project Layout

```
CardGame/
├── CLAUDE.md                  # Locked game rules (authoritative)
├── index.html                 # Entry point
├── css/                       # Styles
├── js/
│   ├── app.js                 # Main controller / UI wiring
│   ├── models/                # Team, Match
│   ├── services/              # firebaseService, teamService, matchService, migrationService
│   ├── utils/                 # firebaseConfig, dateUtils, storage, env, seasonDigest
│   ├── data/                  # seasonFacts.js — GENERATED, see Season Records above
│   └── components/            # UI components
├── scripts/                   # dump-db, season-facts, migrations
├── tests/                     # Jest tests + setup.js
├── claude/                    # Detailed project documentation
├── firebase.json              # Firebase Hosting config
├── firestore.rules            # Firestore security rules
├── jest.config.js             # Jest configuration
├── package.json
└── env.example                # Template for .env
```

---

## Documentation

Detailed docs live in [`claude/`](./claude/):

- [`project-overview.md`](./claude/project-overview.md) — high-level project description
- [`architecture-overview.md`](./claude/architecture-overview.md) — system design
- [`api-documentation.md`](./claude/api-documentation.md) — service APIs
- [`game-rules-and-conditions.md`](./claude/game-rules-and-conditions.md) — extended rules + implementation notes (rules themselves are locked in [`CLAUDE.md`](./CLAUDE.md))
- [`database-schema.md`](./claude/database-schema.md) — Firestore schema
- [`setup-and-development.md`](./claude/setup-and-development.md) — extended setup guide

---

## Deployment

```bash
# Deploy hosting + rules
firebase deploy

# Hosting only
firebase deploy --only hosting

# Firestore rules only
firebase deploy --only firestore:rules
```

---

## License

ISC — see [`LICENSE`](./LICENSE).
