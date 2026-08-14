/**
 * Facts Engine — deterministic fuel for the AI commentary layer.
 *
 * Spec: ai-commentary.md. Four jobs, all pure (no DOM, no network):
 *   1. winProbability  — Monte Carlo from historical round-score pools
 *   2. funFacts        — ranked computed nuggets from match history
 *   3. factsPacket     — the compact JSON the LLM is allowed to see
 *   4. dramaOf         — was the round that just landed worth speaking aloud?
 *
 * The LLM never computes anything; every number in the UI comes from here
 * (or from StatsUtils). Rules impact: none — reads locked-rule outputs only.
 */
const FactsEngine = (() => {
    const _Stats = (typeof StatsUtils !== 'undefined') ? StatsUtils
        : (typeof require === 'function' ? require('./stats.js') : null);

    // ─── Shared helpers ──────────────────────────────────────────────────────
    function isCompleted(m) { return m && m.status === 'completed'; }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : 'Team';
    }

    function roundsOf(m) {
        return Array.isArray(m?.rounds) ? m.rounds : [];
    }

    // ─── Rule conformance (records hygiene) ──────────────────────────────────
    // Legacy rounds were entered with hand-typed scores (Match.addRound still
    // accepts explicit score args), so ~29 stored round-sides carry scores the
    // locked rules in CLAUDE.md §4 cannot produce — e.g. a +160, or 140+extras
    // on a blind, or a doubled −140 blind penalty from an old house rule.
    //
    // Nothing is rewritten: history is history, and every stat that sums or
    // averages actual play still reads the stored numbers. But a *record*
    // ("biggest single round ever") must not be held by an arithmetic slip, so
    // record-style facts filter through this check.
    //
    // Legacy blinds whose `blind` flag was never stored are NOT violations —
    // their score is exactly right for a blind, only the flag is missing, and
    // StatsUtils.isBlindSide already infers them.
    function scoreForSide(side) {
        const p = Number(side?.promise);
        const a = Number(side?.actual);
        if (!Number.isFinite(p) || !Number.isFinite(a)) return null;
        if (typeof Match !== 'undefined' && typeof Match.computeScore === 'function') {
            return Match.computeScore(p, a, { blind: !!side.blind });
        }
        // Local mirror of CLAUDE.md §4 priority order (Node without Match).
        if (side?.blind) return a >= 7 ? 140 : -70;
        if (a < p) return -(p * 10);
        if (a >= p * 2) return -(p * 10);
        return (p * 10) + (a - p);
    }

    function isRuleConformantSide(side) {
        if (!side) return false;
        const stored = Number(side.score);
        if (!Number.isFinite(stored)) return false;
        const asDeclared = scoreForSide(side);
        if (asDeclared === null) return false;
        if (stored === asDeclared) return true;
        // Unflagged legacy blind: promise 7 and the score a blind would give.
        const a = Number(side.actual);
        if (Number(side.promise) === 7 && !side.blind && stored === (a >= 7 ? 140 : -70)) return true;
        return false;
    }

    // True when every round-side in the match conforms — used to keep
    // whole-match records (record final score, comebacks) honest.
    function isRuleConformantMatch(match) {
        for (const r of roundsOf(match)) {
            for (const side of ['team1', 'team2']) {
                if (r[side] && !isRuleConformantSide(r[side])) return false;
            }
        }
        return true;
    }

    // ─── Round-score pools (for the Monte Carlo) ─────────────────────────────
    // Every per-round score a team has ever posted. Thin pools (< MIN_POOL)
    // are topped up with the global pool so new teams don't produce
    // degenerate odds.
    const MIN_POOL = 20;

    // Neutral fallback when there is no history at all — representative
    // outcomes under the locked scoring rules (misses, mets, extras, blinds).
    const DEFAULT_POOL = [-80, -70, -60, -50, -40, 40, 43, 50, 53, 54, 61, 63, 65, 72, 140];

    function roundScorePool(teamId, matches) {
        const id = String(teamId);
        const pool = [];
        for (const m of (matches || [])) {
            const side = String(m.team1Id) === id ? 'team1'
                       : String(m.team2Id) === id ? 'team2' : null;
            if (!side) continue;
            for (const r of roundsOf(m)) {
                const s = Number(r[side]?.score);
                if (Number.isFinite(s)) pool.push(s);
            }
        }
        return pool;
    }

    function globalScorePool(matches) {
        const pool = [];
        for (const m of (matches || [])) {
            for (const r of roundsOf(m)) {
                for (const side of ['team1', 'team2']) {
                    const s = Number(r[side]?.score);
                    if (Number.isFinite(s)) pool.push(s);
                }
            }
        }
        return pool;
    }

    function blendedPool(teamId, matches, global) {
        const own = roundScorePool(teamId, matches);
        if (own.length >= MIN_POOL) return own;
        const g = (global && global.length) ? global : DEFAULT_POOL;
        return own.concat(g);
    }

    // ─── Win probability — Monte Carlo (spec § Win probability model) ────────
    // Simulates the rest of the match N times from the current score, drawing
    // each simulated round from each team's historical pool. Applies the
    // locked finish rules exactly (CLAUDE.md §2/§5): first to ≥500; both ≥500
    // same round → higher total; exact tie → team1.
    //
    // rng is injectable so tests run seeded and deterministic.
    const SIM_ROUND_CAP = 200;

    function winProbability(match, matches, options = {}) {
        const iterations = options.iterations || 2000;
        const rng = options.rng || Math.random;

        // A finished match is not a probability.
        if (isCompleted(match)) {
            const t1Won = String(match.winnerId) === String(match.team1Id);
            return { team1: t1Won ? 1 : 0, team2: t1Won ? 0 : 1, iterations: 0 };
        }

        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);

        const global = globalScorePool(matches);
        const pool1 = blendedPool(match.team1Id, matches, global);
        const pool2 = blendedPool(match.team2Id, matches, global);
        const sample = pool => pool[Math.floor(rng() * pool.length)];

        let wins1 = 0;
        for (let i = 0; i < iterations; i++) {
            let t1 = s1, t2 = s2, rounds = 0;
            while (t1 < 500 && t2 < 500 && rounds < SIM_ROUND_CAP) {
                t1 += sample(pool1);
                t2 += sample(pool2);
                rounds++;
            }
            if (t1 >= 500 && t2 >= 500) {
                // Both crossed in the same simulated round → higher total,
                // team1 on an exact tie (locked rule).
                wins1 += (t2 > t1) ? 0 : 1;
            } else if (t1 >= 500) {
                wins1 += 1;
            } else if (t2 >= 500) {
                // team2 wins
            } else {
                // Pathological pools hit the cap — award the current leader,
                // team1 on a tie (mirrors the deterministic fallback).
                wins1 += (t2 > t1) ? 0 : 1;
            }
        }
        return { team1: wins1 / iterations, team2: 1 - wins1 / iterations, iterations };
    }

    // ─── Per-match derivations used by facts + packet ────────────────────────

    // Largest deficit the eventual winner faced at any point (completed only).
    function comebackOf(match) {
        if (!isCompleted(match) || !match.winnerId || !_Stats) return null;
        const series = _Stats.cumulativeSeries(match);
        const winnerSide = String(match.winnerId) === String(match.team1Id) ? 'team1' : 'team2';
        const loserSide = winnerSide === 'team1' ? 'team2' : 'team1';
        let worst = 0;
        for (let i = 0; i < series.team1.length; i++) {
            const deficit = series[loserSide][i] - series[winnerSide][i];
            if (deficit > worst) worst = deficit;
        }
        return worst > 0 ? { deficit: worst, winnerId: match.winnerId, match } : null;
    }

    // Consecutive most-recent rounds a side has scored negative in a match.
    function missStreak(match, side) {
        const rounds = roundsOf(match);
        let n = 0;
        for (let i = rounds.length - 1; i >= 0; i--) {
            if (Number(rounds[i]?.[side]?.score || 0) < 0) n++;
            else break;
        }
        return n;
    }

    // ─── Fun facts (spec § Fun-facts catalogue) ──────────────────────────────
    // Each fact: { id, icon, text, weight, live } — ranked by weight desc.
    // liveMatch (optional, in_progress) promotes live-aware facts to the top.
    function funFacts(teams, matches, liveMatch = null, options = {}) {
        const limit = options.limit || 8;
        const completed = (matches || []).filter(isCompleted);
        const facts = [];
        const add = (id, icon, text, weight, live = false) =>
            facts.push({ id, icon, text, weight, live });

        const vsLine = m =>
            `${teamName(teams, m.team1Id)} vs ${teamName(teams, m.team2Id)}`;

        // Longest / shortest match by rounds
        let longest = null, shortest = null;
        for (const m of completed) {
            const n = roundsOf(m).length;
            if (!n) continue;
            if (!longest || n > roundsOf(longest).length) longest = m;
            if (!shortest || n < roundsOf(shortest).length) shortest = m;
        }
        if (longest) {
            add('longest-match', '⏳',
                `Longest match ever: ${vsLine(longest)} went ${roundsOf(longest).length} rounds.`, 60);
        }
        if (shortest && shortest !== longest) {
            add('shortest-match', '⚡',
                `Fastest finish: ${vsLine(shortest)} was done in ${roundsOf(shortest).length} rounds.`, 40);
        }

        // Records only count rule-conformant play — a legacy typo must not
        // own "biggest ever" (see isRuleConformantSide). Fall back to the full
        // set if the filter would leave nothing to talk about.
        const conformant = completed.filter(isRuleConformantMatch);
        const strictRecords = conformant.length > 0;
        const recordPool = strictRecords ? conformant : completed;

        // Highest single-round team score (conformant sides only)
        let topRound = null;
        for (const m of recordPool) {
            for (const r of roundsOf(m)) {
                for (const sideKey of ['team1', 'team2']) {
                    const side = r[sideKey];
                    if (!side) continue;
                    if (strictRecords && !isRuleConformantSide(side)) continue;
                    const s = Number(side.score);
                    if (!topRound || s > topRound.score) {
                        topRound = { score: s, m, roundNumber: r.roundNumber, sideKey };
                    }
                }
            }
        }
        if (topRound && topRound.score > 0) {
            const tid = topRound.sideKey === 'team1' ? topRound.m.team1Id : topRound.m.team2Id;
            const oid = topRound.sideKey === 'team1' ? topRound.m.team2Id : topRound.m.team1Id;
            add('top-round-score', '🚀',
                `Biggest single round: +${topRound.score} by ${teamName(teams, tid)} (round ${topRound.roundNumber} vs ${teamName(teams, oid)}).`, 55);
        }

        // Record final score + closest finish
        let recordFinal = null, closest = null;
        for (const m of recordPool) {
            const t1 = Number(m.finalScore?.team1 || 0);
            const t2 = Number(m.finalScore?.team2 || 0);
            const hi = Math.max(t1, t2);
            const margin = Math.abs(t1 - t2);
            if (!recordFinal || hi > recordFinal.hi) recordFinal = { hi, m };
            if (m.winnerId && (!closest || margin < closest.margin)) closest = { margin, m };
        }
        if (recordFinal) {
            add('record-final', '🏔️',
                `Record total: ${teamName(teams, recordFinal.m.winnerId)} closed a match on ${recordFinal.hi} points.`, 50);
        }
        if (closest) {
            add('closest-finish', '😮‍💨',
                `Closest finish: ${vsLine(closest.m)} was decided by just ${closest.margin} point${closest.margin === 1 ? '' : 's'}.`, 65);
        }

        // Biggest comeback
        let comeback = null;
        for (const m of recordPool) {
            const c = comebackOf(m);
            if (c && (!comeback || c.deficit > comeback.deficit)) comeback = c;
        }
        if (comeback) {
            add('biggest-comeback', '🔄',
                `Biggest comeback: ${teamName(teams, comeback.winnerId)} trailed by ${comeback.deficit} and still won.`, 70);
        }

        // Blind economy (tournament + best blind team)
        if (_Stats) {
            const blinds = _Stats.blindEconomy(completed);
            if (blinds.tournament.called > 0) {
                const pct = Math.round(blinds.tournament.successRate * 100);
                const net = blinds.tournament.netEV;
                add('blind-economy', '🕶️',
                    `Blind calls land ${pct}% of the time (${blinds.tournament.called} calls, net ${net >= 0 ? '+' : ''}${net} points).`, 45);
            }
            let bestBlind = null;
            for (const [tid, s] of Object.entries(blinds.byTeam)) {
                if (s.called >= 3 && (!bestBlind || s.successes / s.called > bestBlind.rate)) {
                    bestBlind = { tid, rate: s.successes / s.called, s };
                }
            }
            if (bestBlind && bestBlind.rate > 0) {
                add('best-blind-team', '🎯',
                    `${teamName(teams, bestBlind.tid)} are the blind specialists — ${bestBlind.s.successes}/${bestBlind.s.called} landed.`, 40);
            }

            // Hottest active win streak
            const hot = _Stats.hottestStreak(teams, completed, 3);
            if (hot && hot.type === 'W') {
                add('hottest-streak', '🔥',
                    `${hot.name} are on a ${hot.count}-match win streak.`, 60);
            }

            // Most one-sided rivalry (≥ 3 meetings)
            let lopsided = null;
            for (let i = 0; i < (teams || []).length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    const h = _Stats.headToHead(teams[i].id, teams[j].id, completed);
                    const total = h.wins + h.losses;
                    if (total < 3) continue;
                    const dom = Math.max(h.wins, h.losses) / total;
                    if (!lopsided || dom > lopsided.dom) {
                        const [wTeam, lTeam] = h.wins >= h.losses
                            ? [teams[i], teams[j]] : [teams[j], teams[i]];
                        lopsided = { dom, wTeam, lTeam, w: Math.max(h.wins, h.losses), l: Math.min(h.wins, h.losses) };
                    }
                }
            }
            if (lopsided && lopsided.dom > 0.65) {
                add('one-sided-rivalry', '💪',
                    `${lopsided.wTeam.name} own the rivalry with ${lopsided.lTeam.name}: ${lopsided.w}–${lopsided.l} head-to-head.`, 45);
            }
        }

        // Longest active promise-kept streak (consecutive positive rounds,
        // ending at the team's most recent round played).
        let bestKept = null;
        for (const t of (teams || [])) {
            const id = String(t.id);
            const chron = (matches || [])
                .filter(m => [String(m.team1Id), String(m.team2Id)].includes(id) && roundsOf(m).length)
                .slice()
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            let streak = 0;
            for (const m of chron) {
                const side = String(m.team1Id) === id ? 'team1' : 'team2';
                for (const r of roundsOf(m)) {
                    if (Number(r[side]?.score || 0) > 0) streak++;
                    else streak = 0;
                }
            }
            if (streak >= 3 && (!bestKept || streak > bestKept.streak)) {
                bestKept = { name: t.name, streak };
            }
        }
        if (bestKept) {
            add('promise-streak', '🤝',
                `${bestKept.name} have kept ${bestKept.streak} straight promises — best active run.`, 50);
        }

        // ── Live-aware facts outrank the archive ─────────────────────────────
        if (liveMatch && liveMatch.status === 'in_progress') {
            const liveRounds = roundsOf(liveMatch).length;
            if (longest && liveRounds >= roundsOf(longest).length) {
                add('live-longest', '⏳',
                    `${vsLine(liveMatch)} is already the longest match of the season (${liveRounds} rounds and counting).`, 90, true);
            }
            const prob = winProbability(liveMatch, matches, options.winProbOptions || {});
            const fav = prob.team1 >= prob.team2 ? 'team1' : 'team2';
            const favId = fav === 'team1' ? liveMatch.team1Id : liveMatch.team2Id;
            const pct = Math.round(Math.max(prob.team1, prob.team2) * 100);
            if (liveRounds > 0) {
                add('live-winprob', '📊',
                    `History gives ${teamName(teams, favId)} a ${pct}% edge right now.`, 85, true);
            }
            if (comeback) {
                const s1 = Number(liveMatch.finalScore?.team1 || 0);
                const s2 = Number(liveMatch.finalScore?.team2 || 0);
                const deficit = Math.abs(s1 - s2);
                const trailerId = s1 < s2 ? liveMatch.team1Id : liveMatch.team2Id;
                if (deficit > comeback.deficit) {
                    add('live-comeback-watch', '🔄',
                        `${teamName(teams, trailerId)} trail by ${deficit} — winning from here would be the biggest comeback ever recorded.`, 88, true);
                }
            }
        }

        facts.sort((a, b) => b.weight - a.weight);
        return facts.slice(0, limit);
    }

    // ─── Drama detection (spec § Spoken commentary) ──────────────────────────
    // Decides whether the round that just landed deserves a voice, and gathers
    // the risk/chance numbers a commentator would actually use.
    //
    // Pure: compares the match against its own previous state, so "what
    // changed" is knowable without any stored history. Returns null when the
    // round was routine — the caller stays silent.
    //
    // level: 'high' | 'medium'   kind: the headline trigger
    // 'finale' outranks everything; 'low' is a routine round, which still
    // gets narrated (every round is spoken) but in a matter-of-fact tone.
    const DRAMA_LEVELS = { finale: 3, high: 2, medium: 1, low: 0 };

    const signed = n => (Number(n) > 0 ? `+${n}` : String(n));

    // "an 8 promise", "a 5 promise" — 8 and 11 are the vowel-sounding ones.
    const article = n => ([8, 11, 18].includes(Number(n)) ? 'an' : 'a');

    const plural = (n, word) => (Number(n) === 1 ? word : `${word}s`);

    // Tuned against a replay of the real season (see ai-commentary.md
    // § Tuning): blinds are common in this league (351 calls) and tiny lead
    // flips are noise, so the bar is set where the table stays quiet through
    // routine play and speaks a handful of times per match.
    const LEAD_CHANGE_MIN = 60;    // a flip smaller than this is not news
    const BIG_SWING_MIN = 180;     // one-round swing worth remarking on
    const LATE_GAME_AT = 380;      // "late" — the win line is in sight
    const CLOSE_GAME_AT = 60;      // scores within this are "close"

    // "Alegeus stars" → "Alegeus stars'", not "Alegeus stars's".
    function possessive(name) {
        const n = String(name);
        return /s$/i.test(n) ? `${n}'` : `${n}'s`;
    }

    // Scores are spoken, so a bare "−280" must not arrive as "–-280" inside a
    // "A to B" phrase. Negative totals are real here (a bad run can go below
    // zero under §4.1/§4.3).
    function spokenScore(n) {
        const v = Number(n);
        return v < 0 ? `minus ${Math.abs(v)}` : String(v);
    }

    function isBlindSide(side) {
        if (!side) return false;
        if (side.blind === true) return true;
        if (side.blind === false) {
            // Legacy rounds predate the flag — infer from the locked shape.
            return Number(side.promise) === 7
                && (Number(side.score) === 140 || Number(side.score) === -70);
        }
        return false;
    }

    function dramaOf(match, prevMatch = null, matches = [], teams = [], options = {}) {
        const rounds = roundsOf(match);
        if (!rounds.length) return null;

        const last = rounds[rounds.length - 1];
        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);
        const t1Name = teamName(teams, match.team1Id);
        const t2Name = teamName(teams, match.team2Id);

        // Score before this round — from prevMatch when supplied, else by
        // subtracting the round that just landed.
        const p1 = prevMatch ? Number(prevMatch?.finalScore?.team1 || 0) : s1 - Number(last.team1?.score || 0);
        const p2 = prevMatch ? Number(prevMatch?.finalScore?.team2 || 0) : s2 - Number(last.team2?.score || 0);

        const sides = ['team1', 'team2'].map(key => ({
            key,
            name: key === 'team1' ? t1Name : t2Name,
            promise: Number(last[key]?.promise || 0),
            actual: Number(last[key]?.actual || 0),
            score: Number(last[key]?.score || 0),
            blind: isBlindSide(last[key]),
        }));

        const triggers = [];
        const push = (kind, level, actor, detail) => triggers.push({ kind, level, actor, detail });

        // Every round is narrated (product decision), so these no longer gate
        // whether we speak — they set the *tone*. A blind late in a close
        // match is shouted; the same blind at 40–10 is merely reported.
        const lateGame = Math.max(s1, s2) >= LATE_GAME_AT;
        const closeGame = Math.abs(s1 - s2) <= CLOSE_GAME_AT;

        // ── Blind hit / miss — the biggest swing in the game ─────────────────
        for (const s of sides) {
            if (!s.blind) continue;
            const consequential = lateGame || closeGame || match.status === 'completed';
            const level = consequential ? 'high' : 'medium';
            if (s.score > 0) {
                push('blind-hit', level, s.name,
                    `${s.name} called blind and landed it — ${s.actual} hands taken, +140.`);
            } else {
                push('blind-miss', level, s.name,
                    `${s.name} called blind and missed — only ${s.actual} of the 7 needed, −70.`);
            }
        }

        // ── Lead change — the match just flipped ─────────────────────────────
        // Only when the new lead is meaningful (a 6-point flip mid-match is
        // noise) or the match is late enough that any flip matters.
        const prevLeader = p1 === p2 ? null : (p1 > p2 ? 'team1' : 'team2');
        const nowLeader = s1 === s2 ? null : (s1 > s2 ? 'team1' : 'team2');
        if (nowLeader && prevLeader && nowLeader !== prevLeader) {
            const margin = Math.abs(s1 - s2);
            const name = nowLeader === 'team1' ? t1Name : t2Name;
            push('lead-change', (margin >= LEAD_CHANGE_MIN || lateGame) ? 'high' : 'medium', name,
                `${name} have taken the lead, ${margin} points clear.`);
        }

        // ── Match point — someone can win next round ─────────────────────────
        const wasMatchPoint = Math.max(p1, p2) >= 450;
        const isMatchPoint = Math.max(s1, s2) >= 450;
        if (isMatchPoint && !wasMatchPoint && match.status !== 'completed') {
            const leadName = s1 >= s2 ? t1Name : t2Name;
            const need = 500 - Math.max(s1, s2);
            push('match-point', 'high', leadName,
                `${leadName} are at match point — ${need} more points closes it.`);
        }

        // ── Record-comeback watch — trailer would set an all-time record ─────
        if (match.status === 'in_progress') {
            let bestComeback = 0;
            for (const m of (matches || [])) {
                if (!isCompleted(m) || !isRuleConformantMatch(m)) continue;
                const c = comebackOf(m);
                if (c && c.deficit > bestComeback) bestComeback = c.deficit;
            }
            // Fires only on the round that crosses the record, not every
            // round the deficit stays large.
            const deficit = Math.abs(s1 - s2);
            const prevDeficit = Math.abs(p1 - p2);
            if (bestComeback > 0 && deficit > bestComeback && prevDeficit <= bestComeback) {
                const trailName = s1 < s2 ? t1Name : t2Name;
                push('record-comeback-watch', 'high', trailName,
                    `${trailName} trail by ${deficit} — winning from here beats the all-time comeback record of ${bestComeback}.`);
            }
        }

        // ── Over-extension — greed punished by the rules ─────────────────────
        for (const s of sides) {
            if (s.blind || s.promise <= 0) continue;
            if (s.actual >= s.promise * 2) {
                push('over-extension', 'medium', s.name,
                    `${s.name} promised ${s.promise} and took ${s.actual} — double the promise turns it into ${s.score}.`);
            }
        }

        // ── Near-miss — missed the promise by exactly one hand ───────────────
        // Only when it hurt: a big promise, or a close/late match.
        for (const s of sides) {
            if (s.blind || s.promise <= 0) continue;
            if (s.actual === s.promise - 1) {
                push('near-miss', (s.promise >= 8 || lateGame || closeGame) ? 'medium' : 'low', s.name,
                    `${s.name} came up one hand short of ${s.promise} — ${s.score} for the round.`);
            }
        }

        // ── Big swing — one round that moved things a long way ───────────────
        const swing = Math.abs(sides[0].score - sides[1].score);
        if (swing >= BIG_SWING_MIN) {
            const winner = sides[0].score > sides[1].score ? sides[0] : sides[1];
            push('big-swing', 'medium', winner.name,
                `A ${swing}-point swing in one round, ${winner.name}'s way.`);
        }

        // ── Match end — the finale outranks everything ───────────────────────
        // Glory for the winner, a gentle roast for the loser (product
        // decision: teasing, never mean — these are colleagues).
        if (match.status === 'completed' && match.winnerId) {
            const winnerIsT1 = String(match.winnerId) === String(match.team1Id);
            const winName = winnerIsT1 ? t1Name : t2Name;
            const loseName = winnerIsT1 ? t2Name : t1Name;
            const winScore = Math.max(s1, s2);
            const loseScore = Math.min(s1, s2);
            push('match-end', 'finale', winName,
                `${winName} have won it, ${spokenScore(winScore)} to ${spokenScore(loseScore)}, in ${rounds.length} ${plural(rounds.length, 'round')}.`);
        }

        // ── Routine round — every round gets narrated, so when nothing
        // remarkable happened we still describe what the round did. ──────────
        if (!triggers.length) {
            const top = sides[0].score >= sides[1].score ? sides[0] : sides[1];
            const other = top === sides[0] ? sides[1] : sides[0];
            let detail;
            if (top.score > 0 && other.score > 0) {
                detail = `Both sides delivered — ${top.name} ${signed(top.score)} on ${article(top.promise)} ${top.promise} promise, ${other.name} ${signed(other.score)}.`;
            } else if (top.score > 0) {
                detail = `${top.name} made their ${top.promise} and took ${top.actual}, ${signed(top.score)}; ${other.name} dropped ${signed(other.score)}.`;
            } else {
                detail = `A rough round for both — ${top.name} ${signed(top.score)}, ${other.name} ${signed(other.score)}.`;
            }
            push('routine', 'low', top.name, detail);
        }

        // Highest level wins the headline; the rest become supporting facts.
        triggers.sort((a, b) => DRAMA_LEVELS[b.level] - DRAMA_LEVELS[a.level]);
        const head = triggers[0];

        // ── Risk & chance context — what a commentator would actually say ────
        // On the finale the glory/roast facts lead; a round trigger from the
        // last round is supporting detail, not the story.
        const facts = [];
        const roundFacts = triggers.slice(1).map(t => t.detail);
        if (match.status !== 'completed') facts.push(...roundFacts);

        if (match.status === 'completed') {
            // Finale context: what the winner did right and the loser did
            // wrong, so the glory and the roast both have something true
            // behind them.
            const winnerIsT1 = String(match.winnerId) === String(match.team1Id);
            const winSide = winnerIsT1 ? 'team1' : 'team2';
            const loseSide = winnerIsT1 ? 'team2' : 'team1';
            const winName = winnerIsT1 ? t1Name : t2Name;
            const loseName = winnerIsT1 ? t2Name : t1Name;
            const loseScoreFinal = Math.min(s1, s2);

            let winBlinds = 0, loseMisses = 0, loseBusts = 0;
            for (const r of rounds) {
                if (isBlindSide(r[winSide]) && Number(r[winSide]?.score) > 0) winBlinds++;
                const ls = r[loseSide];
                if (!ls) continue;
                if (Number(ls.score) < 0) loseMisses++;
                const lp = Number(ls.promise), la = Number(ls.actual);
                if (!isBlindSide(ls) && lp > 0 && la >= lp * 2) loseBusts++;
            }
            // Glory first…
            if (winBlinds > 0) facts.push(`${winName} landed ${winBlinds} blind${winBlinds === 1 ? '' : 's'} on the way`);

            // …then the roast. Always give the LLM something true to tease
            // with, even when the loser played a clean match.
            if (loseBusts > 0) {
                facts.push(`${loseName} over-extended ${loseBusts} time${loseBusts === 1 ? '' : 's'}`);
            } else if (loseMisses > 0) {
                facts.push(`${loseName} went negative in ${loseMisses} of the ${rounds.length} ${plural(rounds.length, 'round')}`);
            } else {
                facts.push(`${loseName} never found the round that mattered, finishing ${spokenScore(loseScoreFinal)}`);
            }
            facts.push(...roundFacts);
        } else {
            // Win-probability swing across this round — the "chance" number.
            const before = { ...match, finalScore: { team1: p1, team2: p2 }, status: 'in_progress' };
            const wpOpts = options.winProbOptions || {};
            const probBefore = winProbability(before, matches, wpOpts);
            const probAfter = winProbability(match, matches, wpOpts);
            const actorIsT1 = head.actor === t1Name;
            const b = Math.round((actorIsT1 ? probBefore.team1 : probBefore.team2) * 100);
            const a = Math.round((actorIsT1 ? probAfter.team1 : probAfter.team2) * 100);
            if (Math.abs(a - b) >= 5) {
                facts.push(`${possessive(head.actor)} win probability moved ${b}% to ${a}%`);
            }
            const leadName = s1 >= s2 ? t1Name : t2Name;
            facts.push(`${leadName} lead ${spokenScore(Math.max(s1, s2))} to ${spokenScore(Math.min(s1, s2))}, ${500 - Math.max(s1, s2)} from the win`);
        }

        // Blind history for the actor — "their 4th blind tonight, 3 landed".
        const actorId = head.actor === t1Name ? match.team1Id : match.team2Id;
        let called = 0, landed = 0;
        for (const m of (matches || [])) {
            const key = String(m.team1Id) === String(actorId) ? 'team1'
                      : String(m.team2Id) === String(actorId) ? 'team2' : null;
            if (!key) continue;
            for (const r of roundsOf(m)) {
                if (!isBlindSide(r[key])) continue;
                called++;
                if (Number(r[key].score) > 0) landed++;
            }
        }
        if ((head.kind === 'blind-hit' || head.kind === 'blind-miss') && called > 1) {
            facts.push(`${head.actor} have called ${called} blinds all season and landed ${landed}`);
        }

        return {
            kind: head.kind,
            level: head.level,
            actor: head.actor,
            headline: head.detail,
            facts: facts.slice(0, 4),
            roundNumber: rounds.length,
            matchId: String(match.id),
            score: { t1: s1, t2: s2 },
            teams: { t1: t1Name, t2: t2Name },
        };
    }

    // ─── Match start — the opening line before a ball is bowled ──────────────
    // Same shape as dramaOf so the audio layer can treat them identically.
    // Sets the scene from real history: the head-to-head record, current
    // streaks, and the pre-match odds from the Monte Carlo.
    function matchStartMoment(match, teams = [], matches = [], options = {}) {
        if (!match) return null;
        const t1Name = teamName(teams, match.team1Id);
        const t2Name = teamName(teams, match.team2Id);

        const facts = [];
        const completed = (matches || []).filter(isCompleted);

        if (_Stats) {
            const h = _Stats.headToHead(match.team1Id, match.team2Id, completed);
            if (h.played > 0) {
                facts.push(`head to head they stand ${t1Name} ${h.wins}, ${t2Name} ${h.losses}`);
            } else {
                facts.push('this is their first ever meeting');
            }
            for (const [id, name] of [[match.team1Id, t1Name], [match.team2Id, t2Name]]) {
                const s = _Stats.currentStreak(id, completed);
                if (s.count >= 3) {
                    facts.push(`${name} arrive on a ${s.count} match ${s.type === 'W' ? 'winning' : 'losing'} run`);
                }
            }
        }

        // Pre-match odds: the same simulation, from 0–0.
        const fresh = { ...match, status: 'in_progress', finalScore: { team1: 0, team2: 0 }, rounds: [] };
        const prob = winProbability(fresh, matches, options.winProbOptions || {});
        const favT1 = prob.team1 >= prob.team2;
        const favName = favT1 ? t1Name : t2Name;
        const favPct = Math.round((favT1 ? prob.team1 : prob.team2) * 100);
        if (favPct >= 55) facts.push(`history makes ${favName} the favourite at ${favPct} percent`);
        else facts.push('history says this one is too close to call');

        return {
            kind: 'match-start',
            level: 'finale',          // an event, not a round — full delivery
            actor: t1Name,
            headline: `${t1Name} against ${t2Name}. First to 500 takes it.`,
            facts: facts.slice(0, 3),
            roundNumber: 0,
            matchId: String(match.id),
            score: { t1: 0, t2: 0 },
            teams: { t1: t1Name, t2: t2Name },
        };
    }

    // A speakable fallback line built only from the drama numbers — used when
    // no Groq key is set, or when the LLM does not answer in time. Audio must
    // never depend on the network.
    //
    // Facts are stored without trailing punctuation in some paths and with it
    // in others, so the join normalises to exactly one full stop — a doubled
    // ".." is audible as an odd pause in speech synthesis.
    function dramaTemplate(drama) {
        if (!drama) return '';
        // Facts are written as clause fragments ("head to head they stand…"),
        // so capitalise when they become standalone sentences.
        const sentence = s => {
            const t = String(s).trim().replace(/\.+$/, '');
            return (t.charAt(0).toUpperCase() + t.slice(1)) + '.';
        };
        const parts = [sentence(drama.headline)];

        // The finale earns two supporting lines — one glorifying, one teasing
        // — because the no-key path must still deliver the winner/loser beat.
        // The start earns them because scene-setting is the whole point.
        const extras = (drama.kind === 'match-end' || drama.kind === 'match-start') ? 2 : 1;
        for (const f of drama.facts.slice(0, extras)) parts.push(sentence(f));
        return parts.join(' ');
    }

    // ─── Facts packet — the ONLY thing the LLM sees (spec § facts packet) ────
    function factsPacket(match, teams, matches, options = {}) {
        const rounds = roundsOf(match);
        const last = rounds.length ? rounds[rounds.length - 1] : null;
        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);
        const t1Name = teamName(teams, match.team1Id);
        const t2Name = teamName(teams, match.team2Id);

        const side = key => last ? {
            promise: Number(last[key]?.promise || 0),
            actual: Number(last[key]?.actual || 0),
            score: Number(last[key]?.score || 0),
            blind: !!last[key]?.blind,
        } : null;

        const packet = {
            kind: isCompleted(match) ? 'recap' : 'live',
            matchId: String(match.id),
            teams: { t1: t1Name, t2: t2Name },
            score: { t1: s1, t2: s2 },
            roundsPlayed: rounds.length,
            lastRound: last ? { t1: side('team1'), t2: side('team2') } : null,
            nuggets: [],
        };

        if (packet.kind === 'recap') {
            packet.winner = String(match.winnerId) === String(match.team1Id) ? t1Name
                          : String(match.winnerId) === String(match.team2Id) ? t2Name : null;
            const c = comebackOf(match);
            if (c) packet.nuggets.push(`${teamName(teams, c.winnerId)} trailed by ${c.deficit} at one point`);
        } else {
            const prob = winProbability(match, matches, options.winProbOptions || {});
            packet.winProb = {
                t1: Math.round(prob.team1 * 100) / 100,
                t2: Math.round(prob.team2 * 100) / 100,
            };
            // In-match pressure line (mirrors Narrate.pressureState thresholds)
            const high = Math.max(s1, s2);
            packet.pressure = (high >= 450 || (500 - s1 <= 50 && 500 - s2 <= 50)) ? 'match-point'
                            : high >= 400 ? 'critical'
                            : high >= 300 ? 'building' : 'calm';
        }

        // Nuggets: promise-miss streaks in this match, head-to-head, streaks.
        for (const [key, name] of [['team1', t1Name], ['team2', t2Name]]) {
            const n = missStreak(match, key);
            if (n >= 2) packet.nuggets.push(`${name} have missed ${n} promises in a row`);
        }
        if (_Stats) {
            const completed = (matches || []).filter(isCompleted);
            const h = _Stats.headToHead(match.team1Id, match.team2Id, completed);
            if (h.wins + h.losses > 0) {
                packet.nuggets.push(`head-to-head this season: ${t1Name} ${h.wins}–${h.losses} ${t2Name}`);
            }
            for (const [id, name] of [[match.team1Id, t1Name], [match.team2Id, t2Name]]) {
                const s = _Stats.currentStreak(id, completed);
                if (s.count >= 3) {
                    packet.nuggets.push(`${name} came in on a ${s.count}-match ${s.type === 'W' ? 'win' : 'losing'} streak`);
                }
            }
        }
        packet.nuggets = packet.nuggets.slice(0, 3);

        return packet;
    }

    return {
        winProbability, funFacts, factsPacket,
        dramaOf, dramaTemplate, matchStartMoment,
        roundScorePool, globalScorePool,
        // internals exposed for tests
        comebackOf, missStreak,
        isRuleConformantSide, isRuleConformantMatch,
        MIN_POOL, DEFAULT_POOL, SIM_ROUND_CAP,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FactsEngine;
}
