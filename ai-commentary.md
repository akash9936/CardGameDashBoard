# AI Commentary — Live Pundit, Fun Facts, Win Meter & Spoken Broadcast

> **Status:** Built, **v1.2**. v1 shipped the on-screen layers (pundit line, win meter, facts
> ticker); v1.1 added spoken commentary for dramatic moments only; **v1.2 narrates every
> round** plus a match-start opening and a winner/loser finale, in a female commentary voice.
> Companion to the existing broadcast layer
> (`js/utils/narrate.js` + `js/components/broadcastStrip.js`); this feature sits *on top of*
> it and never replaces it.
>
> **Rules impact:** None, structurally so. Everything here is **presentation-only** — it
> reads match data, computes derived numbers, and phrases words around them. It writes
> nothing to Firestore, holds no score-bearing state, and never touches scoring, validation,
> promise, blind, or win logic. The locked rules in [`CLAUDE.md`](CLAUDE.md) are enforced
> where they always were (`Match.computeScore`, the round form). This is squarely in the
> §8 "implementation only" bucket: *"Adding new statistics derived from existing rule
> outputs."*
>
> **Constraints (locked by product decision):** must be **free**, must run with
> **no server** (static GitHub Pages, as today), and must **degrade to today's UI** when the
> AI is unavailable. These rule out any key-holding proxy, Cloud Function, or paid tier.

## The core principle: facts are computed, words are generated

An LLM asked to *compute* statistics will get arithmetic wrong, drift from the locked
scoring rules, and hallucinate records that never happened. So the split is absolute:

- **The facts engine (deterministic JS)** computes every number: scores, streaks, records,
  win probability, comebacks. It is a pure module in the mold of `js/utils/stats.js`,
  Node-testable, no DOM, no network.
- **The LLM (Groq) is a wordsmith only.** It receives a compact JSON "facts packet" of
  pre-computed numbers and returns 1–2 punchy commentator sentences. The prompt forbids
  inventing numbers; every figure shown in the UI comes from the facts engine, never from
  the model.
- **No LLM output is ever parsed for data.** The model's text is displayed verbatim
  (escaped) and thrown away. A hallucination can at worst produce an odd sentence — it can
  never corrupt a stat, a score, or the UI's numbers.

Two of the three surfaces need no LLM at all and work for everyone, always:

| Layer | Engine | Needs Groq key? |
|---|---|---|
| **Win-probability meter** on live matches | Monte Carlo simulation from historical round scores | ❌ never |
| **Fun-facts ticker** on the Statistics page | computed records + streaks from match history | ❌ never |
| **AI pundit line** on live/completed match cards | facts packet → Groq → one flavorful line | ✅ optional |

## Security posture (decided)

**Bring-your-own Groq key, stored in `localStorage`.** The site is static; a key shipped in
`js/` would be public to the world, and *no server* is locked — so there is no place to hide
a shared key. Instead:

- Whoever wants AI commentary creates a **free** Groq key (console.groq.com, ~30 seconds)
  and pastes it once into the ⚙️ AI settings dialog. It is stored in `localStorage` on that
  device only — never in the repo, never in Firestore, never sent anywhere except
  `api.groq.com` over HTTPS.
- Groq's API is CORS-enabled, so the browser calls it directly. No proxy, no worker,
  no function.
- **No key → the feature is invisible.** The broadcast strip shows exactly what it shows
  today (the rule-based `Narrate` lines); the win meter and facts ticker still work because
  they never needed the key.
- Same accepted posture as Ghost Seat: this is an office friend group's dashboard. The
  worst case for a leaked personal key is revoking a free key and making another. No
  further security work is in scope.

## What it looks like

### 1. AI pundit line (broadcast strip upgrade)

The existing strip keeps its three rule-based lines (WHAT / WHY / NEXT — instant,
deterministic, offline-safe). When a Groq key is present, a fourth line **fades in when the
response arrives** (~200–500 ms on Groq):

```
▌ Alpha missed their 6 promise — only took 4 (−60).        WHAT
▌ Bravo leads by 210 — a commanding gap.                   WHY
▌ Without a blind, Alpha stays behind.                     NEXT
▌ ✨ Three failed promises in a row — Alpha are bidding    AI
▌    like the cards owe them money.
```

- Refreshes only when the round count changes (one call per round, not per render).
- Completed matches get a one-line recap, generated once and cached in `localStorage`
  keyed by match id — reloading the page never re-spends a call on a finished match.
- Any failure (timeout, rate limit, bad key, offline) → the line simply doesn't appear.
  Nothing blocks, nothing errors on-screen.

### 2. Win-probability meter (live matches, no LLM)

On every `in_progress` match card, under the broadcast strip:

```
  Alpha  ████████████░░░░░░░  Bravo
         67%            33%
```

Computed by **Monte Carlo simulation** (§ Win probability model below) and recomputed on
every Firestore `onSnapshot` refresh — it visibly swings after a big round, which is the
fun. Colored with each team's existing `StatsUtils.teamColor`.

### 3. Fun-facts ticker (Statistics page, no LLM)

A rotating strip near the top of the Stats section, cycling through computed nuggets:

```
  💡 Longest match ever: Alpha vs Bravo went 14 rounds (Jun 3).
  💡 Charlie have hit 9 straight promises — best active streak.
  💡 Biggest comeback: Delta trailed by 187 and won (May 21).
  💡 Blind calls land 62% of the time this season (+1,540 net).
```

Every fact is computed from the full match history (89 matches and counting). Facts about
the *current live match* rank first when one is running ("this is already the longest match
of the season"). v1 shows the computed phrasing for everyone; LLM re-phrasing of ticker
facts (same numbers, better words) is deferred to v2 — see *Out of scope*.

## Design decisions (settled)

| Question | Decision |
|---|---|
| Where does the LLM run | **Groq**, called directly from the browser (CORS). OpenAI-compatible `/chat/completions`. Chosen for latency (~200–500 ms) — commentary must feel live. |
| API key | **BYO, per device, `localStorage`.** No shared key exists anywhere. Settings dialog to paste/clear it. |
| Model | `llama-3.3-70b-versatile` as the default, a single const in `groqService.js`. Not user-facing. |
| Can the LLM compute anything | **Never.** Facts packet in → prose out. Output displayed verbatim (escaped), never parsed, never stored as data. |
| What if Groq is down / no key | Rule-based `Narrate` lines stand alone, win meter + ticker unaffected. The AI layer is a pure progressive enhancement. |
| Calls per match | ~1 per round (~9–15 per match) + 1 recap. Trivially inside Groq's free tier. In-flight guard: one request per match at a time. |
| Caching | Live line: in-memory, keyed `matchId:roundCount`. Recap: `localStorage`, keyed `matchId` (finished matches never change). Ticker re-phrase: in-memory per fact per session. |
| Win probability | **Deterministic Monte Carlo in JS** — never the LLM. The LLM may *mention* the computed % but the number on screen always comes from the simulation. |
| Firestore | **Zero writes, zero schema changes, zero rules changes.** Reads only what the UI already reads. |
| Prompt language | English, commentator persona, hard cap ~2 sentences, "use only the numbers provided; do not invent statistics or events". |
| XSS | LLM output and team names are **escaped** before insertion, same as the strip does today. |

## Win probability model (deterministic)

For an in-progress match at score *(s1, s2)*:

1. Build each team's **round-score pool**: every per-round score that team has ever posted,
   across all completed and in-progress matches (their side of `match.rounds[].score`).
   A team with fewer than 20 historical rounds gets its pool topped up from the
   **global pool** (all round scores by anyone) so new teams don't produce degenerate odds.
2. Simulate the rest of the match **N = 2,000 times**: each simulated round draws one
   sample from each team's pool, adds to the running totals, and stops when either total
   reaches ≥ 500 — applying the locked tie rules exactly (both ≥ 500 in the same round →
   higher total wins; exact tie → team1, per `CLAUDE.md` §2/§5).
3. A safety cap of 200 simulated rounds per run guards against pathological pools
   (both teams net-negative); a capped run awards the current leader, team1 on a tie.
4. `P(team1) = wins1 / N`.

Properties: no draws (mirrors the rules), reflects each team's actual scoring
distribution including their blind habits and failure rates, and runs in ~a millisecond —
fine to recompute on every snapshot. The RNG is injectable so tests run seeded and
deterministic.

Pre-match (pending) odds are the same simulation from 0–0 — used by the ticker
("history gives Alpha a 58% edge tonight"), not shown on pending cards in v1.

## The facts packet (what the LLM sees)

One compact JSON object, built by the facts engine — numbers only, all pre-computed:

```js
{
  kind: 'live',                    // 'live' | 'recap'
  teams: { t1: 'Alpha', t2: 'Bravo' },
  score: { t1: 373, t2: 445 },
  roundsPlayed: 9,
  pressure: 'critical',            // Narrate.pressureState
  lastRound: {                     // both sides, promise/actual/score/blind
    t1: { promise: 6, actual: 4, score: -60, blind: false },
    t2: { promise: 5, actual: 9, score: 54,  blind: false },
  },
  winProb: { t1: 0.33, t2: 0.67 }, // from the Monte Carlo, not for the LLM to compute
  nuggets: [                       // 0–3 most interesting computed facts, ranked
    'Alpha have missed 3 promises in a row',
    'Bravo lead 5-2 on head-to-head this season',
  ],
}
```

System prompt (fixed, in `groqService.js`): commentator persona; the scoring rules
summarised in three lines *so the model understands what a blind or an over-extension
means*; then the contract — *"Write 1–2 short, punchy sentences of live commentary. Use
ONLY the numbers and facts provided. Never invent statistics, records, or events. No
markdown, no quotes, no preamble."* `temperature` ~0.8 (it's flavor text; variety is the
point), `max_tokens` 90.

## Fun-facts catalogue (v1, all computed)

From full history: **longest / shortest match** (rounds), **highest single-round team
score**, **record final score**, **closest finish** (winner margin), **biggest comeback**
(largest deficit later overcome by the eventual winner, via cumulative series),
**blind economy** (calls, hit rate, net points — `StatsUtils.blindEconomy` exists),
**best active win streak** (`StatsUtils.currentStreak`), **longest promise-kept streak**
(consecutive rounds a team scored positive), **most one-sided rivalry**
(`StatsUtils.headToHeadMatrix`).

When a live match is running, live-aware facts outrank the archive: *"already the longest
match of the season"*, *"Bravo one blind away from the biggest comeback ever recorded"*.
Each fact carries an interest weight; the ticker shows the top ~8, rotating.

## Spoken commentary — the full broadcast (v1.2)

The table laptop becomes a commentator. It speaks the **opening line** when a match starts,
**every round** as it is submitted, and a **finale** that glorifies the winner and teases the
loser.

**Locked product decisions:**

- **Every round is narrated.** A match is at most ~12 rounds, so a running commentary is the
  point — not an occasional interjection. Drama level no longer decides *whether* to speak,
  only *how*.
- **Three moments beyond the rounds**: match start (scene-setting from head-to-head, streaks
  and pre-match odds), and match end (winner glorified, loser roasted).
- **Funny, but never made up.** Comedy about real numbers; every figure comes from the facts
  engine.
- **The roast stays affectionate.** These are colleagues — teasing about the cards, never
  personal. Product decision; the prompt enforces it.
- **Female voice, commentary delivery.**
- **Off by default**, one 🔊 toggle.

> **v1.1 was dramatic-moments-only** — a filter plus a frequency guard held it to ~3 lines a
> match. That was reversed by product decision: the table wants continuous commentary. The
> drama detection survives intact and now drives *tone* instead of *silence*. The tuning
> record below is kept because the thresholds still classify each moment.

### Tone tiers

`FactsEngine.dramaOf` classifies every round; `AudioCommentary.PROSODY` maps the tier to
delivery. Nothing is ever silent.

| Tier | When | Delivery (rate / pitch) |
|---|---|---|
| `finale` | match start, match won | 1.02 / 1.12 — occasion |
| `high` | blind late or in a close match, lead change, match point, record-comeback watch | 1.12 / 1.18 — excited |
| `medium` | blind that did not swing much, over-extension, big swing, near-miss that hurt | 1.06 / 1.08 |
| `low` | ordinary round — both sides simply made or missed their promise | 1.0 / 1.0 — matter-of-fact |

### Voice selection

Voice availability is OS-dependent, so `pickVoice()` ranks by name against the voices macOS,
Windows, Android and iOS actually ship (Samantha, Karen, Moira, Zira, Hazel, Google UK
English Female…), preferring English voices, then any voice whose metadata says female, then
the default. Resolved once per session and cached; re-resolved if the synth is swapped.

### What the voice says

Each moment carries the numbers a commentator would use — **risk and chance**, not just the
result: what was risked, what it changed, where the match stands, the win-probability swing,
and historical context ("their 4th blind tonight; they've hit 3").

With a Groq key those facts go through the `spoken` prompt mode, which is tuned per moment:
one sentence for rounds, **two for match start and match end** (the opening needs both team
names; the finale needs the win *and* the roast — a one-sentence cap kept truncating the
second beat). Without a key, hand-written templates speak the same facts, and the finale
template always carries a glory fact and a roast fact.

### How it speaks

**Web Speech API** (`speechSynthesis`) — free, no key, no network, offline. Rejected: Groq
PlayAI TTS (better voice, ~1s latency and a network dependency for something that must feel
instant) and ElevenLabs (second key, real cost).

Rules that keep it well-behaved:

- **Speak only on a genuinely new round.** Keyed on `matchId:roundCount`; re-renders,
  reloads and snapshot echoes never re-speak. Match start is keyed separately and fires once.
- **`cancel()` before every `speak()`** so two quick rounds never overlap.
- **Browsers block audio until a user gesture** — the toggle click is that gesture.
- **The LLM line has a 2.5s deadline**; past it the template speaks. Audio never waits on the
  network.
- Toggle state in `localStorage` (`aiCommentary.audio`), per device.

### Speakable text

Lines are read aloud, so the templates avoid what sounds wrong: negative totals are spoken
("minus 280"), possessives handle names ending in s ("Alegeus stars'"), "an 8 promise" vs
"a 5 promise", singular/plural rounds, sentence joins normalise to one full stop, and LLM
newlines are collapsed (they read as a stumble).

### Drama classification tuning (retained from v1.1)

The thresholds were tuned by replaying **283 real rounds** (30 completed matches). They no
longer gate speech — they assign the tone tier:

- A blind is `high` only when consequential: late (someone ≥ 380), close (within 60), or
  match-deciding. Otherwise `medium`. This league calls blinds constantly (351 in the season).
- Lead change is `high` at a ≥ 60-point new gap or late in the match, else `medium`.
- Near-miss is `medium` on a promise of 8+ or in a close/late match, else `low`.
- Big swing needs ≥ 180; record-comeback watch fires on the round that crosses the record.

### Listener controls (in-app panel)

The 🎙️ AI button in the Matches header opens one dialog holding everything: an on/off
switch, the four voice controls, live previews, and the Groq key field.

| Control | Options | Effect |
|---|---|---|
| **Language** | every language the device has a voice for (23 on this Mac, incl. Hindi, Tamil, Telugu, Bengali, Kannada) | picks the voice pool **and** the language the LLM writes in |
| **Voice** | every voice in that language, natural ones first | `Auto` picks a female voice; an explicit choice always wins |
| **Speed** | 0.7×–1.4× | multiplies the per-moment rate |
| **Mood** | Hype / Classic / Sarcastic / Calm | changes prosody **and** the LLM's attitude |

Two previews: **Preview** speaks a sample line in the chosen language, and **Preview a blind
call** runs a real moment through the real path (template or LLM) so what you hear is what a
match will sound like. Every control previews on change — the settings are audible, not
imagined.

Delivery is `moment tone × mood × speed`, clamped to the Web Speech legal range (0.5–2) so no
combination can produce an unusable utterance.

**Novelty voices.** macOS ships joke voices (Bubbles, Trinoids, Bad News…). They stay
selectable — someone will want "Bad News" for a losing streak — but sort last and never win
the auto-pick.

### Non-English languages need a key (decided)

The offline templates in `FactsEngine` are **English only**. Writing and maintaining them in
23 languages is not worth it, so instead:

- Non-English languages are **listed but flagged** ("Hindi (1) — needs Groq key"), and the
  panel explains why when one is selected without a key.
- Without a key in a non-English language, moments are **skipped** (`language-unavailable`)
  rather than spoken. A native voice reading an English sentence is worse than silence.
- With a key, the LLM writes in that language and it works end to end.

**Script guard.** A synthesiser pronounces by script, so romanised Hindi ("blind call kiya")
read by a Hindi voice comes out with English phonetics. Testing against Groq showed the model
obeys "use the native script" for Tamil but persistently romanises Hindi, whatever the
prompt. So output is **verified, not trusted**: `usesExpectedScript()` checks the Unicode
range for Indic/Cyrillic/Arabic/CJK languages and rejects a mismatched line, which then falls
through to the skip above. Latin-script languages are not checked.

### Data model addition

```
localStorage
  aiCommentary.audio            // '1' | absent — off by default
  aiCommentary.audioPrefs       // { lang, voiceURI, speed, mood }

in-memory (per session)
  spokenFor:  Set matchId:roundCount   // never speak the same round twice
  startedFor: Set start:matchId        // opening line fires once
```

No Firestore changes; audio is a pure client-side reaction to data the app already loads.

## Legacy data: records hygiene (decided)

An audit of the 89-match history against `Match.computeScore` found **185 of ~1,800
round-sides** whose stored score does not match the locked rules. They fall in three
buckets:

| Bucket | Count | What it is |
|---|---|---|
| Unflagged legacy blinds | 141 | Promise 7 scoring ±140/−70 with `blind: false` — the score is exactly right *for a blind*, only the flag predates the field. `StatsUtils.isBlindSide` already infers these. **Not a violation.** |
| Old bonus variant | 15 | Off by ≤ 5 (e.g. promise 7 / actual 7 stored as 72, rules say 70). |
| **Rule-impossible** | **29** | Scores no reading of §4 can produce: a **+160**, several `140 + extras` blinds (the rules pay a flat 140), doubled **−140** blind penalties from an old house rule, and assorted arithmetic slips. |

The cause is historical, not a live bug: `Match.addRound` still accepts explicit score
arguments (`js/models/Match.js:61`), and the old round form let scores be typed by hand.
The current form derives every score from the locked rules, so new rounds cannot do this.

**Decision: nothing is rewritten.** History stays as played — correcting the 29 rounds
would shift match totals and could flip past winners, which is a league-history decision,
not a code one. Instead, **record-style facts filter through `isRuleConformantSide`**:

- Affected facts: *biggest single round*, *record total*, *closest finish*, *biggest
  comeback*. A legacy typo must not own "biggest ever".
- Unaffected: everything that sums or averages real play — leaderboard, totals, blind
  economy, promise accuracy, win-probability pools. Those keep reading stored scores,
  because they describe what actually happened at the table.
- 52 of 68 completed matches are fully conformant — an ample record pool. If a filter ever
  left *nothing*, records fall back to the unfiltered set rather than going silent.

Effect on real data: the biggest-single-round record reads **+140** (a legitimate blind)
instead of the impossible +160.

## Cost & limits (all free tier)

| Resource | Usage | Limit | Verdict |
|---|---|---|---|
| Groq API | ~15 calls/match, ≤ 90 output tokens each | free tier: ~30 req/min, generous daily tokens | ✅ orders of magnitude of headroom |
| Firestore | zero additional reads/writes (uses data already loaded) | — | ✅ nothing changes |
| Hosting | 3 new JS files + CSS, no build step | GitHub Pages | ✅ |
| Monte Carlo | ~2,000 × ≤ 200 additions per live card per snapshot | main thread | ✅ ~1 ms |

## Failure modes

| Failure | Behaviour |
|---|---|
| No key configured | AI layer invisible; win meter + ticker + Narrate all still work. |
| Request timeout (4 s `AbortController`) | Pundit line skipped for that round; retried on the next round change. |
| 401 (bad/revoked key) | Pundit line skipped; settings dialog shows "key rejected" the next time it's opened. No nagging. |
| 429 (rate limit) | Skipped for that round. At this call volume it will not recur. |
| Groq deprecates the model | Single const to update; on 4xx model errors the service quietly stops for the session. |
| LLM returns junk / too long | Truncated to ~200 chars, escaped, displayed. Junk words can't corrupt anything — no output is parsed. |

## Data model

**No Firestore changes.** Everything client-side:

```
localStorage
  aiCommentary.groqKey            // the user's own key, this device only
  aiCommentary.recaps             // { [matchId]: "recap line" } — finished matches only,
                                  // pruned to the 50 most recent

in-memory (per session)
  liveLines: Map matchId:roundCount → line     // one Groq call per round
  inflight:  Set matchId                        // one request per match at a time
```

## File plan

| File | Role |
|---|---|
| `js/utils/factsEngine.js` | **Pure.** Fun-facts catalogue, win probability (Monte Carlo, injectable RNG), facts-packet builder. No DOM, no network — tested in Node like `stats.js`. |
| `js/services/groqService.js` | Key management, the single fetch path (timeout, caching, in-flight guard), prompt constants. Fetch is injectable for tests. |
| `js/components/aiCommentary.js` | DOM layer: decorates rendered broadcast strips with the pundit line, renders the win meter and the ticker, owns the ⚙️ AI settings dialog. |
| `css/styles.css` | Pundit line, win meter, ticker, settings dialog styles (appended). |
| `js/app.js` | Three hook calls: after `refreshMatchesList()` (decorate strips + meters), in `refreshStats()` (ticker), one settings button. |
| `index.html` | Script tags + ticker container. |
| `tests/facts-engine.test.js` | Seeded-RNG win-prob tests (incl. tie rules), facts correctness against hand-built histories. |
| `tests/groq-service-logic.test.js` | Mock-fetch: packet → request shape, caching, timeout/error fallbacks, no call without a key. |

## Out of scope (deliberately)

- Any server, proxy, worker, or shared key.
- LLM anywhere in scoring, validation, or data entry — presentation only, forever.
- Voice/audio commentary (text only in v1).
- Pre-match hype cards and long-form match reports — natural v2 on top of the same facts
  packet, once the v1 surfaces prove fun.
- LLM re-phrasing of ticker facts — v2; the computed phrasing is already decent and the
  ticker must stay key-free.
- Per-viewer personalisation, favourite teams, notification pushes.
- Showing win probability on pending matches (computed but not surfaced in v1).

## Rough build estimate

| Piece | Effort |
|---|---|
| Facts engine: catalogue + Monte Carlo + packet builder | 1 day |
| Groq service: key mgmt, fetch, cache, guards | 0.5 day |
| UI: pundit decoration, win meter, ticker, settings dialog, CSS | 1 day |
| App wiring + manual test against the live dump | 0.5 day |
| Jest suites | 0.5 day |

**~3.5 days.** No prerequisites — live listeners (`firebaseService.js:99,108`) and the
broadcast layer already exist.

## Open questions (decide during build)

- Ticker cadence: rotate every ~7 s, or advance on click only? (Start with 7 s + pause on
  hover.)
- Should the recap line also appear inside the match-detail modal, or only on the card?
- When both a live match and the archive produce facts, how many live facts may crowd the
  ticker before it feels repetitive? (Start: max 3 of 8.)
