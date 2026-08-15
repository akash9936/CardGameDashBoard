/**
 * League Memory — what these two teams have done to each other before.
 *
 * Spec: ai-continuity.md §1. The shipped commentary knows exactly one thing:
 * the match in front of it. It can say Gaurav/Akash just missed a 6-promise;
 * it cannot say they have now done that three matches running, or that this is
 * the rematch of Sunday's 506-156. The archive holds 39 meetings between those
 * two over seven months and no packet carried any of it.
 *
 * Not to be confused with its neighbours:
 *   - commentaryMemory — HOW things were phrased (anti-repetition, per session)
 *   - commentaryLog    — WHAT WAS SAID (persisted scrollback for a human)
 *   - leagueMemory     — WHAT HAPPENED between these teams, historically
 *
 * Pure: no DOM, no network, no Date.now(). Node-testable like stats.js.
 *
 * Rules impact: none. Reads locked-rule outputs only (CLAUDE.md §4). Facts
 * that quote a scoreline as a RECORD filter through rule-conformance first
 * (see §1.5 and the records-hygiene decision in ai-commentary.md) so a legacy
 * typo can never own "biggest ever".
 */
const LeagueMemory = (() => {
    // Dependencies are resolved LAZILY, at call time rather than load time.
    //
    // This module loads BEFORE factsEngine.js in index.html (factsPacket picks
    // it up as a global, so it has to). Capturing `FactsEngine` into a const up
    // here would therefore capture `undefined` in the browser and never
    // recover — which would silently disable the rule-conformance filter and
    // let a legacy scoring typo own "biggest hiding in this rivalry" forever.
    // A silent wrong record is worse than a loud crash, so resolve on demand.
    // The bare identifier must be referenced literally: a top-level `const` is
    // a lexical binding, not a property of globalThis, so a dynamic
    // `globalThis[name]` lookup would never find these in the browser.
    function _require(path) {
        try { return (typeof require === 'function') ? require(path) : null; }
        catch (e) { return null; }
    }
    const _facts = () =>
        (typeof FactsEngine !== 'undefined') ? FactsEngine : _require('./factsEngine.js');
    const _arc = () =>
        (typeof SessionArc !== 'undefined') ? SessionArc : _require('./sessionArc.js');
    // isBlindSide lives on StatsUtils, not FactsEngine — legacy rounds carry no
    // blind flag, so the inference (promise 7 scoring 140) is the only reliable
    // read and both modules must use the same one.
    const _stats = () =>
        (typeof StatsUtils !== 'undefined') ? StatsUtils : _require('./stats.js');

    /**
     * The recency ladder (ai-continuity.md §1.3).
     *
     * Not all history is equally sayable: a callback to last night is comedy,
     * one to May 2025 is trivia. Memories carry a band and the tightest
     * available wins. Same-session callbacks are deliberately absent — those
     * belong to SessionArc, which knows the night's running order.
     */
    const BANDS = ['last-meeting', 'last-5', 'season', 'all-time'];

    /** How many meetings "recent form" looks back over. */
    const FORM_WINDOW = 5;

    /** Most memory nuggets allowed out of this module. */
    const MAX_NUGGETS = 2;

    /** A pattern must repeat at least this many times to be worth saying. */
    const MIN_PATTERN = 3;

    function isCompleted(m) { return m && m.status === 'completed'; }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : String(id);
    }

    function pairKey(a, b) {
        return [String(a), String(b)].sort().join('::');
    }

    function scoresOf(match) {
        return {
            t1: Number(match?.finalScore?.team1 || 0),
            t2: Number(match?.finalScore?.team2 || 0),
        };
    }

    /**
     * Every completed meeting between two teams, oldest first.
     *
     * Cancelled matches are excluded from every memory type: an abandoned game
     * has no result to remember. in_progress matches are excluded too — the
     * match being commentated must never appear in its own history.
     */
    function meetingsBetween(team1Id, team2Id, matches, options = {}) {
        const key = pairKey(team1Id, team2Id);
        const excludeId = options.excludeMatchId != null ? String(options.excludeMatchId) : null;
        return (matches || [])
            .filter(m => isCompleted(m))
            .filter(m => pairKey(m.team1Id, m.team2Id) === key)
            .filter(m => excludeId === null || String(m.id) !== excludeId)
            .sort((a, b) => {
                const A = _arc();
                const ta = A ? A.timeOf(a) : 0;
                const tb = A ? A.timeOf(b) : 0;
                return (ta - tb) || String(a.id).localeCompare(String(b.id));
            });
    }

    /**
     * Rule-conformance guard for record-style claims.
     *
     * Facts that COUNT outcomes (meetings, form, wins) read stored results
     * unfiltered — they describe what actually happened at the table. Facts
     * that quote a scoreline as a superlative must be conformant, or a legacy
     * arithmetic slip becomes the league record.
     */
    function isConformant(match) {
        const F = _facts();
        if (!F || typeof F.isRuleConformantMatch !== 'function') return true;
        try { return F.isRuleConformantMatch(match); }
        catch (e) { return true; }
    }

    /**
     * Head-to-head history between two teams.
     * Returns null when they have never completed a match against each other.
     */
    function rivalry(team1Id, team2Id, matches, teams = [], options = {}) {
        const meetings = meetingsBetween(team1Id, team2Id, matches, options);
        if (!meetings.length) return null;

        const id1 = String(team1Id);
        const name1 = teamName(teams, team1Id);
        const name2 = teamName(teams, team2Id);

        let wins1 = 0, wins2 = 0;
        for (const m of meetings) {
            if (m.winnerId == null) continue;
            if (String(m.winnerId) === id1) wins1++; else wins2++;
        }

        const describe = (m) => {
            if (!m) return null;
            const s = scoresOf(m);
            // Report scores from the perspective of the teams as passed in,
            // not as the match happened to be seated.
            const flip = String(m.team1Id) !== id1;
            const a = flip ? s.t2 : s.t1;
            const b = flip ? s.t1 : s.t2;
            return {
                matchId: String(m.id),
                date: _arc() ? _arc().sessionKeyOf(m, options) : null,
                winner: m.winnerId != null ? teamName(teams, m.winnerId) : null,
                score: { t1: a, t2: b },
                margin: Math.abs(a - b),
                conformant: isConformant(m),
            };
        };

        const last = meetings[meetings.length - 1];
        const recent = meetings.slice(-FORM_WINDOW);
        let rWins1 = 0, rWins2 = 0;
        for (const m of recent) {
            if (m.winnerId == null) continue;
            if (String(m.winnerId) === id1) rWins1++; else rWins2++;
        }

        // Biggest margin — record-style, so conformant matches only. Falls back
        // to the unfiltered set rather than going silent if the filter empties
        // it (same fallback rule the season records use).
        const pool = meetings.filter(isConformant);
        const marginPool = pool.length ? pool : meetings;
        let biggest = null;
        for (const m of marginPool) {
            const d = describe(m);
            if (!d || d.winner == null) continue;
            if (!biggest || d.margin > biggest.margin) biggest = d;
        }

        return {
            teams: { t1: name1, t2: name2 },
            meetings: meetings.length,
            wins: { t1: wins1, t2: wins2 },
            lastMeeting: describe(last),
            recentForm: { window: recent.length, t1: rWins1, t2: rWins2 },
            firstMeeting: _arc() ? _arc().sessionKeyOf(meetings[0], options) : null,
            biggestMargin: biggest,
        };
    }

    /**
     * Repeating behaviours across a rivalry's recent meetings.
     *
     * Only patterns that are cheap to compute from stored round data and
     * genuinely repeat (>= MIN_PATTERN) qualify — a "pattern" that happened
     * twice is a coincidence, and saying it out loud is how a commentator
     * loses credibility.
     */
    function patterns(team1Id, team2Id, matches, teams = [], options = {}) {
        const meetings = meetingsBetween(team1Id, team2Id, matches, options);
        if (meetings.length < MIN_PATTERN) return [];

        const window = meetings.slice(-FORM_WINDOW);
        const out = [];

        for (const [id, side] of [[team1Id, 't1'], [team2Id, 't2']]) {
            const tid = String(id);
            const name = teamName(teams, id);

            // Consecutive losses in this rivalry, counting back.
            let losses = 0;
            for (let i = meetings.length - 1; i >= 0; i--) {
                const m = meetings[i];
                if (m.winnerId == null) break;
                if (String(m.winnerId) === tid) break;
                losses++;
            }
            if (losses >= MIN_PATTERN) {
                out.push({ kind: 'losing-run', team: name, side, count: losses });
            }

            // Consecutive wins in this rivalry.
            let wins = 0;
            for (let i = meetings.length - 1; i >= 0; i--) {
                const m = meetings[i];
                if (m.winnerId == null) break;
                if (String(m.winnerId) !== tid) break;
                wins++;
            }
            if (wins >= MIN_PATTERN) {
                out.push({ kind: 'winning-run', team: name, side, count: wins });
            }

            // Blind APPETITE, not blind presence.
            //
            // "Called a blind in every recent meeting" was the obvious version
            // and it is worthless: measured across the archive, 81% of
            // team-sides call at least one blind in any given match. A fact
            // that is true of four sides in five sounds like insight while
            // saying nothing — exactly the failure commentary-style.md §5.4
            // warns about. So the bar is VOLUME: multiple blinds per meeting,
            // sustained. That is genuinely unusual and worth a line.
            let blinds = 0;
            for (const m of window) {
                const seat = String(m.team1Id) === tid ? 'team1' : 'team2';
                const rounds = Array.isArray(m.rounds) ? m.rounds : [];
                for (const r of rounds) {
                    const S = _stats();
                    if (S && S.isBlindSide && S.isBlindSide(r[seat])) blinds++;
                }
            }
            if (window.length >= MIN_PATTERN && blinds >= window.length * 2) {
                out.push({
                    kind: 'blind-appetite', team: name, side,
                    count: blinds, meetings: window.length,
                });
            }
        }

        return out;
    }

    /**
     * Ranked, recency-banded memory lines for the facts packet.
     *
     * Prose, because these are quotable history the model may repeat verbatim.
     * At most MAX_NUGGETS: the prompt caps output at 1-2 sentences and a model
     * handed six facts writes a list instead of a line.
     */
    function nuggets(match, matches, teams = [], options = {}) {
        if (!match) return [];
        const opts = Object.assign({}, options, { excludeMatchId: match.id });
        const riv = rivalry(match.team1Id, match.team2Id, matches, teams, opts);
        if (!riv) return [];

        const n1 = riv.teams.t1;
        const n2 = riv.teams.t2;
        const ranked = [];

        // BAND: last-meeting — the tightest and funniest callback available.
        const lm = riv.lastMeeting;
        if (lm && lm.winner) {
            // Only quote the actual scoreline when the match is rule-conformant.
            // Otherwise say who won without lending a legacy typo authority.
            const line = lm.conformant
                ? `Rematch of their last meeting: ${lm.winner} won it ${Math.max(lm.score.t1, lm.score.t2)}-${Math.min(lm.score.t1, lm.score.t2)}.`
                : `${lm.winner} took their last meeting.`;
            ranked.push({ band: 'last-meeting', text: line });
        }

        // BAND: last-5 — recent form, only when it is lopsided enough to be a
        // story. A 3-2 split is not a story.
        const rf = riv.recentForm;
        if (rf.window >= 3) {
            const lead = rf.t1 > rf.t2 ? { name: n1, w: rf.t1 } : { name: n2, w: rf.t2 };
            if (lead.w >= Math.ceil(rf.window * 0.75) && lead.w > rf.window - lead.w) {
                ranked.push({
                    band: 'last-5',
                    text: `${lead.name} have taken ${lead.w} of the last ${rf.window}.`,
                });
            }
        }

        // BAND: last-5 — repeating behaviour beats a bare count.
        for (const p of patterns(match.team1Id, match.team2Id, matches, teams, opts)) {
            if (p.kind === 'losing-run') {
                ranked.push({ band: 'last-5', text: `${p.team} have lost ${p.count} in a row to them.` });
            } else if (p.kind === 'winning-run') {
                ranked.push({ band: 'last-5', text: `${p.team} have won the last ${p.count} between these two.` });
            } else if (p.kind === 'blind-appetite') {
                ranked.push({ band: 'last-5', text: `${p.team} have called ${p.count} blinds in their last ${p.meetings} meetings.` });
            }
        }

        // BAND: season — the sheer weight of the rivalry.
        if (riv.meetings >= 10) {
            ranked.push({
                band: 'season',
                text: `Meeting ${riv.meetings + 1} between these two; ${n1} lead the series ${riv.wins.t1}-${riv.wins.t2}.`,
            });
        }

        // BAND: all-time — the record that frames everything else.
        if (riv.biggestMargin && riv.biggestMargin.winner && riv.meetings >= 5) {
            ranked.push({
                band: 'all-time',
                text: `Biggest hiding in this rivalry: ${riv.biggestMargin.winner} by ${riv.biggestMargin.margin}.`,
            });
        }

        // Tightest band first, original order preserved within a band.
        ranked.sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band));

        const seen = new Set();
        const out = [];
        for (const r of ranked) {
            if (seen.has(r.text)) continue;
            seen.add(r.text);
            out.push(r.text);
            if (out.length >= MAX_NUGGETS) break;
        }
        return out;
    }

    return {
        rivalry, patterns, nuggets, meetingsBetween,
        BANDS, FORM_WINDOW, MAX_NUGGETS, MIN_PATTERN,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LeagueMemory;
}
