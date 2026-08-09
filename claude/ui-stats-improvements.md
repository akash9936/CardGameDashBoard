# UI, Stats & "Fun to Watch" — Deep Design Spec

A focused plan for making the Card Game Dashboard **visually appealing**, **easy to understand at a glance**, and **fun to watch live** — with enough numeric depth (sizes, hex/OKLCH, ms timings, easing curves, copy) that the next implementer can build straight from this doc.

> **Scope.** Presentation, motion, narrative, accessibility. **Game rules are locked** in [`../CLAUDE.md`](../CLAUDE.md) and must not change. Anything here that would require a rule change is out of scope until the change-control protocol in `CLAUDE.md` is followed.

> **Audience.** Two teams sitting around a phone/laptop during play, plus an optional wall-mounted TV view for tournaments. Designs must read **across a room** for the wall use case, and **on a 6.1″ phone in landscape** for the table use case.

---

## Table of contents

0. [Moment Architecture — the governing lens](#0-moment-architecture)
1. [Baseline — what already exists](#1-baseline)
2. [Design tokens — colors, type, space, motion](#2-design-tokens)
3. [Tier 0 — Live match experience](#3-tier-0)
4. [Tier 0.5 — Broadcast layer & Pressure meter](#3b-broadcast)
5. [Tier 1 — Stats that tell a story](#4-tier-1)
6. [Tier 2 — Glanceable understanding](#5-tier-2)
7. [Tier 3 — Motion, polish, accessibility](#6-tier-3)
8. [Tier 4 — Optional power features](#7-tier-4)
9. [Recommended first build order](#8-build-order)
10. [Guardrails](#9-guardrails)

---

## 0. Moment Architecture — the governing lens <a id="0-moment-architecture"></a>

This dashboard is not a stats reporter. It's three things layered on the same surface:

- a **live sports broadcast** (during play),
- a **learning tool** (for first-time viewers),
- a **memory reel** (after the match is over).

Every screen, component, animation, and metric in this doc must justify itself by answering at least one of three questions:

1. **What happened?** (the fact)
2. **Why does it matter?** (the meaning)
3. **What changes next?** (the implication)

If a proposed element answers *none* of those three, it's decoration — cut it or downgrade it. Sections §2 through §7 are tagged with `[W]`, `[M]`, `[N]` to mark which of the three a component primarily serves. Components tagged with all three (e.g. the Game Board, the Broadcast Strip, the Match Story) are highest-priority.

### Operating principles derived from the lens

- **One element animates at a time.** Today's UI runs shimmer, confetti, pulse, blur, count-ups, and a Spline 3D background simultaneously. That's noise — it answers none of the three questions. Choose one focal motion per moment and keep everything else still. (Reinforces Apple's clarity / Material's expressive-but-tokened motion stance.)
- **Tension by slowing down, not speeding up.** As the pressure meter (§3b.2) rises, motion *slows* and contrast *tightens*. Speed and flashing degrade meaning.
- **Curate, don't enumerate.** The memory reel shows 3 turning points, not 30 rounds. The broadcast strip shows 3 facts, not 30. Peaks and pivots, never an inventory.
- **Spectator-readable by default.** Every screen should have a "spectator pass": with inputs hidden and type scaled up, would someone across the room still understand what's happening? If no, the hierarchy is wrong.
- **Progressive disclosure for newcomers.** A 20-second walkthrough on first visit, dismissible forever after. New viewers should leave their first match knowing the rules without ever opening `CLAUDE.md`.

These principles aren't aesthetic preferences — they're filters. Every component in §3–§7 was either kept, rewritten, or cut against them.

---

## 1. Baseline — what already exists <a id="1-baseline"></a>

Confirmed in the codebase so we extend rather than duplicate:

| Surface | Where | Status |
|---|---|---|
| Cumulative score "worm" chart per match, with 500 win-line | `js/app.js:752` (`mountWormCharts`) | ✅ done |
| Sparklines on match cards | `js/app.js:715` (`mountSparklines`) | ✅ done |
| Promise vs Actual scatter per team | `js/app.js:1270` | ✅ done |
| Score-per-Match line chart per team | `js/app.js:1242` | ✅ done |
| Hot strip (streaks, top round, top rivalry) | `js/app.js:572` (`renderHotStrip`) | ✅ done |
| KPI tiles (matches / rounds / highest / blinds) | `js/app.js:988` (`renderKpiTiles`) | ✅ done |
| H2H matrix with team-color dots | `js/app.js:532` (`renderH2hMatrix`) | ✅ done |
| Leaderboard with sortable cols + form chips | `js/app.js:1003` (`renderLeaderboard`) | ✅ done |
| Deterministic 12-color team palette | `js/utils/stats.js:288` (`TEAM_PALETTE`, `teamColor`) | ✅ done |
| Spline 3D background | `index.html:17` | ✅ done |
| Glass effect (backdrop blur, gradients) | `css/styles.css` throughout | ✅ done |
| CSS tokens in `:root` | `css/styles.css:1-20` | ⚠️ thin — needs expansion (§2) |

So the bones are good. The gaps are in **live drama**, **discoverability**, **motion language**, and **a single shared token system**.

---

## 2. Design tokens — colors, type, space, motion <a id="2-design-tokens"></a>

Before redesigning any single component, lock the tokens. Everything in Tiers 0–4 references this section. Add to `css/styles.css` under `:root`.

### 2.1 Color tokens

**Surface & text** (dark mode default; light mode in §6.3).

```css
:root {
  /* Surfaces */
  --bg-app:        oklch(20% 0.02 250);   /* page bg, replaces #0f172a */
  --bg-panel:      oklch(24% 0.02 250);   /* solid card */
  --bg-glass:      color-mix(in oklab, var(--bg-panel) 65%, transparent);
  --bg-glass-hi:   color-mix(in oklab, var(--bg-panel) 78%, transparent); /* modals */
  --border:        oklch(35% 0.02 250 / 0.55);
  --border-hi:     oklch(80% 0 0 / 0.12);  /* glass top highlight */

  /* Text */
  --fg:            oklch(97% 0 0);         /* body */
  --fg-muted:      oklch(72% 0.02 250);    /* secondary */
  --fg-dim:        oklch(55% 0.02 250);    /* tertiary */
}
```

**Semantic tokens** — never use a raw hex outside this block.

| Token | OKLCH | Hex (approx) | Use |
|---|---|---|---|
| `--success` | `oklch(72% 0.17 145)` | `#3FBF7A` | Promise met, round win, positive score |
| `--warning` | `oklch(75% 0.15 70)` | `#E0A23A` | Approaching over-extension (actual ≥ promise × 1.7) |
| `--danger` | `oklch(65% 0.21 25)` | `#E15050` | Under-promise / over-extension / loss |
| `--info` | `oklch(70% 0.15 250)` | `#7A9BE5` | Blind indicator |
| `--blind-gold` | `oklch(85% 0.16 90)` | `#F2C84A` | Blind success only — sacred, used nowhere else |
| `--neutral` | `oklch(70% 0.02 250)` | `#A8AFB8` | Pending / idle |

**Why these.** Sequential lightness ≈72% keeps every semantic readable on the dark glass at WCAG AA. The blind-gold is reserved so when it appears, it *means* "+140" — like a referee's whistle reserved for one event.

**Team palette (replace `TEAM_PALETTE` in `js/utils/stats.js:288`).** 12 colors at fixed L=72%, varied H, dropped chroma on yellow-green to clear deuteranopia/protanopia confusion. Each pairs with a **pattern** (dot / stripe / chevron / cross-hatch) for double-encoding — colorblind users must be able to tell teams apart without hue.

| # | Name | OKLCH | Hex | Pattern |
|---|---|---|---|---|
| 1 | Crimson | `oklch(72% 0.19 25)` | `#F26A6A` | solid dot |
| 2 | Orange | `oklch(75% 0.17 55)` | `#F08A3E` | diagonal stripe ↗ |
| 3 | Amber | `oklch(82% 0.15 90)` | `#E8B83A` | dots |
| 4 | Lime | `oklch(82% 0.18 130)` | `#A3D944` | cross-hatch |
| 5 | Emerald | `oklch(72% 0.16 160)` | `#3FBF8B` | solid dot |
| 6 | Teal | `oklch(72% 0.13 195)` | `#3CC0C7` | horizontal stripe |
| 7 | Cyan | `oklch(75% 0.12 225)` | `#5DB7E8` | dots |
| 8 | Indigo | `oklch(68% 0.17 265)` | `#7E8BF0` | solid dot |
| 9 | Violet | `oklch(70% 0.19 295)` | `#B07CF0` | diagonal stripe ↘ |
| 10 | Magenta | `oklch(68% 0.22 330)` | `#E26AC9` | dots |
| 11 | Rose | `oklch(75% 0.14 10)` | `#F09090` | chevron |
| 12 | Slate | `oklch(70% 0.03 250)` | `#A8AFB8` | solid dot |

`teamColor()` keeps its current hash; `teamPattern()` is a new sibling.

### 2.2 Type scale

System font (already in `css/styles.css:30`) is fine for body; for **scoreboard numerals only**, switch to a tabular font with locked figure width so digits don't shimmy as they count up:

```css
.numeric { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

| Role | Phone | Desktop | TV (1080p, 3 m) | Weight |
|---|---|---|---|---|
| Score numeral (live match) | 56 px | 96 px | 240 px | 800 / tabular |
| Score numeral (cards) | 32 px | 40 px | 96 px | 700 / tabular |
| H1 page | 24 px | 32 px | 56 px | 700 |
| H2 section | 18 px | 24 px | 40 px | 600 |
| H3 card | 16 px | 18 px | 32 px | 600 |
| Body | 14 px | 16 px | 24 px | 400 |
| Label / chip | 11 px (uppercase, +0.06em) | 12 px | 18 px | 500 |
| Code / meta | 12 px (mono) | 13 px (mono) | 20 px (mono) | 400 |

### 2.3 Spacing & radius

8 px grid. Tokens: `--s-1: 4px`, `--s-2: 8px`, `--s-3: 12px`, `--s-4: 16px`, `--s-5: 24px`, `--s-6: 32px`, `--s-7: 48px`, `--s-8: 64px`.

Radius: `--r-1: 8px` (chips), `--r-2: 12px` (buttons), `--r-3: 16px` (cards), `--r-4: 20px` (panels), `--r-pill: 9999px`.

### 2.4 Elevation (shadow + glass)

Three layers max. Beyond that, contrast collapses and the GPU hurts.

```css
--shadow-1: 0 1px 2px rgb(0 0 0 / .24);                       /* chip rest */
--shadow-2: 0 4px 12px rgb(0 0 0 / .25);                      /* card */
--shadow-3: 0 12px 32px rgb(0 0 0 / .35);                     /* modal */
--glass-blur: 16px;                                            /* default */
--glass-blur-soft: 8px;                                        /* dividers */
--glass-blur-modal: 28px;                                      /* full overlay */
--glass-tint: rgb(20 22 28 / .62);
--glass-highlight: inset 0 1px 0 rgb(255 255 255 / .12);      /* top lip */
```

Every glass surface: `background: var(--glass-tint); backdrop-filter: blur(var(--glass-blur)) saturate(160%); border: 1px solid var(--border); box-shadow: var(--shadow-2), var(--glass-highlight);`. Solid fallback in `@supports not (backdrop-filter: blur(1px))`.

### 2.5 Motion tokens

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 150 ms | hover, focus rings, micro-state |
| `--dur-base` | 250 ms | nav transitions, panel show/hide |
| `--dur-emph` | 600 ms | chart draw, count-up start |
| `--dur-celebrate` | 1800 ms | winner reveal, big count-up |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | exits, settle |
| `--ease-out-expo` | `cubic-bezier(.16,1,.3,1)` | count-up, drama |
| `--ease-inout` | `cubic-bezier(.4,0,.2,1)` | transitions |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | confetti, pop-in (use sparingly) |

All motion respects `@media (prefers-reduced-motion: reduce)` — see §6.1.

---

## 3. Tier 0 — Live match experience <a id="3-tier-0"></a>

The most visceral upgrade. The current round modal (`js/app.js:280`) is four bare number inputs. This is where players actually look at the screen — make it feel like a scoreboard, not a form.

### 3.0 The "Game Board" — replaces `showMatchRoundModal`

**Layout** (desktop ≥ 960 px wide):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ROUND 7                                                          ✕   │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                      │
│  ┌────────────────────────┐        ┌────────────────────────┐       │
│  │  ●  TEAM ALPHA         │   VS   │  ●  TEAM BETA          │       │
│  │  ─────────────         │        │  ─────────────         │       │
│  │       340              │        │       420              │       │
│  │  ▓▓▓▓▓▓▓░░░ 68%        │        │  ▓▓▓▓▓▓▓▓░░ 84%        │       │
│  │                        │        │                        │       │
│  │  PROMISE               │        │  PROMISE               │       │
│  │  ┌──┬──┬──┬──┬──┬──┐  │        │  ┌──┬──┬──┬──┬──┬──┐  │       │
│  │  │ 4│ 5│ 6│ 7│ 8│ 9│  │        │  │ 4│ 5│ 6│ 7│ 8│ 9│  │       │
│  │  ├──┼──┼──┼──┼──┼──┤  │        │  ├──┼──┼──┼──┼──┼──┤  │       │
│  │  │10│11│12│13│ BLIND│  │        │  │10│11│12│13│ BLIND│  │       │
│  │  └──┴──┴──┴──┴──────┘  │        │  └──┴──┴──┴──┴──────┘  │       │
│  │                        │        │                        │       │
│  │  ACTUAL: 8             │        │  ACTUAL: 5  (auto)     │       │
│  │  ━━━━━━━━●━━━━         │        │  ━━━●━━━━━━━━━         │       │
│  │  0      8           13 │        │  0   5              13 │       │
│  │                        │        │                        │       │
│  │  ┌──────────────────┐  │        │  ┌──────────────────┐  │       │
│  │  │     +82          │  │        │  │     −60          │  │       │
│  │  │   met + 2 extras │  │        │  │  over-extension  │  │       │
│  │  └──────────────────┘  │        │  └──────────────────┘  │       │
│  └────────────────────────┘        └────────────────────────┘       │
│                                                                      │
│  WHAT IF? Take 1 more → -80 (over-extension)                        │
│                                                                      │
│  [  COMMIT ROUND  ]                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Container.** Full-viewport modal, `--bg-glass-hi`, blur 28 px, radius 20 px, padding 32 px desktop / 16 px mobile. Max width 1080 px. Two team panels side-by-side; stack vertically below 720 px.

**Team panel.**
- Size: 480 × 560 px desktop, 100% width mobile.
- Background: solid `--bg-panel` with a **6 px left border in the team's color**.
- 4 px top accent line (`linear-gradient(90deg, teamColor 0%, transparent 100%)`).
- Header row: 12 px team-color dot, team name in H3, right-aligned current cumulative score in 56 px tabular numeric.
- Progress-to-500 bar directly below the score: 8 px tall, full panel width, `--r-pill`, filled with team color at `width = score/500*100%`. Caption: "68% to 500".

**Promise picker (chip grid).**
- Label "PROMISE" 12 px / 500 / uppercase / +0.06em / `--fg-muted` / `margin-bottom: 8px`.
- 10 chips for 4–13 + 1 "BLIND" chip. Each chip **48 × 48 px** (WCAG 2.5.5 AAA). 6-column grid desktop, 5-column mobile. `gap: 8px`.
- Chip rest: `--bg-panel`, 1 px `--border`, radius 12 px, numeral 18 px / 600 centered.
- Chip hover: border becomes team color, lift 1 px (`transform: translateY(-1px)`), 150 ms `--ease-out`.
- Chip selected: fill 100% team color, white numeral, 2 px ring at `color-mix(in oklab, teamColor, white 40%)`.
- BLIND chip: same size, label "BLIND" 11 px uppercase + tiny 🃏 glyph; when selected, fill `--blind-gold`, black text, and **hide the actual slider** (blind locks promise at 7 per game rules).

**Actual picker (linked sum-to-13 control).**
- Label "ACTUAL: 8" with the value inline at 18 px / 600.
- Track: 320 px wide, 12 px tall, `--r-pill`, `--bg-panel`. Tick marks at every integer (1 px, `--fg-dim`).
- Thumb: 24 px circle, team color fill, white border 2 px, shadow `--shadow-1`.
- **Linked behavior.** When Team A's actual moves to 8, Team B's actual instantly snaps to 5 with a 200 ms `--ease-out` tween and a 1 px slate flash on the affected thumb so the user sees the cause. This *enforces* `actual1 + actual2 = 13` visually — no error message needed.
- Below the slider: `±` steppers at 32 × 32 px for precision; arrow keys (←/→) also move the thumb when the slider has focus.
- Disabled values: if Team A's promise is "BLIND" and Team A's actual must be entered first, dim Team B's slider until A is committed.

**Live score preview card.**
- Appears the instant both promise & actual are valid for that team.
- 200 × 80 px, `--r-3`, padding 12 px.
- Background tinted by outcome:
  - Positive → `color-mix(in oklab, var(--success) 22%, var(--bg-panel))`
  - Negative → `color-mix(in oklab, var(--danger) 22%, var(--bg-panel))`
  - Blind success → `color-mix(in oklab, var(--blind-gold) 30%, var(--bg-panel))`
- Numeral 40 px / 800 / tabular, sign prefix `+` or `−`. Color = matching semantic token.
- Caption 11 px uppercase: "MET + 2 EXTRAS" / "OVER-EXTENSION" / "UNDER-PROMISE" / "BLIND!".
- Updates with a 200 ms cross-fade when the value changes.

**"What if?" strip.**
- Full-width below the two panels, 13 px / 400, `--fg-muted`.
- Shows the *delta* of taking 1 more or 1 fewer hand: e.g. "Take 1 more → −80 (over-extension penalty)".
- Teaches scoring through play — the most-clicked path to learning the rules.

**Commit Round button.**
- Bottom-centered, 320 × 56 px, `--r-pill`, `--gradient-1` background, white text 16 px / 700.
- Disabled state (33% opacity) until both teams have valid promise+actual and `a1 + a2 = 13`.
- On click: 80 ms scale-down to 0.97, then submit. See §3.1 for what happens after.

### 3.1 Round-result reveal (post-commit)

Don't just refresh. Run a 1.6 s sequence before showing the next round:

| t (ms) | Element | Animation |
|---|---|---|
| 0 | Round form | Fade to 0 over 200 ms `--ease-out` |
| 200 | Reveal panel | Slide up 16 px + fade in over 300 ms |
| 500 | Score numeral | Count up from 0 to round score over 700 ms `--ease-out-expo` |
| 600 | Outcome stamp | Pop in (`--ease-spring`) — "MET", "OVER-EXTENSION", "UNDER", or "🃏 BLIND!" at 48 px |
| 800 | Worm chart | Append new segment over 500 ms `--ease-out`; new dot lands with a 200 ms 1.4× scale bounce |
| 1200 | Cumulative scores | Count up to new totals over 600 ms; progress bars fill in parallel |
| 1600 | Sequence done | "Next round →" CTA fades in |

**Per-outcome flourish:**

- **Blind success (+140):** 1.5 s confetti burst from the team's panel — 80 particles, gold (`--blind-gold`) + team color, `spread: 60°`, `gravity: 1`, fired with `canvas-confetti`. A 🃏 stamp at 64 px lands behind the score numeral, then fades over 1 s.
- **Over-extension (−promise×10):** 240 ms horizontal shake on the team panel (`translateX(-6px → 6px → -3px → 3px → 0)`); red border pulse (1.5× weight, 600 ms back to normal).
- **Under-promise:** 400 ms dim-down on the promise chip that was selected (opacity 0.4 → 1) so the player visually links "promise too high" to the chip they clicked.
- **Met + extras:** 200 ms green check pulse next to the score, 16 px tick mark inside a circle that scales 0 → 1 with `--ease-spring`.

### 3.2 "Approaching 500" tension cues

Triggered when either team's cumulative ≥ 400.

- **Leader panel:** persistent slow pulse — 1400 ms cycle, `ease-in-out-sine`, opacity 0.85 → 1, scale 1.00 → 1.015 on the score numeral only. Outer glow `box-shadow: 0 0 24px 0 teamColor/40%`.
- **Both teams within 50 of 500:** "MATCH POINT" chip appears in the round header — 11 px uppercase, gold border 1 px, gold text, transparent fill. Steady (no flash). On the matches list card, the same chip appears.
- **"Points to win" mini-strip:** below each team's cumulative score, 13 px text "60 to win" updates live.

Apple Sports principle: **tension is built by slowing down, not speeding up.** No flashing.

### 3.3 Winner moment

When `match.status === 'completed'`:

1. **Worm chart freezes** with the winning team's line highlighted (3.5 px instead of 2.5 px), losing line dimmed to 50% opacity.
2. **500 line glows** gold for 1 s.
3. **Confetti** — 2 bursts at `{x:.2,y:.6}` and `{x:.8,y:.6}`, 100 particles each, team-color palette, total duration 2200 ms.
4. **Winner panel** slides in from below: team name 56 px / 800, "WINNER" label 14 px uppercase gold, final score `510 – 340` in 80 px tabular, round count "in 9 rounds".
5. **"Match story" auto-generated** below: 2–3 sentences pulled from `matchSummary()` — *"Alpha won 510–340 in 9 rounds. Beta led by 130 at round 5 before Alpha's blind in round 7 swung the match. Biggest swing: round 7 (Δ 220)."*
6. **Actions:** [Share] (copies text + opens native share if available) · [Replay] (see §7.1) · [Back to matches].
7. Optional **sound** (off by default, persisted in `localStorage`): subtle 800 ms airhorn sample. Hidden behind a 🔇 toggle in the header.

All celebrations gated by `prefers-reduced-motion` — see §6.1.

### 3.4 Component → moment-architecture mapping (Tier 0)

| Component | W | M | N | Notes |
|---|---|---|---|---|
| Game Board panel (§3.0) | ✅ | ✅ | ✅ | Highest priority — all three |
| Live score preview (§3.0) | ✅ | ✅ | ✅ | "What if?" is literally the N question |
| Round-result reveal (§3.1) | ✅ | ✅ |   | The "why" lands via outcome stamps |
| Approaching-500 pulse (§3.2) | ✅ |   | ✅ | Subsumed by Pressure Meter — see §3b.2 |
| Winner moment + Match Story (§3.3) | ✅ | ✅ |   | Bridges to memory reel |

---

## 3b. Tier 0.5 — Broadcast layer & Pressure meter <a id="3b-broadcast"></a>

This tier sits *between* the live data (§3) and the historical stats (§4–§5). It's the narrator layer — present whenever a match is live or just completed.

### 3b.1 Broadcast Strip — "what just happened, why, what's next"  `[W] [M] [N]`

A persistent 3-line strip at the top of any live match view (and as a banner on the matches list when a match is in progress). It answers the three questions in three lines, updated after every round.

**Layout** (full width, 96 px tall desktop / 80 px mobile, glass surface, sits below the round counter):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ●  Alpha just hit a +82 (promise 8, took 10).                       [WHAT] │
│    They're now 40 ahead with momentum — Beta's last 3 rounds averaged −20. │
│    A blind next round flips it. Without one, Alpha closes in 3.    [NEXT] │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Spec.**
- 3 lines, top-to-bottom: **WHAT** (the fact), **WHY** (the meaning), **NEXT** (the implication).
- Type: 16 px / 500 desktop, 14 px / 500 mobile. Line height 1.5. `--fg` for primary, `--fg-muted` for secondary.
- Tiny labels right-aligned in 10 px uppercase `--fg-dim`: `WHAT` `WHY` `NEXT`. These act as scaffolding for first-time viewers — they learn the structure subconsciously after watching 2 rounds.
- Left-edge: 3 px accent bar in the *acting* team's color (the team that just bid/scored).
- Background: glass, `--bg-glass`, 16 px blur, 14 px padding, radius 12 px.
- Transition: when a new round is committed, the strip **cross-fades** 250 ms `--ease-out`. No slide, no pulse — the content change *is* the signal.

**Copy generator** (new function in `js/utils/stats.js`):

```
narrate(match) → { what: string, why: string, next: string }
```

Pull from already-computed `matchSummary()` + `cumulativeSeries()` + new `pressureState()` (§3b.2). Templates per outcome:

| Last round | WHAT template |
|---|---|
| Met + extras | `"{team} hit +{score} (promise {p}, took {a})."` |
| Blind success | `"{team} called blind and hit it (+140)."` |
| Over-extension | `"{team} took {a} on a promise of {p} — over-extended (−{p*10})."` |
| Under-promise | `"{team} missed their {p} promise (only took {a}, lost {p*10})."` |

WHY templates draw on trend: cumulative lead / deficit, recent form, blind history. NEXT templates compute the minimum rounds for either team to close out at current scoring pace, and flag whether a single blind flips momentum (`leadDeficit < 140` → "a blind flips it").

**Why this matters.** Without it, the dashboard is a record. With it, it's a *broadcast*. This is the highest-leverage net-new piece in the doc — see §8.

### 3b.2 Pressure Meter — 4-state spectrum  `[W] [N]`

Replaces my earlier "approaching 500 cues" (§3.2 in Tier 0). The whole UI shifts subtly based on a single derived state:

```
pressureState(match) → 'calm' | 'building' | 'critical' | 'match-point'
```

| State | Trigger | Visual response | Motion response |
|---|---|---|---|
| **Calm** | both teams < 300 | default surfaces, default contrast | normal animation timings |
| **Building** | either team 300–399 | leader's cumulative numeral gains 1 px accent underline in their team color | nothing else changes |
| **Critical** | either team 400–449 | leader panel gains a 12 px outer glow at 25% opacity in team color | all non-essential animations slow by 1.3× — cross-fades become 325 ms instead of 250 ms |
| **Match-point** | either team ≥ 450 (or both within 50 of 500) | "MATCH POINT" chip in round header (11 px uppercase, gold border 1 px on transparent, no fill); leader numeral gains 24 px outer glow at 40% opacity | all motion slows by 1.6×; background gradient enters a 4 s slow-pulse at ±4% lightness; everything else freezes |

**Key principle:** tension is signaled by **stillness and slowing**, not by acceleration. The room gets quieter, not noisier. (Apple Sports / Onefootball pattern.)

**Where it surfaces:** Game Board (§3.0), Matches list cards (§5.6), TV mode (§7.2), Broadcast Strip (§3b.1 — its tone shifts: WHAT becomes terser, NEXT becomes sharper).

### 3b.3 First-Time Viewer Walkthrough  `[M]`

A 20-second progressive overlay that triggers on first visit to a live match (gate on `localStorage.firstMatchWatched !== 'true'`). Five frames, each dismissible, total ≤ 20 seconds if the viewer just reads:

| Frame | Anchor | Copy (≤ 12 words) |
|---|---|---|
| 1 | Team panel | "Each team **promises** how many hands they'll take." |
| 2 | Promise picker | "Promises run 4 to 13. Or call **blind** — locked at 7." |
| 3 | Actual slider | "The two teams' **actuals** always add up to 13." |
| 4 | Score preview | "Hit your promise → score. Miss → minus. Take 2× → also minus." |
| 5 | Worm chart | "First to **500** wins. Watch the lines race." |

**Spec.** Each frame is a glass card (`--bg-glass-hi`, 16 px blur), positioned next to its anchor with a 12 px arrow pointing at it. Card: 280 × auto, padding 16 px, radius 12 px. Header 12 px uppercase `--fg-muted` ("Step 2 of 5"). Body 15 px / 500. Footer: [Skip] (left, ghost button) + [Next →] (right, primary). On step 5: [Got it!] replaces both.

Backdrop dims the rest of the UI to 30% — focus is forced on the anchor. Esc key skips. Once dismissed: never auto-shows again, but a "Replay walkthrough" item appears in the header overflow menu. This is the §5.1 scoring legend's *complement*, not its replacement — the legend is a reference, the walkthrough is onboarding.

### 3b.4 Spectator Pass  `[W] [M]`

Every primary screen (live match, matches list, stats) gets a hidden-by-default Spectator Pass. Toggle in the header (◐ icon), or auto-engages on `?tv=1` (see §7.2).

**What changes in Spectator Pass:**
- All input controls hide (Commit Round button, promise chips, sliders, sort dropdowns, action buttons).
- Type scales up: body 16→20 px, headings +25%, score numerals jump to the "TV" column from §2.2.
- The Broadcast Strip (§3b.1) becomes the most prominent element — doubles in height.
- One motion at a time enforcement gets stricter — only the Pressure Meter and the worm chart animate.
- Padding doubles. Hierarchy gets ruthless: anything that isn't story is gone.

This is the test we run on the regular screens too: *if Spectator Pass would hide it, does it actually belong on the regular screen?*

### 3b.5 Team Theme Pack (tasteful)  `[W]`

Each team picks one accent layer on top of the auto-assigned color (§2.1):

- **Icon** — one glyph from a curated set of ~24 (clubs, swords, comet, anchor, fox, etc.). Renders 16 px in the leaderboard, 32 px on the team card, 96 px in the winner moment. No emoji, no custom uploads — keep it consistent.
- **Pattern** — already specified in §2.1 (dot / stripe / chevron / cross-hatch). The icon and pattern compose to make a colorblind-distinct visual identity.
- **Sound cue (optional, opt-in)** — one 400 ms sample played at *their* winner moment only. Three options: airhorn, fanfare, gentle chime. Off by default; player can opt-in per team in team settings.
- **No badges per achievement.** Resist the "fighting game character select" temptation — one icon, one pattern, one optional sound. Adults playing a card game shouldn't feel like they're picking a Smash Bros fighter.

Data model: `Team.theme = { iconKey, soundKey | null }`. Color stays deterministic from `teamColor()` so the palette can never collide.

---

## 4. Tier 1 — Stats that tell a story <a id="4-tier-1"></a>

### 4.0 Moment Replay — the 3-pivot memory reel  `[W] [M]`

The single best post-match feature. Most people remember **peaks and pivots**, not every round. After a match completes, surface exactly three turning points and let the viewer scrub through them.

**Algorithm.** From `match.rounds` + `cumulativeSeries()`:

1. **Biggest swing** — round with the largest `|team1.score − team2.score|`.
2. **Best blind** — highest-scoring successful blind in the match, if any. If none, substitute *highest single round score*.
3. **Worst over-extension** — biggest negative score caused by `actual ≥ promise × 2` (not blind). If none, substitute *biggest under-promise miss*.

If any of the three resolve to the same round, fall through to the next-best candidate so all three are distinct rounds when possible.

**Layout.** A horizontal strip below the winner moment (§3.3), 3 cards side-by-side. Each card 320 × 200 px, glass, radius 16 px, padding 16 px:

- Top: 11 px uppercase label — "BIGGEST SWING" / "BEST BLIND" / "WORST CALL".
- Middle: round number + the score delta in 32 px tabular ("R7 · Δ 220").
- Bottom: one-sentence narration from the same generator as §3b.1.
- Click → opens the worm chart zoomed to that round, with the pre-round state shown for 600 ms before the round resolves on the chart.

This is the curated alternative to the **full replay** in §7.1. Both can coexist — replay is for completionists, the 3-pivot reel is what gets shared.

### 4.1 Promise Accuracy (the missing skill metric)  `[W] [M]`

`hitRate = roundsMet / roundsBid`. A round is "met" when `actual ≥ promise && actual < promise × 2`, OR `blind && actual ≥ 7`.

- **New function** in `js/utils/stats.js`: `promiseAccuracy(teams, matches)` returning `{ teamId: { bid, met, rate } }`.
- **KPI tile** on Stats page: "Promise Accuracy · 64%" with a 4 px under-line bar showing the rate.
- **Leaderboard column** (insert between Avg and Form): "Acc%" — number in 14 px tabular + 60-px-wide horizontal bar behind the cell.
- **Team profile**: large dial — 160 × 160 px ring chart, accent `--success` for rate, `--danger` for miss. Center numeral 28 px / 700.

### 4.2 Blind economy  `[W] [M]`

`kpis()` (`js/utils/stats.js:25`) only counts blinds. Add:
- `blindEconomy(matches)` → `{ called, successes, failures, successRate, netEV }`. EV = `successes × 140 + failures × -70`.
- Hot-strip chip: "🃏 Net blind EV: +280" — gold border 1 px when positive, danger when negative.
- Leaderboard badge: small 🃏 next to a team's name if they've called ≥ 3 blinds. Tooltip: "5 blinds called · 3 hit (60%) · Net +280".

### 4.3 Over-extension rate (discipline metric)  `[M]`

`matchSummary()` (`js/utils/stats.js:345`) tracks per match — aggregate.
- New: `overExtensionRate(teamId, matches)` → percentage of rounds where `actual ≥ promise × 2`.
- Surface as a hot-strip chip "Most disciplined: Alpha (2% over-ext)" and as a tooltip in the radar (§4.7).

### 4.4 Comebacks  `[W] [M]`

`cumulativeSeries()` (`js/utils/stats.js:114`) makes this trivial.
- New: `comebackStats(matches)` → for each completed match, the max deficit faced by the eventual winner.
- Hot-strip chip: "🔄 Biggest comeback: Alpha overcame −180 vs Beta".
- Match detail header: "Max deficit overcome: 180" rendered next to the round count.

### 4.5 Round-score histogram  `[W]`

Bins at the meaningful thresholds:
`≤−100 | −80 to −51 | −50 to −1 | 0 | 1 to 50 | 51 to 100 | 101 to 139 | 140`.

- Render as vertical bars, 280 × 120 px, color = `--success` for positive bins, `--danger` for negative, `--blind-gold` for the +140 bin, `--neutral` for 0.
- Hover shows count and example matches.
- Surfaces: tournament-wide on Stats page; per-team on team profile.

### 4.6 Average margin of victory  `[M]`

`roundsWon − roundsLost` already in `leaderboard()`.
- Add `avgMargin` and a new column "Margin" next to Win%. Positive in `--success`, negative in `--danger`, with `+/−` prefix.

### 4.7 Style fingerprint (use radar carefully)  `[M]`

⚠️ Radar charts mislead: area scales with the square of the values, and shape depends on axis order. **Use only with ≤ 8 axes and ≤ 2 series.** For us, 4 axes is enough:

- **Aggressive** = avg promise (normalized 4–13 → 0–1)
- **Reliable** = promise hit rate
- **Bold** = blinds per match (normalized vs tournament max)
- **Disciplined** = 1 − over-extension rate

Render as a 200 × 200 px radar on the team card, with a translucent fill (`team color at 25% alpha`) and 2 px stroke (team color). **Alongside, render the four numbers as small-multiple bars** (Tufte's preferred substitute) so the data is also readable without the radar's distortions. Both are present; the radar provides identity, the bars provide precision.

---

## 5. Tier 2 — Glanceable understanding <a id="5-tier-2"></a>

### 5.1 Inline scoring legend

New viewers can't decode `−40` vs `+82` vs `+140`. Add a collapsible card on the Stats page; default open on first visit (persist dismissed state in `localStorage`).

**Layout** — 4 example rows in a 2-col table, 13 px text:

| Promise | Actual | Score | Why |
|---|---|---|---|
| 8 | 5 | **−80** | Under-promise — forfeit full promise (§4.1) |
| 8 | 10 | **+82** | Met + 2 extras (§4.2) |
| 4 | 9 | **−40** | Over-extension — Actual ≥ Promise × 2 (§4.3) |
| 7 (Blind) | 8 | **+140** | Blind success (§4.4) |

The "Why" links to the relevant section in `CLAUDE.md` (open in new tab). Card is `--bg-panel`, 16 px padding, radius 16 px, 1 px border. Header "HOW SCORING WORKS" 12 px uppercase, chevron toggle on the right.

### 5.2 KPI tiles — context line

`renderKpiTiles` (`js/app.js:988`) currently shows label + number. Add `sub` and `onClick`.

| Tile | Value | Sub | Click |
|---|---|---|---|
| Matches | 24 | "3 this week" | scroll to matches |
| Rounds | 187 | "avg 7.8 / match" | — |
| Highest Round | +140 | "Alpha · R5 vs Beta" | open that match |
| Blinds | 17 | "11 hit · 65% · Net +280" | filter rounds list to blinds |
| Promise Accuracy | 64% | "best: Alpha 78%" | open Alpha's profile |

**Tile spec.** 200 × 120 px desktop, 50% width mobile (2 per row). Padding 16 px. Value 32 px / 800 tabular at top-left. Label 12 px uppercase under it. Sub 12 px `--fg-muted` along the bottom edge. Left edge: 4 px accent in the tile's semantic color. Hover: 1 px translate-up, `--shadow-2`. Click: 80 ms scale to 0.98.

### 5.3 Leaderboard scannability

Current table (`js/app.js:1003`) is 10 dense numeric columns. Improvements:

- **Row left-border** in team color (4 px) — instantly identifies the team without needing to read the name.
- **Inline data bars** behind Total and Avg cells: 100% width, 6 px tall, `--r-pill`, fill = `teamColor at 30% alpha`, width = `value / maxInColumn * 100%`. Number stays on top.
- **Sparkline** column showing last-5 score series per team — 80 × 24 px canvas, 1.5 px stroke in team color. Reuses `mountSparklines` infrastructure.
- **Compact toggle** in the table header: hides Played, Wins, Losses, Total when on — leaves Rank/Team/Win%/Pts/Form/Spark.
- **Rank chips**: 1st gold `--blind-gold`, 2nd silver `oklch(82% 0.01 250)`, 3rd bronze `oklch(60% 0.10 50)` — circular 28 px badges instead of plain numerals.

Row height: 56 px (clears 48 px tap target for the team name link).

### 5.4 H2H matrix intensity

Current matrix (`js/app.js:532`) shows W-L only. `5-1` looks like `1-0`.

- **Cell background** = `color-mix(in oklab, var(--success) X%, var(--bg-panel))` where X = `winRate * 60` (max 60% to keep numerals legible).
- **Mini split bar** inside each cell: 80% of cell width, 4 px tall, two segments — green for wins, red for losses, proportional.
- **Cell size** 64 × 64 px desktop, 44 × 44 px mobile. Tap target meets WCAG 2.5.8.
- **Diagonal** rendered as 8 diagonal stripes at `--fg-dim/20%`.
- **Hover/focus** tooltip: last 3 results with dates.
- **Sort dropdown** above matrix: by points / by total score / alphabetical — currently always rank-sorted (`headToHeadMatrix` in `stats.js:312`).

### 5.5 Recent Activity → match cards

Current (`js/app.js:1078`) is plain text. Each row becomes a 64 px tall card:

- Two color bars on the left (8 px each, team colors, stacked).
- Score `123 – 87` in 18 px tabular, winner in `--success`, loser in `--fg-muted`.
- Round count chip + duration chip.
- Date in `--fg-dim` 12 px, right-aligned.
- Whole card clickable to open match detail.

### 5.6 Match-card glanceability (list view)

Each card on the Matches list should answer "what happened?" in <1 s:

- **Two color bands** at top (4 px each side-by-side, full width).
- **Score** 32 px tabular center, winning side in team color.
- **Winner crown** 👑 in front of the winner name; loser dimmed to 70%.
- **Sparkline** below the score (the existing one), 200 × 32 px.
- **Chip strip** along bottom: round count, blinds (gold), biggest swing — each 11 px uppercase `--r-pill`.
- Card height ~ 220 px, padding 16 px, radius 16 px.

---

## 6. Tier 3 — Motion, polish, accessibility <a id="6-tier-3"></a>

### 6.1 Reduced motion (non-negotiable)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .confetti, .pulse, .shimmer, .count-up { display: none !important; }
}
```

- Count-ups → instant value.
- Confetti → suppressed entirely.
- Pulse glows → static border in the same color.
- Worm-chart reveal → no draw-on; renders complete.

### 6.2 Keyboard & screen readers

- **Promise chip picker**: `role="radiogroup"` on the grid, `role="radio"` on each chip, `aria-checked`, arrow keys cycle, Space/Enter selects. Focus ring 2 px team color + 2 px offset.
- **Linked sliders**: `role="slider"`, `aria-valuemin/max/now`, `aria-controls` pointing at the opponent's slider so screen readers announce the sum constraint.
- **Leaderboard headers** (`js/app.js:1032`): `<th>` is focusable, Enter sorts, `aria-sort="ascending|descending|none"` on the active column.
- **Modal**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the H2. Focus trap on open, restore on close. Escape closes (already partly done).
- **All semantic colors**: paired with text or icon — never hue alone. Win/loss chips include a `+`/`−` prefix.
- **Contrast targets** (APCA, candidate WCAG 3):
  - Body text 14 px / 400: **Lc 90**.
  - Score numerals ≥ 60 px / 700: **Lc 45**.
  - Chart axis labels 12 px: **Lc 75**.
  - Verify against the *composited* glass background, not the `rgba` value.

### 6.3 Light mode

Toggle in header, persisted in `localStorage`. Use `data-theme="light"` on `<html>` and override tokens:

```css
[data-theme="light"] {
  --bg-app: oklch(98% 0.005 250);
  --bg-panel: oklch(100% 0 0);
  --bg-glass: rgb(255 255 255 / .70);
  --fg: oklch(15% 0.02 250);
  --fg-muted: oklch(40% 0.02 250);
  --border: oklch(85% 0.02 250 / .6);
}
```

Team colors stay the same — they're already mid-lightness (L≈72%) and work on either background. Re-verify contrast on light glass.

### 6.4 Number formatting

`Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })` for scores (handles 1,500 grouping). `Intl.NumberFormat(..., { style: 'percent', maximumFractionDigits: 0 })` for rates. Centralize in `js/utils/format.js`.

### 6.5 Empty states sell the feature

Current "Stats appear once a match is started" is dead text. Instead, show a **demo match worm** with seeded fake data plus a "Try a demo round →" CTA that opens the round modal in demo mode (no Firestore writes). Lets visitors *feel* the game before any auth.

### 6.6 Skeletons everywhere

Audit every async path (`refreshTeamsList`, `refreshMatchesList`, `refreshStats`, `viewTeamDetails`) — skeleton on **every** load, not just first. Skeleton shimmer: linear-gradient sweep at 1.4 s cycle, `--ease-inout`, 80% opacity. Suppress under reduced motion.

### 6.7 Spline background performance

`index.html:11,17` loads ~1 MB of Spline runtime. LCP hit.
- `defer` the script tag.
- Hide entirely under `prefers-reduced-motion`.
- Hide on viewport width < 720 px (mobile doesn't need it).
- Always render a static gradient fallback so the page doesn't go black if Spline fails.

---

## 7. Tier 4 — Optional power features <a id="7-tier-4"></a>

### 7.1 Full match replay  `[W]`

The *completionist* sibling of §4.0 Moment Replay. §4.0 (3 turning points) is the default post-match experience because it matches how memory actually works. **Full replay** is for the rare viewer who wants the whole arc — typically a player reviewing their own match.

"Replay All" button on completed match detail. Plays rounds 1 per 700 ms, worm chart draws live, score numerals count up per round. Spacebar pauses, ←/→ scrubs, number keys jump to a round. Pure animation over existing data — no Firestore writes, no new aggregations. Build *after* §4.0; reuse the same chart-zoom + narration code path.

### 7.2 TV mode

`?tv=1` URL flag. Hides sticky nav and action buttons. Layout: leaderboard top-left (40% width), hot strip across the top, live match worm bottom-center (full width, 60% height). All type sizes upgraded to the "TV" column in §2.2. Designed for 1080p projection in a tournament room. Auto-refreshes every 30 s.

### 7.3 Per-player stats

Requires recording per-round attribution (who actually took each trick). Data-model change — flag as future, requires `CLAUDE.md` review since it touches the round shape.

### 7.4 Export / share

- "Download match card" — renders the worm + summary to a 1200 × 630 PNG via `canvas.toBlob` (also OG-card sized for sharing).
- "Copy summary" — plain text for chat apps.

### 7.5 Public spectator URL

Read-only `/spectate/:matchId`. No auth required, live updates via Firestore snapshot listener. **Requires** tightening `firestore.rules` to separate read (public) from write (auth). The current rules are wide-open writes — fix this first regardless.

---

## 8. Recommended first build order <a id="8-build-order"></a>

Re-prioritized around the Moment Architecture (§0). Each item is the most "what / why / next" payoff for the hours spent. Build top-to-bottom.

1. **§2 Design tokens** *(1–2 days)*. Lock the OKLCH palette, type scale, motion tokens, glass system. Everything downstream depends on this. Without it, future work bakes in inconsistency.

2. **§3b.1 Broadcast Strip + §3b.2 Pressure Meter** *(2–3 days)*. The narrator layer is the single biggest engagement upgrade in the doc and the most "moment-architecture" feature here — it literally answers WHAT / WHY / NEXT on every round. Build the `narrate()` + `pressureState()` aggregations in `stats.js`, then wire the strip into the live match view first, then the matches-list banner.

3. **§3.0 Game Board redesign** *(3–5 days)*. The moment players look at the screen. Promise chip picker + linked sum-to-13 sliders + live score preview turn data entry into a play. Make sure the Game Board respects the Pressure Meter (#2) and hosts the Broadcast Strip.

4. **§3.1 Round reveal + §3.3 Winner Moment + §4.0 Moment Replay** *(3–4 days)*. The reveal lands the WHY; the winner moment + 3-pivot replay turn the match into the memory reel. These three share the count-up, confetti, and chart-zoom primitives — build together.

5. **§3b.3 First-Time Viewer Walkthrough + §5.1 Scoring Legend** *(1 day combined)*. Onboarding + reference. Together these mean a brand-new viewer understands the game in 20 seconds and has the lookup table for later.

6. **§4.1 Promise Accuracy + §4.2 Blind Economy** *(1 day)*. The two skill metrics the leaderboard is missing. Cheap because the aggregations are small additions to `stats.js`.

After these six, the rest of Tiers 1–3 fall in naturally because they all consume the tokens, aggregations, and narrative primitives established above.

**Lens check before merging any PR**: does the new component answer at least one of `[W] [M] [N]` from §0? If not, defer it.

---

## 9. Guardrails <a id="9-guardrails"></a>

- **Moment Architecture (§0) is the merge gate.** Every new component must answer at least one of WHAT / WHY / NEXT, and be tagged `[W] [M] [N]` in this doc when added. Components that answer none of the three are decoration — cut or downgrade.
- **One element animates at a time.** When in doubt about whether to animate, don't. The Pressure Meter slows the room down on purpose; counter-animations break it.
- **No new game rules.** Every item here is presentation. If anything would require a rule change, stop and follow the protocol in [`../CLAUDE.md`](../CLAUDE.md) §Change Control.
- **Keep `stats.js` pure.** New aggregations go in `js/utils/stats.js` as pure functions — no DOM, no Firestore. Jest tests in `tests/` (mirror `tests/scoring-system.test.js`), 80% coverage threshold in `jest.config.js`.
- **Reuse Chart.js v4.** Already loaded (`index.html:12`). Don't add another chart lib.
- **Reuse `canvas-confetti`** for celebrations (small, dependency-free, GPU-friendly). Don't roll your own particle system.
- **Reuse the team palette + pattern pairing.** Single source of truth in `stats.js`.
- **Every color via token, never hex.** New components reference `--success`, `--blind-gold`, etc.
- **Motion gated by `prefers-reduced-motion`.** Non-negotiable for accessibility and battery.
- **Contrast verified on composited glass**, not on the rgba alone. Test against bright-photo backgrounds since the Spline scene includes light areas.
- **Tap targets ≥ 48 px** for live-play inputs (round entry, promise/actual). ≥ 44 px elsewhere. ≥ 8 px spacing between adjacent targets.
- **Tabular numerals** on every count-up, score, KPI, and chart label so digits don't shimmy.

---

## References (selected)

- ESPN scoreboard / scorebug pattern — *NewscastStudio, 2024-2025 redesigns*
- Apple Sports — Live Activities, motion backgrounds, match-point cue
- FiveThirtyEight 2020 forecast — annotated worm-chart pattern
- Tufte, *Beautiful Evidence* — sparkline dimensions
- Material Design 3 — easing & duration tokens
- Apple HIG — 44 pt minimum hit target
- WCAG 2.2 §2.5.8 — 24 × 24 px minimum; §2.3.1 flashing; §2.2.2 pause/stop
- APCA — Lc 45/75/90 contrast targets
- Radix Colors & Vercel Geist — semantic token model
- Okabe-Ito, Paul Tol — colorblind-safe categorical palettes
- `canvas-confetti` (catdad) — particle count / spread / decay defaults
- CountUp.js — smart-easing count-up pattern
- NN/g — Input Steppers, Sliders/Knobs, target sizes
- Apple "Liquid Glass" (visionOS, iOS 26) — modern glassmorphism rules
