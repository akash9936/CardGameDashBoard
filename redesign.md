# Redesign & Improvement Backlog — Card Game Dashboard

> **Status:** v2 — top 50 ideas reviewed and debated by 6 personas (12 agents, 2 rounds);
> synthesis, adopted new ideas (51–58), priority tiers, and cuts are at the bottom.
> **Hard constraint:** Game rules in `CLAUDE.md` are **locked**. Every idea below is
> rules-preserving — nothing changes scoring, promise ranges, blind values, the 500-point
> win condition, or any other §1–§6 rule. Ideas that surface rules differently (advisors,
> stats, visualizations) are allowed; ideas that alter outcomes are not.

---

## A. Stats & Analytics (ideas 1–13)

1. **Match timeline chart** — per-match line chart of cumulative score by round, showing the race to 500 (data already in `roundHistory`).
2. **Promise calibration scatter** — promised vs actual per team: are you an over-bidder or sandbagger? Builds on `promiseAccuracy` in `stats.js`.
3. **Blind-bid ROI panel** — per team: blinds attempted, success rate, net points from blinds (extends existing `blindEconomy`).
4. **Streak tracking** — current and all-time longest win/loss streaks, shown as a chip on the leaderboard.
5. **Elo-style skill rating** — a second ranking column that weights wins by opponent strength; league points stay authoritative.
6. **Records page** — all-time records: biggest single round, fastest match to 500, most rounds in a match, biggest comeback.
7. **Clutch stats** — performance in rounds where either team was within 100 of the 500 threshold.
8. **Comeback tracker** — largest deficit ever overcome to win a match.
9. **Season system** — archive a season, freeze its leaderboard into a Hall of Fame, start fresh; all-time stats still aggregate across seasons.
10. **Rivalry pages** — dedicated head-to-head page per team pair: history, streaks, average margins, blind duels (extends `h2hMatrix`).
11. **Live win-probability meter** — during an in-progress match, estimate win chance from score gap + historical data. Informational only.
12. **Round-number heatmap** — do teams score better in early vs late rounds? Heatmap of average score by round index.
13. **Shareable stat cards** — export a team's stat block or a match summary as a PNG for WhatsApp/Slack sharing.

## B. Player Experience (ideas 14–22)

14. **"What do I need" widget** — for an in-progress match: points to 500, and which promise outcomes (per §4) would get there this round. Pure arithmetic on locked rules.
15. **Bid history hints** — when promising, show your historical actual-hands distribution ("you take 6+ hands 43% of the time"). Advisory, never enforced.
16. **Achievements/badges** — first blind success, a 13-hand round, 5-win streak, survived a 140-swing, etc. Derived from round history.
17. **Match MVP moments** — auto-detect the highlight of a match (biggest swing round, decisive blind) and pin it to the match card (extends `winnerMoment`/`momentReel`).
18. **Round entry undo** — undo the last round within a grace window, with an audit trail entry, rather than manual DB surgery.
19. **Personal trajectory page** — a team's score trend, form, calibration and rank history in one profile view.
20. **Web push notifications** — notify followers when a match starts, hits a blind, or finishes.
21. **Match comments / trash-talk board** — short comments on a match, visible in replay.
22. **Confetti + sound polish on win** — richer `winnerMoment` with team-color confetti and optional sound, respecting reduced-motion.

## C. Spectator Experience (ideas 23–28)

23. **TV/broadcast mode** — full-screen auto-cycling view (leaderboard → live match → records) for an office wall display.
24. **Live match spectating** — Firestore listeners so a round entered on one device appears on all open dashboards within seconds, with the existing `roundReveal` animation.
25. **QR spectator invite** — QR code on the dashboard that opens the read-only spectator view (extends `spectatorPass`).
26. **Commentary feed** — expand `narrate.js` into a scrolling live commentary panel with selectable tone (neutral / hype / roast).
27. **Public match share pages** — a per-match permalink with Open Graph image so shared links unfurl nicely.
28. **Score ticker embed** — a tiny embeddable widget/iframe showing live standings for other internal pages.

## D. Visual & UX (ideas 29–38)

29. **Mobile-first score entry** — one-thumb round entry flow: big steppers, promise slider, single confirm; current form is desktop-shaped.
30. **Leaderboard cards on mobile** — collapse the wide table into stacked cards under a breakpoint instead of horizontal scroll.
31. **Light theme + toggle** — currently dark-only; add a light palette via CSS custom properties and remember the choice.
32. **Replace Spline 3D background** — swap the heavy remote 3D scene for a lightweight CSS/canvas ambient background; biggest single page-weight win.
33. **Design-token cleanup** — one consistent spacing/type/color scale in `styles.css`; kill one-off magic values.
34. **Skeleton loaders** — content-shaped placeholders instead of spinners for leaderboard/matches while Firestore loads.
35. **Rank-change indicators** — ▲▼ movement vs. previous standings next to each leaderboard rank.
36. **Accessibility pass** — semantic tables, ARIA labels on chips/sparklines, focus states, WCAG-AA contrast, full keyboard nav.
37. **Empty states with guidance** — friendly zero-data states: "No matches yet — create one" with a pointed CTA.
38. **Reduced-motion audit** — honor `prefers-reduced-motion` across `animate.js`, reveals, and replays.

## E. Tech Health (ideas 39–46)

39. **Split `app.js`** — 1,835 lines into per-view ES modules (`views/teams.js`, `views/matches.js`, `views/stats.js`) with a tiny router; no framework needed.
40. **XSS hardening** — team names and member names are interpolated into `innerHTML` across the app; add an escape helper and use it everywhere.
41. **Firestore security-rules audit** — verify writes require the admin auth and reads match the spectator model; document the rules in `claude/`.
42. **CI test gate** — run the existing Jest suite in the GitHub Action and block deploy on failure (currently deploy runs without tests).
43. **Centralize rule validation** — one `rules.js` module implementing CLAUDE.md §4/§6, imported by `Match.js`, forms, and tests — no duplicated formulas.
44. **Error handling + offline queue** — retry/backoff for Firestore ops, queue round submissions made while offline, surface failures with toasts instead of silent console errors.
45. **E2E smoke tests** — Playwright flow: create teams → match → rounds → win at 500 → leaderboard reflects it; run in CI.
46. **PWA** — manifest + service worker: installable on phones, cached shell, last-known scores viewable offline.

## F. Admin & Data Entry (ideas 47–50)

47. **Keyboard-first round entry** — number keys + Enter to log a round in seconds; auto-focus flow; the actual-hands pair auto-completes to 13.
48. **Correction workflow** — edit a past round with a required reason; recompute downstream totals; show an "edited" marker in replay (integrity per CLAUDE.md §3.3).
49. **Match scheduler** — plan upcoming matches with date/time; scheduled matches show on the dashboard as "upcoming" with notification hooks.
50. **Automated backup** — nightly Firestore export via scheduled GitHub Action using the existing `scripts/dump-db.js`, committed to a private backup location; one-click restore doc.

---

## Persona Review — Debate Outcomes

Six personas reviewed the list independently, then each read the other five reviews and
debated back (rebuttals, concessions, final top-5 votes). Summary of where they landed:

| Persona | Final top 5 (post-debate) | Core stance |
|---|---|---|
| **Score Viewer** (checks scores, never plays) | 32, 30, 4, 35, 24 | "Fix my 30-second phone check: kill the Spline load, un-scroll the leaderboard, hand me the diff since Tuesday." |
| **Player** (plays daily) | 29, 18, 41, 14, 4 | "Everything that touches the 30 seconds between hands: one-thumb entry, undo, and the math to 500. Lock the record — my streaks are worthless if anyone can edit the DB." |
| **Engineer** (maintains it) | 41, 40, 42, 43, 32 | "Verified: world-writable Firestore, unescaped `innerHTML` in ~15 places, no CI gate, repo root published to gh-pages. Foundation first — but conceded the app.js split can wait." |
| **Visual Designer** | 32, 33, 30, 29, 36 | "The product reads as a pile of effects, not a system. Tokens + information diet on the leaderboard; conceded light theme can wait." |
| **Product Thinker** | 29, 24, 32, 41, 14 | "One arc for 3 releases: make the game-night ritual live. Cut everything built for an audience this tool doesn't have (OG pages, push infra, embeds, Elo)." |
| **League Admin** (enters every score) | 41, 48, 50, 18, 47 | "A wrong score that can't be fixed cleanly is my nightmare. Real auth, corrections with audit trail, nightly backups, faster entry." |

**Verified findings surfaced during review** (Engineer, confirmed against the repo):
- `firestore.rules`: every collection is `allow read, write: if true` — anyone with the URL can read, alter, or wipe all league data. Makes every stats/integrity feature moot until fixed.
- Team/member names are interpolated into `innerHTML` unescaped in many places — stored XSS; with live listeners (#24) it would become *pushed* XSS.
- `deploy.yml` publishes the repo root: `db-dump/` (real match data), `tests/`, `scripts/`, `claude/` are all on the public gh-pages branch.
- The Jest suite (17 files covering the locked rules) never runs in CI; deploys are ungated.
- Firebase SDK 8.6.1 (compat, unsupported) + chart.js + confetti + Spline loaded from CDNs with no SRI/CSP pinning.

**Strongest debate dynamics:**
- **#32 (replace Spline) — near-unanimous** (4 final-top-5 votes, endorsed by all six): it's simultaneously the Viewer's cold-start fix, the Designer's coherence fix, the Engineer's supply-chain fix, and the Player's at-the-table load fix.
- **#41 (security) — biggest mind-changer** (4 votes): four personas moved it *up* after the Engineer's findings; consensus hardened it from "audit" to "implement real Firebase Auth at the DB boundary, with a persistent trusted-device session for the Admin."
- **#29 (mobile entry) reframed** from comfort to *integrity*: Player + Admin argued mis-taps in a desktop-shaped form are how wrong scores are born; Engineer and Designer conceded.
- **#5 (Elo) — unanimously cut** by all six: "one scoreboard, one truth."
- **#18 vs #48** (undo vs full correction workflow): Product's "80% of corrections are ten seconds ago" argument won — undo ships first, correction workflow follows.
- **#9 (seasons) deferred, not killed**: a data-model migration is too risky before backups (#50) and a CI gate (#42) exist; Player added the condition that all-time records must survive season freezes.
- **#39 (split app.js) demoted by its own advocate**: the Engineer conceded it's maintainer ergonomics — to be done incrementally, never as a gate on user-facing work.

## Adopted New Ideas (51–58)

Proposed by personas during review, adopted into the backlog:

51. **Pre-commit score preview** *(Player + Admin, endorsed by Engineer)* — before saving a round, show the computed §4 scores and new running totals ("Promise 8, Actual 5 → −80; you'll be at 320"). Catches mis-entries before they exist; first consumer of the shared `rules.js` (#43). Folds into #29/#47.
52. **State-aware landing view** *(Viewer + Product, independently)* — stop opening on Teams admin. If a match is live → open on it; else → leaderboard with latest result. Admin chrome (🔧 Fix Stats etc.) moves out of the public surface *(Designer + Admin)*.
53. **Slack results webhook** *(Product)* — auto-post match results (and blind moments) to the office channel via one incoming webhook. Replaces the cut push-notification and OG-page ideas at ~5% of the effort.
54. **One-tap rematch** *(Player)* — the loser always demands a rematch; a "Rematch" button on the winner screen pre-fills the new match.
55. **"Since your last visit" digest** *(Viewer)* — one dismissible line: "Since Tue: 2 matches, A beat B 512–430, C is now #1." localStorage timestamp, no backend.
56. **Stats purely derived — delete "Fix Stats"** *(Admin + Designer)* — per CLAUDE.md §7 stats are derived; recompute from round history on read/write instead of storing drifting copies. The button's existence is the bug.
57. **Pin/upgrade dependencies** *(Engineer)* — upgrade off Firebase 8.6.1 compat; add SRI + CSP for remaining CDN assets (or vendor them).
58. **Deploy an allowlist, not the repo root** *(Engineer)* — publish only `index.html`, `css/`, `js/` to gh-pages; removes `db-dump/`, `tests/`, `scripts/`, `claude/` from the public site.

## Priority Tiers (v2 — post-debate)

**P0 — Security & integrity (before any feature):**
#41 real Firebase Auth + locked Firestore rules · #40 XSS escaping · #42 CI test gate · #58 deploy allowlist · #50 automated backup · #57 dependency pinning

**P1 — Release 1: "Fix the daily ritual":**
#32 replace Spline · #29 mobile-first entry (+ #51 preview) · #30 leaderboard cards with information diet (+ #35 rank arrows) · #18 round undo · #4 streak chips · #43 rules.js · #52 state-aware landing (+ #56 derived stats)

**P2 — Release 2: "Make it live":**
#24 live match spectating · #14 "what do I need" widget · #47 keyboard-first entry · #48 correction workflow · #13 shareable stat cards · #53 Slack webhook · #54 rematch · #55 visit digest · #6 records page

**P3 — Later (valuable, not now):**
#9 seasons (only after P0; all-time records must survive) · #16 badges (after icon system) · #36 accessibility pass · #33 design tokens · #34 skeletons · #38 reduced-motion · #31 light theme · #10 rivalry pages · #2 calibration scatter · #3 blind ROI · #1 match timeline · #17 MVP moments · #19 trajectory page · #12 heatmap · #7/#8 clutch & comeback · #37 empty states · #44 offline queue · #45 E2E tests · #39 app.js split (incremental) · #22 win polish (skippable) · #49 scheduler · #25 QR invite

**Cut after debate:**
#5 Elo (unanimous — two rankings, one truth) · #21 comments board · #26 commentary tones · #28 ticker embed · #20 web push (superseded by #53) · #27 OG share pages (superseded by #13) · #46 PWA (contested; revisit only if #32 doesn't fix cold-start) · #11 win-probability (too little data)
