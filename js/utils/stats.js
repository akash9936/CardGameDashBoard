/**
 * Pure-function statistics computed from raw teams + matches.
 * No Firestore reads, no side effects. Safe to call on every render.
 */
const StatsUtils = (() => {
    function isCompleted(m) { return m.status === 'completed'; }

    function teamIdsOf(m) { return [String(m.team1Id), String(m.team2Id)]; }

    function teamSide(match, teamId) {
        return String(match.team1Id) === String(teamId) ? 'team1' : 'team2';
    }

    function opponentId(match, teamId) {
        return String(match.team1Id) === String(teamId) ? String(match.team2Id) : String(match.team1Id);
    }

    function isBlindSide(side) {
        if (!side) return false;
        if (side.blind === true) return true;
        if (side.blind === false) return false;
        return side.promise === 7 && side.score === 140;
    }

    function kpis(matches) {
        const completed = matches.filter(isCompleted);
        let totalRounds = 0;
        let highestRoundScore = -Infinity;
        let blindsCalled = 0;

        for (const m of matches) {
            const rounds = Array.isArray(m.rounds) ? m.rounds : [];
            totalRounds += rounds.length;
            for (const r of rounds) {
                const s1 = Number(r.team1?.score ?? -Infinity);
                const s2 = Number(r.team2?.score ?? -Infinity);
                if (s1 > highestRoundScore) highestRoundScore = s1;
                if (s2 > highestRoundScore) highestRoundScore = s2;
                if (isBlindSide(r.team1)) blindsCalled++;
                if (isBlindSide(r.team2)) blindsCalled++;
            }
        }

        return {
            totalMatches: completed.length,
            totalRounds,
            highestRoundScore: highestRoundScore === -Infinity ? 0 : highestRoundScore,
            blindsCalled,
        };
    }

    function leaderboard(teams, matches) {
        const rows = teams.map(t => ({
            id: String(t.id),
            name: t.name,
            played: 0, wins: 0, losses: 0,
            points: 0, totalScore: 0,
            roundsWon: 0, roundsLost: 0,
        }));
        const byId = new Map(rows.map(r => [r.id, r]));

        for (const m of matches.filter(isCompleted)) {
            const t1 = byId.get(String(m.team1Id));
            const t2 = byId.get(String(m.team2Id));
            if (!t1 || !t2) continue;

            t1.played++; t2.played++;
            t1.totalScore += Number(m.finalScore?.team1 || 0);
            t2.totalScore += Number(m.finalScore?.team2 || 0);
            t1.roundsWon += Number(m.roundStats?.team1?.won || 0);
            t1.roundsLost += Number(m.roundStats?.team1?.lost || 0);
            t2.roundsWon += Number(m.roundStats?.team2?.won || 0);
            t2.roundsLost += Number(m.roundStats?.team2?.lost || 0);

            if (String(m.winnerId) === t1.id) { t1.wins++; t1.points += 3; t2.losses++; }
            else if (String(m.winnerId) === t2.id) { t2.wins++; t2.points += 3; t1.losses++; }
        }

        for (const r of rows) {
            r.winPct = r.played ? (r.wins / r.played) * 100 : 0;
            r.avgScore = r.played ? r.totalScore / r.played : 0;
        }

        rows.sort((a, b) =>
            b.points - a.points ||
            b.winPct - a.winPct ||
            b.totalScore - a.totalScore ||
            a.name.localeCompare(b.name)
        );
        rows.forEach((r, i) => { r.rank = i + 1; });
        return rows;
    }

    function recentForm(teams, matches, lastN = 5) {
        const completed = matches
            .filter(isCompleted)
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const out = new Map();
        for (const t of teams) {
            const teamId = String(t.id);
            const form = [];
            for (const m of completed) {
                const ids = teamIdsOf(m);
                if (!ids.includes(teamId)) continue;
                form.push(String(m.winnerId) === teamId ? 'W' : 'L');
                if (form.length >= lastN) break;
            }
            out.set(teamId, form);
        }
        return out;
    }

    function cumulativeSeries(match) {
        const rounds = Array.isArray(match.rounds) ? match.rounds.slice() : [];
        rounds.sort((a, b) => a.roundNumber - b.roundNumber);
        const labels = ['Start'];
        const team1 = [0], team2 = [0];
        let t1 = 0, t2 = 0;
        for (const r of rounds) {
            t1 += Number(r.team1?.score || 0);
            t2 += Number(r.team2?.score || 0);
            labels.push(`R${r.roundNumber}`);
            team1.push(t1);
            team2.push(t2);
        }
        return { labels, team1, team2 };
    }

    function roundOutcome(side) {
        if (!side) return 'neutral';
        const score = Number(side.score || 0);
        if (isBlindSide(side)) return score > 0 ? 'blind-success' : 'blind-fail';
        if (score < 0) return 'negative';
        if (score === 0) return 'neutral';
        return 'positive';
    }

    function teamMatches(teamId, matches) {
        const id = String(teamId);
        return matches
            .filter(m => teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function teamProfile(teamId, teams, matches) {
        const id = String(teamId);
        const team = teams.find(t => String(t.id) === id);
        if (!team) return null;
        const all = teamMatches(id, matches);
        const completed = all.filter(isCompleted);

        let wins = 0, losses = 0, totalScore = 0;
        let roundsWon = 0, roundsLost = 0;
        let bestMatchScore = -Infinity, bestMatchId = null;
        const opponentCounts = new Map();

        for (const m of completed) {
            const side = teamSide(m, id);
            const myScore = Number(m.finalScore?.[side] || 0);
            totalScore += myScore;
            roundsWon += Number(m.roundStats?.[side]?.won || 0);
            roundsLost += Number(m.roundStats?.[side]?.lost || 0);
            if (String(m.winnerId) === id) wins++; else if (m.winnerId) losses++;
            if (myScore > bestMatchScore) { bestMatchScore = myScore; bestMatchId = m.id; }
            const opp = opponentId(m, id);
            opponentCounts.set(opp, (opponentCounts.get(opp) || 0) + 1);
        }

        const played = completed.length;
        let topOpponentId = null, topOpponentCount = 0;
        for (const [oid, count] of opponentCounts) {
            if (count > topOpponentCount) { topOpponentId = oid; topOpponentCount = count; }
        }

        return {
            id,
            name: team.name,
            members: Array.isArray(team.members) ? team.members : [],
            played, wins, losses,
            points: wins * 3,
            winPct: played ? (wins / played) * 100 : 0,
            totalScore,
            avgScore: played ? totalScore / played : 0,
            roundsWon, roundsLost,
            bestMatchScore: bestMatchScore === -Infinity ? 0 : bestMatchScore,
            bestMatchId,
            topOpponentId,
            allMatches: all,
        };
    }

    function headToHead(teamId, opponentId, matches) {
        const id = String(teamId), oid = String(opponentId);
        const between = matches.filter(m => {
            const ids = teamIdsOf(m);
            return isCompleted(m) && ids.includes(id) && ids.includes(oid);
        }).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

        let wins = 0, losses = 0;
        for (const m of between) {
            if (String(m.winnerId) === id) wins++;
            else if (m.winnerId) losses++;
        }
        const recent = between.slice(0, 3).map(m => String(m.winnerId) === id ? 'W' : 'L');
        return { played: between.length, wins, losses, recent };
    }

    function teamScoreSeries(teamId, matches) {
        const id = String(teamId);
        const completed = matches
            .filter(m => isCompleted(m) && teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        return completed.map((m, i) => ({
            x: i + 1,
            y: Number(m.finalScore?.[teamSide(m, id)] || 0),
            matchId: m.id,
            date: m.date,
        }));
    }

    function teamPromiseActualPoints(teamId, matches) {
        const id = String(teamId);
        const points = [];
        for (const m of matches) {
            if (!teamIdsOf(m).includes(id)) continue;
            const side = teamSide(m, id);
            for (const r of (m.rounds || [])) {
                const v = r[side];
                if (!v) continue;
                points.push({
                    x: Number(v.promise || 0),
                    y: Number(v.actual || 0),
                    score: Number(v.score || 0),
                    blind: isBlindSide(v),
                });
            }
        }
        return points;
    }

    function currentStreak(teamId, matches) {
        const id = String(teamId);
        const completed = matches
            .filter(m => isCompleted(m) && teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (!completed.length) return { count: 0, type: null };
        const first = String(completed[0].winnerId) === id ? 'W' : 'L';
        let count = 0;
        for (const m of completed) {
            const r = String(m.winnerId) === id ? 'W' : 'L';
            if (r !== first) break;
            count++;
        }
        return { count, type: first };
    }

    function hottestStreak(teams, matches, minCount = 3) {
        let best = null;
        for (const t of teams) {
            const s = currentStreak(t.id, matches);
            if (s.count >= minCount && (!best || s.count > best.count)) {
                best = { teamId: String(t.id), name: t.name, ...s };
            }
        }
        return best;
    }

    function topRoundScore(matches) {
        let best = { score: -Infinity, matchId: null, roundNumber: null, side: null };
        for (const m of matches) {
            for (const r of (m.rounds || [])) {
                for (const side of ['team1', 'team2']) {
                    const s = Number(r[side]?.score || 0);
                    if (s > best.score) {
                        best = { score: s, matchId: m.id, roundNumber: r.roundNumber, side };
                    }
                }
            }
        }
        if (!isFinite(best.score)) return null;
        return best;
    }

    const TEAM_PALETTE = [
        '#6366f1', // indigo
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ef4444', // red
        '#06b6d4', // cyan
        '#a855f7', // purple
        '#84cc16', // lime
        '#ec4899', // pink
        '#f97316', // orange
        '#14b8a6', // teal
        '#3b82f6', // blue
        '#eab308', // yellow
    ];

    function teamColor(teamId) {
        const s = String(teamId);
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = (hash * 41 + s.charCodeAt(i)) >>> 0;
        }
        return TEAM_PALETTE[hash % TEAM_PALETTE.length];
    }

    // ─── §3b.5 Team Theme Pack ───────────────────────────────────────────────
    // 24 curated unicode glyphs (no emoji — single-shape Symbol-block chars
    // that render consistently across Mac/Win/Linux/Android sans color font).
    const ICON_SET = [
        { key: 'spade',    glyph: '♠' },
        { key: 'club',     glyph: '♣' },
        { key: 'heart',    glyph: '♥' },
        { key: 'diamond',  glyph: '♦' },
        { key: 'star',     glyph: '★' },
        { key: 'shamrock', glyph: '☘' },
        { key: 'comet',    glyph: '☄' },
        { key: 'anchor',   glyph: '⚓' },
        { key: 'swords',   glyph: '⚔' },
        { key: 'bolt',     glyph: '⚡' },
        { key: 'atom',     glyph: '⚛' },
        { key: 'fleur',    glyph: '⚜' },
        { key: 'knight',   glyph: '♞' },
        { key: 'rhomb',    glyph: '◆' },
        { key: 'tri',      glyph: '▲' },
        { key: 'disc',     glyph: '●' },
        { key: 'sparkle',  glyph: '✦' },
        { key: 'circled',  glyph: '✪' },
        { key: 'arrow',    glyph: '➤' },
        { key: 'gear',     glyph: '⚙' },
        { key: 'crown',    glyph: '♛' },
        { key: 'tower',    glyph: '♜' },
        { key: 'hammer',   glyph: '⚒' },
        { key: 'ankh',     glyph: '☥' },
    ];

    const PATTERN_SET = [
        { key: 'dot' },
        { key: 'stripe-up' },     // diagonal ↗
        { key: 'stripe-h' },      // horizontal
        { key: 'stripe-down' },   // diagonal ↘
        { key: 'chevron' },
        { key: 'hatch' },         // cross-hatch
    ];

    function _hashIndex(seed, modulo) {
        const s = String(seed);
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = (h * 41 + s.charCodeAt(i)) >>> 0;
        }
        return h % modulo;
    }

    // Resolve the icon spec for a team. Accepts either a team object (with
    // optional .theme.iconKey) or a bare id (deterministic fallback).
    function teamIcon(team) {
        const id = team && typeof team === 'object' ? team.id : team;
        const overrideKey = team && typeof team === 'object'
            ? team.theme?.iconKey
            : null;
        if (overrideKey) {
            const hit = ICON_SET.find(i => i.key === overrideKey);
            if (hit) return hit;
        }
        return ICON_SET[_hashIndex(id, ICON_SET.length)];
    }

    function teamPattern(team) {
        const id = team && typeof team === 'object' ? team.id : team;
        const overrideKey = team && typeof team === 'object'
            ? team.theme?.patternKey
            : null;
        if (overrideKey) {
            const hit = PATTERN_SET.find(p => p.key === overrideKey);
            if (hit) return hit;
        }
        return PATTERN_SET[_hashIndex(id, PATTERN_SET.length)];
    }

    function headToHeadMatrix(teams, matches) {
        const ranked = leaderboard(teams, matches);
        const ids = ranked.map(r => r.id);
        const cells = {};
        for (const a of ids) {
            cells[a] = {};
            for (const b of ids) {
                if (a === b) { cells[a][b] = null; continue; }
                cells[a][b] = headToHead(a, b, matches);
            }
        }
        const namesById = new Map(ranked.map(r => [r.id, r.name]));
        return { ids, namesById, cells };
    }

    function topRivalry(matches) {
        const counts = new Map();
        for (const m of matches) {
            if (!isCompleted(m)) continue;
            const [a, b] = teamIdsOf(m).slice().sort();
            const key = `${a}|${b}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        let best = null;
        for (const [key, count] of counts) {
            if (!best || count > best.count) {
                const [team1Id, team2Id] = key.split('|');
                best = { team1Id, team2Id, count };
            }
        }
        return best;
    }

    function matchSummary(match) {
        const rounds = Array.isArray(match.rounds) ? match.rounds : [];
        let blinds = 0, overExtensions = 0;
        let biggestSwing = { round: null, delta: 0 };

        for (const r of rounds) {
            for (const side of ['team1', 'team2']) {
                const v = r[side];
                if (!v) continue;
                if (isBlindSide(v)) blinds++;
                const promise = Number(v.promise || 0);
                const actual = Number(v.actual || 0);
                if (promise > 0 && actual >= promise * 2 && !isBlindSide(v)) overExtensions++;
            }
            const delta = Math.abs(Number(r.team1?.score || 0) - Number(r.team2?.score || 0));
            if (delta > biggestSwing.delta) biggestSwing = { round: r.roundNumber, delta };
        }

        return { blinds, overExtensions, biggestSwing, totalRounds: rounds.length };
    }

    // ─── Moment Reel (§4.0) ──────────────────────────────────────────────────
    // Returns up to three turning points: biggest swing, best blind, worst call.
    // Each entry is { key, label, roundNumber, sideId, score, delta }, or null
    // if no qualifying round exists (and no fallback applies).
    //
    // Selection rules:
    //   1. BIGGEST SWING — round with the largest |team1.score − team2.score|.
    //   2. BEST BLIND    — highest positive score on a blind side. Fallback:
    //                      highest single positive round score (any side).
    //   3. WORST CALL    — most-negative score caused by over-extension (non-blind).
    //                      Fallback: most-negative score from under-promise.
    //
    // If two slots resolve to the same round, slot 2 / slot 3 try their
    // fallback to keep all three distinct when possible.
    function momentReel(match) {
        const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
        if (!rounds.length) return { biggestSwing: null, bestBlind: null, worstCall: null };

        const t1Id = match.team1Id, t2Id = match.team2Id;
        const enriched = rounds.map(r => {
            const s1 = Number(r.team1?.score || 0);
            const s2 = Number(r.team2?.score || 0);
            return { r, s1, s2, delta: Math.abs(s1 - s2) };
        });

        // 1. Biggest swing — guaranteed to exist if rounds.length > 0.
        const swing = enriched.slice().sort((a, b) => b.delta - a.delta)[0];
        const swingWinner = swing.s1 >= swing.s2 ? 'team1' : 'team2';
        const biggestSwing = {
            key: 'biggestSwing',
            label: 'BIGGEST SWING',
            roundNumber: swing.r.roundNumber,
            sideId: swingWinner === 'team1' ? t1Id : t2Id,
            score: swingWinner === 'team1' ? swing.s1 : swing.s2,
            delta: swing.delta,
        };

        // 2. Best blind, with fallback to best single positive round.
        let bestBlind = null;
        let bestBlindScore = -Infinity;
        for (const { r } of enriched) {
            for (const side of ['team1', 'team2']) {
                if (isBlindSide(r[side])) {
                    const s = Number(r[side].score || 0);
                    if (s > bestBlindScore && s > 0) {
                        bestBlindScore = s;
                        bestBlind = {
                            key: 'bestBlind',
                            label: 'BEST BLIND',
                            roundNumber: r.roundNumber,
                            sideId: side === 'team1' ? t1Id : t2Id,
                            score: s,
                            delta: null,
                        };
                    }
                }
            }
        }
        if (!bestBlind) {
            // Fallback — highest positive round score on any side.
            let topScore = -Infinity, top = null;
            for (const { r } of enriched) {
                for (const side of ['team1', 'team2']) {
                    const s = Number(r[side]?.score || 0);
                    if (s > topScore && s > 0) {
                        topScore = s;
                        top = {
                            key: 'bestBlind',
                            label: 'HIGHEST SCORE',
                            roundNumber: r.roundNumber,
                            sideId: side === 'team1' ? t1Id : t2Id,
                            score: s,
                            delta: null,
                        };
                    }
                }
            }
            bestBlind = top;
        }

        // 3. Worst call — over-extension first, then under-promise as fallback.
        let worstOver = null, worstOverScore = Infinity;
        let worstUnder = null, worstUnderScore = Infinity;
        for (const { r } of enriched) {
            for (const side of ['team1', 'team2']) {
                const v = r[side];
                if (!v) continue;
                if (isBlindSide(v)) continue;
                const promise = Number(v.promise || 0);
                const actual = Number(v.actual || 0);
                const score = Number(v.score || 0);
                if (promise > 0 && actual >= promise * 2 && score < worstOverScore) {
                    worstOverScore = score;
                    worstOver = {
                        key: 'worstCall',
                        label: 'WORST CALL',
                        roundNumber: r.roundNumber,
                        sideId: side === 'team1' ? t1Id : t2Id,
                        score, delta: null,
                    };
                } else if (actual < promise && score < worstUnderScore) {
                    worstUnderScore = score;
                    worstUnder = {
                        key: 'worstCall',
                        label: 'BIGGEST MISS',
                        roundNumber: r.roundNumber,
                        sideId: side === 'team1' ? t1Id : t2Id,
                        score, delta: null,
                    };
                }
            }
        }
        let worstCall = worstOver || worstUnder;

        // De-duplicate the worst-call slot only.
        //
        // Rationale: a +140 blind that *was* also the biggest swing is the
        // headline of the match, not a conflict to resolve — let the swing and
        // best-blind share a round when that's the truth. But a negative round
        // showing up next to its own positive twin is just noise, so we move
        // worst-call to a different round when an alternative exists.
        if (worstCall && (worstCall.roundNumber === biggestSwing.roundNumber
                       || (bestBlind && worstCall.roundNumber === bestBlind.roundNumber))) {
            const taken = new Set([biggestSwing.roundNumber, bestBlind?.roundNumber].filter(Boolean));
            let alt = null, altScore = Infinity;
            for (const { r } of enriched) {
                if (taken.has(r.roundNumber)) continue;
                for (const side of ['team1', 'team2']) {
                    const v = r[side];
                    if (!v || isBlindSide(v)) continue;
                    const s = Number(v.score || 0);
                    if (s < altScore && s < 0) {
                        altScore = s;
                        alt = { ...worstCall, roundNumber: r.roundNumber, sideId: side === 'team1' ? t1Id : t2Id, score: s };
                    }
                }
            }
            if (alt) worstCall = alt;
        }

        return { biggestSwing, bestBlind, worstCall };
    }

    // ─── Promise Accuracy (§4.1) ─────────────────────────────────────────────
    // A side "met" their promise when:
    //   blind:  actual >= 7
    //   normal: actual >= promise && actual < promise * 2
    // Both promises in a round count toward the bid total (blind included).
    function promiseAccuracy(teams, matches) {
        const perTeam = new Map();
        for (const t of (teams || [])) {
            perTeam.set(String(t.id), { bid: 0, met: 0, rate: 0 });
        }
        let totalBid = 0, totalMet = 0;

        for (const m of (matches || [])) {
            for (const r of (Array.isArray(m.rounds) ? m.rounds : [])) {
                for (const sideKey of ['team1', 'team2']) {
                    const side = r[sideKey];
                    if (!side) continue;
                    const tid = String(sideKey === 'team1' ? m.team1Id : m.team2Id);
                    const stats = perTeam.get(tid) || { bid: 0, met: 0, rate: 0 };
                    const blind = isBlindSide(side);
                    const actual = Number(side.actual || 0);
                    const promise = Number(side.promise || 0);
                    const met = blind
                        ? actual >= 7
                        : (promise > 0 && actual >= promise && actual < promise * 2);
                    stats.bid++;
                    if (met) stats.met++;
                    perTeam.set(tid, stats);
                    totalBid++;
                    if (met) totalMet++;
                }
            }
        }

        const byTeam = {};
        for (const [id, s] of perTeam) {
            s.rate = s.bid ? s.met / s.bid : 0;
            byTeam[id] = s;
        }
        return {
            byTeam,
            tournament: {
                bid: totalBid,
                met: totalMet,
                rate: totalBid ? totalMet / totalBid : 0,
            },
        };
    }

    // ─── Blind Economy (§4.2) ────────────────────────────────────────────────
    // Tracks how the +140 / −70 sword cuts both ways.
    function blindEconomy(matches) {
        const perTeam = new Map();
        let called = 0, successes = 0, failures = 0;

        for (const m of (matches || [])) {
            for (const r of (Array.isArray(m.rounds) ? m.rounds : [])) {
                for (const sideKey of ['team1', 'team2']) {
                    const side = r[sideKey];
                    if (!side || !isBlindSide(side)) continue;
                    const tid = String(sideKey === 'team1' ? m.team1Id : m.team2Id);
                    const s = perTeam.get(tid) || { called: 0, successes: 0, failures: 0, netEV: 0 };
                    s.called++;
                    if (Number(side.score || 0) > 0) s.successes++;
                    else s.failures++;
                    s.netEV = s.successes * 140 + s.failures * -70;
                    perTeam.set(tid, s);

                    called++;
                    if (Number(side.score || 0) > 0) successes++;
                    else failures++;
                }
            }
        }

        const byTeam = {};
        for (const [id, s] of perTeam) byTeam[id] = s;
        return {
            byTeam,
            tournament: {
                called,
                successes,
                failures,
                successRate: called ? successes / called : 0,
                netEV: successes * 140 + failures * -70,
            },
        };
    }

    return {
        kpis, leaderboard, recentForm, teamSide, opponentId, isBlindSide,
        cumulativeSeries, roundOutcome, matchSummary, momentReel,
        promiseAccuracy, blindEconomy,
        teamProfile, headToHead, teamScoreSeries, teamPromiseActualPoints, teamMatches,
        currentStreak, hottestStreak, topRoundScore, topRivalry,
        headToHeadMatrix, teamColor, TEAM_PALETTE,
        teamIcon, teamPattern, ICON_SET, PATTERN_SET,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatsUtils;
}
