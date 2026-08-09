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
│   ├── utils/                 # firebaseConfig, dateUtils, storage, env
│   └── components/            # UI components
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
