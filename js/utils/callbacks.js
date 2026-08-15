/**
 * Callbacks — the commentator remembers what already happened this match.
 *
 * Spec: claude/commentary-style.md §10.1. The funniest thing a commentator does
 * is remember: "teesra blind. Teesra." §8 rules out *model* memory — the model
 * is stateless per call and must never be trusted to recall facts. But the
 * CALLER can remember, and hand the model a finished observation to phrase.
 *
 * That is the whole design, and it is the same contract as every other packet
 * field: this module COMPUTES the callback in JS, the model only says it.
 * A callback is a verified count of things that already happened, never
 * something the model infers.
 *
 * ── Where the memory comes from ──────────────────────────────────────────────
 *
 * Two sources, deliberately different:
 *
 *   match.rounds  — what HAPPENED. The ground truth for "third blind this
 *                   match", counted from the scoreboard, never from prose.
 *   CommentaryLog — what was SAID. Used only to avoid repeating a callback
 *                   that was already made ("teesra blind" twice is not a
 *                   callback, it is a stutter).
 *
 * Reading facts out of the log would be a bug: the log holds sentences, and a
 * sentence is not a source of truth. Counting comes from rounds; the log
 * answers only "have I already said this one?".
 *
 * Everything degrades: no log, no rounds, no callback — the line is generated
 * exactly as it is today.
 */
const Callbacks = (() => {

    // The transcript of what was said. Resolved by BARE NAME first: in the
    // browser these are classic scripts whose top-level `const` lives in script
    // scope and is NOT a property of globalThis, so a `globalThis.X` probe
    // reports "missing" and silently disables the feature.
    const _log = (typeof CommentaryLog !== 'undefined')
        ? CommentaryLog
        : (typeof require === 'function' ? require('./commentaryLog.js') : undefined);

    // Ordinals for the callback line. Hinglish, because that is the register
    // the callback lands in (commentary-style.md §6) — "teesra blind" is the
    // canonical example in the spec.
    const ORDINAL_HI = { 2: 'doosra', 3: 'teesra', 4: 'chautha', 5: 'paanchwa' };
    const ORDINAL_EN = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };

    // A callback needs a pattern, and a pattern needs at least a repeat. Two is
    // a coincidence worth noting; three is the joke. Below 2, say nothing.
    const MIN_REPEAT = 2;

    function roundsOf(match) {
        return Array.isArray(match?.rounds) ? match.rounds : [];
    }

    function sideOf(round, key) {
        return round && round[key] ? round[key] : null;
    }

    // A blind is flagged on modern rounds. Historical rows only carry the
    // score, where +140 is the unambiguous signature of a landed blind
    // (CLAUDE.md §4.4) — the same rule factsEngine uses.
    function isBlind(side) {
        if (!side) return false;
        if (side.blind === true) return true;
        return Number(side.score) === 140;
    }

    // Which side of the round belongs to this team.
    function keyForTeam(match, teamId) {
        if (String(match?.team1Id) === String(teamId)) return 'team1';
        if (String(match?.team2Id) === String(teamId)) return 'team2';
        return null;
    }

    // ─── The counters ────────────────────────────────────────────────────────
    // Each returns a plain count from match.rounds. No prose, no model.

    // How many blinds this team has called this match, including the round
    // that just landed.
    function blindCount(match, teamId) {
        const key = keyForTeam(match, teamId);
        if (!key) return 0;
        return roundsOf(match).filter(r => isBlind(sideOf(r, key))).length;
    }

    // Consecutive rounds ending in a negative score, counting back from the
    // most recent. The "still bleeding" pattern.
    function negativeStreak(match, teamId) {
        const key = keyForTeam(match, teamId);
        if (!key) return 0;
        const rounds = roundsOf(match);
        let n = 0;
        for (let i = rounds.length - 1; i >= 0; i--) {
            const side = sideOf(rounds[i], key);
            if (!side || Number(side.score) >= 0) break;
            n++;
        }
        return n;
    }

    // How many times this team has bid this exact number this match. The
    // "always seven" tell — a real behavioural pattern, not a vibe.
    function sameBidCount(match, teamId, promise) {
        const key = keyForTeam(match, teamId);
        if (!key || !Number.isFinite(Number(promise))) return 0;
        return roundsOf(match).filter(r => {
            const side = sideOf(r, key);
            return side && Number(side.promise) === Number(promise);
        }).length;
    }

    // ─── Already-said guard ──────────────────────────────────────────────────
    // A callback is only funny once. The log records what was actually spoken,
    // so a callback tagged into it can be checked before being made again.
    //
    // Tagged by SHAPE ("blind:3"), not by wording: the model rephrases freely,
    // so matching on text would never fire.
    function alreadyMade(matchId, tag) {
        if (!_log || !tag) return false;
        return _log.entries(matchId).some(e => e.callback === tag);
    }

    /**
     * The callback for this moment, or null when there isn't one.
     *
     * Returns a finished, verified observation:
     *   { tag, text, count, kind }
     *
     * `text` is a fact stated plainly, NOT a joke — the model's job is to land
     * it. Handing the model a punchline produces a recited punchline.
     *
     * @param drama   a FactsEngine.dramaOf result (carries the two-sided round)
     * @param match   the match, for counting from rounds
     * @param opts    { lang } — 'hinglish' picks Hindi ordinals
     */
    function forMoment(drama, match, opts = {}) {
        if (!drama || !match) return null;

        const hinglish = String(opts.lang || '').toLowerCase() === 'hinglish';
        const ordinals = hinglish ? ORDINAL_HI : ORDINAL_EN;
        const actorId = actorTeamId(drama, match);
        if (!actorId) return null;

        // Ordered by how funny the callback is, most first. Only one callback
        // per line — two is a lecture.
        const candidates = [];

        // 1. The repeated blind. The strongest callback in the game: it is a
        //    choice, repeated, with 140 points riding on it each time.
        const blinds = blindCount(match, actorId);
        if (blinds >= MIN_REPEAT) {
            const word = ordinals[blinds] || `${blinds}th`;
            candidates.push({
                tag: `blind:${blinds}`,
                kind: 'repeat-blind',
                count: blinds,
                text: hinglish
                    ? `${word} blind hai is match mein`
                    : `that is their ${word} blind of the match`,
            });
        }

        // 2. The bleed. Consecutive negative rounds is the pattern everyone at
        //    the table has already noticed out loud.
        const bleed = negativeStreak(match, actorId);
        if (bleed >= MIN_REPEAT) {
            candidates.push({
                tag: `bleed:${bleed}`,
                kind: 'negative-streak',
                count: bleed,
                text: hinglish
                    ? `lagataar ${bleed} round se minus mein hain`
                    : `that is ${bleed} straight rounds in the red`,
            });
        }

        // 3. The tell. Bidding the same number over and over.
        const promise = actorPromise(drama, match, actorId);
        const sameBid = sameBidCount(match, actorId, promise);
        if (sameBid >= 3 && Number.isFinite(Number(promise))) {
            candidates.push({
                tag: `bid:${promise}:${sameBid}`,
                kind: 'same-bid',
                count: sameBid,
                text: hinglish
                    ? `${sameBid} baar ${promise} hi bola hai`
                    : `they have bid ${promise} ${sameBid} times now`,
            });
        }

        // Skip anything already said this match — a repeated callback is a
        // stutter, not a callback.
        const fresh = candidates.find(c => !alreadyMade(drama.matchId, c.tag));
        return fresh || null;
    }

    // Whose moment is this? dramaOf names the actor by team NAME, so map it
    // back to an id via the match. Falls back to team1 only when the names are
    // unusable, and returns null rather than guessing wrong.
    function actorTeamId(drama, match) {
        const actor = drama.actor;
        if (!actor) return null;
        if (drama.teams?.t1 === actor) return match.team1Id;
        if (drama.teams?.t2 === actor) return match.team2Id;
        return null;
    }

    // What the actor promised in the round that just landed.
    function actorPromise(drama, match, actorId) {
        const key = keyForTeam(match, actorId);
        if (!key) return null;
        const rounds = roundsOf(match);
        const last = rounds[rounds.length - 1];
        const side = sideOf(last, key);
        return side ? Number(side.promise) : null;
    }

    return {
        forMoment, alreadyMade,
        blindCount, negativeStreak, sameBidCount,
        ORDINAL_HI, ORDINAL_EN, MIN_REPEAT,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Callbacks;
}
