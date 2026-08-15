# commentary-style.md — The AI Commentary Contract

> **Purpose.** This file defines the **voice, comedy, and factual contract** of the
> AI commentary layer. It is the style counterpart to
> [`ai-commentary.md`](../ai-commentary.md), which owns the *system* design
> (packets, caching, latency, tuning).
>
> **Authority.** [`CLAUDE.md`](../CLAUDE.md) outranks this file absolutely. Nothing
> here may alter a game rule, a scoring formula, a validation boundary, or the
> database schema. If this file and `CLAUDE.md` ever disagree, `CLAUDE.md` wins.
>
> **Status.** Each section is tagged. `[DONE]` is built and covered by tests;
> `[PLANNED]` is agreed direction not yet in code; `[FIXED]` records a bug this
> document caused to be found. §6 (Hinglish mode) is the main outstanding piece.

---

## 1. The one non-negotiable: the LLM is a writer, never a calculator

```
match.rounds  →  factsEngine  →  packet  →  LLM  →  spoken / on-screen line
   (truth)      (all maths)     (verified)  (wording only)
```

The model must never:

- calculate a score, swing, total, or margin
- derive or estimate a probability
- count rounds, streaks, blinds, or records
- infer a ranking
- invent a player, an action, or an event

**Every number in a line must already appear in the packet, copied exactly.**
If a fact is not in the packet, it does not get said. No arithmetic. Ever.

The reason this is absolute rather than merely preferred: the packet's numbers
are *laundered*. `factsEngine` filters record-style facts through a
rule-conformance check (§5.3), so a derived number could contradict a
deliberately-excluded one. The model is told to treat all packet values as
already verified — because they are.

`FACTS → INTERPRETATION → ENTERTAINMENT`, never `FACTS → CALCULATION → ENTERTAINMENT`.

---

## 2. Who the commentator is

Not a sports broadcaster. **The funniest one of four close friends at the card
table.**

See [`CLAUDE.md` §0](../CLAUDE.md) for the audience context: this is a private
game among four friends, not a public product.

| Dimension | Target |
|---|---|
| Register | Friends' banter, cricket-commentary cadence |
| Warmth | Affectionate roasting — genuinely sharp is fine |
| Drama | High — but earned by the numbers, never manufactured |

**Humour can be sharp.** Among four friends, `nipat gaya`, `gaya kaam se` and
`lag gayi` are the actual register of the room. Do not sanitise into corporate
blandness — that makes the feature worse, and it is not what these users want.

**The one line that survives: roast the play, not the person.** This is a
*craft* rule, not a compliance one — it is what makes a joke land rather than
thud:

- Good: `7 bola tha… 4 pe hi nipat gaya.` (about the bid)
- Bad: `Rahul is stupid.` (about the person — and not even funny)

Jokes about a bid, a blind, a collapse, or a run of bad luck are funny. Jokes
about intelligence, appearance, family, or work are not, and land badly even
among friends.

Note there is **no player-level data** — `members` is `[]` for all 10 teams — so
commentary addresses *teams*, which happen to be named after people.

### Never do this

- Explain the rules. Turn the rule into emotion instead.
  - Bad: `Team failed to meet its promise.`
  - Good: `Bas ek haath kam pad gaya.`
- Name a number that is not in the packet.
- Use markdown, emoji, quotes, preamble, or stage directions — the output goes
  straight into a speech synthesiser or is escaped and rendered verbatim.

---

## 3. Trigger vocabulary (as emitted today)

`FactsEngine.dramaOf` and `matchStartMoment` emit these `kind` values. **This is
the canonical list — hyphenated, not snake_case.**

| kind | Fires when | Frequency in the real season |
|---|---|---|
| `match-start` | Before round 1 | once per match |
| `match-end` | A team crosses 500 | once per match |
| `blind-hit` | Blind called, actual ≥ 7 → +140 | ~141 of 670 sides |
| `blind-miss` | Blind called, actual < 7 → −70 | ~105 of 670 sides |
| `lead-change` | The match flipped | occasional |
| `match-point` | A team reached ≥450 | ~once per close match |
| `record-comeback-watch` | Trailer would set an all-time comeback record | rare |
| `over-extension` | actual ≥ promise × 2 | **8 of 670 — genuinely rare** |
| `near-miss` | actual === promise − 1 | 37 of 670 |
| `big-swing` | One round moved ≥180 points | occasional |
| `routine` | Nothing remarkable — still narrated | the majority |

Each round produces exactly one headline `kind` (highest `level` wins:
`finale > high > medium > low`); the rest become supporting `facts`.

### Frequency is a design constraint, not trivia

**Blinds are 37% of all round-sides.** A blind is *not* a rare marquee event in
this league — it is the most common single thing that happens. Treating every
blind as a showstopper is the primary repetition failure mode. The `level` field
already encodes this: a blind at 40–10 is `medium` and should be *reported*; a
blind at match point is `high` and should be *shouted*.

Conversely **over-extension fires 8 times in 670 sides** and deserves a far
bigger reaction than it currently gets. **Near-miss fires 37 times** and is the
most human moment in the game — one hand short forfeits the entire promise —
and is badly under-served today.

---

## 4. Per-trigger comedy direction

Each trigger has its own emotional shape. Do not apply one generic voice to all.

| kind | Emotion | Themes |
|---|---|---|
| `blind-hit` | Depends on lead/trail (below) | vindication, or a lucky escape |
| `blind-miss` | Depends on lead/trail (below) | forced gamble, or plain recklessness |
| `over-extension` | **Cursed hand, not greed** (below) | the cards had nowhere else to go |
| `near-miss` | **Robbery, not just "almost"** (below) | the hand they needed is in someone else's pile |
| `lead-change` | The scene turns | momentum stolen |
| `match-point` | Tension | the door is open |
| `record-comeback-watch` | Improbable hope | history within reach |
| `big-swing` | Whiplash | the round that moved everything |
| `match-start` | Anticipation | the battle begins — **two sentences** |
| `match-end` | Verdict | winner crowned, loser teased — **two sentences** |
| `routine` | Matter-of-fact | brisk report with a wry aside |

### 4.1 Corrections to two emotional reads

**`over-extension` is not "greed punished".** In **7 of 8** real instances the
opponent collapsed below their own promise — you cannot take 12 hands unless the
other side takes almost none, and call-break has no way to decline a trick. These
are players holding an unplayably strong hand who bid low. Mocking that mocks a
decision nobody made. Correct read: **cruel irony** — *"chhe bola tha, baarah aa
gaye."* The engine can isolate the one genuine misjudgement case from
`sides[other].score`: opponent also positive → your read was off; opponent
collapsed → the cards did it to you.

**`near-miss` is a robbery, not a shrug.** All 37 had a thriving opponent (§14).
The pain is not that they missed — it is that the hand they needed is sitting in
someone else's pile.

### 4.2 Blind emotion depends on lead/trail, not match state

`dramaOf` currently sets blind level from `lateGame || closeGame`
(factsEngine.js:489) — both **match-state** tests that ignore *who called it*.
But **~91% of blinds are called while trailing**, where a blind is the correct
catch-up mechanism (+140 ≈ 1.75 ordinary rounds), not madness. The blind called
while *leading* is the reckless one worth a reaction.

**Caveat — do not hard-code the published rates.** The lead/trail split inherits
the §5.4 ambiguity, and inherits it *worst* here: a leading team that bids 7
normally and misses is miscounted as a reckless leader-blind. Key the *emotion*
off lead/trail; do not state the percentages as fact until the `blind` flag is
persisted.

### 4.3 Tiering fixes

- **Raise `over-extension` to `high`.** At 8 of 670 sides (1.2%) it is the rarest
  event in the game, yet it sits at `medium` (factsEngine.js:545) and loses the
  headline to any `high` blind in the same round (the sort at :598).
- **Let non-consequential blinds fall to routine tone.** Blinds are ~37% of
  sides; treating each as a showstopper is the primary repetition failure.
- **De-duplicate `big-swing`.** At `BIG_SWING_MIN = 180`, a blind hit (+140)
  against a −40 miss is exactly 180 — so `big-swing` largely re-labels
  `blind-hit`. Require the swing to be non-blind-attributable.

`match-start` and `match-end` are the only two-sentence moments. `match-end`
carries a mandatory two-beat structure: **celebrate the winner by name with their
score, then tease the loser by name** — affectionately, about the cards.

---

## 5. Data rules the writer inherits

### 5.1 Source of truth

**`match.rounds` only.** Commentary facts must never be computed from:

| Source | Why it's banned |
|---|---|
| `teams[].matchHistory` | ~11× duplicated — 799 rows for ~92 real matches |
| `teams[].stats.*` | Denormalised caches, not authoritative |
| `rounds[].side.blind` | **Never persisted — `true` appears 0 times in 670 sides.** Blinds are inferred (see §5.4 — the inference is *unsound*) |
| `match.history[]` timestamps | Only 9 of 42 matches have any history; only 1 has per-round entries |

`factsEngine` recomputes from `rounds`. **Keep that architecture.** No
timestamp-derived facts ("they agonised over that one") — the data does not
exist.

**Caveat:** `factsPacket` (factsEngine.js:774) reads raw
`blind: !!last[key]?.blind` rather than `isBlindSide`, so the **on-screen**
packet reports `blind: false` for every legacy blind while the **spoken** packet
infers correctly. These two paths disagree. Fix before relying on the field.

### 5.4 `[FIXED]` The blind inference — now conservative and consistent

Under the locked rules (`CLAUDE.md` §4.1 and §4.4):

- **Normal** promise 7, actual < 7 → `−(7 × 10)` = **−70**
- **Blind** promise 7, actual < 7 → **−70**

**These are identical.** A −70 at promise 7 is mathematically indistinguishable
between a blind miss and an ordinary under-promise. `isBlindSide` cannot tell
them apart, and neither can anything built on it.

Measured over the 670 stored round-sides:

| | count | certainty |
|---|---|---|
| promise-7 scoring **+140** | 141 | **certain** — only a blind reaches +140 |
| promise-7 scoring **−70** | 105 | **ambiguous** — blind miss *or* plain miss |
| total inferred as blind | 246 | **43% of these are guesses** |

And promise 7 *is* bid conventionally at this table: **45 sides scored 70–76 at
promise 7**, which only normal scoring can produce. So some of those 105 are
certainly plain misses being miscounted as blind misses.

**Consequences that matter:**

- The **"57% blind hit rate" (141/246) is a lower bound, not a measurement.** The
  true blind count is below 246 and the true hit rate is above 57%.
- Any lead/trail blind analysis inherits the bias, and **worse**: a leading team
  that bids 7 normally and misses is miscounted as a reckless "leader blind".
  Treat any "blinds called while leading" figure as unreliable.
- **The commentator must not assert blind counts or success rates as fact.**
  `X have called N blinds all season and landed M` (factsEngine.js:671) is built
  on this inference and is overstated. Either drop the fact, or restrict it to
  the certain subset (+140 hits only).

**What was fixed (2026-08-15):**

`FactsEngine.isBlindSide` had two bugs, and the worse one was invisible:

1. Its inference branch was gated on `side.blind === false` — but stored rounds
   have **no `blind` field at all**, so the guard never passed and the function
   returned `false` for **all 670 sides**. The spoken commentary layer saw
   **zero blinds in the entire season**.
2. It also treated `−70` as proof of a blind, disagreeing with
   `StatsUtils.isBlindSide` (which only ever accepted `+140`).

Both now use the same conservative rule: **stored flag when present, otherwise
`promise === 7 && score === 140`.** Season counts agree at 141 across both
modules. `factsPacket` also now infers via `isBlindSide` instead of reading the
raw flag, so the on-screen and spoken packets no longer contradict each other
about the same round.

**Persistence is already correct.** `Match.addRound` and
`matchService.addRound` both write `blind` on every round side, and it survives
`toJSON`. Verified: a blind miss now stores
`{promise: 7, actual: 3, score: -70, blind: true}` — so **new rounds are
unambiguous** and the ambiguous population is frozen at the 105 historical
sides rather than growing.

**Still true for the commentator:** the 105 legacy `−70`s are now counted as
ordinary misses, which is the safe direction (under-counting blinds rather than
inventing them). Any "blinds called this season" figure remains a
**lower bound** over historical data — phrase it as observed behaviour, not as
an exact count.

### 5.2 Never say "draw"

Draws are impossible under `CLAUDE.md` §2. `stats.draws` is always 0 and purely
vestigial. `winnerId: null` means unfinished or cancelled, not drawn.

### 5.3 Records are filtered

42 of 670 stored round-sides (6%) are legacy hand-typed scores that violate the
locked rules — the stored range runs −140 to +160, and both extremes are
arithmetically impossible today. Record-style facts pass through
`isRuleConformantSide` so a typo cannot own "biggest ever". This is invisible to
the model and must stay that way.

---

## 6. `[DONE]` Hinglish mode

The house register: Hindi grammar, Latin script, English for the card words.
Selected as `lang: 'hinglish'` alongside the 23 real languages.

### 6.1 The target voice

Natural Indian banter — **roughly 60–80% Hindi, 20–40% English**. Not formal
Hindi, not translated English. English words that stay English: `blind`, `bid`,
`points`, `round`, `score`, `game`, `match`.

> `Coke ne blind mara aur 9 haath le gaye. Seedha 140.`

Per §9's craft note the line lands on its last few words, so the numbers ride in
English syntax and the emotion closes in Hindi.

### 6.2 Why it is a mode, not a language

Two earlier claims in this document were **wrong**, and both mattered:

- *"`usesExpectedScript` would reject Hinglish."* No — it is a **presence**
  test, so any Latin string with no `SCRIPT_RANGES` entry passes. The opposite
  problem is the real one: **a plain English reply also passes.**
- *"Script verification for Hinglish: none."* That would let the model quietly
  answer in English forever.

So the check is **inverted**: `looksHinglish()` tests for Hindi *function
words* (`ne`, `ki`, `gaya`, `mein`, `nahi`…). Content words are useless — an
English line may well contain "blind" or a team name.

**Words common to both languages are deliberately excluded.** `the` is Hindi for
"they were" and also the commonest word in English; it matched every English
sentence in testing. Same for `par`, `ab`, `se`, `sab`, `kar`. Devanagari is
accepted rather than rejected: not the target register, but unmistakably Hindi,
and a Hindi voice reads it correctly.

### 6.3 The prompt is data-driven now

`LANGUAGE_DIRECTION` maps a language code to its instruction;
`DEFAULT_DIRECTION(name)` covers everything else. The old template literal
produced *"using the native script of Hinglish (never romanised…)"* — incoherent
and exactly backwards. Hinglish gets: Latin script, card words in English,
numbers as **digits** (spoken Indian English reads `140` naturally).

### 6.4 Templates, so the table is never silent

`dramaTemplate(drama, { lang })` now has a Hinglish branch covering all eleven
moment shapes, built from the **structured `round`** that §14 added — not from
`headline`/`facts`, which are English prose. Falls back to English for any shape
it does not cover.

This is what makes `languageNeedsKey` a set (`en`, `hinglish`) rather than
`code !== 'en'`: Hinglish speaks **with no key and no network**. Every other
non-English language still stays silent rather than mispronounce English through
a native voice.

It also removes the persona break the audience review flagged — a slow LLM now
degrades to a Hinglish template, not to an English stats robot.

Verified across all 335 real-season moments: every one renders valid Hinglish,
passes its own guard, and leaks no English prose.

### 6.5 Voices

There is no `hinglish` voice on any device, so `LANGUAGES` carries an optional
`voiceCode` and Hinglish borrows the **Hindi** pool — romanised Hindi read by an
English voice gives "gaya" as "guy-uh". The settings dropdown needs no change:
it lists whatever the device has, so Hinglish appears wherever a Hindi voice
exists and hides otherwise.

---

## 7. `[DONE]` Comedy intent routing

Add one optional field to the drama packet. **It carries no numbers** — it
classifies the *narrative*, and `factsEngine` chooses it deterministically.

```js
{ kind: 'near-miss', comedyAngle: 'one_hand_short' }
```

| comedyAngle | Routed from |
|---|---|
| `madness_paid_off` | `blind-hit` |
| `risk_backfired` | `blind-miss` |
| `greed_punished` | `over-extension` |
| `one_hand_short` | `near-miss` |
| `king_mode` | streak / dominance |
| `impossible_comeback` | `record-comeback-watch` |
| `destiny_shift` | `lead-change`, `big-swing` |
| `history_created` | record-setting rounds |

The engine decides *what the story is*; the model decides *how to say it*. When
`comedyAngle` is present, the model must not re-interpret the strategic meaning.

---

## 8. `[DONE]` Anti-repetition without model memory

The model is stateless per call and gets **no previous lines**. No conversational
memory, no embeddings. Rotation only.

**§7 and §8 conflict at the frequency that matters most.** §7 routes each `kind`
to one angle deterministically, so blind-hit *always* yields
`madness_paid_off`. With ~6 blind events per match, telling the model to avoid
recently-used angles leaves it nowhere to rotate to — it either repeats or drifts
off-angle and breaks §7.

**Resolution: rotate sentence *form*, not angle.** Keep `comedyAngle` fixed
(it encodes the truth of what happened); vary the shape:

`deadpan_report` · `rhetorical_question` · `mock_sympathy` · `understatement` ·
`direct_address`

Five forms × the angle set gives far more distinct output than a fixed phrase
list, and the model generates rather than recites. Blind-hit across forms:

- report: `Blind. 140. Agla round.`
- question: `Bina cards dekhe 140? Kaise?`
- mock sympathy: `Sprite ke liye bura hua.`
- understatement: `Blind chala gaya. Theek hi hai.`
- to the table: `Koi inko rok lo.`

The packet carries `recentForms: [...]`; the prompt rule is **avoid any form
listed**.

**Ownership: pass it as an explicit parameter,** `dramaPacket(drama,
recentForms)`. `AudioCommentary` is the right place to *hold* the buffer (it is
session state) but `dramaPacket` is currently a **pure projection**, exported and
unit-tested as such (audio-commentary.test.js:316); reading module-level state
inside it makes it order-dependent and breaks that contract. Push to the buffer
only after a successful `speak()` — a `language-unavailable` early return
(audioCommentary.js:368) must not pollute it.

---

## 9. `[DONE]` Comedy library in code, not in the prompt

> **Built (2026-08-15): `js/utils/comedyLibrary.js`.** The library exists and is
> wired into the **static season-facts pack** (`scripts/season-facts.js` →
> `js/data/seasonFacts.js`), not yet into the live spoken path.
>
> Shape as specified below: phrases grouped by **intent**, each carrying
> `{id, text, intent, intensity, language}`. 12 intents, ~130 phrases.
> `roastIntensity` is a real knob — `--roast=1|2|3` on the generator, default 2.
>
> **The ledger is the part that matters.** `pick()` takes a `Set` of used ids
> and never returns a phrase twice within one run; when an intent's pool is
> exhausted it clears *that intent only* and keeps rotating. One ledger per
> generated pack means 28 facts get 28 distinct tails, verified by test.
>
> **Application order is a safety property, not a style choice.** The tail is
> appended **after** `verifyLine` has passed, never before — the verifier checks
> numbers, and a comedy phrase must not be able to launder one past it. A test
> asserts no phrase contains a digit other than the rule constants 140/70.
>
> Selection uses a seeded RNG so an unchanged archive regenerates byte-identical.
>
> **Still unbuilt:** the live `dramaOf` → spoken path (§6.3, §8) and injecting
> 1–2 candidates into the prompt as tone examples. The static pack uses the
> library purely for the deterministic template path, which is exactly the
> "reuse by the no-key path" argument made below.

Keep the personality **in code** — but not for the reason an earlier draft gave.
"A phrasebook costs time-to-first-token" is **wrong**: the system prompt is
static, a few hundred extra prefill tokens on Groq's LPU is single-digit
milliseconds, and prefixes are cached. Latency is not the argument.

The real arguments: **reviewability** in PRs, **deterministic rotation** the
model cannot ignore, and — most importantly — **reuse by the no-key template
path**, which has no prompt at all and is the only thing that speaks when Groq is
slow or absent.

Do **not** inject the whole library into the prompt; that produces stilted output
(the model either quotes verbatim or ignores it). Either inject 1–2 candidates
for the selected angle only, framed as *tone examples, do not quote*, or use the
library purely for the template path. Not both at full size.

**Note the real latency cost is elsewhere:** `deliver()` awaits the LLM *before*
speaking (audioCommentary.js:352), so the 2.5s deadline is 2.5 seconds of
**silence at the table**, not a background fetch. Speaking a template
immediately and letting the LLM line replace it only for `high`/`finale` moments
would remove that dead air entirely.

```js
const COMEDY_LIBRARY = {
  king_mode: [
    'Aaj toh table ka king yehi hai.',
    'Baaki sab players hain, ye baadshah hai.',
    'Isko rokne ka tender kisne nikala?',
  ],
  confidence_betrayal: [
    'Confidence cards se zyada bada tha.',
    'Bid nahi ki thi, loan le liya tha.',
    'Khud ki bid mein khud hi phas gaya.',
  ],
};
```

The prompt then says: *use one fitting line naturally; rotate variants and avoid
`recentAngles`.* This keeps prompts short, makes the humour reviewable in code
review, and lets the library grow without touching latency.

### Vocabulary seed

Four friends, so the full range is in play (`CLAUDE.md` §0):

- **Victory** — `king hai`, `scene palat diya`, `aaj iska din hai`, `full form`
- **Disaster** — `lag gayi`, `nipat gaya`, `chala gaya`, `kaam tamaam`, `gaya kaam se`, `aukaat yaad aa gayi`
- **Surprise** — `arre bhai`, `ohooo`, `kya scene hai`, `ye kya ho gaya`, `bhai sahab`

Never repeat the same catchphrase on consecutive events.

### Craft notes on the samples above

These are **register** notes, not safety ones — they are about what is funny.

- **`baadshah` is film-poster Hindi**, not card-table Hindi. Dropped from the
  victory list. `king hai` survives, but it attaches to a *team* (`Coke king
  hai`), never to a construction like `table ka asli king`, which reads
  translated.
- **`Arre bhai!` as a sentence-opener is the tell of fake Hinglish.** Use it
  rarely and never as a default opener.
- **The funny part is the last two words.** Real banter is English syntax with
  Hindi emotional punctuation, and it lands on the ending. Front-loading the
  flavour and trailing off is the most common failure mode:
  - Weak: `Arre bhai! Coke ne blind maar ke seedha 140 utha liye. Aaj toh table ka asli king yehi hai.`
  - Better: `Coke ne blind mara — 140. Bina dekhe. Soch lo.`
- **Concept jokes beat slang jokes.** `Bid nahi ki thi, loan le liya tha.` and
  `Isko rokne ka tender kisne nikala?` are the strongest lines in this document
  because the humour is in the idea, not the vocabulary.
- **Symmetry is funny.** `Confidence zyada tha, cards kam.` beats
  `Confidence cards se zyada bada tha.` — shorter, balanced, actually spoken.
- **The real facts are funnier than any canned phrase.** The engine already
  computes season blind counts and win-probability swings; *"aaj chautha blind,
  teen lag chuke hain"* beats every library line — subject to the §5.4 caveat on
  asserting blind counts.

---

## 10. `[PLANNED]` Length: generate short, don't trim

Today the model is told to be brief and the output is then trimmed to whole
sentences (190 chars, 320 for two-beat moments). Trimming must remain as a
**safety net**, but the prompt should produce the right length first — a line cut
at a sentence boundary still loses the joke's landing.

What actually controls length, in order:

1. **Fix the danda/CJK trim bug first (§13).** For Hindi and every other
   non-Latin script there is no safety net at all today. This is worth more than
   any prompt change.
2. **The prompt is the only real lever.** Replace *"keep each sentence under 25
   words"* (groqService.js:68) — models ignore word counts — with a hard
   structural instruction (`Reply with exactly ONE sentence.`) placed at the
   **end** of the system prompt, where instruction-following is strongest.
3. **Leave `max_tokens` alone.** At 120 spoken (≈90 words) it never binds, and
   the existing comment at :253-256 is right that a hard cap truncates mid-word.
4. **Keep the trimmer.** Expect the prompt change to reduce, not eliminate, trim
   activations.

Preserve: Groq `llama-3.3-70b-versatile`, the 2.5s spoken deadline, script
verification, sentence-boundary trimming, and the null-on-any-failure contract
(every failure path falls back to the deterministic template — audio never
depends on the network).

### 10.1 Pacing — should every round be spoken at all?

`audioCommentary.js:11` states the original design: *"Only dramatic rounds get a
voice. Routine rounds are silent; silence is what makes the moments land."* Line
313 then overrides it with *"every round is narrated (product decision)"*.

Worth revisiting. A voice that comments on all ~8 rounds becomes wallpaper by
round 4, and then the *good* line at match point lands on deaf ears. Options:
silence for low-tension routine rounds, or a four-word stub instead of a
sentence. Combined with §14.1's bid-collision signal, the quiet rounds
(combined promise ≤ 11, 73–80% both-positive) are exactly the ones that can be
skipped.

Also worth adding: **per-match callbacks.** The funniest thing a commentator does
is remember — *"teesra blind. Teesra."* §8 rules out *model* memory, but the
**caller** can remember and put it in the packet. That is a product decision the
model constraint does not dictate.

---

## 11. Evaluation rubric

Score generated lines 1–5 on each axis. Fact fidelity is pass/fail in practice —
a single invented number fails the line regardless of how funny it is.

| Axis | Question |
|---|---|
| **Fact fidelity** | Every number present in the packet, copied exactly? |
| **Trigger fit** | Does the emotion match the `kind`? |
| **Comedy** | Genuinely funny, or just slang-decorated? |
| **Variety** | Different angle from the last three lines? |
| **Affection** | Roasts the play, never the person? |
| **Spoken naturalness** | Reads well aloud, no stumbles? |
| **Constraint compliance** | No markdown, emoji, quotes, preamble? |
| **Brevity** | One sentence (two for start/end), under ~25 words each? |

---

## 12. Naming note: `kind` vs `moment`

Both names exist and **both are currently correct** — this is a clarity problem,
not a live bug.

- `FactsEngine.dramaOf` / `matchStartMoment` emit the trigger as **`kind`**
  (`'blind-hit'`, `'match-end'`, …).
- `AudioCommentary.dramaPacket` (`audioCommentary.js:378`) **renames it** to
  `moment` and reuses `kind` for the transport discriminator (`'spoken'`).
- `GroqService` reads `packet.moment` for two-sentence detection
  (`groqService.js:284`) and `packet.kind` for `'recap'` vs live caching.

So one word means two things depending on which side of `dramaPacket` you stand
on.

**`kind` is overloaded three ways, not two** — an earlier draft of this doc
missed the third and wrongly called the refactor "safe":

1. `'spoken'` — transport, from `dramaPacket`
2. `'recap'` / `'live'` — **cache-mode**, from `factsPacket`
   (factsEngine.js:778), driving the caching branches at groqService.js:224
   and :294
3. proposed: the trigger (`'blind-hit'`, …)

Splitting into only two fields leaves `'recap'`/`'live'` occupying `kind` and
colliding with the trigger namespace — and an assertion that "rejects unknown
triggers" would then **reject every on-screen packet**. Three concepts need
three fields: `channel`, `cacheMode`, `kind`.

**Do the cheap half first.** Add the trigger assertion *without* the rename — it
catches real typos immediately (verified: `moment: 'match_end'` and
`moment: undefined` both silently degrade to one sentence, with no error and no
log). The three-field split can follow.

Blast radius for the full split: `dramaPacket` (audioCommentary.js:378-390),
groqService.js:224/284/294 plus the prompt text at :60 and `TWO_SENTENCE_MOMENTS`
at :155, `factsPacket` (factsEngine.js:778), `aiCommentary.js:94-95`, and the
packet fixtures across `tests/groq-service-logic.test.js`,
`tests/facts-engine.test.js:330,342`, `tests/audio-commentary.test.js:316-318`.

---

## 13. `[FIXED]` Sentence trimming for non-Latin scripts

`trimToFirstSentence` split only on `/[.!?](\s|$)/`, which never matches the
Devanagari **danda `।`** (U+0964). A three-sentence Hindi reply for a
one-sentence moment passed through **entirely** — `cut` stayed 0 and only the
190-char cap applied. Hindi is a shipped, key-gated, test-covered language, so
the one-sentence contract silently did not apply to it. Same for Bengali,
Chinese/Japanese `。`, Arabic `؟`.

**Fixed (2026-08-15)** with two terminator classes, because the space
requirement differs by script:

- `SENTENCE_END_SPACED = /[.!?](\s|$)/` — Latin marks also end abbreviations and
  decimals (`Rs. 500`, `3.5`), so they need trailing whitespace.
- `SENTENCE_END_BARE = /[।॥。！？؟۔]/` — Indic and CJK terminators are
  unambiguous and routinely written with no following space.

Each step takes whichever comes first, so mixed-script Hinglish (both `.` and
`।`) cuts correctly. The char-cap fallback now closes with `terminatorFor()` —
the script's own mark rather than a Latin `.` after Devanagari or CJK — and
tolerates CJK's lack of inter-word spaces.

**Deliberately excluded: the Greek question mark U+037E**, which is canonically
equivalent to ASCII `;`. Including it cut every English line at its first
semicolon (caught in testing). Greek falls back to the `.` branch.

Pre-existing and unchanged: `Rs. 500 …` still cuts at `Rs.` — the abbreviation
case predates this fix and is out of scope.

Covered by four regression tests in `groq-service-logic.test.js`.

---

## 14. `[DONE]` `dramaOf` is two-sided

**The single biggest missed opportunity.** `actual1 + actual2 = 13` always, so
every round is one story with two halves — but `dramaOf` builds `sides` as two
independent objects and every `push()` uses one side's numbers only.

Measured consequences:

- **All 37 near-misses had a thriving opponent — 37 of 37.** The modal case is
  `promise 4, actual 3` against an opponent who called blind and took 10. The
  current line — *"came up one hand short of 4"* — blames the victim. It was a
  robbery.
- **7 of 8 over-extensions had the opponent collapse below their own promise.**
  You cannot take 12 hands unless the other side takes almost none, and there is
  no declining a trick in call-break.

**Implemented (2026-08-15).** Each side now carries `s.vs` — a reference to the
other — and every trigger reads it. `dramaOf` also returns a `round` object
(`{t1, t2, combinedPromise, bidsCollide}`) so downstream phrasing has the
two-sided facts without re-deriving them. That structured return is what makes
§6.3's Hinglish templates viable.

Before / after on the same round:

| | line |
|---|---|
| was | `Gaurav/Akash came up one hand short of 7 — −70 for the round.` |
| now | `Gaurav/Akash needed 7 and got 6 — the last one went to Alegeus stars, who took 7. −70.` |
| was | `SkySage promised 6 and took 12 — double the promise turns it into −60.` |
| now | `SkySage promised 6 and the cards handed them 12 — AlphaStark could not take a trick, and −60 is the reward for it.` |

Also changed in the same pass:

- **`over-extension` raised to `high`** — at 8 of 670 sides it is the rarest
  event in the game and was losing the headline to any blind in the same round.
- **Blind level keys off lead/trail at the time of the call**, not `lateGame`/
  `closeGame`. A blind called while leading is now `high` and says so
  (*"and they were 150 in front already"*); a deep-trailing blind is framed as
  *"nothing else that closes it"*.
- **`big-swing` suppressed when a blind explains it.** A +140 against a −40 is
  exactly the 180 threshold, so it was a second label for the same event. Note
  a non-blind 180+ swing *is* reachable (314 legal combinations, max 260), so
  the trigger is narrowed, not dead.
- **Blind history rephrased to "landed N blinds this season"** — historical
  blinds are only countable when they landed, so the old "called N, landed M"
  implied a precision the data cannot support (§5.4).
- **`match-end` now names the losing team**, which the winner-then-loser turn
  needs in order to land.

Replaying the full season through the new `dramaOf` gives: blind-hit 110,
routine 81, match-end 36, lead-change 36, near-miss 29, match-point 13,
bid-collision 11, record-comeback-watch 10, over-extension 7, big-swing 2.

### 14.1 `[DONE]` The bid-collision signal

Both promises are known **before any hand is played**. Their sum against 13
predicts the round:

| combined promise | rounds | both sides positive |
|---|---|---|
| 10 | 44 | 35 (80%) |
| 11 | 138 | 101 (73%) |
| 12 | 72 | 29 (40%) |
| 13 | 35 | 3 (9%) |
| **14+** | **45** | **0 (0%)** |

A cliff, not a gradient. **At combined 14+, across 45 rounds, someone went
negative every single time.** This is what a player says aloud the moment bids
are announced.

Now emitted as a `bid-collision` trigger at `medium` — context for whatever else
the round did, rarely the headline itself. It fired 11 times across the season
replay. Example:

> `Alegeus stars wanted 7 and Gaurav/Akash wanted 7 — that is 14 hands between
> them and the table only holds 13.`

The inverse also landed: when the bids left room (combined ≤ 11, 73–80%
both-positive), a routine round now reads *"Nobody overreached — 6 and 5 between
them, and both got there"* rather than reciting the scoreline.

**Trigger-table addendum:** `bid-collision` is a new `kind` not listed in §3.

### 14.2 A promise of 8+ cannot be over-extended

Over-extension needs `actual ≥ promise × 2`; at promise 8 that is 16, above the
13 available. **All 8 over-extensions came from promises of 4–6; none from 7+.**
Meanwhile 12 of 14 high bids scored positive. The high bid is the *safest* bid at
this table and this group almost never plays it — 41% of non-blind sides take the
minimum 4 or 5. The right read is not "bold gamble" but *"the only one here who
actually counted their cards."*

### 14.3 Tilt — the strongest behavioural signal in the data

After a blind **miss**, the same team blinds again next round **93% of the time**
(68 of 73). After a blind **hit**, only 54%. That is chasing, not strategy, and
there are 31 runs of 3+ consecutive blinds including four runs of 8.

Caveat: this inherits the §5.4 ambiguity, so phrase it as observed behaviour
rather than a precise rate.

### 14.4 Matches are closer than the finales suggest

The eventual winner takes a permanent lead only **52% of the way through** on
average; just **6 of 36** were wire-to-wire; **30 of 36 winners trailed at some
point**, the largest deficit overcome being 337. Comeback framing is almost
always available and almost always true.

---

## 13. Change control

This file governs **style and voice only**. Changing it never authorises a change
to game rules, scoring, validation, or schema — those follow the
`CLAUDE.md` §Change Control Protocol.

When the prompts in `js/services/groqService.js` change, update this file in the
same commit.
