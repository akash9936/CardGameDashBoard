# AI Continuity — League Memory, Session Arcs, Player Identity & the Eval Harness

> **Status:** **Built, v1.** Four features, specced together because they share one
> seam: **the facts packet** (`FactsEngine.factsPacket`) and the digest that feeds it.
>
> §1, §2 and §4 are live. §3 is built but **ships dark** until
> [`js/data/rosters.js`](js/data/rosters.js) is filled in — see §3.1.
>
> **Three decisions changed during the build**, each because the archive disagreed with
> the spec:
>
> 1. **`always-blinds` was cut.** The spec proposed "called a blind in every recent
>    meeting" as a pattern. Measured: **81% of team-sides call ≥1 blind in any match**, so
>    the fact is true of four sides in five and says nothing — precisely the failure
>    `commentary-style.md` §5.4 warns about. Replaced with `blind-appetite`, which requires
>    *volume* (≥2 blinds per meeting, sustained).
> 2. **Dependency resolution is by bare identifier, not `globalThis`.** Every module here
>    is a top-level `const`, which is a lexical binding and **not** a property of
>    `globalThis`. The first implementation looked up `globalThis[name]`, passed every Node
>    test, and would have left continuity permanently dark in the browser. Caught by
>    simulating the real `index.html` load order; there is now a regression note in each
>    resolver.
> 3. **The eval harness reads `drama.level` / `drama.kind`.** The spec said `tier` /
>    `moment`; those fields do not exist. Reading the wrong pair silently collapsed every
>    stratum to `low`. (`commentary-style.md` §12 documents this exact naming split.)
>
> **Rules impact:** None. Everything here is presentation-only — it reads match data,
> computes derived numbers, and phrases words around them. Zero Firestore writes for §1,
> §2 and §4; §3 adds one *non-score-bearing* field (`members`) that already exists on the
> Team model and is simply unpopulated. Nothing touches scoring, validation, promise,
> blind, or win logic. Squarely in [`CLAUDE.md`](CLAUDE.md) §8 "implementation only":
> *"Adding new statistics derived from existing rule outputs."*
>
> **Constraints (inherited, unchanged):** free, no server, static GitHub Pages, degrades to
> today's UI when the AI is unavailable. §1–§3 are deterministic JS and need **no key at
> all**. Only §4 spends tokens, and it runs offline on a laptop, never in the browser.

## Why these four, together

The commentary layer that shipped (`ai-commentary.md` v1.2) knows exactly one thing: **the
match in front of it.** It can tell you that Gaurav/Akash just missed a 6-promise. It cannot
tell you that they have now done that in three straight matches, that this is the fourth
game of a Saturday night they have yet to win, or that the person who made the bid has now
lost with four different partners.

That is the difference between a scoreboard reading itself aloud and a commentator who has
called every game. The data to close the gap is **already in the archive** — 89 matches,
661 rounds, 15 months, 53 sessions — and no packet carries any of it.

| § | Feature | Needs a key? | Blocked on |
|---|---|---|---|
| §1 | **League memory** — rivalry history, rematch callbacks, era awareness | ❌ never | nothing |
| §2 | **Session arcs** — the night as a unit: who's up, who's on tilt | ❌ never | nothing |
| §3 | **Player identity** — people across rotating team names | ❌ never | **roster input (§3.1)** |
| §4 | **Eval harness** — replay history through the prompt, judge the output | ✅ offline only | nothing |

§4 is listed last but is the one that makes the other three *safe to tune*. Today there is
no way to know whether a prompt change helped.

---

## The data, verified

Measured against `db-dump/backup-2026-08-11_00-08-39` (89 matches, 15 teams, 661 rounds):

```
matches            89   (68 completed, 9 in_progress, 12 cancelled)
rounds            661
date span         2025-05-22 → 2026-08-10   (~15 months)
distinct sessions  54   (6h-shifted day; see §2.1)
  of which 2+ matches      18
  of which 2+ completed    14
  largest night             8 matches
distinct rivalries 13
  Gaurav/Akash ⚔ KorbaGang  39 completed   (2026-01-18 → 2026-08-10)
  AlphaStark   ⚔ SkySage     9 completed   (2025-05-24 → 2026-01-16)
team-slots        178
  with any members data  21  (12%)
  with none            157  (88%)
```

Two facts shape every decision below:

1. **This is one rivalry with a long tail.** Gaurav/Akash vs KorbaGang is 39 of 68
   completed matches. League memory is therefore mostly *rivalry* memory, and it is deep
   enough (39 games over 7 months) to support real callbacks.
2. **Player identity is not in the data.** The two teams carrying the league
   (`KorbaGang` 61 slots, `Gaurav/Akash` 55) both have `members: []`. See §3.1.

### What the archive does NOT have

Stated up front so no feature is specced on top of a number that does not exist:

- **No per-round timestamps.** `0 / 89` matches have any time on a round — only
  `match.date` exists. So "they took 20 minutes over that bid" is **uncomputable**, and
  nothing in this spec depends on intra-match timing.
- **No `history[]` content.** The field exists and is empty on every match sampled.
- **No player attribution per round.** Who bid, who played — not recorded, and §3 does
  **not** invent it. §3 resolves *teams to people*, never *rounds to people*.

---

## §1 League memory

### 1.1 What it is

A new pure module, `js/utils/leagueMemory.js`, that answers: **what has happened between
these two teams before, and what happened recently enough to be worth mentioning?**

`FactsEngine.factsPacket` today carries exactly one cross-match nugget — a head-to-head
W–L from `StatsUtils.headToHead`, plus a streak. That is a statistic, not a memory. A
memory is specific: *a date, a scoreline, an event*.

### 1.2 The four memory types

| Type | Question it answers | Example line it enables |
|---|---|---|
| **Rematch** | What happened the last time these two played? | "Rematch of Sunday's 506–156 hiding." |
| **Recent form** | What have these two done in the last N meetings? | "KorbaGang have taken four of the last five." |
| **Pattern** | Does a thing that just happened keep happening? | "Third match running they've collapsed after leading at the half." |
| **Era** | Where does this sit in the 15-month record? | "Their biggest win since January." |

### 1.3 The recency ladder (design decision)

Not all history is equally sayable. A callback to a match from May 2025 is trivia; a
callback to last night is comedy. So memories carry a **recency band**, and the packet
prefers the tightest one available:

```
same-session   → "you literally just lost this exact match"     (§2 handles these)
last-meeting   → "rematch of Sunday's 506–156"
last-5         → "they've taken four of the last five"
season         → "their 39th meeting this year"
all-time       → "biggest margin since the AlphaStark era"
```

Ranked, not exhaustive: **at most 2 memory nuggets** reach the packet, because the prompt
already caps output at 1–2 sentences and a model handed six facts writes a list.

### 1.4 API

```js
LeagueMemory.rivalry(team1Id, team2Id, matches, teams, options)
// → {
//     meetings: 39,
//     lastMeeting: { date, winner, score: {t1,t2}, margin, matchId },
//     recentForm: { window: 5, wins1: 1, wins2: 4 },
//     firstMeeting: '2026-01-18',
//     biggestMargin: { winner, margin, date },
//   } | null

LeagueMemory.patterns(team1Id, team2Id, matches, options)
// → [ { kind:'collapse-after-lead', team, count:3, window:3 }, … ]

LeagueMemory.nuggets(match, matches, teams, options)
// → ['Rematch of Sunday's 506–156.', 'KorbaGang have taken four of the last five.']
//   Ranked, recency-banded, ≤2. This is what factsPacket consumes.
```

Pure, DOM-free, network-free, `Date.now()`-free (an `options.now` is injected — same
discipline `SeasonDigest` already follows). Node-testable like `stats.js`.

### 1.5 Rules hygiene

Memory facts that quote a **scoreline as a record** (biggest margin, record total) filter
through `FactsEngine.isRuleConformantSide`, exactly as `ai-commentary.md` § *Legacy data*
already mandates — a legacy typo must not own "biggest ever". Facts that merely *count*
outcomes (meetings, form, streaks) read stored results unfiltered, because they describe
what actually happened at the table.

Cancelled matches are excluded from every memory type. `in_progress` matches count toward
"meetings" but never toward form or records.

---

## §2 Session arcs

### 2.1 What a session is

The app models matches. The table plays **nights**. 18 of 54 sessions contain more than one
match; one contains eight.

A session is a maximal run of matches separated by less than a gap threshold. Two candidate
definitions, and the decision:

| Definition | Behaviour | Verdict |
|---|---|---|
| Calendar day | Splits a 23:40 → 00:20 back-to-back into two "sessions" | ❌ wrong, and this league plays past midnight constantly |
| **6h-shifted day** | Day boundary moves to 06:00; post-midnight joins the evening before | ✅ **chosen** — yields 54 sessions, matches how the nights actually ran |
| Gap-based (e.g. >4h apart) | More "correct" in theory | ❌ needs per-match end times we do not have |

**Decision: 6h-shifted day**, i.e. `sessionKey = (date − 6h).toISOString().slice(0,10)`.
Simple, deterministic, and verified against the archive — the four largest sessions it
produces are all genuine single-night runs of the same two teams.

> **Timezone: solved, after it bit.** The first implementation applied the shift in UTC and
> the spec accepted the consequences. Against **live Firestore** that was wrong in a visible
> way: sessions were keyed in UTC but the cards under each header print a *local* date, so
> the Saturday-night games of 2026-08-02 (00:03 and 04:12 IST) keyed to `08-01` while
> rendering as `02/08/2026` — the same label as the genuinely separate Sunday-evening
> session. The key is now built from **local** date parts, and the header labels the night
> from that key rather than from its first match's date. Both are regression-tested, and
> the suite is verified across five timezones (IST, UTC, US East/West, NZ) so a
> local-clock assumption cannot pass in one zone and fail in another.

### 2.2 What it computes

New pure module `js/utils/sessionArc.js`:

```js
SessionArc.sessionsOf(matches, options)
// → [ { key:'2026-08-10', matches:[…], start, end, count } … ]  (chronological)

SessionArc.current(match, matches, options)
// → {
//     index: 4,               // this is the 4th match of the night
//     total: 4,
//     tally: { 'KorbaGang': 3, 'Gaurav/Akash': 0 },
//     winless: ['Gaurav/Akash'],       // played ≥2 tonight, won none
//     onTilt: [{ team:'Gaurav/Akash', losses:3 }],   // ≥3 straight losses tonight
//     rematchOf: matchId | null,       // immediately-preceding meeting, same pairing
//     isDecider: false,
//   } | null
```

`null` when the match is the first of its session — a one-match night has no arc, and the
commentator should not pretend otherwise.

### 2.3 The lines it unlocks

These are currently uncomputable and are the point of the feature:

- "Fourth match tonight and Gaurav/Akash still haven't won one."
- "That's three on the bounce — someone hide the cards."
- "Immediate rematch. They did not take that well."
- "Best of the night so far, and it's 1 a.m."

### 2.4 Tilt (definition)

`commentary-style.md` §14.3 calls tilt "the strongest behavioural signal in the data" but
scopes it within a match. Session tilt is the cross-match version: **≥3 consecutive losses
within one session.** It is a *tone* input, not a silence gate — same contract `dramaOf`
already has.

Roast discipline (`CLAUDE.md` §0): tilt is a fact about the cards, phrased as such. "Third
straight loss" is fair game; anything about the person's state of mind is not.

---

## §3 Player identity

### 3.1 The blocker, stated plainly

**88% of team-slots have no member data.** `KorbaGang` (61 slots) and `Gaurav/Akash` (55)
are both `members: []`. Nothing in the archive records who played. A name-parse recovers
the slash-style pairs (`Sky/K2` → Akash, k2) and *invents* the rest.

**Decision: a hand-authored roster map, supplied by the user, committed as data.** Not
inferred, not guessed. Until it is filled, §3 ships dark — the plumbing exists, the packet
carries nothing, and no line changes.

`js/data/rosters.js` — a plain window global, no build step, same pattern as
`js/data/seasonFacts.js`:

```js
window.ROSTERS = {
  // TEAM NAME (matched case-insensitively, trimmed)  →  canonical player names
  'KorbaGang':      ['?', '?'],   // ← 61 slots. REQUIRED.
  'Gaurav/Akash':   ['?', '?'],   // ← 55 slots. REQUIRED.
  'SkySage':        ['?', '?'],   // ← 11 slots
  'AlphaStark':     ['?', '?'],   // ← 10 slots
  'Alegeus stars':  ['?', '?'],   // ←  8 slots
  'K2-G':           ['Gaurav', 'Kritagya'],      // from members[]
  'Sky/K2':         ['Akash', 'k2'],             // from members[]
  'skybhola':       ['akash', 'anish'],          // from members[] (split needed)
  'Propellers':     ['Shreyans', 'Akash'],       // from members[] (split needed)
  'Gaurav/ Palash': ['Gaurav', 'Palash'],        // from members[] (split needed)
  'SageStark':      ['Gaurav', 'Aman'],          // from members[]
  'sagealpha':      ['aman', 'harshit'],         // from members[] (split needed)
  'Jake/sky':       ['?', '?'],                  // members[] is ['Jake/sky'] — unusable
  // 'Coke' / 'Sprite' — seed teams, excluded by SeasonDigest. No roster.
};
```

Canonicalisation: names are matched case-insensitively and trimmed, so `akash`, `Akash`
and ` Akash ` are one person. A `window.PLAYER_ALIASES` map handles the rest (`k2` →
`Kritagya`, if that is who k2 is — user decides).

### 3.2 What it computes

`js/utils/playerStats.js`:

```js
PlayerStats.identify(teamName)          // → ['Akash','Kritagya'] | null
PlayerStats.careerOf(player, matches, teams)
// → { matches, wins, losses, winRate, partners:[{name, matches, wins}],
//     bestPartner, worstPartner, teamsPlayedFor:[…] }
PlayerStats.nuggets(match, matches, teams)   // → ≤1 person-level nugget for the packet
```

### 3.3 The line it unlocks

> "Akash has now lost with four different partners."

That is the whole reason this feature exists. `CLAUDE.md` §0 is explicit that the audience
is four friends and the register is affectionate abuse — and a roast lands on a **person**,
not on a team label that changes every month.

**Guardrail, restated from `CLAUDE.md` §0:** roast the play, not the person. Person-level
facts are about *results* — wins, losses, partners, bids. Never about the human.

### 3.4 Scope limits (deliberate)

- **Teams → people only.** Rounds are not attributed to players; the data does not support
  it and this spec does not fake it.
- **No per-player skill rating.** `redesign.md` cut Elo unanimously ("one scoreboard, one
  truth"); a per-player rating is the same idea wearing a hat. Counts and rates only.
- **No new Firestore writes in v1.** The roster is a committed static file. Populating
  `Team.members` through the UI going forward is a separate, later change.

---

## §4 The eval harness

### 4.1 The problem

`commentary-style.md` §11 defines an evaluation rubric. **Nothing runs it.** There is no way
to answer:

- Does temperature 0.9 actually beat 0.7?
- Does the §8 anti-repetition change reduce repetition, or just move it?
- Does Hinglish land, or does it read as a translation?
- Do the §1–§3 nuggets above make lines better, or just longer?

Every prompt decision in this repo so far has been made by reading a handful of outputs.
With 661 rounds of real history available, that is a choice, not a constraint.

### 4.2 What it is

`scripts/commentary-eval.js` — an **offline Node script**, in the mould of the existing
`scripts/season-facts.js`. Never runs in the browser. Never on a user's device.

```
Pipeline:
  1. Load teams + matches from the newest db-dump backup
  2. Sample N moments from the archive (stratified — see 4.3)
  3. For each moment: build the real packet via FactsEngine.factsPacket
                      + the new §1/§2/§3 nuggets
  4. Generate a line through the REAL GroqService path, per variant
  5. Judge each line with an LLM judge against commentary-style.md §11
  6. Write scratch/commentary-eval/<timestamp>.json + a markdown summary
```

Usage mirrors `season-facts.js`:

```
node scripts/commentary-eval.js                       # default sample, current prompt
node scripts/commentary-eval.js --n 60                # sample size
node scripts/commentary-eval.js --variants a,b        # A/B two prompt configs
node scripts/commentary-eval.js --no-judge            # generate only, eyeball it
node scripts/commentary-eval.js --seed 42             # reproducible sample
```

### 4.3 Stratified sampling (why not random)

A random sample of 661 rounds is ~80% ordinary rounds, and ordinary rounds are exactly
where commentary quality matters least. The sampler therefore **stratifies by moment type**,
using the classifier that already exists (`FactsEngine.dramaOf`):

| Stratum | Share | Why |
|---|---|---|
| `match-start` | 15% | Two-sentence contract; names both teams |
| `match-end` | 15% | Winner + roast; the hardest beat |
| drama `high` | 25% | Blinds, lead changes, match point |
| drama `medium` | 20% | Over-extension, big swing |
| drama `low` | 25% | The repetition risk lives here |

Sampling is **seeded** so two variants see the identical moment set — otherwise an A/B is
comparing samples, not prompts.

### 4.4 The judge

A second LLM call, given the packet, the generated line, and the §11 rubric. It scores:

| Dimension | Scale | Auto-checkable? |
|---|---|---|
| **Factual** — every number appears in the packet | pass/fail | ✅ **deterministic, not the judge** |
| Funny | 1–5 | judge |
| Varied — vs the other lines in the run | 1–5 | judge + deterministic n-gram overlap |
| In-voice — matches the §2 persona | 1–5 | judge |
| Speakable — reads aloud cleanly | 1–5 | judge |
| Length — within contract | pass/fail | ✅ deterministic |

**Factual grounding is never left to the judge.** It reuses the same
number-extraction check `scripts/season-facts.js` already has (`verifyLine`): pull every
numeral from the line, assert each appears in the packet. A judge that *opines* on
hallucination is a worse detector than five lines of regex, and the repo has already
committed to that approach once.

> **Judge caveat, stated openly.** An LLM judging "is this funny" is a weak signal in
> absolute terms. It is used **comparatively** — variant A vs variant B on an identical
> seeded sample — where it is far more reliable than a single-run absolute score. The
> harness reports deltas, never a "commentary quality: 3.8/5" headline. A `--human` mode
> dumps an unlabelled A/B sheet for the four friends to score themselves, which remains
> the only ground truth that matters.

### 4.5 Cost

Groq free tier, ~30 req/min. A 60-moment × 2-variant run with judging is
`60 × 2 × 2 = 240` calls ≈ 8 minutes wall-clock at the rate limit, well inside daily
token limits. Run manually, never in CI (`redesign.md` #42's CI gate is for the Jest
suite, which must stay key-free and offline).

### 4.6 Output

Committed nowhere by default — writes to the scratchpad. A run produces:

```
Variant A (temp 0.9, current prompt)     Variant B (temp 0.7, +anti-repetition)
  factual        60/60  ✓                  factual        60/60  ✓
  length         58/60                     length         60/60
  funny          3.4                       funny          3.2
  varied         2.1  ← repetition          varied         4.0
  in-voice       3.8                       in-voice       3.9
  speakable      4.1                       speakable      4.2
  repeated openings: 14 ("Oh my", ×6)      repeated openings: 2
```

That table is the deliverable. It is what turns "§8 anti-repetition" from an opinion into
a measurement.

---

## Wiring: how these reach the commentary

All four features converge on one function. `FactsEngine.factsPacket` gains **at most three
new optional fields**, and the total nugget budget stays capped:

```js
{
  kind, matchId, teams, score, roundsPlayed, lastRound, winProb, pressure,
  nuggets: [...],            // ≤3, unchanged

  // NEW — all optional, all omitted when unavailable
  memory:  ['Rematch of Sunday's 506–156.'],           // §1, ≤2
  session: { index: 4, total: 4, winless: ['Gaurav/Akash'] },   // §2
  players: ['Akash has now lost with four different partners.'], // §3, ≤1
}
```

**Budget discipline.** The prompt caps output at 1–2 sentences. Handing the model eight
facts produces a list, not a line. So the packet enforces a **hard ceiling of 4 total
narrative facts** (`nuggets` + `memory` + `players`), ranked by the §1.3 recency ladder,
tightest band first. §4 exists precisely to verify this ceiling is right.

`session` is passed as structured data rather than prose because the prompt uses it for
*framing* ("fourth match tonight") rather than as a quotable statistic.

### Prompt changes

`SPOKEN_PROMPT` and `SYSTEM_PROMPT` gain one clause each, telling the model that `memory`
and `players` entries are **quotable history** and that `session` is **framing**. The
existing hard rule is unchanged and still governs: *use ONLY the numbers and facts
provided; never invent statistics, records, or events.*

---

## File plan

| File | Role | Status |
|---|---|---|
| `js/utils/leagueMemory.js` | §1. Pure. Rivalry history, recency ladder, patterns. | new |
| `js/utils/sessionArc.js` | §2. Pure. Session grouping, tally, tilt, rematch detection. | new |
| `js/utils/playerStats.js` | §3. Pure. Team→people resolution, career + partner stats. | new |
| `js/data/rosters.js` | §3. Hand-authored roster map + aliases. **User-supplied.** | new |
| `scripts/commentary-eval.js` | §4. Offline harness: sample → generate → judge → report. | new |
| `js/utils/factsEngine.js` | Packet gains `memory` / `session` / `players`; 4-fact ceiling. | edit |
| `js/services/groqService.js` | Two prompt clauses. No behavioural change. | edit |
| `index.html` | Script tags for the three new modules + rosters. | edit |
| `tests/league-memory.test.js` | Recency banding, rules-hygiene filter, cancelled exclusion. | new |
| `tests/session-arc.test.js` | 6h shift incl. the midnight case, tally, tilt, rematch. | new |
| `tests/player-stats.test.js` | Canonicalisation, partner counting, missing-roster safety. | new |
| `tests/facts-packet-continuity.test.js` | Fact ceiling, omission when unavailable. | new |
| `package.json` | `commentary-eval` / `commentary-eval:quick` scripts. | edit |

### Verified against the archive

Measured on `db-dump/backup-2026-08-11_00-08-39` after the build:

```
sessions                 54  (spec predicted 54)   ✓
  multi-match            18  (spec predicted 18)   ✓
  largest night           8  (spec predicted  8)   ✓
midnight rule            23:40 and 00:20 group together  ✓
rivalry depth            Gaurav/Akash v KorbaGang: 39 meetings  ✓
packets carrying memory  78 / 89
packets carrying session 35 / 89
packets carrying players 31 / 89   (from the 7 rosters recoverable today)
max narrative facts       4 / 89 packets — ceiling never breached  ✓
eval moments enumerated 707, stratified across all 5 strata  ✓
```

Test suite: **66 new tests**, all passing (23 session-arc, 17 league-memory,
16 player-stats, 10 packet-continuity). Full run: 839 passing across 34 suites.
Two failures in `ghost-*` suites are pre-existing, untracked work on a separate
feature and reference none of these modules.

No Firestore changes. No new dependencies. No build step. Consistent with every prior
feature in this repo.

## Build order

1. **§2 session arcs** — smallest, self-contained, needs no input from anyone, and unlocks
   the funniest line available tonight.
2. **§4 eval harness** — before §1 and §3 land, so their effect on line quality is
   *measured* rather than asserted.
3. **§1 league memory** — the largest deterministic piece; measurable the day it lands.
4. **§3 player identity** — plumbing anytime; goes live the moment the roster is filled.

## Consumers beyond the LLM

The three data modules are pure functions returning structured data; the facts
packet was simply the first customer. Shipped consumers:

| Consumer | Uses | Notes |
|---|---|---|
| `FactsEngine.factsPacket` | all three | The original target (§ Wiring). |
| **Matches list — session grouping** | `SessionArc.groupForDisplay` / `summarise` | Groups the list by night with a header per session. |

### Session grouping (built)

`refreshMatchesList` wraps each night's cards in a `.session-group` under a
`.session-header` reading *date · N matches · the night's story*. Story
priority: **sweep** → **winless** → **fixture scoreline** → **played/winners**.
`SessionArc` is treated as optional — if it fails to load, the list renders
exactly as it did before.

> **A fabricated scoreline, caught in review.** The first version rendered the
> night's top two standings as `A x–y B`. On the real archive that produced
> **"Coke 1–1 KorbaGang"** for 2026-08-09 — a head-to-head between two teams
> that never played each other and merely won separate games that evening
> (Sprite v Coke, Gaurav/Akash v KorbaGang). An X–Y scoreline is only honest
> when the whole night was one repeated fixture, so `summarise` now computes
> `singleFixture` and the header falls back to "2 played · 2 winners"
> otherwise. Regression-tested in `tests/session-arc.test.js`.

Natural next consumers, unbuilt: a **rivalry page** (`redesign.md` #10 — 
`LeagueMemory.rivalry` + `patterns` is essentially its whole data layer), the
**team-page H2H card** (`app.js` renders W/L only; `rivalry()` adds last result,
record margin, first meeting), and **player pages** (blocked on the roster).

## Open questions (decide during build)

- **Fact ceiling of 4** — is it 3? §4 answers this empirically; 4 is the starting guess.
- Should `session` framing also reach the **on-screen** pundit line, or stay spoken-only?
  (Leaning spoken-only: "fourth match tonight" is a broadcast line, not a scoreboard line.)
- Does a rematch callback need the *date* ("Sunday's") when the session already implies it?
  Probably not within a session; yes across sessions.
- `Jake/sky` has `members: ['Jake/sky']` — one person or two? Roster input decides.
- Do cancelled matches count toward "matches tonight"? (Leaning yes for `total`, no for
  `tally` — an abandoned game still happened at the table.)

## Out of scope (deliberately)

- Per-round player attribution — the data does not support it.
- Per-player ratings or a second leaderboard — `redesign.md` cut Elo unanimously.
- Any LLM involvement in scoring, validation, or data entry — presentation only, forever.
- Running the eval harness in CI — it needs a key and a network; the Jest gate must not.
- Rewriting legacy rounds — `ai-commentary.md`'s records-hygiene decision stands.
- Populating `Team.members` through the admin UI — separate change, later.
