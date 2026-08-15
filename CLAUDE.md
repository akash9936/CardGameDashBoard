# CLAUDE.md — Card Game: Locked Game Rules

> **Purpose.** This file is the single source of truth for the **immutable game rules** of the Card Game project. These rules **must not change**. Any code, documentation, test, or feature added to this repository must conform to the rules in this file.
>
> **Scope.** Game rules only — team composition, match structure, round structure, promise/actual constraints, scoring formulas, blind rules, win conditions, and validation boundaries. Implementation details (file paths, models, services, UI) live in [`claude/game-rules-and-conditions.md`](claude/game-rules-and-conditions.md) and may evolve.

---

## Change Control Protocol (READ FIRST)

These rules are **locked**. Treat them as a contract.

1. **Never silently modify** any rule in this file.
2. **Never modify code** that conflicts with these rules without first following the protocol below.
3. **Before changing any rule**, the agent (Claude) must:
   - **Ask the user for explicit permission** to change the rule, quoting the exact rule being changed.
   - **List every place the old rule appears** in the codebase (code, tests, docs, UI strings) and report what will break or become inconsistent if the rule changes.
   - **Wait for confirmation.** Do not proceed on implicit assent.
4. **Only after explicit approval**:
   - Update this `CLAUDE.md` first.
   - Then update [`claude/game-rules-and-conditions.md`](claude/game-rules-and-conditions.md).
   - Then update code, tests, and any other affected files in the same change set.
5. **Any rule change must update `CLAUDE.md`** in the same commit. A rule change without a `CLAUDE.md` update is invalid.

---

## 0. Who This Is For (Context, Not a Rule)

This section is **context**, not a locked rule. It does not constrain scoring,
validation, or match logic — it exists so agents make sensible judgement calls
about tone, safety, and polish. It may be updated without the §Change Control
Protocol.

**The audience is four close friends.** This is a private game among people who
know each other well. It is **not a public product**, not a customer-facing app,
and not something strangers will use.

What that means in practice:

- **Humour can be sharp.** The AI commentary layer (see
  [`claude/commentary-style.md`](claude/commentary-style.md)) can roast harder
  than a public product would. Between four friends, `nipat gaya` /
  `gaya kaam se` / affectionate abuse is the actual register of the room. Do not
  sanitise it into corporate blandness — that would make the feature worse and
  is not what the users want.
- **Still roast the play, not the person.** This survives as a *craft* rule
  rather than a compliance one: jokes about a bid, a blind, or a collapse are
  funny; jokes about someone's intelligence, appearance, family, or job are not,
  and land badly even among friends. Teams are named after real people
  (`Gaurav/Akash`, `Sky/K2`), so the distinction still takes care.
- **No HR-style guardrails are required.** Earlier drafts assumed an open-office
  audience with seniors present and proposed blocklists on that basis. That
  premise is wrong. Do not add compliance machinery for an audience of four
  friends.
- **Onboarding and hand-holding matter less.** Everyone using this already knows
  the rules. Prefer density and speed over explanatory UI.
- **Data volume stays small.** ~10 teams, tens of matches, hundreds of rounds.
  Optimise for clarity, not scale. Full-table scans in the browser are fine.

What this does **not** license:

- Breaking any locked rule in §1–§8 below.
- Slurs, or humour targeting protected characteristics.
- Shipping something knowingly broken because "it's just for us."

---

## 1. Team Rules

| Rule | Value |
|---|---|
| Minimum members per team | **1** |
| Maximum members per team | No limit |
| Team name uniqueness | **Case-insensitive unique** across the system |
| Team name content | Non-empty, not whitespace-only |
| Team creation auth | Requires administrative authentication |

---

## 2. Match Rules

| Rule | Value |
|---|---|
| Format | Head-to-head between **exactly two** teams |
| Self-play | A team **cannot** play against itself |
| Duplicate pending matches | **Not allowed** between the same two teams |
| Win threshold | First team to reach **≥ 500 points** wins |
| Termination | Match ends **immediately** when a team reaches 500 |
| Draws | **Not possible** (500-point rule guarantees a winner) |
| Match states | `pending` → `in_progress` → `completed` / `cancelled` |
| Cancellation | Allowed from any state; requires a reason |
| Simultaneous 500 | **Higher total score wins**; if totals are exactly equal, team1 (first team processed) wins (deterministic) |

---

## 3. Round Rules

Each round has two phases: **Promise**, then **Actual**.

### 3.1 Promise Hand Constraints

| Rule | Value |
|---|---|
| Minimum promise per team | **4** |
| Maximum promise per team | **13** |
| Validation | `4 ≤ promiseHands ≤ 13` (per team) |

### 3.2 Actual Hand Constraints

| Rule | Value |
|---|---|
| Minimum actual per team | **0** |
| Sum constraint | `team1Actual + team2Actual = 13` (exactly) |

### 3.3 Round Lifecycle

- Rounds may only be added to matches in `in_progress` state.
- Rounds are processed **sequentially**.
- Round data must be **complete and valid** before being persisted.
- Each round records: promises, actuals, computed scores, and timestamp.

---

## 4. Scoring Rules (LOCKED)

The score for each team in a round is computed independently using the cases below.

### 4.1 Case 1 — Under-promise (Actual < Promise)

If a team fails to meet its promise, the **entire promise value** becomes negative (×10). The size of the shortfall does **not** affect the magnitude.

```
teamScore = -(promiseHands × 10)
```

**Examples:**
- Promise 4, Actual 3 → `-(4 × 10)` = **−40**
- Promise 8, Actual 5 → `-(8 × 10)` = **−80**
- Promise 10, Actual 0 → `-(10 × 10)` = **−100**

### 4.2 Case 2 — Met promise, with extras (Promise ≤ Actual < Promise × 2)

If a team meets or exceeds its promise but stays **strictly below** double the promise, the promise scores at full value (×10) and **each extra hand adds 1 point** (not ×10).

```
a = actualHands − promiseHands     // a ≥ 0
teamScore = (promiseHands × 10) + a    // only when actualHands < promiseHands × 2
```

**Examples:**
- Promise 8, Actual 8 (a = 0) → `(8 × 10) + 0` = **80**
- Promise 8, Actual 10 (a = 2) → `(8 × 10) + 2` = **82**
- Promise 4, Actual 7 (a = 3) → `(4 × 10) + 3` = **43**
- Promise 5, Actual 9 (a = 4) → `(5 × 10) + 4` = **54** *(9 < 10, still in this case)*

> **Note:** Promise 4 with Actual 8 or higher does **not** fall here — `8 ≥ 4 × 2` triggers §4.3 instead.

### 4.3 Case 3 — Over-extension (Actual ≥ Promise × 2)

If a team takes **at least double** the hands it promised, the round is treated as an over-extension penalty: the **entire promise** is converted into a negative score (×10), identical in magnitude to the under-promise penalty (§4.1).

```
teamScore = -(promiseHands × 10)    // when actualHands >= promiseHands × 2
```

This case takes **priority** over the meet-with-extras rule (§4.2) at and beyond the `2 × Promise` threshold.

**Examples:**
- Promise 4, Actual 8 (8 = 4×2) → `-(4 × 10)` = **−40**
- Promise 4, Actual 9 → `-(4 × 10)` = **−40**
- Promise 4, Actual 13 → `-(4 × 10)` = **−40**
- Promise 5, Actual 10 (10 = 5×2) → `-(5 × 10)` = **−50**
- Promise 6, Actual 12 → `-(6 × 10)` = **−60**
- Promise 6, Actual 11 → `(6 × 10) + 5` = **+65** (11 < 12, falls under §4.2)

### 4.4 Case 4 — Blind bid

When **Blind** is selected for a team:

- Promise is **fixed at 7** (the 4–13 promise range does not apply; user does not enter a promise value).
- The **extra-hand bonus does NOT apply**.

| Outcome | Condition | Score |
|---|---|---|
| Blind success | `actualHands ≥ 7` | `7 × 2 × 10` = **+140** (fixed) |
| Blind failure | `actualHands < 7` | `-(7 × 10)` = **−70** (fixed) |

**Examples:**
- Blind, Actual 7 → **+140**
- Blind, Actual 11 → **+140** (no bonus for extras)
- Blind, Actual 5 → **−70**
- Blind, Actual 0 → **−70**

### 4.5 Score Characteristics

- **Higher is better.** Positive = met promise within range; negative = missed promise or over-extended.
- **Promise commitment.** Missing the promise forfeits the full promise value as negative points (§4.1).
- **Over-extension penalty.** Taking ≥ 2× the promised hands also forfeits the full promise as negative (§4.3) — symmetric with the under-promise penalty.
- **Bonus.** Each extra hand beyond a non-blind promise adds **1 point** (not 10), but only while `Actual < Promise × 2` (§4.2).
- **Blind doubles success, single-penalty on failure.** Blind success = +140; Blind failure = −70. The over-extension rule does **not** apply to Blind.

### 4.6 Case Priority

Evaluate cases in this order; the first match wins:

1. **Blind selected** → §4.4
2. **Actual < Promise** → §4.1 (under-promise)
3. **Actual ≥ Promise × 2** → §4.3 (over-extension)
4. **Promise ≤ Actual < Promise × 2** → §4.2 (met-with-extras)

---

## 5. Match Progression

| Item | Rule |
|---|---|
| Starting round counter | `0`, increments per completed round |
| Round history | Full record of every round (promises, actuals, scores, timestamp) |
| Running totals | Cumulative score tracked per team |
| Round won/lost | The team with the **higher** round score wins that round (scoring is "higher is better") |
| Win check | Performed after each round; first team to **≥ 500** wins immediately. If both teams reach ≥ 500 in the same round, the team with the **higher total score** wins (team1 on an exact tie) |

---

## 6. Validation Constraints

These are the hard validation boundaries that must be enforced wherever rounds are submitted.

```
4  ≤ team1Promise ≤ 13                    (unless team1 is Blind → promise = 7)
4  ≤ team2Promise ≤ 13                    (unless team2 is Blind → promise = 7)
0  ≤ team1Actual
0  ≤ team2Actual
team1Actual + team2Actual = 13
```

> **Note on legacy bounds.** Previous documentation referenced a per-round score cap (`-100 ≤ totalScore ≤ 200`). The locked scoring rules in §4 can produce scores outside that range (e.g. blind success = +140 per team → +280 combined). Any legacy `±100/±200` total-score guard is **superseded** by the rules in §4 and must not block valid rounds.

---

## 7. Statistics (Derived, Not Rules)

Team stats are **computed from match history** and are not themselves game rules. They must be derivable from the rules in §1–§6:

- `matchesPlayed`, `wins`, `losses`, `draws` (always 0 — see §2)
- `points` (league points: 3 per win, 0 per loss)
- `totalScore` (sum of round scores across all matches, per §4)
- `roundsWon`, `roundsLost` (per §5)

---

## 8. What Counts as a "Rule Change"

Examples of changes that **require** the §Change Control Protocol:

- Changing the win threshold (500).
- Changing the promise range (4–13).
- Changing the actual-sum constraint (=13).
- Changing any scoring formula in §4.
- Changing the over-extension threshold (`Actual ≥ Promise × 2`) or its penalty.
- Changing the case-priority order in §4.6.
- Changing the Blind promise (7), success score (+140), or failure score (−70).
- Allowing draws, self-play, or more than two teams per match.
- Changing team uniqueness from case-insensitive to case-sensitive (or vice versa).

Examples that do **not** require the protocol (implementation only):

- Refactoring `js/models/Match.js` while preserving the rules.
- UI/UX changes that surface the same rules differently.
- Adding new statistics derived from existing rule outputs.
- Performance improvements, bug fixes that restore conformance to these rules.

---

## 9. Maintenance

- **This file is authoritative.** If `claude/game-rules-and-conditions.md`, code, or tests disagree with `CLAUDE.md`, `CLAUDE.md` wins — fix the others.
- **Never delete a rule** without going through the §Change Control Protocol.
- **Always update this file** in the same commit as any approved rule change.
