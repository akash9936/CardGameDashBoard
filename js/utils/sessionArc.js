/**
 * Session Arc — the night as a unit of narrative.
 *
 * Spec: ai-continuity.md §2. The app models matches; the table plays *nights*.
 * 18 of 54 sessions in the archive hold more than one match and one holds
 * eight, so "fourth match tonight and they still haven't won one" is a real
 * and currently uncomputable line.
 *
 * Where this sits among its neighbours:
 *   - factsEngine      — what happened in THIS match
 *   - seasonDigest     — what is true across the whole season
 *   - leagueMemory     — what these two teams have done to each other before
 *   - sessionArc       — what has happened TONIGHT (this module)
 *
 * Pure: no DOM, no network, no Date.now(). `options.now` is injected wherever
 * "now" would otherwise be needed, matching the discipline in seasonDigest.js.
 *
 * Rules impact: none. Reads locked-rule outputs only (CLAUDE.md §4) and never
 * recomputes a score.
 */
const SessionArc = (() => {

    /**
     * Where the day boundary sits, in hours after UTC midnight.
     *
     * A calendar day is the wrong unit for this league: matches cluster after
     * 22:00 and routinely run past midnight, so a 23:40 → 00:20 back-to-back
     * would split into two "sessions" and the second would look like a fresh
     * night. Shifting the boundary to 06:00 puts post-midnight play back with
     * the evening it belongs to.
     *
     * Gap-based clustering (e.g. "same session if within 4h of the previous")
     * would be more principled, but it needs per-match END times and the
     * archive has none — 0 of 89 matches carry any per-round timestamp. The
     * shift is deterministic, needs only match.date, and was verified against
     * the archive: the four largest sessions it produces are all genuine
     * single-night runs.
     *
     * Caveat (ai-continuity.md §2.1): match.date is a UTC ISO string and the
     * shift is applied in UTC. For a league playing ~22:00-01:00 IST this
     * groups correctly, but a match starting 06:00-06:30 local could land in
     * the previous session. Across 15 months exactly one match started before
     * 07:00, so this is accepted rather than engineered around.
     */
    const DAY_SHIFT_HOURS = 6;

    /** Consecutive losses within one session before a team is "on tilt". */
    const TILT_LOSSES = 3;

    /** A team must have played at least this many tonight to be "winless". */
    const WINLESS_MIN = 2;

    function isCompleted(m) { return m && m.status === 'completed'; }
    function isCancelled(m) { return m && m.status === 'cancelled'; }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : String(id);
    }

    /**
     * Parse match.date to a millisecond epoch, or null when unusable.
     * Accepts an ISO string (what Firestore dumps hold), a Date, or a number.
     */
    function timeOf(match) {
        const d = match && match.date;
        if (!d) return null;
        if (typeof d === 'number') return Number.isFinite(d) ? d : null;
        if (d instanceof Date) {
            const t = d.getTime();
            return Number.isFinite(t) ? t : null;
        }
        // Firestore Timestamp-like objects, in case a live doc is passed in
        // rather than a dump row.
        if (typeof d === 'object' && typeof d.seconds === 'number') {
            return d.seconds * 1000;
        }
        if (typeof d === 'string') {
            const t = Date.parse(d);
            return Number.isFinite(t) ? t : null;
        }
        return null;
    }

    /**
     * The session a timestamp belongs to: 'YYYY-MM-DD' of the shifted day.
     * Exported so tests (and callers) can assert the midnight rule directly.
     */
    function sessionKeyFor(ms, options = {}) {
        if (!Number.isFinite(ms)) return null;
        const shift = (options.dayShiftHours == null ? DAY_SHIFT_HOURS : options.dayShiftHours);
        const d = new Date(ms - shift * 3600 * 1000);
        // Built from LOCAL parts, not toISOString().
        //
        // A "night" is local to the people at the table, and the card under the
        // header prints its date with toLocaleDateString(). Keying in UTC while
        // labelling in local time splits one evening across two groups that
        // then display the SAME date — seen in production on 2026-08-02, where
        // games at 00:03 and 04:12 IST keyed to 08-01 but rendered as 02/08.
        // Deriving both from local time keeps key and label in agreement.
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function sessionKeyOf(match, options = {}) {
        return sessionKeyFor(timeOf(match), options);
    }

    /**
     * Group every dated match into sessions, chronologically.
     *
     * Cancelled matches are KEPT here — they happened at the table, and "the
     * one we abandoned" is part of the night's story. Callers decide whether
     * to count them (tally ignores them; total does not — see current()).
     * Matches with no usable date are dropped: they cannot be placed in a
     * night at all.
     */
    function sessionsOf(matches, options = {}) {
        const dated = (matches || [])
            .map(m => ({ match: m, ms: timeOf(m) }))
            .filter(x => x.ms !== null)
            .sort((a, b) => a.ms - b.ms);

        const byKey = new Map();
        for (const { match, ms } of dated) {
            const key = sessionKeyFor(ms, options);
            if (!byKey.has(key)) {
                byKey.set(key, { key, matches: [], start: ms, end: ms, count: 0 });
            }
            const s = byKey.get(key);
            s.matches.push(match);
            s.start = Math.min(s.start, ms);
            s.end = Math.max(s.end, ms);
            s.count = s.matches.length;
        }
        return Array.from(byKey.values()).sort((a, b) => a.start - b.start);
    }

    /** The session containing `match`, or null if it has no usable date. */
    function sessionOf(match, matches, options = {}) {
        const key = sessionKeyOf(match, options);
        if (!key) return null;
        return sessionsOf(matches, options).find(s => s.key === key) || null;
    }

    /**
     * Did `teamId` win `match`? Returns true/false/null (null = no winner yet,
     * or the match never produced one).
     */
    function wonBy(match, teamId) {
        if (!isCompleted(match)) return null;
        if (match.winnerId == null) return null;
        return String(match.winnerId) === String(teamId);
    }

    /**
     * The arc up to and including `match`.
     *
     * Everything is computed from matches at or before this one in the night —
     * a commentator at match 3 of 5 does not know about matches 4 and 5. That
     * makes the result stable when replayed over history (the eval harness
     * depends on this) and correct when called live.
     *
     * Returns null when the match is the first of its session: a one-match
     * night has no arc, and the commentator should not pretend otherwise.
     */
    function current(match, matches, teams = [], options = {}) {
        const session = sessionOf(match, matches, options);
        if (!session) return null;

        const ms = timeOf(match);
        const id = String(match && match.id);

        // Matches at or before this one, in order. Ties on timestamp are
        // broken by id so the ordering is total and stable.
        const upto = session.matches
            .filter(m => {
                const t = timeOf(m);
                if (t < ms) return true;
                if (t > ms) return false;
                return String(m.id) <= id;
            })
            .sort((a, b) => (timeOf(a) - timeOf(b)) || String(a.id).localeCompare(String(b.id)));

        const index = upto.length;
        if (index <= 1) return null;   // first match of the night — no arc yet

        const prior = upto.slice(0, -1);   // everything before this match

        // Tally: wins per team name, completed matches only. A cancelled game
        // has no winner, so it cannot contribute to a tally.
        const tally = {};
        const played = {};
        for (const m of prior) {
            if (isCancelled(m)) continue;
            for (const tid of [m.team1Id, m.team2Id]) {
                const name = teamName(teams, tid);
                played[name] = (played[name] || 0) + 1;
                if (!(name in tally)) tally[name] = 0;
            }
            if (isCompleted(m) && m.winnerId != null) {
                const w = teamName(teams, m.winnerId);
                tally[w] = (tally[w] || 0) + 1;
            }
        }

        // Winless: played at least WINLESS_MIN tonight, won none of them.
        const winless = Object.keys(tally)
            .filter(name => (played[name] || 0) >= WINLESS_MIN && tally[name] === 0)
            .sort();

        // Tilt: TILT_LOSSES consecutive completed losses, counting back from
        // the most recent match of the night. A cancelled game is skipped
        // rather than treated as a loss or as a streak-breaker.
        const onTilt = [];
        const ids = new Set();
        for (const m of prior) {
            ids.add(String(m.team1Id));
            ids.add(String(m.team2Id));
        }
        for (const tid of ids) {
            let losses = 0;
            for (let i = prior.length - 1; i >= 0; i--) {
                const m = prior[i];
                if (isCancelled(m)) continue;
                const involved = String(m.team1Id) === tid || String(m.team2Id) === tid;
                if (!involved) continue;
                const won = wonBy(m, tid);
                if (won === false) losses++;
                else break;   // a win (or an unfinished game) ends the run
            }
            if (losses >= TILT_LOSSES) {
                onTilt.push({ team: teamName(teams, tid), losses });
            }
        }
        onTilt.sort((a, b) => b.losses - a.losses || a.team.localeCompare(b.team));

        // Rematch: the immediately preceding match of the night was the same
        // pairing, in either seating order.
        const prev = prior[prior.length - 1];
        const samePairing = prev && (
            new Set([String(prev.team1Id), String(prev.team2Id)]).size === 2 &&
            [String(match.team1Id), String(match.team2Id)].every(x =>
                String(prev.team1Id) === x || String(prev.team2Id) === x)
        );

        return {
            key: session.key,
            index,
            total: session.count,
            tally,
            winless,
            onTilt,
            rematchOf: samePairing ? String(prev.id) : null,
            previousWinner: samePairing && isCompleted(prev) && prev.winnerId != null
                ? teamName(teams, prev.winnerId) : null,
        };
    }

    /**
     * Compact session framing for the facts packet.
     *
     * Deliberately structured rather than prose: the prompt uses this for
     * FRAMING ("fourth match tonight") rather than as a quotable statistic,
     * so it does not go through the narrative-fact ceiling that memory and
     * player nuggets share (ai-continuity.md § Wiring).
     */
    function packetSession(match, matches, teams = [], options = {}) {
        const arc = current(match, matches, teams, options);
        if (!arc) return null;
        const out = { index: arc.index, total: arc.total };
        if (arc.winless.length) out.winless = arc.winless;
        if (arc.onTilt.length) out.onTilt = arc.onTilt.map(t => `${t.team} (${t.losses})`);
        if (arc.rematchOf) {
            out.rematch = true;
            if (arc.previousWinner) out.previousWinner = arc.previousWinner;
        }
        return out;
    }

    /**
     * A whole night summarised, for display above a group of match cards.
     *
     * Distinct from current(): that answers "where does THIS match sit in the
     * night" for the commentator mid-play. This answers "what happened that
     * night, in total" for a reader scrolling history, so it counts every
     * match in the session rather than stopping at one.
     *
     * Returns null for a session with no completed matches to describe — a
     * night of nothing but cancelled games gets a plain header, not a
     * fabricated scoreline.
     */
    function summarise(session, teams = []) {
        if (!session || !session.matches || !session.matches.length) return null;

        const tally = {};
        const played = {};
        let completed = 0, cancelled = 0, live = 0;

        for (const m of session.matches) {
            if (isCancelled(m)) { cancelled++; continue; }
            if (!isCompleted(m)) { live++; continue; }
            completed++;
            for (const tid of [m.team1Id, m.team2Id]) {
                const name = teamName(teams, tid);
                played[name] = (played[name] || 0) + 1;
                if (!(name in tally)) tally[name] = 0;
            }
            if (m.winnerId != null) {
                const w = teamName(teams, m.winnerId);
                tally[w] = (tally[w] || 0) + 1;
            }
        }

        // Standings for the night, best first. Ties broken by name so the
        // header is stable across re-renders.
        const standings = Object.keys(tally)
            .map(name => ({
                team: name,
                wins: tally[name],
                losses: (played[name] || 0) - tally[name],
                played: played[name] || 0,
            }))
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.team.localeCompare(b.team));

        // A "sweep" is a night where one team played more than once and won
        // the lot — the fact most worth putting in a header.
        const sweeper = standings.find(s => s.played >= 2 && s.losses === 0) || null;
        const winless = standings.filter(s => s.played >= WINLESS_MIN && s.wins === 0);

        // Was the whole night the SAME two teams?
        //
        // This matters for display: a header reading "Coke 1-1 KorbaGang" is a
        // fabricated head-to-head when those two never played each other and
        // merely won separate games on the same evening (a real case in the
        // archive, 2026-08-09). An X-Y scoreline may only be shown when the
        // night genuinely was one repeated fixture.
        const pairings = new Set();
        for (const m of session.matches) {
            if (isCancelled(m)) continue;
            pairings.add([String(m.team1Id), String(m.team2Id)].sort().join('::'));
        }
        const singleFixture = pairings.size === 1 && completed >= 2;

        return {
            key: session.key,
            start: session.start,
            end: session.end,
            total: session.matches.length,
            completed, cancelled, live,
            standings,
            sweeper,
            singleFixture,
            winless: winless.map(s => s.team),
        };
    }

    /**
     * Group a list of matches into sessions for rendering, newest night first.
     *
     * The matches list is ordered newest-first, and this preserves that at
     * both levels: sessions descend by date, and within a session the matches
     * keep the order they arrived in. Undated matches cannot be placed in a
     * night, so they are returned together in a trailing `undated` bucket
     * rather than being silently dropped from the UI.
     */
    function groupForDisplay(matches, teams = [], options = {}) {
        const dated = [];
        const undated = [];
        for (const m of (matches || [])) {
            (timeOf(m) === null ? undated : dated).push(m);
        }

        const order = new Map();
        dated.forEach((m, i) => order.set(m, i));

        const byKey = new Map();
        for (const m of dated) {
            const key = sessionKeyFor(timeOf(m), options);
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(m);
        }

        const groups = Array.from(byKey.entries()).map(([key, list]) => {
            const times = list.map(timeOf);
            const session = {
                key,
                matches: list,
                start: Math.min(...times),
                end: Math.max(...times),
                count: list.length,
            };
            return {
                key,
                matches: list.slice().sort((a, b) => order.get(a) - order.get(b)),
                summary: summarise(session, teams),
            };
        });

        // Newest night first, matching the list's existing ordering.
        groups.sort((a, b) => String(b.key).localeCompare(String(a.key)));

        return { groups, undated };
    }

    return {
        sessionsOf, sessionOf, current, packetSession,
        summarise, groupForDisplay,
        sessionKeyFor, sessionKeyOf, timeOf,
        DAY_SHIFT_HOURS, TILT_LOSSES, WINLESS_MIN,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionArc;
}
