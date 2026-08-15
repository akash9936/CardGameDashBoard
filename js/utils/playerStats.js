/**
 * Player Stats — the people behind the rotating team names.
 *
 * Spec: ai-continuity.md §3. Team names in this league rotate constantly
 * (Akash appears under Sky/K2, skybhola, Gaurav/Akash and Propellers), so a
 * roast aimed at a team label misses the human it is actually about. CLAUDE.md
 * §0 is explicit that the audience is four friends and the register is
 * affectionate — and that lands on a person, not on a label that changed last
 * month.
 *
 * The one line this exists to enable:
 *     "Akash has now lost with four different partners."
 *
 * SCOPE LIMITS (deliberate, ai-continuity.md §3.4):
 *   - Teams resolve to people. ROUNDS DO NOT. Who bid, who played a card, is
 *     not recorded anywhere and this module does not fake it.
 *   - No per-player rating or second leaderboard. redesign.md cut Elo
 *     unanimously ("one scoreboard, one truth") and a player rating is the
 *     same idea wearing a hat. Counts and rates only.
 *   - Roasts stay on results — wins, losses, partners. Never on the human.
 *
 * Ships dark until js/data/rosters.js is filled in: an unknown team yields no
 * players and every person-level line is skipped.
 *
 * Pure: no DOM, no network, no Date.now().
 */
const PlayerStats = (() => {
    // Resolved lazily so this module does not depend on script order in
    // index.html (see the same note in leagueMemory.js). Only used to order
    // matches chronologically; a missing SessionArc degrades to insertion
    // order rather than throwing.
    // Referenced by bare identifier: a top-level `const` is a lexical binding,
    // not a globalThis property, so a dynamic lookup would miss it in browsers.
    function _arc() {
        if (typeof SessionArc !== 'undefined') return SessionArc;
        try { return (typeof require === 'function') ? require('./sessionArc.js') : null; }
        catch (e) { return null; }
    }

    function _rosterData() {
        if (typeof ROSTERS !== 'undefined' && ROSTERS) {
            return {
                rosters: ROSTERS,
                aliases: (typeof PLAYER_ALIASES !== 'undefined' && PLAYER_ALIASES) || {},
            };
        }
        if (typeof require === 'function') {
            try {
                const d = require('../data/rosters.js');
                return { rosters: d.ROSTERS || {}, aliases: d.PLAYER_ALIASES || {} };
            } catch (e) { /* not present — feature stays dark */ }
        }
        return { rosters: {}, aliases: {} };
    }

    /** '?' and blanks mean "not yet known" and are dropped, not named. */
    function isPlaceholder(name) {
        const s = String(name == null ? '' : name).trim();
        return !s || s === '?';
    }

    function norm(s) {
        return String(s == null ? '' : s).trim().toLowerCase();
    }

    /**
     * Canonical display name for a person: alias-resolved, original casing
     * preserved from the roster where possible.
     */
    function canonical(name, aliases) {
        const key = norm(name);
        if (!key) return null;
        const a = (aliases || _rosterData().aliases) || {};
        if (Object.prototype.hasOwnProperty.call(a, key)) return a[key];
        // Title-case a bare lowercase name so 'akash' and 'Akash' render alike.
        const raw = String(name).trim();
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    /**
     * The people who played under a team name, or [] when unknown.
     * Matching is case-insensitive and trimmed.
     */
    function identify(teamName, options = {}) {
        const { rosters, aliases } = options.rosters
            ? { rosters: options.rosters, aliases: options.aliases || {} }
            : _rosterData();
        const want = norm(teamName);
        if (!want) return [];
        for (const key of Object.keys(rosters || {})) {
            if (norm(key) !== want) continue;
            const list = rosters[key] || [];
            const out = [];
            const seen = new Set();
            for (const m of list) {
                if (isPlaceholder(m)) continue;
                const c = canonical(m, aliases);
                if (!c || seen.has(norm(c))) continue;
                seen.add(norm(c));
                out.push(c);
            }
            return out;
        }
        return [];
    }

    function teamNameOf(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : null;
    }

    /** The people on a given side of a match, or [] when unknown. */
    function playersOf(match, seat, teams, options = {}) {
        const id = seat === 'team1' ? match.team1Id : match.team2Id;
        return identify(teamNameOf(teams, id), options);
    }

    function isCompleted(m) { return m && m.status === 'completed'; }

    /**
     * A person's record across every team name they have played under.
     *
     * A match counts once per person even if their two team names somehow both
     * resolve to them (which the data does not currently produce, but a future
     * roster edit could).
     */
    function careerOf(player, matches, teams, options = {}) {
        const target = norm(canonical(player, options.aliases));
        if (!target) return null;

        let played = 0, wins = 0, losses = 0;
        const partners = new Map();      // canonical → { matches, wins }
        const teamsPlayedFor = new Set();
        const partnersInLosses = new Set();

        const chronological = (matches || [])
            .filter(isCompleted)
            .sort((a, b) => {
                const A = _arc();
                const ta = A ? A.timeOf(a) : 0;
                const tb = A ? A.timeOf(b) : 0;
                return (ta - tb) || String(a.id).localeCompare(String(b.id));
            });

        for (const m of chronological) {
            for (const seat of ['team1', 'team2']) {
                const roster = playersOf(m, seat, teams, options);
                if (!roster.length) continue;
                if (!roster.some(p => norm(p) === target)) continue;

                played++;
                const tid = seat === 'team1' ? m.team1Id : m.team2Id;
                const tn = teamNameOf(teams, tid);
                if (tn) teamsPlayedFor.add(tn);

                const won = m.winnerId != null && String(m.winnerId) === String(tid);
                if (m.winnerId != null) { if (won) wins++; else losses++; }

                for (const p of roster) {
                    if (norm(p) === target) continue;
                    const cur = partners.get(p) || { name: p, matches: 0, wins: 0 };
                    cur.matches++;
                    if (won) cur.wins++;
                    partners.set(p, cur);
                    if (m.winnerId != null && !won) partnersInLosses.add(p);
                }
                break;   // counted this match already
            }
        }

        if (!played) return null;

        const partnerList = Array.from(partners.values())
            .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name))
            .map(p => Object.assign({}, p, {
                losses: p.matches - p.wins,
                winRate: p.matches ? p.wins / p.matches : 0,
            }));

        // "Best"/"worst" partner needs enough games to mean anything; a single
        // match together is not a verdict on a partnership.
        const MIN = options.minPartnerMatches == null ? 3 : options.minPartnerMatches;
        const qualified = partnerList.filter(p => p.matches >= MIN);
        const byRate = qualified.slice().sort((a, b) =>
            b.winRate - a.winRate || b.matches - a.matches || a.name.localeCompare(b.name));

        return {
            player: canonical(player, options.aliases),
            matches: played,
            wins, losses,
            winRate: (wins + losses) ? wins / (wins + losses) : 0,
            partners: partnerList,
            distinctPartners: partnerList.length,
            partnersInLosses: partnersInLosses.size,
            bestPartner: byRate.length ? byRate[0] : null,
            worstPartner: byRate.length > 1 ? byRate[byRate.length - 1] : null,
            teamsPlayedFor: Array.from(teamsPlayedFor).sort(),
        };
    }

    /** Every person known to the roster who actually appears in the archive. */
    function allPlayers(matches, teams, options = {}) {
        const set = new Map();
        for (const m of (matches || [])) {
            for (const seat of ['team1', 'team2']) {
                for (const p of playersOf(m, seat, teams, options)) {
                    set.set(norm(p), p);
                }
            }
        }
        return Array.from(set.values()).sort();
    }

    /**
     * At most one person-level nugget for the facts packet.
     *
     * Only fires when the roster actually knows who is playing, and only for
     * facts that are about RESULTS. The bar is deliberately high: a
     * person-level line should feel earned, not generated every round.
     */
    function nuggets(match, matches, teams = [], options = {}) {
        if (!match) return [];
        const others = (matches || []).filter(m => String(m.id) !== String(match.id));
        const out = [];

        for (const seat of ['team1', 'team2']) {
            const roster = playersOf(match, seat, teams, options);
            if (!roster.length) continue;

            for (const person of roster) {
                const c = careerOf(person, others, teams, options);
                if (!c) continue;

                // Rotating partners is the signature fact of this league.
                if (c.partnersInLosses >= 3) {
                    out.push(`${c.player} has now lost with ${c.partnersInLosses} different partners.`);
                    continue;
                }
                if (c.distinctPartners >= 4 && c.matches >= 6) {
                    out.push(`${c.player} has played with ${c.distinctPartners} different partners.`);
                    continue;
                }
                if (c.bestPartner && c.worstPartner
                    && c.bestPartner.name !== c.worstPartner.name
                    && c.bestPartner.winRate - c.worstPartner.winRate >= 0.4) {
                    out.push(`${c.player} wins with ${c.bestPartner.name} and loses with ${c.worstPartner.name}.`);
                }
            }
        }

        return out.slice(0, 1);
    }

    return {
        identify, playersOf, careerOf, allPlayers, nuggets,
        canonical, isPlaceholder,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayerStats;
}
