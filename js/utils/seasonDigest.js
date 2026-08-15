/**
 * Season Digest — the whole season, aggregated into one compact JSON packet.
 *
 * This is the *data* half of the static season-facts feature. FactsEngine
 * answers "what is interesting about THIS match, right now"; SeasonDigest
 * answers "what is interesting about the season as a whole" — grouped by
 * team, by rivalry, by promise size, by blind appetite, by era.
 *
 * Everything here is deterministic and pure (no DOM, no network, no Date.now).
 * The digest it produces is the ONLY thing the LLM is shown when generating
 * the static facts pack (scripts/season-facts.js), which keeps the same
 * contract the live commentary already has: the model is a wordsmith, never
 * a calculator.
 *
 * Rules impact: none. Reads locked-rule outputs only (CLAUDE.md §4).
 */
const SeasonDigest = (() => {
    const _Stats = (typeof StatsUtils !== 'undefined') ? StatsUtils
        : (typeof require === 'function' ? require('./stats.js') : null);
    const _Facts = (typeof FactsEngine !== 'undefined') ? FactsEngine
        : (typeof require === 'function' ? require('./factsEngine.js') : null);

    // ─── Excluded teams ──────────────────────────────────────────────────────
    // "Coke" and "Sprite" were the seed/test teams used while building the app.
    // Their matches are real rows in Firestore but not real play, so they must
    // not appear in season records — a fabricated 1228-point blowout would
    // otherwise own "biggest hiding" forever.
    //
    // Matched case-insensitively by name, so re-seeding under new ids still
    // excludes them. Override per-call via options.excludeTeams.
    const DEFAULT_EXCLUDED = ['coke', 'sprite'];

    function excludedIdSet(teams, exclude = DEFAULT_EXCLUDED) {
        const names = new Set((exclude || []).map(n => String(n).trim().toLowerCase()));
        const ids = new Set();
        for (const t of (teams || [])) {
            if (names.has(String(t.name || '').trim().toLowerCase())) ids.add(String(t.id));
        }
        return ids;
    }

    // Drop excluded teams and every match they played. Applied once at the top
    // of build(); the individual section functions then need no knowledge of
    // it, so a caller using them directly still gets the same filtering by
    // passing an already-filtered list.
    function withoutExcluded(teams, matches, exclude) {
        const ids = excludedIdSet(teams, exclude);
        if (!ids.size) return { teams: teams || [], matches: matches || [], excluded: [] };
        return {
            teams: (teams || []).filter(t => !ids.has(String(t.id))),
            matches: (matches || []).filter(m =>
                !ids.has(String(m.team1Id)) && !ids.has(String(m.team2Id))),
            excluded: [...ids],
        };
    }

    // ─── Small helpers ───────────────────────────────────────────────────────
    const isCompleted = m => m && m.status === 'completed';
    const roundsOf = m => (Array.isArray(m?.rounds) ? m.rounds : []);
    const round1 = n => Math.round(n * 10) / 10;
    const pct = n => Math.round(n * 100);

    function nameOf(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : `Team ${id}`;
    }

    // Chronological order. Dates are strings in the dump; matches without a
    // date sort last but keep their relative order (stable sort).
    function chronological(matches) {
        return (matches || []).slice().sort((a, b) => {
            const ta = Date.parse(a?.date || '') || 0;
            const tb = Date.parse(b?.date || '') || 0;
            return ta - tb;
        });
    }

    // A blind side, including legacy rounds that predate the flag.
    // Delegates to StatsUtils so there is exactly one definition in the app.
    function isBlind(side) {
        if (_Stats && typeof _Stats.isBlindSide === 'function') return _Stats.isBlindSide(side);
        if (!side) return false;
        if (side.blind === true) return true;
        return Number(side.promise) === 7
            && (Number(side.score) === 140 || Number(side.score) === -70);
    }

    // Walk every round-side in the season once. The callback gets everything
    // a fact might need, so callers never re-walk the match list themselves.
    function eachSide(matches, fn) {
        for (const m of (matches || [])) {
            for (const r of roundsOf(m)) {
                for (const key of ['team1', 'team2']) {
                    const side = r[key];
                    if (!side) continue;
                    const oppKey = key === 'team1' ? 'team2' : 'team1';
                    fn({
                        match: m,
                        round: r,
                        side,
                        opp: r[oppKey] || null,
                        teamId: String(key === 'team1' ? m.team1Id : m.team2Id),
                        oppId: String(key === 'team1' ? m.team2Id : m.team1Id),
                        promise: Number(side.promise || 0),
                        actual: Number(side.actual || 0),
                        score: Number(side.score || 0),
                        blind: isBlind(side),
                        roundNumber: Number(r.roundNumber || 0),
                    });
                }
            }
        }
    }

    // ─── 1. Season shape ─────────────────────────────────────────────────────
    // The headline counters: how much card game actually happened.
    function overview(teams, matches) {
        const completed = (matches || []).filter(isCompleted);
        const chron = chronological(completed);
        let rounds = 0, blinds = 0, sides = 0, busts = 0, misses = 0;

        eachSide(completed, s => {
            sides++;
            if (s.blind) blinds++;
            if (s.score < 0) misses++;
            if (!s.blind && s.promise > 0 && s.actual >= s.promise * 2) busts++;
        });
        for (const m of completed) rounds += roundsOf(m).length;

        const first = chron[0];
        const last = chron[chron.length - 1];

        return {
            teams: (teams || []).length,
            matchesCompleted: completed.length,
            matchesTotal: (matches || []).length,
            rounds,
            handsDealt: rounds * 13,        // every round is exactly 13 hands (§3.2)
            blindsCalled: blinds,
            blindRatePct: sides ? pct(blinds / sides) : 0,
            negativeRounds: misses,
            negativeRatePct: sides ? pct(misses / sides) : 0,
            overExtensions: busts,
            firstMatchDate: first?.date || null,
            lastMatchDate: last?.date || null,
        };
    }

    // ─── 2. Per-team profile ─────────────────────────────────────────────────
    // One row per team, deep enough that the LLM can find a personality in it:
    // are they cautious, greedy, blind-happy, clutch, or quietly consistent?
    function teamProfiles(teams, matches) {
        const completed = (matches || []).filter(isCompleted);
        const rows = [];

        for (const t of (teams || [])) {
            const id = String(t.id);
            const played = completed.filter(m =>
                String(m.team1Id) === id || String(m.team2Id) === id);
            if (!played.length) continue;

            let wins = 0, losses = 0, roundsPlayed = 0, totalScore = 0;
            let promiseSum = 0, promiseCount = 0, actualSum = 0;
            let met = 0, missed = 0, busts = 0, blindCalled = 0, blindLanded = 0;
            let bestRound = null, worstRound = null;
            let biggestPromise = 0, smallestPromise = 99;

            // A team's "best round ever" must be a round the rules can
            // actually produce — ~29 legacy sides carry hand-typed scores
            // (a +160, a doubled −140 blind) that would otherwise own every
            // personal record. Same guard the season records use.
            const honest = s => !_Facts || _Facts.isRuleConformantSide(s.side);

            for (const m of played) {
                if (String(m.winnerId) === id) wins++;
                else if (m.winnerId) losses++;
            }

            eachSide(played, s => {
                if (s.teamId !== id) return;
                roundsPlayed++;
                totalScore += s.score;
                actualSum += s.actual;
                if (s.blind) {
                    blindCalled++;
                    if (s.score > 0) blindLanded++;
                } else if (s.promise > 0) {
                    promiseSum += s.promise;
                    promiseCount++;
                    if (s.promise > biggestPromise) biggestPromise = s.promise;
                    if (s.promise < smallestPromise) smallestPromise = s.promise;
                    if (s.actual >= s.promise * 2) busts++;
                }
                if (s.score > 0) met++; else missed++;
                if (honest(s)) {
                    if (!bestRound || s.score > bestRound.score) {
                        bestRound = { score: s.score, promise: s.promise, actual: s.actual,
                                      blind: s.blind, vs: nameOf(teams, s.oppId) };
                    }
                    if (!worstRound || s.score < worstRound.score) {
                        worstRound = { score: s.score, promise: s.promise, actual: s.actual,
                                       blind: s.blind, vs: nameOf(teams, s.oppId) };
                    }
                }
            });

            const streak = _Stats ? _Stats.currentStreak(t.id, completed) : { count: 0, type: null };

            rows.push({
                team: t.name,
                played: played.length,
                wins,
                losses,
                winPct: played.length ? pct(wins / played.length) : 0,
                totalScore,
                avgMatchScore: played.length ? Math.round(totalScore / played.length) : 0,
                avgRoundScore: roundsPlayed ? round1(totalScore / roundsPlayed) : 0,
                rounds: roundsPlayed,
                avgPromise: promiseCount ? round1(promiseSum / promiseCount) : 0,
                avgActual: roundsPlayed ? round1(actualSum / roundsPlayed) : 0,
                boldestPromise: biggestPromise || null,
                safestPromise: smallestPromise === 99 ? null : smallestPromise,
                promisesKeptPct: roundsPlayed ? pct(met / roundsPlayed) : 0,
                roundsNegative: missed,
                overExtensions: busts,
                blindsCalled: blindCalled,
                blindsLanded: blindLanded,
                blindHitPct: blindCalled ? pct(blindLanded / blindCalled) : null,
                bestRound,
                worstRound,
                currentStreak: streak.count >= 2
                    ? `${streak.count} ${streak.type === 'W' ? 'wins' : 'losses'}`
                    : null,
            });
        }

        rows.sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore);
        return rows;
    }

    // ─── 3. Promise-size economics ───────────────────────────────────────────
    // Grouped by the number promised: does a 9 actually pay better than a 5?
    // This is the group-by that makes the most interesting facts, because it
    // answers a question no single match can.
    function promiseBands(matches) {
        const bands = new Map();   // promise → tallies
        eachSide((matches || []).filter(isCompleted), s => {
            if (s.blind || s.promise < 4) return;
            const b = bands.get(s.promise) || { promise: s.promise, called: 0, met: 0, busts: 0, points: 0 };
            b.called++;
            b.points += s.score;
            if (s.score > 0) b.met++;
            if (s.actual >= s.promise * 2) b.busts++;
            bands.set(s.promise, b);
        });

        return [...bands.values()]
            .sort((a, b) => a.promise - b.promise)
            .map(b => ({
                promise: b.promise,
                called: b.called,
                metPct: pct(b.met / b.called),
                bustPct: pct(b.busts / b.called),
                avgPoints: round1(b.points / b.called),
            }));
    }

    // Blind economy, tournament-wide and by team, with the net points the
    // +140 / −70 sword has actually paid out (§4.4).
    function blindReport(teams, matches) {
        if (!_Stats) return null;
        const completed = (matches || []).filter(isCompleted);
        const eco = _Stats.blindEconomy(completed);
        const byTeam = Object.entries(eco.byTeam)
            .filter(([, s]) => s.called >= 3)
            .map(([id, s]) => ({
                team: nameOf(teams, id),
                called: s.called,
                landed: s.successes,
                hitPct: pct(s.successes / s.called),
                netPoints: s.netEV,
            }))
            .sort((a, b) => b.hitPct - a.hitPct || b.called - a.called);

        return {
            called: eco.tournament.called,
            landed: eco.tournament.successes,
            hitPct: pct(eco.tournament.successRate),
            netPoints: eco.tournament.netEV,
            byTeam: byTeam.slice(0, 10),
        };
    }

    // ─── 4. Records (rule-conformant only) ───────────────────────────────────
    // Records must not be held by a legacy typo, so they filter through
    // FactsEngine's conformance check — the same guard the live ticker uses.
    function records(teams, matches) {
        const completed = (matches || []).filter(isCompleted);
        const conformant = _Facts
            ? completed.filter(m => _Facts.isRuleConformantMatch(m))
            : completed;
        const pool = conformant.length ? conformant : completed;
        const strict = conformant.length > 0;
        const vs = m => `${nameOf(teams, m.team1Id)} vs ${nameOf(teams, m.team2Id)}`;

        // "2026-04-18T…" → "April 2026". Facts read better with a when.
        const when = m => {
            const d = new Date(m?.date || '');
            return isNaN(d) ? null
                : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        };
        // The final score, as a fact can quote it. Named winningScore/
        // losingScore rather than winner/loser so spreading this never
        // collides with a `winner` team NAME on the same object.
        const finalOf = m => {
            const t1 = Number(m.finalScore?.team1 || 0);
            const t2 = Number(m.finalScore?.team2 || 0);
            return { winningScore: Math.max(t1, t2), losingScore: Math.min(t1, t2) };
        };

        let longest = null, shortest = null, highestFinal = null, closest = null, biggestBlowout = null;
        for (const m of pool) {
            const n = roundsOf(m).length;
            if (!n) continue;
            if (!longest || n > roundsOf(longest).length) longest = m;
            if (!shortest || n < roundsOf(shortest).length) shortest = m;

            const t1 = Number(m.finalScore?.team1 || 0);
            const t2 = Number(m.finalScore?.team2 || 0);
            const hi = Math.max(t1, t2);
            const margin = Math.abs(t1 - t2);
            if (!highestFinal || hi > highestFinal.score) highestFinal = { score: hi, m };
            if (m.winnerId && (!closest || margin < closest.margin)) closest = { margin, m };
            if (m.winnerId && (!biggestBlowout || margin > biggestBlowout.margin)) biggestBlowout = { margin, m };
        }

        // Best and worst single round-sides in the season.
        let bestRound = null, worstRound = null, biggestSwing = null;
        eachSide(pool, s => {
            if (strict && _Facts && !_Facts.isRuleConformantSide(s.side)) return;
            // Context a commentator would want: who won the match this round
            // happened in, and what the opponent scored in the same round.
            const context = {
                team: nameOf(teams, s.teamId),
                vs: nameOf(teams, s.oppId),
                promise: s.promise,
                actual: s.actual,
                blind: s.blind,
                round: s.roundNumber,
                opponentScore: Number(s.opp?.score || 0),
                wonTheMatch: String(s.match.winnerId) === s.teamId,
                date: when(s.match),
            };
            if (!bestRound || s.score > bestRound.score) {
                bestRound = { score: s.score, ...context };
            }
            if (!worstRound || s.score < worstRound.score) {
                worstRound = { score: s.score, ...context };
            }
            const swing = s.score - Number(s.opp?.score || 0);
            if (swing > 0 && (!biggestSwing || swing > biggestSwing.swing)) {
                biggestSwing = { swing, ...context, score: s.score };
            }
        });

        // Biggest comeback in the season, with the round it turned on.
        let comeback = null;
        if (_Facts) {
            for (const m of pool) {
                const c = _Facts.comebackOf(m);
                if (c && (!comeback || c.deficit > comeback.deficit)) {
                    const f = finalOf(m);
                    comeback = {
                        deficit: c.deficit,
                        team: nameOf(teams, c.winnerId),
                        opponent: nameOf(teams, String(c.winnerId) === String(m.team1Id) ? m.team2Id : m.team1Id),
                        match: vs(m),
                        finalScore: f.winningScore,
                        opponentScore: f.losingScore,
                        rounds: roundsOf(m).length,
                        date: when(m),
                    };
                }
            }
        }

        // How typical is a match? Gives every record something to be measured
        // against — "15 rounds, when the average is 9".
        let totalRounds = 0, counted = 0;
        for (const m of pool) {
            const n = roundsOf(m).length;
            if (n) { totalRounds += n; counted++; }
        }
        const avgRounds = counted ? round1(totalRounds / counted) : null;

        return {
            averageMatchLength: avgRounds,
            longestMatch: longest ? {
                rounds: roundsOf(longest).length, match: vs(longest), date: when(longest),
                winner: nameOf(teams, longest.winnerId), ...finalOf(longest), avgRounds,
            } : null,
            shortestMatch: shortest ? {
                rounds: roundsOf(shortest).length, match: vs(shortest), date: when(shortest),
                winner: nameOf(teams, shortest.winnerId), ...finalOf(shortest), avgRounds,
            } : null,
            highestFinalScore: highestFinal ? {
                score: highestFinal.score, team: nameOf(teams, highestFinal.m.winnerId),
                match: vs(highestFinal.m), date: when(highestFinal.m),
                opponentScore: finalOf(highestFinal.m).losingScore,
                rounds: roundsOf(highestFinal.m).length,
            } : null,
            closestFinish: closest ? {
                margin: closest.margin, match: vs(closest.m), date: when(closest.m),
                winner: nameOf(teams, closest.m.winnerId),
                ...finalOf(closest.m), rounds: roundsOf(closest.m).length,
            } : null,
            biggestBlowout: biggestBlowout ? {
                margin: biggestBlowout.margin, match: vs(biggestBlowout.m),
                date: when(biggestBlowout.m), winner: nameOf(teams, biggestBlowout.m.winnerId),
                ...finalOf(biggestBlowout.m), rounds: roundsOf(biggestBlowout.m).length,
            } : null,
            bestSingleRound: bestRound,
            worstSingleRound: worstRound,
            biggestRoundSwing: biggestSwing,
            biggestComeback: comeback,
        };
    }

    // ─── 5. Rivalries ────────────────────────────────────────────────────────
    // Every pairing that has met more than once, with who owns whom.
    function rivalries(teams, matches) {
        const completed = (matches || []).filter(isCompleted);
        const out = [];
        const list = teams || [];

        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                const between = completed.filter(m => {
                    const ids = [String(m.team1Id), String(m.team2Id)];
                    return ids.includes(String(a.id)) && ids.includes(String(b.id));
                });
                if (between.length < 2) continue;

                let aWins = 0, bWins = 0, rounds = 0;
                for (const m of between) {
                    if (String(m.winnerId) === String(a.id)) aWins++;
                    else if (String(m.winnerId) === String(b.id)) bWins++;
                    rounds += roundsOf(m).length;
                }
                const [leadName, leadW, trailName, trailW] = aWins >= bWins
                    ? [a.name, aWins, b.name, bWins]
                    : [b.name, bWins, a.name, aWins];

                out.push({
                    pair: `${a.name} vs ${b.name}`,
                    meetings: between.length,
                    record: `${leadName} ${leadW}–${trailW} ${trailName}`,
                    leader: leadW === trailW ? null : leadName,
                    dominance: between.length ? pct(leadW / between.length) : 0,
                    avgRounds: round1(rounds / between.length),
                });
            }
        }

        out.sort((a, b) => b.meetings - a.meetings || b.dominance - a.dominance);
        return out.slice(0, 12);
    }

    // ─── 6. Streaks across the whole season ──────────────────────────────────
    // Longest runs a team ever put together — match wins, and consecutive
    // kept promises across match boundaries.
    function streaks(teams, matches) {
        const completed = chronological((matches || []).filter(isCompleted));
        const out = { longestWinStreak: null, longestLossStreak: null, longestPromiseStreak: null };

        for (const t of (teams || [])) {
            const id = String(t.id);
            const mine = completed.filter(m =>
                String(m.team1Id) === id || String(m.team2Id) === id);

            let win = 0, loss = 0, bestWin = 0, bestLoss = 0;
            for (const m of mine) {
                if (String(m.winnerId) === id) { win++; loss = 0; }
                else if (m.winnerId) { loss++; win = 0; }
                if (win > bestWin) bestWin = win;
                if (loss > bestLoss) bestLoss = loss;
            }
            if (bestWin >= 2 && (!out.longestWinStreak || bestWin > out.longestWinStreak.count)) {
                out.longestWinStreak = { team: t.name, count: bestWin };
            }
            if (bestLoss >= 2 && (!out.longestLossStreak || bestLoss > out.longestLossStreak.count)) {
                out.longestLossStreak = { team: t.name, count: bestLoss };
            }

            // Consecutive positive rounds, running across matches in date order.
            let kept = 0, bestKept = 0;
            for (const m of mine) {
                const key = String(m.team1Id) === id ? 'team1' : 'team2';
                for (const r of roundsOf(m)) {
                    if (Number(r[key]?.score || 0) > 0) { kept++; if (kept > bestKept) bestKept = kept; }
                    else kept = 0;
                }
            }
            if (bestKept >= 3 && (!out.longestPromiseStreak || bestKept > out.longestPromiseStreak.count)) {
                out.longestPromiseStreak = { team: t.name, count: bestKept };
            }
        }
        return out;
    }

    // ─── 6b. Tilt — how a team reacts to a bad round ─────────────────────────
    // The strongest behavioural signal in the archive. Measured league-wide:
    // after a NEGATIVE round a team calls blind next round ~65% of the time;
    // after a positive round, ~21%. That is chasing, not strategy.
    //
    // Only consecutive round PAIRS within one match count — a team's reaction
    // to its own last round. `tiltIndex` is the percentage-point gap between
    // the two rates, so 0 means ice-cold and 100 means every bad round is
    // answered with a blind.
    //
    // Note the §5.4 caveat from claude/commentary-style.md: the blind flag is
    // absent on legacy rounds, so `isBlind` under-counts. Both rates are
    // depressed by the same bias, which makes the GAP the honest number and
    // the absolute rates a lower bound.
    const TILT_MIN_SAMPLE = 12;

    function tilt(teams, matches) {
        const completed = (matches || []).filter(isCompleted);
        const perTeam = new Map();

        const bump = (id, bucket, wentBlind) => {
            const t = perTeam.get(id) || {
                afterBad: { blind: 0, total: 0 },
                afterGood: { blind: 0, total: 0 },
                chased: 0, chasedTotal: 0,
            };
            t[bucket].total++;
            if (wentBlind) t[bucket].blind++;
            perTeam.set(id, t);
        };

        let leagueBad = { blind: 0, total: 0 }, leagueGood = { blind: 0, total: 0 };

        for (const m of completed) {
            const rounds = roundsOf(m);
            for (let i = 0; i < rounds.length - 1; i++) {
                for (const key of ['team1', 'team2']) {
                    const cur = rounds[i][key];
                    const next = rounds[i + 1][key];
                    if (!cur || !next) continue;
                    const id = String(key === 'team1' ? m.team1Id : m.team2Id);
                    const bad = Number(cur.score || 0) < 0;
                    const wentBlind = isBlind(next);

                    bump(id, bad ? 'afterBad' : 'afterGood', wentBlind);
                    const bucket = bad ? leagueBad : leagueGood;
                    bucket.total++;
                    if (wentBlind) bucket.blind++;

                    // Escalation: raising the promise straight after a miss.
                    if (bad && !isBlind(cur) && !wentBlind) {
                        const t = perTeam.get(id);
                        t.chasedTotal++;
                        if (Number(next.promise || 0) > Number(cur.promise || 0)) t.chased++;
                    }
                }
            }
        }

        const rows = [];
        for (const [id, t] of perTeam) {
            if (t.afterBad.total < TILT_MIN_SAMPLE) continue;
            const badRate = pct(t.afterBad.blind / t.afterBad.total);
            const goodRate = t.afterGood.total ? pct(t.afterGood.blind / t.afterGood.total) : 0;
            rows.push({
                team: nameOf(teams, id),
                afterBadPct: badRate,
                afterGoodPct: goodRate,
                tiltIndex: Math.max(0, badRate - goodRate),
                sample: t.afterBad.total,
                escalatePct: t.chasedTotal >= 5 ? pct(t.chased / t.chasedTotal) : null,
            });
        }
        rows.sort((a, b) => b.tiltIndex - a.tiltIndex);

        return {
            league: {
                afterBadPct: leagueBad.total ? pct(leagueBad.blind / leagueBad.total) : 0,
                afterGoodPct: leagueGood.total ? pct(leagueGood.blind / leagueGood.total) : 0,
                badSample: leagueBad.total,
                goodSample: leagueGood.total,
            },
            byTeam: rows,
            hottest: rows[0] || null,
            coolest: rows.length ? rows[rows.length - 1] : null,
        };
    }

    // ─── 6c. Personalities — an archetype earned from real numbers ───────────
    // Every trait is a threshold over teamProfiles + tilt, so a team can only
    // hold an archetype the data supports. Ordered by specificity: the first
    // match wins, so "100% promises kept" beats the generic fallbacks.
    //
    // The Hinglish label is the fun part; `evidence` is what makes it fair.
    const MIN_ROUNDS_FOR_ARCHETYPE = 25;

    function personalities(teams, matches) {
        const profiles = teamProfiles(teams, matches)
            .filter(p => p.rounds >= MIN_ROUNDS_FOR_ARCHETYPE);
        const tiltRows = tilt(teams, matches).byTeam;
        const tiltOf = name => tiltRows.find(t => t.team === name) || null;

        // League baselines, so an archetype means "compared to this table",
        // not against numbers hard-coded from one snapshot of the data.
        const avg = key => profiles.reduce((n, p) => n + (p[key] || 0), 0) / (profiles.length || 1);
        const avgPromise = avg('avgPromise');
        const avgKept = avg('promisesKeptPct');

        const ARCHETYPES = [
            {
                id: 'saint',
                label: 'Bhagwan ka banda',
                blurb: 'Promise kiya toh kiya.',
                test: p => p.promisesKeptPct >= 90,
                evidence: p => `${p.promisesKeptPct}% promises kept across ${p.rounds} rounds`,
            },
            {
                id: 'sniper',
                label: 'Ganit ka master',
                blurb: 'Counts the cards, then counts the money.',
                test: p => p.promisesKeptPct >= avgKept + 3 && (p.blindHitPct ?? 0) >= 85,
                evidence: p => `${p.promisesKeptPct}% kept and ${p.blindsLanded} of ${p.blindsCalled} blinds landed`,
            },
            {
                id: 'blind_addict',
                label: 'Blind ka aashiq',
                blurb: 'Aankhein band, dua qubool.',
                test: p => p.blindsCalled >= 40 && (p.blindHitPct ?? 100) < 70,
                evidence: p => `${p.blindsCalled} blinds called, only ${p.blindHitPct}% landed`,
            },
            {
                id: 'tilter',
                label: 'Garam dimaag',
                blurb: 'Ek round kharab, agla blind.',
                test: p => { const t = tiltOf(p.team); return t && t.tiltIndex >= 40; },
                evidence: p => {
                    const t = tiltOf(p.team);
                    return `blind rate jumps ${t.afterGoodPct}% to ${t.afterBadPct}% after a bad round`;
                },
            },
            {
                id: 'gambler',
                label: 'Jugaadu',
                blurb: 'Plan B hi Plan A hai.',
                test: p => p.avgPromise >= avgPromise + 0.2 && p.promisesKeptPct < avgKept,
                evidence: p => `promises ${p.avgPromise} a round but keeps only ${p.promisesKeptPct}%`,
            },
            {
                id: 'rock',
                label: 'Bharosemand',
                blurb: 'Boring. Effective. Deadly.',
                test: p => p.promisesKeptPct >= avgKept + 2 && p.overExtensions <= 1,
                evidence: p => `${p.promisesKeptPct}% kept, only ${p.overExtensions} over-extension`,
            },
            {
                id: 'safe',
                label: 'Darr ka mara',
                blurb: 'Chhota bid, chhoti khushi.',
                test: p => p.avgPromise <= avgPromise - 0.2,
                evidence: p => `promises just ${p.avgPromise} hands a round — the timidest at the table`,
            },
            {
                id: 'workhorse',
                label: 'Table ka pillar',
                blurb: 'Har match mein hai.',
                test: () => true,                       // fallback — always matches
                evidence: p => `${p.rounds} rounds across ${p.played} matches`,
            },
        ];

        return profiles.map(p => {
            const arch = ARCHETYPES.find(a => a.test(p)) || ARCHETYPES[ARCHETYPES.length - 1];
            const t = tiltOf(p.team);
            return {
                team: p.team,
                archetype: arch.label,
                archetypeId: arch.id,
                blurb: arch.blurb,
                evidence: arch.evidence(p),
                // Four 0–100 bars. Each is a real ratio, clamped — never a
                // made-up "rating out of 100".
                traits: {
                    nerve: Math.min(100, Math.round((p.blindsCalled / Math.max(1, p.rounds)) * 300)),
                    discipline: p.promisesKeptPct,
                    blindEye: p.blindHitPct ?? 0,
                    coolHead: t ? Math.max(0, 100 - t.tiltIndex) : null,
                },
                record: `${p.wins}-${p.losses}`,
                rounds: p.rounds,
                avgPromise: p.avgPromise,
                tiltIndex: t ? t.tiltIndex : null,
            };
        });
    }

    // ─── 7. Oddities — the numbers nobody would think to compute ─────────────
    function oddities(matches) {
        const completed = (matches || []).filter(isCompleted);
        const out = [];

        // The single most popular promise in the league.
        const promiseFreq = new Map();
        let sevenNonBlind = 0, thirteens = 0, perfectHits = 0, sides = 0, zeroHands = 0;
        eachSide(completed, s => {
            sides++;
            if (s.actual === 0) zeroHands++;
            if (s.blind) return;
            if (s.promise < 4) return;
            promiseFreq.set(s.promise, (promiseFreq.get(s.promise) || 0) + 1);
            if (s.promise === 7) sevenNonBlind++;
            if (s.actual === 13) thirteens++;
            if (s.actual === s.promise) perfectHits++;
        });
        const favourite = [...promiseFreq.entries()].sort((a, b) => b[1] - a[1])[0];
        if (favourite) {
            out.push({
                id: 'favourite-promise',
                stat: `${favourite[0]} is the most-promised number in the league — called ${favourite[1]} times.`,
            });
        }
        if (perfectHits) {
            out.push({
                id: 'exact-hits',
                stat: `${perfectHits} of ${sides} round-sides landed exactly on the promised number, not one hand more.`,
            });
        }
        if (thirteens) {
            out.push({
                id: 'all-thirteen',
                stat: thirteens === 1
                    ? 'One team has swept all 13 hands in a single round — which under the rules is a penalty, not a triumph.'
                    : `Teams have swept all 13 hands ${thirteens} times — which under the rules is a penalty, not a triumph.`,
            });
        }
        if (zeroHands) {
            out.push({
                id: 'zero-hands',
                stat: `${zeroHands} round-side${zeroHands === 1 ? ' has' : 's have'} ended with zero hands taken.`,
            });
        }
        if (sevenNonBlind) {
            out.push({
                id: 'seven-open-eyed',
                stat: `7 has been promised open-eyed ${sevenNonBlind} times, rather than taking the blind at the very same number.`,
            });
        }

        // Does going first help? Under the locked rules team1 wins exact ties
        // (§2), so this is a real question worth answering.
        let t1Wins = 0, decided = 0;
        for (const m of completed) {
            if (!m.winnerId) continue;
            decided++;
            if (String(m.winnerId) === String(m.team1Id)) t1Wins++;
        }
        if (decided >= 10) {
            out.push({
                id: 'first-team-edge',
                stat: `The team listed first has won ${t1Wins} of ${decided} decided matches.`,
            });
        }

        // How often does a match go the full distance vs end early?
        const lengths = completed.map(m => roundsOf(m).length).filter(Boolean);
        if (lengths.length >= 10) {
            const sorted = lengths.slice().sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            out.push({
                id: 'typical-length',
                stat: `The typical match runs ${median} rounds — ${lengths.filter(n => n > median).length} have gone longer.`,
            });
        }

        // Which round number is the bloodiest?
        const byRound = new Map();
        eachSide(completed, s => {
            const b = byRound.get(s.roundNumber) || { n: 0, neg: 0 };
            b.n++;
            if (s.score < 0) b.neg++;
            byRound.set(s.roundNumber, b);
        });
        const bloody = [...byRound.entries()]
            .filter(([, b]) => b.n >= 10)
            .sort((a, b) => (b[1].neg / b[1].n) - (a[1].neg / a[1].n))[0];
        if (bloody) {
            out.push({
                id: 'bloodiest-round',
                stat: `Round ${bloody[0]} is the cruellest slot in a match — ${pct(bloody[1].neg / bloody[1].n)}% of promises made there ended negative.`,
            });
        }

        return out;
    }

    // ─── The digest ──────────────────────────────────────────────────────────
    // One object, small enough to hand to an LLM whole, rich enough that every
    // static fact it writes is a real number from real play.
    function build(teams, matches, options = {}) {
        const raw = { teams: (teams || []).length, matches: (matches || []).length };
        // Seed/test teams are stripped once, here — every section below then
        // operates on real play only.
        const filtered = withoutExcluded(teams, matches, options.excludeTeams);
        teams = filtered.teams;
        matches = filtered.matches;

        return {
            generatedFrom: {
                teams: raw.teams,
                matches: raw.matches,
                excludedTeams: filtered.excluded.length,
                excludedMatches: raw.matches - matches.length,
            },
            overview: overview(teams, matches),
            teams: teamProfiles(teams, matches).slice(0, options.teamLimit || 12),
            promiseBands: promiseBands(matches),
            blinds: blindReport(teams, matches),
            records: records(teams, matches),
            rivalries: rivalries(teams, matches),
            streaks: streaks(teams, matches),
            tilt: tilt(teams, matches),
            personalities: personalities(teams, matches),
            oddities: oddities(matches),
        };
    }

    return {
        build,
        overview, teamProfiles, promiseBands, blindReport,
        records, rivalries, streaks, oddities,
        tilt, personalities,
        // internals exposed for tests
        eachSide, chronological, isBlind,
        withoutExcluded, excludedIdSet, DEFAULT_EXCLUDED,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeasonDigest;
}
